import { NextRequest, NextResponse } from 'next/server'
import { processAllFollowUpReminders } from '@/lib/followup-scheduler'

// §STEP8FB-CRON-ROUTE: follow-up reminder scheduler.
//
// §SCHEDULE: 0 * * * * (hourly, configured in vercel.json).
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

const CRON_SECRET = process.env.CRON_SECRET

function isAuthorized(req: NextRequest): boolean {
  if (!CRON_SECRET) return false
  const authHeader = req.headers.get('authorization') || req.headers.get('Authorization')
  if (authHeader === `Bearer ${CRON_SECRET}`) return true
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
