/**
 * §DISTRIBUTED-RATE-LIMITING: Serverless-safe rate limiting using Upstash Redis.
 *
 * In-memory rate limiting (used previously) does NOT work on Vercel serverless
 * because each function invocation is a fresh instance with its own memory.
 * Upstash Redis provides a persistent, distributed counter that works across
 * all serverless instances.
 *
 * §FALLBACK: If UPSTASH_REDIS_REST_URL is not configured (e.g., in local dev),
 * rate limiting is SKIPPED (returns true = allowed). This ensures the app
 * continues to work in development without Redis.
 *
 * §CONFIGURATION: Set these in Vercel Environment Variables:
 *   UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
 *   UPSTASH_REDIS_REST_TOKEN=xxx
 */

import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

let _ratelimiters: Record<string, Ratelimit> = {}

function getRedis(): Redis | null {
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (!url || !token) return null
  return new Redis({ url, token })
}

function getRatelimiter(name: string, limit: number, window: string): Ratelimit | null {
  if (_ratelimiters[name]) return _ratelimiters[name]
  const redis = getRedis()
  if (!redis) return null
  _ratelimiters[name] = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(limit, window as '1 m' | '15 m' | '1 h'),
    prefix: `bizledger:${name}`,
    analytics: true,
  })
  return _ratelimiters[name]
}

/**
 * Check if a request is allowed under the rate limit.
 * Returns `{ success: boolean, limit, remaining, reset }`.
 * If Redis is not configured or connection fails, returns success (fail-open).
 */
export async function checkRateLimit(
  identifier: string,
  limiterName: string,
  limit: number,
  window: string
): Promise<{ success: boolean; limit: number; remaining: number; reset: number }> {
  const ratelimiter = getRatelimiter(limiterName, limit, window)
  if (!ratelimiter) {
    // §FALLBACK: No Redis configured — allow all requests (dev mode)
    return { success: true, limit, remaining: limit, reset: 0 }
  }
  try {
    return await ratelimiter.limit(identifier)
  } catch (e) {
    // §FAIL-OPEN: If Redis connection fails, allow the request through.
    // This prevents a Redis outage from locking users out of the app.
    console.error(`Rate limit check failed for ${limiterName}:`, e)
    return { success: true, limit, remaining: limit, reset: 0 }
  }
}

/**
 * Get a client identifier for rate limiting.
 * Uses IP address (from Vercel headers) + optional user ID for authenticated routes.
 */
export function getClientId(req: Request, userId?: string): string {
  // §VERCEL-HEADERS: Vercel provides the real client IP in these headers
  const xForwardedFor = req.headers.get('x-forwarded-for')
  const xRealIp = req.headers.get('x-real-ip')
  const ip = xForwardedFor?.split(',')[0]?.trim() || xRealIp || 'unknown'
  return userId ? `${ip}:${userId}` : ip
}

/**
 * Rate limit presets for different endpoint types.
 */
export const RATE_LIMITS = {
  // §LOGIN: 5 attempts per 15 minutes per IP (prevents brute-force)
  LOGIN: { name: 'login', limit: 5, window: '15 m' },
  // §PIN: 5 attempts per 15 minutes per IP (prevents brute-force)
  PIN: { name: 'pin', limit: 5, window: '15 m' },
  // §AUTH: 20 requests per minute per IP (general auth endpoints)
  AUTH: { name: 'auth', limit: 20, window: '1 m' },
  // §IMAGE: 10 requests per minute per user (expensive AI/image processing)
  IMAGE: { name: 'image', limit: 10, window: '1 m' },
  // §OCR: 5 requests per minute per user (very expensive)
  OCR: { name: 'ocr', limit: 5, window: '1 m' },
  // §PUBLIC-ORDER: 10 orders per hour per IP (prevents spam)
  PUBLIC_ORDER: { name: 'public-order', limit: 10, window: '1 h' },
} as const
