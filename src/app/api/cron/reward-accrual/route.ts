import { NextRequest, NextResponse } from 'next/server'
import { processPendingRewardAccruals, PROCESS_LIMIT } from '@/lib/reward-outbox'
import { reconcileRewardAccrualOutbox, RECONCILIATION_LIMIT } from '@/lib/reward-reconciliation'

// §STEP7-CRON-ROUTE: drains the RewardAccrualOutbox + runs reconciliation.
//
// §SCHEDULE: */5 * * * * (every 5 minutes, configured in vercel.json).
//
// §SECURITY: requires CRON_SECRET in the Authorization header. Vercel Cron
// sends `Authorization: Bearer ${CRON_SECRET}`. We reject any request
// without a matching secret. The secret is read from env — NEVER hard-coded.
//
// §BOUNDED: processes at most PROCESS_LIMIT (50) outbox rows per invocation
// + scans at most RECONCILIATION_LIMIT (500) recent invoices for reconciliation.
// This keeps the route within Vercel's maxDuration (60s for cron routes).
//
// §CONCURRENT-SAFETY: the outbox processor uses atomic claim (updateMany with
// WHERE status IN ('PENDING','FAILED')). Even if Vercel Cron invokes this
// route twice concurrently (rare, but possible during deploy handoff), the
// two invocations will not double-process the same row. And even if they did,
// accrueCustomerRewardFromInvoice is idempotent by sourceInvoiceId.
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

    // §STEP-2: run reconciliation as a safety net. Finds eligible invoices
    // that have NEITHER a PROFIT_ACCRUAL event NOR an outbox row, and creates
    // PENDING outbox rows for them. Bounded to RECONCILIATION_LIMIT recent
    // invoices. The NEXT cron invocation will drain the newly-created rows.
    //
    // §STRATEGY: scan the most recent RECONCILIATION_LIMIT invoices (by
    // createdAt DESC) across ALL businesses. This catches recent misses
    // without a full-table scan. Since the cron runs every 5 minutes, any
    // missed invoice is caught within 5 minutes. Historical gaps (pre-Step-7
    // invoices) are caught gradually as they fall within the recent window;
    // a separate one-time backfill script can handle bulk historical gaps
    // (out of scope for this cron route).
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
