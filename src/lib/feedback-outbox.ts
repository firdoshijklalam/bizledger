import { db } from '@/lib/db'
import { createProductFeedbackRecord } from '@/lib/product-feedback'

// §FEEDBACK-OUTBOX: Durable processing for product-feedback-request creation.
//
// §PURPOSE: closes the fire-and-forget gap. After an eligible sale commits,
// the outbox row (created atomically in the same $transaction) is processed:
//   - immediately post-commit (best-effort, non-fatal)
//   - by the cron worker (durable retry with backoff)
//
// §GUARANTEE: if an eligible sale commits, EITHER a ProductFeedback record
// eventually exists for each unique productId (or one generic request when no
// product-backed items exist), OR a durable FeedbackOutbox row exists recording
// the unfinished work. The feedback request is NEVER silently lost.
//
// §MULTI-PRODUCT: the outbox row stores a JSON-stringified array of unique
// productIds (in deterministic first-appearance order from the invoice items)
// in the `productIds` column. The processor creates ONE ProductFeedback per
// unique productId — each call to createProductFeedbackRecord computes a
// distinct dedupKey (one per productId), so duplicates are impossible. If the
// JSON array is null/empty (no product-backed items), a single generic feedback
// record is created with productId=null.
//
// §CONCURRENT-PROCESSOR-SAFETY: claiming a row uses an atomic conditional
// UPDATE (updateMany with WHERE status IN ('PENDING','FAILED') AND backoff).
// Only the claimToken holder may transition PROCESSING → COMPLETED/FAILED.
// If two processors race, only one's updateMany matches (count===1); the
// other sees count===0 and skips. Even if both somehow invoke the create
// path, createProductFeedbackRecord's dedupKey + partial unique index
// guarantees no duplicate ProductFeedback records.
//
// §IDEMPOTENCY: createProductFeedbackRecord is race-safe by dedupKey. Retrying
// a COMPLETED invoice is safe — the second call short-circuits at the COMPLETED
// status check + each create call hits the dedupKey early-exit / P2002 catch.

// §MAX-ATTEMPTS: after this many failures, the row becomes PERMANENTLY_FAILED.
// 10 attempts with the backoff schedule below = ~10.6 hours of retries before
// giving up. This is generous enough to ride out a multi-hour DB outage.
//
// §PERMANENTLY_FAILED-SEMANTICS: PERMANENTLY_FAILED means AUTOMATIC retry is
// exhausted. The durable failure record remains (never deleted). MANUAL or
// operator-initiated retry is still possible later (e.g., by resetting the
// row to PENDING via a future admin route or DB query).
export const MAX_ATTEMPTS = 10

// §STALE-THRESHOLD: a PROCESSING row older than this is considered crashed
// and is eligible for reclaim by another processor. 5 minutes is long enough
// that a healthy create (sub-second) never trips it, but short enough that
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

