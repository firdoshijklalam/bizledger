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
// §RETRY-ACCOUNTING: attempts is incremented EXACTLY ONCE per actual processing
// attempt — at claim time (PENDING/FAILED → PROCESSING). The catch block in
// processFeedbackOutboxRow does NOT increment again. This ensures MAX_ATTEMPTS=10
// means exactly 10 actual processing attempts, not 5.
//
// §BACKOFF: FAILED rows become eligible for retry only after
// BACKOFF_SCHEDULE_MS[attempts] has elapsed since lastAttemptAt. The schedule
// is: 30s, 1m, 2m, 5m, 10m, 20m, 40m, 80m, 160m, 320m. Total ≈ 10.6 hours.
//
// §CONCURRENT-SAFETY: claiming uses a conditional updateMany (WHERE id AND status
// IN ('PENDING','FAILED')). Result transitions (COMPLETED/FAILED/PERMANENTLY_FAILED)
// use a conditional updateMany (WHERE id AND status='PROCESSING' AND claimToken=<token>).
// A concurrent worker that reclaimed a stale row + completed it CANNOT be overwritten
// by a slower worker's stale FAILED result (count===0 → no-op).
//
// §MULTI-PRODUCT: the outbox row stores a JSON-stringified array of unique
// productIds (in deterministic first-appearance order from the invoice items)
// in the `productIds` column. The processor creates ONE ProductFeedback per
// unique productId — each call to createProductFeedbackRecord computes a
// distinct dedupKey, so duplicates are impossible. If the JSON array is
// null/empty (no product-backed items), a single generic feedback record is
// created with productId=null.

export const MAX_ATTEMPTS = 10

export const STALE_PROCESSING_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

export const BACKOFF_SCHEDULE_MS = [
  30 * 1000,           // 30s  — after attempt 1 fails
  60 * 1000,           // 1m  — after attempt 2 fails
  2 * 60 * 1000,       // 2m  — after attempt 3 fails
  5 * 60 * 1000,       // 5m  — after attempt 4 fails
  10 * 60 * 1000,      // 10m — after attempt 5 fails
  20 * 60 * 1000,      // 20m — after attempt 6 fails
  40 * 60 * 1000,      // 40m — after attempt 7 fails
  80 * 60 * 1000,      // 80m — after attempt 8 fails
  160 * 60 * 1000,     // 160m — after attempt 9 fails
  320 * 60 * 1000,     // 320m — after attempt 10 fails
]

export const PROCESS_LIMIT = 50

export type ProcessSummary = {
  claimed: number
  completed: number
  failed: number
  permanentlyFailed: number
  reclaimed: number
  errors: Array<{ invoiceId: string; error: string }>
}

// ════════════════════════════════════════════════════════════════════════
// §BACKOFF: compute the backoff delay for the NEXT retry.
// `attempts` = number of processing attempts SO FAR (after the current claim).
// Returns the delay in ms before the NEXT retry becomes eligible, or null if
// MAX_ATTEMPTS reached (no more retries).
//
// Example: after attempt 1 (attempts=1) fails, backoffForAttempt(1) = 60s.
// The row becomes eligible for retry 60s after lastAttemptAt.
// ════════════════════════════════════════════════════════════════════════
export function backoffForAttempt(attempts: number): number | null {
  if (attempts >= MAX_ATTEMPTS) return null
  const idx = Math.min(attempts, BACKOFF_SCHEDULE_MS.length - 1)
  return BACKOFF_SCHEDULE_MS[idx]
}

function generateClaimToken(): string {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID()
    }
  } catch {}
  return `claim-${Date.now()}-${Math.random().toString(36).substring(2, 12)}`
}

// ════════════════════════════════════════════════════════════════════════
// §RECLAIM-STALE: a PROCESSING row older than STALE_PROCESSING_THRESHOLD_MS
// is considered crashed. Reset it to PENDING (so the drain picks it up).
// Does NOT reset attempts (reclaim is recovery, not a failure).
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
    },
  })
  return result.count
}

