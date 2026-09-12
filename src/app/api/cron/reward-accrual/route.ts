import { NextRequest, NextResponse } from 'next/server'
import { processPendingRewardAccruals, PROCESS_LIMIT } from '@/lib/reward-outbox'
import { reconcileRewardAccrualOutbox, RECONCILIATION_LIMIT } from '@/lib/reward-reconciliation'

// §STEP7A-CRON-ROUTE: drains the RewardAccrualOutbox + runs cursor-based
// incremental reconciliation.
//
// §SCHEDULE: */5 * * * * (every 5 minutes, configured in vercel.json).
//
// §SECURITY: requires CRON_SECRET in the Authorization header. Vercel Cron
// sends `Authorization: Bearer ${CRON_SECRET}`. We reject any request
// without a matching secret. The secret is read from env — NEVER hard-coded.
//
// §BOUNDED:
//   - Outbox drain: at most PROCESS_LIMIT (50) rows per invocation.
//   - Reconciliation: at most RECONCILIATION_LIMIT (500) invoices PER BUSINESS
//     per invocation. The cron iterates all businesses that have eligible
//     invoices (capped at 1000 businesses for safety).
//
// §RECONCILIATION-STRATEGY (Step 7A — cursor-based incremental):
//   - Each business has ONE RewardReconciliationCursor (durable, @unique(businessId)).
//   - Each run processes the next bounded batch of eligible invoices AFTER the
//     cursor position (lastCreatedAt, lastInvoiceId), ordered (createdAt ASC, id ASC).
//   - The cursor advances based on SCANNED rows, NOT on successfully-created
//     outbox rows. A problematic invoice does NOT block the cursor.
//   - When the cursor reaches the newest invoice (batch < limit), the NEXT run
//     finds 0 rows + wraps the cursor to the start (cyclic) + increments cycleCount.
//   - This guarantees COMPLETE eventual coverage of ALL eligible invoices,
//     including historical gaps (pre-Step-7 invoices) — not just the latest N.
//
// §CRON-BEHAVIOR:
//   - batch size: RECONCILIATION_LIMIT (500) per business
//   - cursor advancement: after each batch, the cursor moves to the last
//     scanned invoice (createdAt, id)
//   - no invoices after cursor → wrap to start (cyclic), increment cycleCount
//   - batch of only already-processed invoices → cursor still advances (they
//     are scanned, just not missing)
//   - mid-run failure → cursor does NOT advance past unscanned rows (cursor
//     update happens only after the full batch is processed). Replay is safe.
//
// §CONCURRENT-SAFETY: the outbox processor uses atomic claim (updateMany with
// WHERE status IN ('PENDING','FAILED')). Even if Vercel Cron invokes this
// route twice concurrently, the two invocations will not double-process the
// same row. And even if they did, accrueCustomerRewardFromInvoice is idempotent
// by sourceInvoiceId.
//
// §TERMINOLOGY (Step 7A correction):
//   - outbox delivery/processing = at-least-once
//   - reward accrual event = idempotent / at-most-once per invoice
//   - resulting business effect = effectively exactly-once
//   - PERMANENTLY_FAILED = automatic retry exhausted; durable failure record;
//     manual/operator retry possible. NOT automatic eventual success.
//
// §RESPONSE: returns a summary for observability.

// §VERCEL-CRON: allow up to 60s (Vercel Cron default maxDuration).
export const maxDuration = 60

// §CRON-SECRET-REQUIRED: the secret must be set in env. If not set, the route
// refuses to run (fails closed — no processing without authentication).
const CRON_SECRET = process.env.CRON_SECRET

function isAuthorized(req: NextRequest): boolean {
  if (!CRON_SECRET) {
    // §NO-SECRET-CONFIGURED: fail closed. The operator must set CRON_SECRET
    // in Vercel env before the cron can run. This prevents anonymous access.
    return false
  }
  // §BEARER-TOKEN: Vercel Cron sends "Bearer <secret>". Accept that form.
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (authHeader === `Bearer ${CRON_SECRET}`) return true
  // §RAW-SECRET: also accept the raw secret (for manual curl testing).
  if (authHeader === CRON_SECRET) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: 'Unauthorized: CRON_SECRET missing or mismatched' },
      { status: 401 }
    )
  }

  try {
    // §STEP-1: drain eligible outbox rows (PENDING + FAILED with backoff elapsed).
    // This is the primary retry path. Bounded to PROCESS_LIMIT rows.
    const processSummary = await processPendingRewardAccruals(PROCESS_LIMIT)

    // §STEP-2: run cursor-based incremental reconciliation. Finds eligible
    // invoices that have NEITHER a PROFIT_ACCRUAL event NOR an outbox row,
    // and creates PENDING outbox rows for them. Bounded to RECONCILIATION_LIMIT
    // invoices PER BUSINESS. The cursor advances forward through ALL eligible
    // invoice history, ensuring complete eventual coverage (including
    // historical gaps). The NEXT cron invocation drains the newly-created rows.
    const reconciliationSummary = await reconcileRewardAccrualOutbox(null, RECONCILIATION_LIMIT)

    return NextResponse.json({
      ok: true,
      processing: processSummary,
      reconciliation: reconciliationSummary,
    })
  } catch (e: any) {
    console.error('Reward accrual cron failed:', e)
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e).slice(0, 500) },
      { status: 500 }
    )
  }
}

// §GET-ALIAS: Vercel Cron can be configured to use GET or POST. Support both
// with the same auth + logic. POST is preferred (CRON_SECRET in header is
// not logged in access logs the way query params are).
export async function GET(req: NextRequest) {
  return POST(req)
}