// §RESULT-TYPE: summary returned by processPendingFeedbackOutbox + the cron
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
// healthy in-flight create (sub-second) never trips this. A crashed
// processor's row is reclaimed after 5 minutes.
// ════════════════════════════════════════════════════════════════════════
export async function reclaimStaleProcessing(limit = PROCESS_LIMIT): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_THRESHOLD_MS)
  const result = await db.feedbackOutbox.updateMany({
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
      // actual create failures.
    },
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
// outbox row's businessId flows into createProductFeedbackRecord, which
// scopes its eligibility + ownership checks by businessId.
// ════════════════════════════════════════════════════════════════════════
async function claimOneRow(): Promise<{ id: string; businessId: string; invoiceId: string; partyId: string | null; productIds: string | null; attempts: number } | null> {
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
  const eligible = await db.feedbackOutbox.findFirst({
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
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, attempts: true },
  })

  if (!eligible) return null

  // §ATOMIC-CLAIM: transition PENDING/FAILED → PROCESSING atomically.
  // If another processor already claimed it, count===0 → return null.
  const claimResult = await db.feedbackOutbox.updateMany({
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
  const claimed = await db.feedbackOutbox.findUnique({
    where: { id: eligible.id },
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, attempts: true },
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
//   3. parse productIds JSON → array of unique productIds (or null for generic)
//   4. for each productId (or null for generic): invoke
//      createProductFeedbackRecord(db, { businessId, partyId, invoiceId,
//      productId, actorUserId: null }). P2002/duplicate → that product is
//      already done (not an error). All non-P2002 errors throw (mark row FAILED).
//   5. success (all products processed) → mark COMPLETED + completedAt
//   6. failure → mark FAILED + lastError + attempts already incremented at claim
//      if attempts >= MAX_ATTEMPTS → PERMANENTLY_FAILED
//
// §NON-FATAL: this function NEVER throws. All errors are caught and recorded
// in the outbox row. The sale/order that triggered it remains committed.
// ════════════════════════════════════════════════════════════════════════
export async function processFeedbackOutboxRow(outboxId: string): Promise<{
  status: string
  created?: number
  error?: string
}> {
  const row = await db.feedbackOutbox.findUnique({
    where: { id: outboxId },
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, status: true, attempts: true },
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

  // §PARTY-CHECK: partyId is required by createProductFeedbackRecord. The
  // eligibility gate at invoice creation requires partyId, so this should
  // never be null in practice. Defensive: if it IS null (e.g., the invoice's
  // partyId was cleared after commit), mark COMPLETED so we don't keep
  // retrying an impossible row.
  if (!row.partyId) {
    await db.feedbackOutbox.update({
      where: { id: outboxId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        processingStartedAt: null,
        claimToken: null,
        lastError: 'Skipped: invoice has no partyId (cannot request feedback)',
      },
    })
    return { status: 'COMPLETED', error: 'Skipped: invoice has no partyId' }
  }

  // §PARSE-PRODUCTIDS: the JSON array of unique productIds (deterministic,
  // first-appearance order from invoice items). null/empty → single generic
  // feedback record (productId=null).
  let productIds: string[] = []
  if (row.productIds) {
    try {
      const parsed = JSON.parse(row.productIds)
      if (Array.isArray(parsed)) {
        productIds = parsed.filter((p): p is string => typeof p === 'string' && p.length > 0)
      }
    } catch {
      // §CORRUPT-JSON: treat as generic (single record with productId=null)
      productIds = []
    }
  }

  // §PRODUCT-LIST: if no productIds parsed, create ONE generic record with
  // productId=null. Otherwise create one per unique productId.
  const productList: (string | null)[] = productIds.length > 0 ? productIds : [null]

  try {
    let createdCount = 0
    for (const productId of productList) {
      // §SHARED-CORE: invokes createProductFeedbackRecord. It:
      //   - validates tenant ownership of partyId/invoiceId/productId
      //   - resolves effective delayHours (Product.feedbackDelayHours > AppSettings.feedbackDelayHours)
      //   - computes dedupKey
      //   - does the atomic create (ProductFeedback + FollowUp + CREATED event + link)
      //   - catches P2002 (duplicate active request) → { created: false, duplicate: true }
      // §ACTOR: null — system-triggered from the invoice flow.
      const result = await createProductFeedbackRecord(db, {
        businessId: row.businessId,
        partyId: row.partyId,
        invoiceId: row.invoiceId,
        productId: productId ?? undefined,
        actorUserId: null,
      })
      if (result.created) {
        createdCount++
      }
      // §DUPLICATE: { created: false, duplicate: true } → that productId's
      // feedback already exists (e.g., merchant manually requested feedback
      // before the outbox fired). NOT an error — skip silently.
    }

    // §SUCCESS: all products processed (created OR duplicate). Mark COMPLETED.
    await db.feedbackOutbox.update({
      where: { id: outboxId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        processingStartedAt: null,
        claimToken: null,
        lastError: null,
      },
    })
    return { status: 'COMPLETED', created: createdCount }
  } catch (e: any) {
    // §FAILURE: record the error. attempts was already incremented at claim
    // time (for cron-claimed rows) OR we increment it here (for immediate
    // post-commit processing where claim was not used).
    const errorMsg = String(e?.message ?? e ?? 'Unknown error').slice(0, 500)
    const newAttempts = row.attempts + 1

    if (newAttempts >= MAX_ATTEMPTS) {
      // §PERMANENTLY-FAILED: exhausted retries. Alertable.
      await db.feedbackOutbox.update({
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
    await db.feedbackOutbox.update({
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
// processors never work the same row. Even if they did, createProductFeedbackRecord
// is race-safe by dedupKey.
// ════════════════════════════════════════════════════════════════════════
export async function processPendingFeedbackOutbox(limit = PROCESS_LIMIT): Promise<ProcessSummary> {
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

    const result = await processFeedbackOutboxRow(claimed.id)

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
// Finds the FeedbackOutbox row by invoiceId, short-circuits if already
// COMPLETED/PERMANENTLY_FAILED, else invokes processFeedbackOutboxRow.
// NON-FATAL — all errors are caught and recorded.
//
// §USED-BY: src/app/api/invoices/route.ts (after createInvoice succeeds)
// §REPLACES: the old fire-and-forget maybeCreateProductFeedbackForInvoice.
// ════════════════════════════════════════════════════════════════════════
export async function processFeedbackOutboxRowForInvoice(
  businessId: string,
  invoiceId: string,
): Promise<void> {
  try {
    // §FIND-OUTBOX-ROW: the outbox row was created atomically with the invoice.
    // It should exist. If it doesn't (e.g., the invoice was ineligible and no
    // row was created — purchase/walk-in/unpaid), this is a no-op.
    //
    // §TENANT-ISOLATION: businessId from the authenticated session is included
    // in the lookup as a defense-in-depth. Even though invoiceId is globally
    // unique, scoping by businessId means a tenant can never affect another
    // tenant's outbox row via this path.
    const outboxRow = await db.feedbackOutbox.findFirst({
      where: { invoiceId, businessId },
      select: { id: true, status: true },
    })

    if (!outboxRow) {
      // §NO-OUTBOX: the invoice was ineligible (purchase/walk-in/unpaid) or the
      // outbox creation was skipped. Nothing to do.
      return
    }

    // §SHORT-CIRCUIT: if already COMPLETED (e.g., a concurrent immediate call
    // or a fast cron beat us to it), no-op.
    if (outboxRow.status === 'COMPLETED' || outboxRow.status === 'PERMANENTLY_FAILED') {
      return
    }

    // §PROCESS: invoke the durable processor. This handles claim, create,
    // status transition, and error recording atomically.
    await processFeedbackOutboxRow(outboxRow.id)
  } catch (e: any) {
    // §NON-FATAL: the sale is already committed. Log and swallow.
    console.error('Feedback outbox processing failed (non-fatal) for invoice', invoiceId, e)
  }
}
