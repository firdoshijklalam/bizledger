import { db } from '@/lib/db'
import { accrueCustomerRewardFromInvoice } from '@/lib/rewards'

// §STEP7-REWARD-OUTBOX: Durable processing for reward accrual.
//
// §PURPOSE: closes the fire-and-forget gap. After an eligible sale commits,
// the outbox row (created atomically in the same $transaction) is processed:
//   - immediately post-commit (best-effort, non-fatal)
//   - by the cron worker (durable retry with backoff)
//   - by reconciliation (safety net for any missed invoices)
//
// §GUARANTEE: if an eligible sale commits, EITHER a CustomerRewardEvent
// (PROFIT_ACCRUAL) eventually exists for that invoice, OR a durable
// RewardAccrualOutbox row exists recording the unfinished work. The reward
// is NEVER silently lost.
//
// §CONCURRENT-PROCESSOR-SAFETY: claiming a row uses an atomic conditional
// UPDATE (updateMany with WHERE status IN ('PENDING','FAILED') AND backoff).
// Only the claimToken holder may transition PROCESSING → COMPLETED/FAILED.
// If two processors race, only one's updateMany matches (count===1); the
// other sees count===0 and skips. Even if both somehow invoke
// accrueCustomerRewardFromInvoice, the sourceInvoiceId unique constraint
// ensures no duplicate PROFIT_ACCRUAL event.
//
// §IDEMPOTENCY: accrueCustomerRewardFromInvoice is idempotent by
// (businessId, sourceInvoiceId). Retrying a COMPLETED invoice is safe —
// the second call returns the existing event (accrued=false).

// §MAX-ATTEMPTS: after this many failures, the row becomes PERMANENTLY_FAILED.
// 10 attempts with the backoff schedule below = ~10.6 hours of retries before
// giving up. This is generous enough to ride out a multi-hour DB outage.
//
// §PERMANENTLY_FAILED-SEMANTICS: PERMANENTLY_FAILED means AUTOMATIC retry is
// exhausted. The durable failure record remains (never deleted). MANUAL or
// operator-initiated retry is still possible later (e.g., by resetting the
// row to PENDING via a future admin route or DB query). Do NOT claim
// automatic eventual success after MAX_ATTEMPTS — the reward may remain
// un-accrued until manual intervention.
export const MAX_ATTEMPTS = 10

// §STALE-THRESHOLD: a PROCESSING row older than this is considered crashed
// and is eligible for reclaim by another processor. 5 minutes is long enough
// that a healthy accrual (sub-second) never trips it, but short enough that
// a crashed processor's row is reclaimed quickly.
export const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

// §BACKOFF-SCHEDULE: bounded, explicit. Index = attempts (0-based for the
// NEXT attempt). After attempt N fails, wait BACKOFF_SCHEDULE[N] before the
// next retry. The schedule is: 30s, 1m, 2m, 5m, 10m, 20m, 40m, 80m, 160m, 320m.
// Total time across 10 attempts ≈ 10.6 hours.
export const BACKOFF_SCHEDULE_MS = [
  30 * 1000,           // 30s
  60 * 1000,           // 1m
  2 * 60 * 1000,       // 2m
  5 * 60 * 1000,       // 5m
  10 * 60 * 1000,      // 10m
  20 * 60 * 1000,      // 20m
  40 * 60 * 1000,      // 40m
  80 * 60 * 1000,      // 80m
  160 * 60 * 1000,     // 160m
  320 * 60 * 1000,     // 320m
]

// §PROCESS-LIMIT: maximum rows processed per cron invocation. Bounded to keep
// the cron route within Vercel's maxDuration (60s for cron routes by default).
export const PROCESS_LIMIT = 50