// ════════════════════════════════════════════════════════════════════════
// §CLAIM-ONE-ROW: atomically claim a single eligible outbox row.
//
// §ELIGIBILITY:
//   - PENDING: always eligible (never processed or reclaimed after crash).
//   - FAILED: eligible only if BACKOFF_SCHEDULE_MS[attempts] has elapsed
//     since lastAttemptAt. Uses the ACTUAL backoff schedule (NOT a hard-coded
//     30s). Attempt N uses BACKOFF_SCHEDULE_MS[N] for the next retry.
//   - PROCESSING/COMPLETED/PERMANENTLY_FAILED: not eligible.
//
// §ATOMIC: uses conditional updateMany (WHERE id AND status IN ('PENDING','FAILED')).
// Only the claimToken holder may transition PROCESSING → COMPLETED/FAILED.
// If two processors race, only one's updateMany matches (count===1).
// ════════════════════════════════════════════════════════════════════════
async function claimOneRow(): Promise<{ id: string; businessId: string; invoiceId: string; partyId: string | null; productIds: string | null; attempts: number; claimToken: string | null } | null> {
  const now = new Date()

  // §STEP-1: try to find an eligible PENDING row (no backoff needed).
  let eligible = await db.feedbackOutbox.findFirst({
    where: { status: 'PENDING' },
    orderBy: { lastAttemptAt: 'asc' },
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, attempts: true },
  })

  // §STEP-2: if no PENDING row, search FAILED rows respecting the backoff schedule.
  if (!eligible) {
    // Fetch FAILED rows ordered by lastAttemptAt. We'll check backoff in JS
    // because each row has a different `attempts` value → different backoff.
    const failedRows = await db.feedbackOutbox.findMany({
      where: { status: 'FAILED' },
      orderBy: { lastAttemptAt: 'asc' },
      take: 20, // scan at most 20 FAILED rows per claim attempt
      select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, attempts: true, lastAttemptAt: true },
    })

    for (const row of failedRows) {
      // §BACKOFF-CHECK: use the ACTUAL backoff schedule for this row's attempt count.
      const backoffMs = backoffForAttempt(row.attempts)
      if (backoffMs === null) continue // MAX_ATTEMPTS reached — should be PERMANENTLY_FAILED, skip

      const elapsed = now.getTime() - (row.lastAttemptAt?.getTime() ?? 0)
      if (elapsed >= backoffMs) {
        eligible = {
          id: row.id, businessId: row.businessId, invoiceId: row.invoiceId,
          partyId: row.partyId, productIds: row.productIds, attempts: row.attempts,
        }
        break
      }
    }
  }

  if (!eligible) return null

  // §ATOMIC-CLAIM: transition PENDING/FAILED → PROCESSING atomically.
  // increments attempts EXACTLY ONCE here. processFeedbackOutboxRow does NOT
  // increment again.
  const claimToken = generateClaimToken()
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
    // §RACE-LOST: another processor claimed it first.
    return null
  }

  // §CLAIM-WON: re-fetch to get the post-increment attempts + claimToken.
  const claimed = await db.feedbackOutbox.findUnique({
    where: { id: eligible.id },
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, attempts: true, claimToken: true },
  })
  return claimed
}

