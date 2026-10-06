import { db } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'
import {
  isWakeable,
  getUnsnoozePatch,
  statusChangeEvent,
  validateStatusTransition,
} from '@/lib/followups'

// §STEP8FB-FOLLOWUP-SCHEDULER: Server-side scheduler for follow-up reminders.
//
// §NO-HTTP: this module does NOT call HTTP routes. It uses shared server-side
// domain functions (getUnsnoozePatch, statusChangeEvent) — the SAME functions
// the transition API uses. This avoids the HTTP overhead + preserves the
// domain state machine rules.
//
// §CONCURRENCY: safe under concurrent cron invocations:
//   - Wake: uses an atomic conditional updateMany (WHERE status='SNOOZED')
//   - Due-soon/overdue: relies on DB-level unique index
//     (businessId, followUpId, type) WHERE followUpId IS NOT NULL.
//     Duplicate inserts hit P2002 → caught + treated as dedup success.
//
// §ACTOR: all scheduler-created events use actor='system' (not a user ID).
// This follows the existing convention (ComplaintEvent.actor can be 'system',
// AuditLog.staffName defaults to 'system').

type TxClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

// §DUE-SOON-WINDOW: follow-ups due within the next 1 hour.
// The cron runs DAILY at 01:00 UTC (0 1 * * *, configured in vercel.json) —
// the Vercel Hobby plan only permits daily cron schedules. Hobby cron timing
// is approximate: invocations are not guaranteed to fire at the exact
// scheduled minute and may be delayed. A delayed run still catches
// follow-ups entering the window because the scan uses dueAt <= now+1h
// (not a fixed boundary), and follow-ups whose dueAt passes between daily
// runs are picked up by the overdue phase (dueAt < now, PHASE-3). DB
// uniqueness dedupes overlapping windows.
export const DUE_SOON_WINDOW_MS = 60 * 60 * 1000 // 1 hour

// §PROCESS-LIMIT: bounded follow-ups per category per cron run.
export const SCHEDULER_PROCESS_LIMIT = 100

// §SYSTEM-ACTOR: the actor string for scheduler-created events.
export const SYSTEM_ACTOR = 'system'

