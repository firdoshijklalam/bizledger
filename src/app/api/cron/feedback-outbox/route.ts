import { NextRequest, NextResponse } from 'next/server'
import { processPendingFeedbackOutbox } from '@/lib/feedback-outbox'

// §CRON: Feedback-outbox durable retry worker. Processes PENDING/FAILED rows
// and reclaims stale PROCESSING rows. Mirrors the reward-accrual cron pattern.
//
// §SCHEDULE: configured in vercel.json as a daily cron (0 0 * * * — midnight UTC).
// This is compatible with the Vercel Hobby plan (daily crons only). On Pro,
// the schedule can be increased to */5 * * * * for faster retries.
//
// §AUTH: fails closed if CRON_SECRET is unset. Accepts `Bearer <secret>` or
// raw `<secret>` in the Authorization header.

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
    const summary = await processPendingFeedbackOutbox()
    return NextResponse.json({ ok: true, ...summary })
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
