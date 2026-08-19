import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit, getClientId, RATE_LIMITS } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const ip = getClientId(req)
  const result = await checkRateLimit(ip, RATE_LIMITS.LOGIN.name, RATE_LIMITS.LOGIN.limit, RATE_LIMITS.LOGIN.window)
  return NextResponse.json({
    ip,
    rateLimitResult: result,
    envUrlSet: !!process.env.UPSTASH_REDIS_REST_URL,
    envTokenSet: !!process.env.UPSTASH_REDIS_REST_TOKEN,
    envUrlPrefix: process.env.UPSTASH_REDIS_REST_URL?.substring(0, 30) + '...',
  })
}
