import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth/session'
import { checkRateLimit, getClientId, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok: true, user: { id, email, name, role, businessId } }
 * Sets: httpOnly session cookie
 *
 * §RATE-LIMITING: Distributed rate limiting via Upstash Redis (5 attempts per
 * 15 min per IP). Falls back to in-memory in development (when Redis is not
 * configured). The in-memory fallback is per-instance and not suitable for
 * serverless production, but works for local dev.
 */

// §IN-MEMORY-FALLBACK: Used only when UPSTASH_REDIS_REST_URL is not set (dev mode)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

export async function POST(req: NextRequest) {
  try {
    const ip = getClientId(req)

    // §DISTRIBUTED-RATE-LIMIT: Check Upstash Redis first (serverless-safe).
    // Falls back to in-memory if Redis is not configured.
    const rateResult = await checkRateLimit(ip, RATE_LIMITS.LOGIN.name, RATE_LIMITS.LOGIN.limit, RATE_LIMITS.LOGIN.window)
    console.log("RATE_LIMIT_DEBUG:", JSON.stringify(rateResult)); if (!rateResult.success) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateResult.reset / 1000) || 900),
            'X-RateLimit-Limit': String(rateResult.limit),
            'X-RateLimit-Remaining': String(rateResult.remaining),
          },
        }
      )
    }

    // §IN-MEMORY-FALLBACK: Also check the in-memory store (for dev without Redis)
    const now = Date.now()
    const attempts = loginAttempts.get(ip)
    if (attempts && process.env.UPSTASH_REDIS_REST_URL === undefined) {
      if (now - attempts.firstAttempt < WINDOW_MS && attempts.count >= MAX_ATTEMPTS) {
        const remainingMs = WINDOW_MS - (now - attempts.firstAttempt)
        return NextResponse.json(
          { error: 'Too many login attempts. Please try again later.', retryAfterMs: remainingMs },
          { status: 429 }
        )
      }
      if (now - attempts.firstAttempt >= WINDOW_MS) {
        loginAttempts.delete(ip)
      }
    }

    const body = await req.json()
    const email = (body.email || '').trim().toLowerCase()

    if (!email || !body.password) {
      return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
    }

    // Find user by email
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, role: true, businessId: true, passwordHash: true },
    })

    // §TIMING-SAFE: Always run verifyPassword even if user not found to prevent
    // timing-based user enumeration. Use a dummy hash that will always fail.
    const dummyHash = 'scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
    const passwordValid = user ? verifyPassword(body.password, user.passwordHash) : verifyPassword(body.password, dummyHash)

    if (!user || !passwordValid) {
      // §IN-MEMORY-FALLBACK: Record failed attempt (dev mode only)
      if (process.env.UPSTASH_REDIS_REST_URL === undefined) {
        recordFailedAttempt(ip, now)
      }
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // §IN-MEMORY-FALLBACK: Clear failed attempts on successful login
    if (process.env.UPSTASH_REDIS_REST_URL === undefined) {
      loginAttempts.delete(ip)
    }

    // Create session
    const token = await createSession(user.id)

    // Build response with user data (exclude passwordHash)
    const response = NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
      },
    })

    // Set httpOnly session cookie
    setSessionCookie(response, token)

    return response
  } catch (e) {
    const errMsg = e instanceof Error ? e.message : String(e)
    return apiError(e, 'Login failed')
  }
}

// §IN-MEMORY-FALLBACK: Helper to record failed login attempts (dev only)
function recordFailedAttempt(ip: string, now: number) {
  const existing = loginAttempts.get(ip)
  if (existing && now - existing.firstAttempt < WINDOW_MS) {
    existing.count++
  } else {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
  }
}
