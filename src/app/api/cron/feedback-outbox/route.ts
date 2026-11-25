import { NextRequest, NextResponse } from 'next/server'
import { processPendingFeedbackOutbox } from '@/lib/feedback-outbox'
import {
  reconcileFeedbackOutbox,
  FEEDBACK_RECONCILIATION_LIMIT,
} from '@/lib/feedback-reconciliation'

// §CRON: Feedback-outbox durable retry worker + cursor-based reconciliation.
// Mirrors the reward-accrual cron pattern (drain + reconcile).
//
// §SCHEDULE: daily (0 0 * * * — midnight UTC, configured in vercel.json).
// Compatible with the Vercel Hobby plan (daily crons only). On Pro, the
// schedule can be increased for faster retries.
//
// §AUTH: fails closed if CRON_SECRET is unset. Accepts `Bearer <secret>` or
// raw `<secret>` in the Authorization header.
//
// §ORDER (deliberate deviation from the reward route's drain→reconcile):
// this route RECONCILES FIRST, then drains. The reward route drains first
// because its */5 cron means a newly-healed row is processed within 5
// minutes anyway. This route runs DAILY — a drain→reconcile order would
// leave every healed row waiting a FULL DAY for the next invocation.
// Reconcile→drain heals AND processes in the same run. Both orders are
// safe: the drain is claim-atomic and per-row idempotent.
//
// §BOUNDED:
//   - Reconciliation: at most FEEDBACK_RECONCILIATION_LIMIT (500) invoices
//     PER BUSINESS (capped at 1000 businesses).
//   - Drain: at most PROCESS_LIMIT (50) rows per invocation. A large batch
//     of freshly-healed rows is drained 50/run — the next daily cron (or
//     the immediate post-commit path for new invoices) picks up the rest.

export const maxDuration = 60

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (!authHeader) return false
  if (authHeader === `Bearer ${secret}`) return true
  if (authHeader === secret) return true
  return false
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized: CRON_SECRET missing or mismatched' }, { status: 401 })
  }
  try {
    // §STEP-1: cursor-based reconciliation — find eligible invoices missing
    // a FeedbackOutbox row (historical bug / import / restore) and create
    // PENDING rows for them. 60-day lookback (see feedback-reconciliation.ts
    // §LOOKBACK-WINDOW). Idempotent; safe to run concurrently.
    const reconciliationSummary = await reconcileFeedbackOutbox(null, FEEDBACK_RECONCILIATION_LIMIT)

    // §STEP-2: drain eligible outbox rows (PENDING + FAILED with backoff
    // elapsed + reclaimed stale PROCESSING). Includes rows created by §STEP-1.
    const processSummary = await processPendingFeedbackOutbox()

    return NextResponse.json({
      ok: true,
      reconciliation: reconciliationSummary,
      processing: processSummary,
    })
  } catch (e: any) {
    console.error('Feedback outbox cron failed:', e)
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e).slice(0, 500) },
      { status: 500 },
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
