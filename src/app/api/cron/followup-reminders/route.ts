import { NextRequest, NextResponse } from 'next/server'
import { processAllFollowUpReminders } from '@/lib/followup-scheduler'

// §STEP8FB-CRON-ROUTE: follow-up reminder scheduler.
//
// §SCHEDULE: 0 1 * * * (daily at 01:00 UTC, configured in vercel.json).
// Hobby-compatible (daily crons only on the Vercel Hobby plan).
// On Pro, this can be increased to hourly (0 * * * *) for faster processing.
//
// §SECURITY: requires CRON_SECRET in the Authorization header (same fail-closed
// pattern as reward-accrual).
//
// §BOUNDED: processes at most SCHEDULER_PROCESS_LIMIT (100) follow-ups per
// category per run.
//
// §CONCURRENCY: safe under overlapping cron invocations — DB unique index
// dedupes notification creation, atomic conditional updateMany dedupes wake.
//
// §PER-BUSINESS: processing is per-follow-up, not per-business. Each follow-up
// is processed independently — errors in one do not abort others.
//
// §RESPONSE: structured summary for observability.

export const maxDuration = 60

// §CRON-SECRET: read at CALL TIME (inside isAuthorized), not at module load.
// This allows tests to set CRON_SECRET after import + ensures the env var
// is always current (important for serverless cold starts where env vars
// may be set after module load).
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false // fail-closed
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (authHeader === `Bearer ${secret}`) return true
  if (authHeader === secret) return true
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
    const summary = await processAllFollowUpReminders()
    return NextResponse.json({ ok: true, ...summary })
  } catch (e: any) {
    console.error('Follow-up reminder cron failed:', e)
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e).slice(0, 500) },
      { status: 500 }
    )
  }
}

export async function GET(req: NextRequest) {
  return POST(req)
}