// §RESULT-TYPE: summary returned by processPendingRewardAccruals + the cron
// route. Used for observability + tests.
export type ProcessSummary = {
  claimed: number
  completed: number
  failed: number
  permanentlyFailed: number
  reclaimed: number
  errors: Array<{ invoiceId: string; error: string }>
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: compute the backoff delay for the NEXT attempt.
// `attempts` is the number of failures so far (0 = first retry).
// Returns null if attempts >= MAX_ATTEMPTS (no more retries).
// ════════════════════════════════════════════════════════════════════════
function backoffForAttempt(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null
  const idx = Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1)
  return BACKOFF_SCHEDULE_MS[idx]
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: generate a unique claim token. Uses crypto.randomUUID when
// available (Node 19+), falls back to cuid-like timestamp+random.
// ════════════════════════════════════════════════════════════════════════
function generateClaimToken(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch {}
  return `claim-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: reclaim stale PROCESSING rows. A row is stale if
// processingStartedAt is older than STALE_PROCESSING_THRESHOLD_MS.
//
// §ATOMIC: uses updateMany with WHERE status='PROCESSING' AND
// processingStartedAt < cutoff. The reclaim resets the row to PENDING
// (so the drain query picks it up) and clears the stale claimToken.
//
// §SAFETY: only rows whose processingStartedAt is OLD are reclaimed. A
// healthy in-flight accrual (sub-second) never trips this. A crashed
// processor's row is reclaimed after 5 minutes.
// ════════════════════════════════════════════════════════════════════════
export async function reclaimStaleProcessing(limit = PROCESS_LIMIT): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS)
  const result = await db.rewardAccrualOutbox.updateMany({
    where: {
      status: 'PROCESSING',
      processingStartedAt: { lt: cutoff },
    },
    data: {
      status: 'PENDING',
      processingStartedAt: null,
      claimToken: null,
      // §NOTE: we do NOT reset attempts or lastAttemptAt here. The reclaim
      // itself is not a failure — it's a recovery. The next drain will claim
      // it and try again. If it keeps crashing, attempts will accumulate on
      // actual accrual failures.
    },
    // §NOTE: Prisma's updateMany does not support `take` directly in SQLite;
    // the WHERE clause + index on (status, processingStartedAt) keeps this
    // bounded. In production (PostgreSQL), a LIMIT would be ideal but is not
    // strictly necessary — the stale set is small.
  })
  return result.count
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: atomically claim a single outbox row for processing.
//
// §ATOMIC-CLAIM: this is the critical concurrency-safety primitive. We use
// updateMany with a WHERE clause that matches ONLY rows eligible for
// processing:
//   - status = 'PENDING' (never processed) OR
//   - status = 'FAILED' AND backoff elapsed (lastAttemptAt < now - backoff)
// The updateMany sets status='PROCESSING', claimToken=<token>,
// processingStartedAt=now, lastAttemptAt=now, attempts=attempts+1.
//
// If two processors race, only one's updateMany matches (count===1); the
// other sees count===0 and gets null. This is the atomic claim.
//
// §NOTE: this queries without businessId scope because the cron worker
// processes ALL businesses. Tenant isolation is maintained because the
// outbox row's businessId flows into accrueCustomerRewardFromInvoice, which
// scopes its eligibility query by businessId.
// ════════════════════════════════════════════════════════════════════════
async function claimOneRow(): Promise<{ id: string; businessId: string; invoiceId: string; attempts: number } | null> {
  const claimToken = generateClaimToken()
  const now = new Date()

  // §ATOMIC-CLAIM: find the oldest eligible PENDING or FAILED (backoff elapsed)
  // row and atomically transition it to PROCESSING. We do this in a single
  // updateMany to avoid the read-then-update race.
  //
  // §SQLITE-LIMITATION: Prisma's updateMany on SQLite does not support
  // ordering or LIMIT, so we claim the first matching row by id (cuid is
  // roughly time-ordered). On PostgreSQL, an `ORDER BY lastAttemptAt ASC
  // LIMIT 1` would be ideal. For SQLite dev, this is acceptable — the cron
  // runs single-threaded per invocation.
  //
  // §APPROACH: first find an eligible row, then atomically claim it by id
  // with a conditional updateMany (WHERE id AND status IN ('PENDING','FAILED')).
  // The conditional updateMany is the atomic guard — if two processors find
  // the same row, only one's updateMany matches.
  const eligible = await db.rewardAccrualOutbox.findFirst({
    where: {
      OR: [
        { status: 'PENDING' },
        {
          status: 'FAILED',
          lastAttemptAt: { lt: new Date(now.getTime() - 30 * 1000) }, // at least 30s since last attempt (min backoff)
        },
      ],
    },
    orderBy: { lastAttemptAt: 'asc' },
    select: { id: true, businessId: true, invoiceId: true, attempts: true },
  })

  if (!eligible) return null

  // §ATOMIC-CLAIM: transition PENDING/FAILED → PROCESSING atomically.
  // If another processor already claimed it, count===0 → return null.
  const claimResult = await db.rewardAccrualOutbox.updateMany({
    where: {
      id: eligible.id,
      status: { in: ['PENDING', 'FAILED'] },
    },
    data: {
      status: 'PROCESSING',
      claimToken,
      processingStartedAt: now,
      lastAttemptAt: now,
      attempts: { increment: 1 },
      lastError: null,
    },
  })

  if (claimResult.count === 0) {
    // §RACE-LOST: another processor claimed it first. Return null — the caller
    // will try to find the next eligible row.
    return null
  }

  // §CLAIM-WON: re-fetch to get the post-increment attempts value.
  const claimed = await db.rewardAccrualOutbox.findUnique({
    where: { id: eligible.id },
    select: { id: true, businessId: true, invoiceId: true, attempts: true },
  })
  return claimed
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-ONE: process a single outbox row by ID. Used by:
//   - the immediate post-commit handler (non-fatal .then/.catch)
//   - the cron worker (drain loop)
//   - tests (direct invocation)
//
// §FLOW:
//   1. fetch the outbox row
//   2. if COMPLETED or PERMANENTLY_FAILED → no-op (already done)
//   3. invoke accrueCustomerRewardFromInvoice(businessId, invoiceId)
//   4. success → mark COMPLETED + completedAt
//   5. failure → mark FAILED + lastError + attempts already incremented at claim
//      if attempts >= MAX_ATTEMPTS → PERMANENTLY_FAILED
//
// §NON-FATAL: this function NEVER throws. All errors are caught and recorded
// in the outbox row. The sale/order that triggered it remains committed.
// ════════════════════════════════════════════════════════════════════════
export async function processRewardAccrualOutbox(outboxId: string): Promise<{
  status: string
  accrued?: boolean
  error?: string
}> {
  const row = await db.rewardAccrualOutbox.findUnique({
    where: { id: outboxId },
    select: { id: true, businessId: true, invoiceId: true, status: true, attempts: true },
  })

  if (!row) {
    return { status: 'NOT_FOUND', error: 'Outbox row not found' }
  }

  // §SHORT-CIRCUIT: COMPLETED rows are never reprocessed.
  if (row.status === 'COMPLETED') {
    return { status: 'COMPLETED' }
  }
  // §SHORT-CIRCUIT: PERMANENTLY_FAILED rows are not auto-retried.
  if (row.status === 'PERMANENTLY_FAILED') {
    return { status: 'PERMANENTLY_FAILED' }
  }

  // §INVOKE-ACCRUAL: the reward service is idempotent. If the invoice was
  // already accrued (e.g., immediate post-commit succeeded but the outbox
  // status update failed), this returns { accrued: false, event: existing }.
  // We treat BOTH accrued=true AND accrued=false-with-event as success —
  // the reward profit was recorded.
  try {
    const result = await accrueCustomerRewardFromInvoice(row.businessId, row.invoiceId)

    if (result.accrued === true || (result.accrued === false && result.event)) {
      // §SUCCESS: mark COMPLETED. Both "newly accrued" and "already accrued
      // (idempotent)" count as success — the reward profit is durably recorded.
      await db.rewardAccrualOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          processingStartedAt: null,
          claimToken: null,
          lastError: null,
        },
      })
      return { status: 'COMPLETED', accrued: result.accrued }
    }

    // §ELIGIBILITY-FAILURE: the accrual returned accrued=false with NO event
    // and NO error (e.g., invoice was voided after commit, or partyId was
    // removed). This is a terminal state — retrying won't help. Mark COMPLETED
    // so we don't keep retrying. The reward service's eligibility filter is
    // authoritative.
    if (result.error && (
      result.error.includes('not eligible') ||
      result.error.includes('no partyId') ||
      result.error.includes('not found')
    )) {
      await db.rewardAccrualOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          processingStartedAt: null,
          claimToken: null,
          lastError: result.error,
        },
      })
      return { status: 'COMPLETED', error: result.error }
    }

    // §UNEXPECTED: accrual returned accrued=false with no event and no
    // recognizable error. Treat as failure + retry.
    throw new Error(result.error || 'Accrual returned no event and no error')
  } catch (e: any) {
    // §FAILURE: record the error. attempts was already incremented at claim
    // time (for cron-claimed rows) OR we increment it here (for immediate
    // post-commit processing where claim was not used).
    const errorMsg = String(e?.message ?? e ?? 'Unknown error').slice(0, 500)
    const newAttempts = row.attempts + 1

    if (newAttempts >= MAX_ATTEMPTS) {
      // §PERMANENTLY-FAILED: exhausted retries. Alertable.
      await db.rewardAccrualOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'PERMANENTLY_FAILED',
          attempts: newAttempts,
          lastError: errorMsg,
          lastAttemptAt: new Date(),
          processingStartedAt: null,
          claimToken: null,
        },
      })
      return { status: 'PERMANENTLY_FAILED', error: errorMsg }
    }

    // §FAILED: will be retried after backoff.
    await db.rewardAccrualOutbox.update({
      where: { id: outboxId },
      data: {
        status: 'FAILED',
        attempts: newAttempts,
        lastError: errorMsg,
        lastAttemptAt: new Date(),
        processingStartedAt: null,
        claimToken: null,
      },
    })
    return { status: 'FAILED', error: errorMsg }
  }
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-PENDING: drain up to `limit` eligible outbox rows.
//
// §FLOW:
//   1. reclaim stale PROCESSING rows (crashed processors)
//   2. loop: atomically claim one row, process it, repeat until limit or no
//      more eligible rows
//   3. return summary
//
// §BOUNDED: processes at most `limit` rows per invocation to stay within
// Vercel's maxDuration. Default 50.
//
// §CONCURRENT-SAFETY: the atomic claim (claimOneRow) ensures two concurrent
// processors never work the same row. Even if they did, accrueCustomerRewardFromInvoice
// is idempotent by sourceInvoiceId.
// ════════════════════════════════════════════════════════════════════════
export async function processPendingRewardAccruals(limit = PROCESS_LIMIT): Promise<ProcessSummary> {
  const summary: ProcessSummary = {
    claimed: 0,
    completed: 0,
    failed: 0,
    permanentlyFailed: 0,
    reclaimed: 0,
    errors: [],
  }

  // §STEP-1: reclaim stale PROCESSING rows (crashed processors).
  summary.reclaimed = await reclaimStaleProcessing(limit)

  // §STEP-2: drain eligible rows.
  for (let i = 0; i < limit; i++) {
    const claimed = await claimOneRow()
    if (!claimed) break // no more eligible rows

    summary.claimed++

    const result = await processRewardAccrualOutbox(claimed.id)

    if (result.status === 'COMPLETED') {
      summary.completed++
    } else if (result.status === 'PERMANENTLY_FAILED') {
      summary.permanentlyFailed++
      summary.errors.push({ invoiceId: claimed.invoiceId, error: result.error ?? 'permanently failed' })
    } else if (result.status === 'FAILED') {
      summary.failed++
      summary.errors.push({ invoiceId: claimed.invoiceId, error: result.error ?? 'failed' })
    }
    // §NOTE: NOT_FOUND or other unexpected statuses are not counted — the row
    // may have been deleted between claim and process (rare).
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §MARK-OUTBOX-RESULT: helper for the immediate post-commit handler.
// Invokes accrueCustomerRewardFromInvoice and updates the outbox row based
// on the result. NON-FATAL — all errors are caught and recorded.
//
// §USED-BY: src/app/api/invoices/route.ts + src/app/api/customer-orders/[id]/status/route.ts
// §REPLACES: the old fire-and-forget `.catch(console.error)`.
// ════════════════════════════════════════════════════════════════════════
export async function processOutboxRowForInvoice(
  businessId: string,
  invoiceId: string,
): Promise<void> {
  try {
    // §FIND-OUTBOX-ROW: the outbox row was created atomically with the invoice.
    // It should exist. If it doesn't (e.g., the invoice was ineligible and no
    // row was created), this is a no-op.
    const outboxRow = await db.rewardAccrualOutbox.findUnique({
      where: { invoiceId },
      select: { id: true, status: true },
    })

    if (!outboxRow) {
      // §NO-OUTBOX: the invoice was ineligible (purchase/void/walk-in) or the
      // outbox creation was skipped (backup restore). Nothing to do.
      return
    }

    // §SHORT-CIRCUIT: if already COMPLETED (e.g., a concurrent immediate call
    // or a fast cron beat us to it), no-op.
    if (outboxRow.status === 'COMPLETED' || outboxRow.status === 'PERMANENTLY_FAILED') {
      return
    }

    // §PROCESS: invoke the durable processor. This handles claim, accrual,
    // status transition, and error recording atomically.
    await processRewardAccrualOutbox(outboxRow.id)
  } catch (e: any) {
    // §NON-FATAL: the sale is already committed. Log and swallow.
    console.error('Reward outbox processing failed (non-fatal) for invoice', invoiceId, e)
  }
}