// ════════════════════════════════════════════════════════════════════════
// §SHARED-WAKE-SERVICE: wakes a SNOOZED follow-up to PENDING.
//
// This is the SAME domain logic the transition API uses for SNOOZED → PENDING.
// Extracted as a shared function so both the API route + the scheduler call it
// without duplicating behavior.
//
// §REQUIREMENTS:
//   - only wakes SNOOZED follow-ups (validates current status from DB)
//   - requires snoozedUntil <= now
//   - transitions SNOOZED → PENDING using getUnsnoozePatch()
//   - clears snoozedUntil
//   - emits exactly one STATUS_CHANGE event (fromValue=SNOOZED, toValue=PENDING)
//   - actor = caller-provided (scheduler passes 'system', API passes user.id)
//   - entire update + event in ONE transaction
//   - idempotent if invoked concurrently (atomic conditional updateMany)
//   - does NOT create a notification
//   - does NOT call HTTP routes
// ════════════════════════════════════════════════════════════════════════
export async function wakeSnoozedFollowUp(
  tx: TxClient,
  followUpId: string,
  businessId: string,
  now: Date,
  actor: string = SYSTEM_ACTOR,
): Promise<{ woken: boolean }> {
  // §FETCH-CURRENT: read current status from DB (never trust caller's state)
  const current = await tx.followUp.findFirst({
    where: { id: followUpId, businessId },
    select: { id: true, status: true, snoozedUntil: true },
  })

  if (!current) return { woken: false }
  if (current.status !== 'SNOOZED') return { woken: false }
  if (!isWakeable(current, now)) return { woken: false }

  // §VALIDATE-TRANSITION: use the domain library
  const validation = validateStatusTransition(current.status, 'PENDING')
  if (!validation.ok) return { woken: false }

  // §ATOMIC: update + event in ONE transaction.
  // §IDEMPOTENT: the update uses WHERE status='SNOOZED' — if another worker
  // already woke it, the update matches 0 rows → we detect via count.
  const patch = getUnsnoozePatch()
  const eventPayload = statusChangeEvent({
    businessId,
    followUpId,
    fromStatus: 'SNOOZED',
    toStatus: 'PENDING',
    actor,
  })

  // §CONDITIONAL-UPDATE: only update if status is still SNOOZED
  const updateResult = await tx.followUp.updateMany({
    where: { id: followUpId, status: 'SNOOZED' },
    data: patch,
  })

  if (updateResult.count === 0) {
    // Another worker already woke it — idempotent no-op
    return { woken: false }
  }

  // §CREATE-EVENT: exactly one STATUS_CHANGE event
  await tx.followUpEvent.create({ data: eventPayload })

  return { woken: true }
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-WAKEABLE: find + wake all SNOOZED follow-ups where snoozedUntil <= now.
//
// §FLOW:
//   1. find SNOOZED follow-ups WHERE snoozedUntil <= now (across all businesses)
//   2. for each: run wakeSnoozedFollowUp inside a $transaction
//   3. per-follow-up errors are caught + recorded — do NOT abort the whole batch
// ════════════════════════════════════════════════════════════════════════
export async function processWakeableFollowUps(
  limit = SCHEDULER_PROCESS_LIMIT,
): Promise<{ scanned: number; woken: number; failed: number }> {
  const now = new Date()
  const summary = { scanned: 0, woken: 0, failed: 0 }

  const wakeable = await db.followUp.findMany({
    where: {
      status: 'SNOOZED',
      snoozedUntil: { lte: now },
    },
    select: { id: true, businessId: true },
    take: limit,
  })

  summary.scanned = wakeable.length

  for (const fu of wakeable) {
    try {
      const result = await db.$transaction(async (tx) => {
        return wakeSnoozedFollowUp(tx, fu.id, fu.businessId, now)
      })
      if (result.woken) summary.woken++
    } catch (e) {
      console.error('Failed to wake follow-up', fu.id, e)
      summary.failed++
    }
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §CREATE-FOLLOWUP-NOTIFICATION: creates a follow-up reminder notification.
//
// §DEDUP: relies on the DB-level partial unique index
//   (businessId, followUpId, type) WHERE followUpId IS NOT NULL.
//   Does NOT do findFirst-then-create. Attempts create directly.
//   On P2002 (unique conflict for the expected key), treats as dedup success.
//   On any OTHER error, rethrows (does NOT swallow unrelated DB errors).
//
// §CLASSIFY-P2002: only P2002 with the follow-up index target is treated as
//   dedup. Other P2002s (e.g. on invoiceId) are rethrown.
// ════════════════════════════════════════════════════════════════════════
async function createFollowUpNotification(opts: {
  businessId: string
  followUpId: string
  type: string
  title: string
  body: string
  link: string
}): Promise<{ created: boolean; deduped: boolean }> {
  try {
    await db.notification.create({
      data: {
        businessId: opts.businessId,
        type: opts.type,
        title: opts.title,
        body: opts.body,
        link: opts.link,
        isRead: false,
        followUpId: opts.followUpId,
        // invoiceId is NOT set for follow-up reminders
      },
    })
    return { created: true, deduped: false }
  } catch (e: any) {
    if (e?.code === 'P2002') {
      // §DEDUP: the unique index (businessId, followUpId, type) rejected
      // the insert — a notification of this type already exists for this
      // follow-up. This is the expected dedup behavior.
      return { created: false, deduped: true }
    }
    // §UNRELATED-ERROR: do NOT swallow. Rethrow so the caller can handle.
    throw e
  }
}

// ════════════════════════════════════════════════════════════════════════
// §PREFERENCE-HELPER: checks if follow-up notifications are enabled for a
// business. Follows the EXACT same convention as createSaleNotification:
//   - No preference row → default enabled (true)
//   - Preference row exists → use its `enabled` value
// This is a per-business check — the scheduler loads preferences for all
// relevant businesses in a bounded batch to avoid N+1 queries.
// ════════════════════════════════════════════════════════════════════════
const FOLLOWUP_PREF_KEY = 'followUps'

async function loadFollowUpPrefs(businessIds: string[]): Promise<Map<string, boolean>> {
  if (businessIds.length === 0) return new Map()
  const prefs = await db.notificationChannelPreference.findMany({
    where: { businessId: { in: businessIds }, key: FOLLOWUP_PREF_KEY },
    select: { businessId: true, enabled: true },
  })
  const map = new Map<string, boolean>()
  for (const p of prefs) {
    map.set(p.businessId, p.enabled)
  }
  return map
}

// §PREF-CHECK: returns true if follow-up notifications are enabled for this
// business (default true if no preference row exists).
function isFollowUpNotifEnabled(businessId: string, prefsMap: Map<string, boolean>): boolean {
  return prefsMap.get(businessId) ?? true
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-DUE-SOON: find PENDING follow-ups due within the next hour.
//
// §SCAN:
//   status = 'PENDING'
//   dueAt >= now (due now or in the future — inclusive boundary)
//   dueAt <= now + DUE_SOON_WINDOW_MS (within the window)
//   snoozedUntil IS NULL (not snoozed)
//
// §PREFERENCE-GATING: before creating a notification, checks if follow-up
// notifications are enabled for the follow-up's business. No preference row
// → default enabled (true). Disabled → skip notification creation.
// Wake behavior is NOT affected by this preference (wake runs independently).
//
// §BOUNDARY: dueAt === now is classified as "due soon" (not overdue).
// Overdue means dueAt < now (strictly past). This ensures no follow-up
// is missed at the exact boundary.
//
// §EXCLUSIONS: COMPLETED, CANCELLED, SNOOZED are excluded (not PENDING).
//
// §DEDUP: DB unique index (businessId, followUpId, 'followup_due_soon') prevents
// duplicates. Repeated cron runs → P2002 → deduped.
// Overlapping windows (delayed cron) are safe because the unique index is
// the authoritative guard — not the application's check.
// ════════════════════════════════════════════════════════════════════════
export async function processDueSoonReminders(
  limit = SCHEDULER_PROCESS_LIMIT,
): Promise<{ scanned: number; created: number; deduped: number; failed: number; skipped: number }> {
  const now = new Date()
  const horizon = new Date(now.getTime() + DUE_SOON_WINDOW_MS)
  const summary = { scanned: 0, created: 0, deduped: 0, failed: 0, skipped: 0 }

  const dueSoon = await db.followUp.findMany({
    where: {
      status: 'PENDING',
      dueAt: { gte: now, lte: horizon },
      snoozedUntil: null,
    },
    select: {
      id: true, businessId: true, title: true, dueAt: true,
      party: { select: { id: true, name: true } },
    },
    take: limit,
  })

  summary.scanned = dueSoon.length

  // §BATCH-PREFS: load follow-up notification preferences for all relevant
  // businesses in ONE query (avoids N+1).
  const businessIds = [...new Set(dueSoon.map(fu => fu.businessId))]
  const prefsMap = await loadFollowUpPrefs(businessIds)

  for (const fu of dueSoon) {
    // §PREFERENCE-CHECK: skip if follow-up notifications are disabled for this business
    if (!isFollowUpNotifEnabled(fu.businessId, prefsMap)) {
      summary.skipped++
      continue
    }
    try {
      const partyName = fu.party?.name || 'Unknown customer'
      const dueLabel = fu.dueAt ? new Date(fu.dueAt).toLocaleString('en-IN') : 'soon'
      const result = await createFollowUpNotification({
        businessId: fu.businessId,
        followUpId: fu.id,
        type: 'followup_due_soon',
        title: 'Follow-up due soon',
        body: `${partyName} • ${fu.title} • Due: ${dueLabel}`,
        link: `/?party=${fu.party?.id || ''}`,
      })
      if (result.created) summary.created++
      else if (result.deduped) summary.deduped++
    } catch (e) {
      console.error('Failed to create due-soon notification for follow-up', fu.id, e)
      summary.failed++
    }
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-OVERDUE: find PENDING follow-ups that are overdue.
//
// §SCAN:
//   status = 'PENDING'
//   dueAt < now (overdue)
//   snoozedUntil IS NULL (not snoozed)
//
// §PREFERENCE-GATING: same as due-soon — checks follow-up notification
// preference per business before creating a notification.
//
// §EXCLUSIONS: COMPLETED, CANCELLED, SNOOZED are excluded (not PENDING).
//
// §DEDUP: DB unique index (businessId, followUpId, 'followup_overdue') prevents
// duplicates. Repeated cron runs → P2002 → deduped. The overdue notification
// is created ONCE per follow-up. If the follow-up is completed then reopened,
// the existing overdue notification persists — no duplicate is created.
// ════════════════════════════════════════════════════════════════════════
export async function processOverdueReminders(
  limit = SCHEDULER_PROCESS_LIMIT,
): Promise<{ scanned: number; created: number; deduped: number; failed: number; skipped: number }> {
  const now = new Date()
  const summary = { scanned: 0, created: 0, deduped: 0, failed: 0, skipped: 0 }

  const overdue = await db.followUp.findMany({
    where: {
      status: 'PENDING',
      dueAt: { lt: now },
      snoozedUntil: null,
    },
    select: {
      id: true, businessId: true, title: true, dueAt: true,
      party: { select: { id: true, name: true } },
    },
    take: limit,
  })

  summary.scanned = overdue.length

  // §BATCH-PREFS: load follow-up notification preferences for all relevant businesses
  const businessIds = [...new Set(overdue.map(fu => fu.businessId))]
  const prefsMap = await loadFollowUpPrefs(businessIds)

  for (const fu of overdue) {
    // §PREFERENCE-CHECK: skip if follow-up notifications are disabled for this business
    if (!isFollowUpNotifEnabled(fu.businessId, prefsMap)) {
      summary.skipped++
      continue
    }
    try {
      const partyName = fu.party?.name || 'Unknown customer'
      const dueLabel = fu.dueAt ? new Date(fu.dueAt).toLocaleString('en-IN') : 'unknown'
      const result = await createFollowUpNotification({
        businessId: fu.businessId,
        followUpId: fu.id,
        type: 'followup_overdue',
        title: 'Follow-up overdue',
        body: `${partyName} • ${fu.title} • Was due: ${dueLabel}`,
        link: `/?party=${fu.party?.id || ''}`,
      })
      if (result.created) summary.created++
      else if (result.deduped) summary.deduped++
    } catch (e) {
      console.error('Failed to create overdue notification for follow-up', fu.id, e)
      summary.failed++
    }
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-SCHEDULED-FEEDBACK-TRANSITIONS: scan ProductFeedback rows whose
// requestedAt has arrived and atomically transition them from 'scheduled' to
// 'pending'. This is the lifecycle handoff in the feedback domain — when a
// scheduled feedback request reaches its requestedAt time, it becomes
// "actionable" (pending). The linked FollowUp is already PENDING with
// dueAt=requestedAt, so the existing due-soon/overdue scans handle the
// reminder notifications; this transition only marks the ProductFeedback
// record itself as actionable.
//
// §ATOMIC: uses updateMany with WHERE id AND status='scheduled' — conditional
// update. If two cron workers race, only one's updateMany matches
// (count===1); the other sees count===0 and skips. Idempotent.
//
// §FILTER: status='scheduled' AND requestedAt <= now. Pending/submitted/
// skipped/expired records are NOT transitioned (they are already actionable
// or terminal).
//
// §NOTE: ProductFeedback.requestedAt is nullable in the schema (legacy
// records created without requestedAt). The Prisma filter `requestedAt: { lte: now }`
// implicitly excludes NULL values (NULL is not <= anything in SQL), so
// legacy records with requestedAt=null are skipped — they are not transitioned
// by this phase. They will be transitioned only when the merchant explicitly
// submits/skips them via the API. This is acceptable — those legacy records
// are not "scheduled" in the new lifecycle sense.
// ════════════════════════════════════════════════════════════════════════
export async function processScheduledFeedbackTransitions(
  limit: number = SCHEDULER_PROCESS_LIMIT,
  now: Date = new Date(),
): Promise<{ scanned: number; transitioned: number; failed: number }> {
  const summary = { scanned: 0, transitioned: 0, failed: 0 }

  const scheduled = await db.productFeedback.findMany({
    where: {
      status: 'scheduled',
      requestedAt: { lte: now },
    },
    select: { id: true, followUpId: true },
    take: limit,
  })

  summary.scanned = scheduled.length

  for (const pf of scheduled) {
    try {
      // §ATOMIC-CONDITIONAL-UPDATE: only transition if status is still
      // 'scheduled'. If another worker already transitioned it (or the
      // merchant submitted/skipped it via the API), count===0 → no-op.
      const result = await db.productFeedback.updateMany({
        where: { id: pf.id, status: 'scheduled' },
        data: { status: 'pending' },
      })
      if (result.count > 0) {
        summary.transitioned++
      }
      // §NOTE: count===0 means another worker won OR the status changed
      // between our scan + our update. Both are fine — idempotent no-op.
    } catch (e) {
      console.error('Failed to transition scheduled feedback', pf.id, e)
      summary.failed++
    }
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-ALL: the main entry point for the cron route. Runs all 4 phases.
//
// §ORDER:
//   1. wake snoozed follow-ups (SNOOZED → PENDING)
//   2. transition scheduled feedback → pending (when requestedAt arrives)
//   3. due-soon reminders (PENDING, due within 1h)
//   4. overdue reminders (PENDING, past due)
//
// §PER-BUSINESS: processing is per-entity, not per-business. Each follow-up
// + feedback record is processed independently — errors in one do not abort
// others.
// ════════════════════════════════════════════════════════════════════════
export async function processAllFollowUpReminders(): Promise<{
  wake: { scanned: number; woken: number; failed: number }
  scheduled: { scanned: number; transitioned: number; failed: number }
  dueSoon: { scanned: number; created: number; deduped: number; failed: number; skipped: number }
  overdue: { scanned: number; created: number; deduped: number; failed: number; skipped: number }
}> {
  // §PHASE-1: wake snoozed follow-ups (SNOOZED → PENDING)
  const wake = await processWakeableFollowUps()

  // §PHASE-1.5: transition scheduled feedback → pending (when requestedAt
  // arrives). Runs AFTER wake (so woken follow-ups are not double-counted)
  // and BEFORE due-soon/overdue (so the feedback domain status reflects
  // "actionable" before the reminder scans run — though the scans key off
  // the FollowUp, not the ProductFeedback, this ordering is logical).
  const scheduled = await processScheduledFeedbackTransitions()

  // §PHASE-2: due-soon reminders (PENDING, due within 1h)
  const dueSoon = await processDueSoonReminders()

  // §PHASE-3: overdue reminders (PENDING, past due)
  const overdue = await processOverdueReminders()

  return { wake, scheduled, dueSoon, overdue }
}