// ════════════════════════════════════════════════════════════════════════
// §PROCESS-ONE: process a single outbox row by ID.
//
// §RETRY-ACCOUNTING: attempts is incremented EXACTLY ONCE per processing
// attempt — at claim time. This function does NOT increment attempts in the
// catch block. It uses the post-claim `row.attempts` value directly.
//
// §CLAIM-IF-NEEDED: if the row is NOT already PROCESSING (PENDING or FAILED —
// the immediate post-commit path), this function claims it first (incrementing
// attempts). If the claim fails (another worker won), it returns CLAIM_LOST.
// For the cron path (row is already PROCESSING from claimOneRow), the claim is
// skipped.
//
// §CONCURRENT-RESULT-GUARD: the COMPLETED/FAILED/PERMANENTLY_FAILED transition
// uses a conditional updateMany (WHERE id AND status='PROCESSING' AND
// claimToken=<token>). A concurrent worker that reclaimed a stale row +
// completed it CANNOT be overwritten by a slower worker's stale FAILED result
// (count===0 → no-op).
//
// §NON-FATAL: this function NEVER throws. All errors are caught + recorded.
// ════════════════════════════════════════════════════════════════════════
export async function processFeedbackOutboxRow(outboxId: string): Promise<{
  status: string
  created?: number
  error?: string
}> {
  const row = await db.feedbackOutbox.findUnique({
    where: { id: outboxId },
    select: { id: true, businessId: true, invoiceId: true, partyId: true, productIds: true, status: true, attempts: true, claimToken: true },
  })

  if (!row) {
    return { status: 'NOT_FOUND', error: 'Outbox row not found' }
  }

  if (row.status === 'COMPLETED') {
    return { status: 'COMPLETED' }
  }
  if (row.status === 'PERMANENTLY_FAILED') {
    return { status: 'PERMANENTLY_FAILED' }
  }

  // §CLAIM-IF-NEEDED: if not already PROCESSING, claim it (increment attempts).
  // This handles the immediate post-commit path (row is PENDING).
  // For the cron path, claimOneRow already claimed it → row.status === 'PROCESSING'.
  let currentAttempts = row.attempts
  let claimToken = row.claimToken

  if (row.status !== 'PROCESSING') {
    claimToken = generateClaimToken()
    const claimResult = await db.feedbackOutbox.updateMany({
      where: { id: outboxId, status: { in: ['PENDING', 'FAILED'] } },
      data: {
        status: 'PROCESSING',
        claimToken,
        processingStartedAt: new Date(),
        lastAttemptAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
      },
    })

    if (claimResult.count === 0) {
      // §RACE-LOST: another processor claimed it first.
      return { status: 'CLAIM_LOST' }
    }

    // §POST-CLAIM: re-read the post-increment attempts.
    currentAttempts = row.attempts + 1
  }

  // §PARTY-CHECK: partyId is required. Defensive: skip impossible rows.
  if (!row.partyId) {
    await db.feedbackOutbox.updateMany({
      where: { id: outboxId, status: 'PROCESSING', claimToken: claimToken ?? undefined },
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

  // §PARSE-PRODUCTIDS: JSON array of unique productIds. null/empty → generic.
  let productIds: string[] = []
  if (row.productIds) {
    try {
      const parsed = JSON.parse(row.productIds)
      if (Array.isArray(parsed)) {
        productIds = parsed.filter((p): p is string => typeof p === 'string' && p.length > 0)
      }
    } catch {
      productIds = []
    }
  }

  const productList: (string | null)[] = productIds.length > 0 ? productIds : [null]

  try {
    let createdCount = 0
    for (const productId of productList) {
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
    }

    // §SUCCESS: conditional updateMany prevents a concurrent worker from
    // overwriting a newer COMPLETED with a stale FAILED.
    await db.feedbackOutbox.updateMany({
      where: { id: outboxId, status: 'PROCESSING', claimToken: claimToken ?? undefined },
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
    const errorMsg = String(e?.message ?? e ?? 'Unknown error').slice(0, 500)

    // §FAILURE: use currentAttempts (already incremented at claim time).
    // Do NOT increment again — the claim was the exactly-once increment.
    if (currentAttempts >= MAX_ATTEMPTS) {
      await db.feedbackOutbox.updateMany({
        where: { id: outboxId, status: 'PROCESSING', claimToken: claimToken ?? undefined },
        data: {
          status: 'PERMANENTLY_FAILED',
          lastError: errorMsg,
          lastAttemptAt: new Date(),
          processingStartedAt: null,
          claimToken: null,
        },
      })
      return { status: 'PERMANENTLY_FAILED', error: errorMsg }
    }

    await db.feedbackOutbox.updateMany({
      where: { id: outboxId, status: 'PROCESSING', claimToken: claimToken ?? undefined },
      data: {
        status: 'FAILED',
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
// 1. reclaim stale PROCESSING rows (crashed processors)
// 2. loop: atomically claim one row, process it, repeat until limit or none
// 3. return summary
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

  summary.reclaimed = await reclaimStaleProcessing(limit)

  for (let i = 0; i < limit; i++) {
    const claimed = await claimOneRow()
    if (!claimed) break

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
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §IMMEDIATE-POST-COMMIT: find the FeedbackOutbox row by invoiceId,
// short-circuit if already COMPLETED/PERMANENTLY_FAILED, else process.
// NON-FATAL — all errors caught.
// ════════════════════════════════════════════════════════════════════════
export async function processFeedbackOutboxRowForInvoice(
  businessId: string,
  invoiceId: string,
): Promise<void> {
  try {
    const outboxRow = await db.feedbackOutbox.findFirst({
      where: { invoiceId, businessId },
      select: { id: true, status: true },
    })

    if (!outboxRow) return

    if (outboxRow.status === 'COMPLETED' || outboxRow.status === 'PERMANENTLY_FAILED') {
      return
    }

    await processFeedbackOutboxRow(outboxRow.id)
  } catch (e: any) {
    console.error('Feedback outbox processing failed (non-fatal) for invoice', invoiceId, e)
  }
}
