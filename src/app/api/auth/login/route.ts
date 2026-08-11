import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth/session'

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok: true, user: { id, email, name, role, businessId } }
 * Sets: httpOnly session cookie
 *
 * §RATE-LIMITING: Simple in-memory rate limiter (5 attempts per 15 min per IP).
 * In production, use Redis/Upstash for distributed rate limiting.
 */

// §RATE-LIMIT: in-memory store (reset on server restart)
const loginAttempts = new Map<string, { count: number; firstAttempt: number }>()
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60 * 1000 // 15 minutes

function getClientIP(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  return req.headers.get('x-real-ip') || 'unknown'
}

export async function POST(req: NextRequest) {
  try {
    // §RATE-LIMIT: Check if IP is rate-limited
    const ip = getClientIP(req)
    const now = Date.now()
    const attempts = loginAttempts.get(ip)
    if (attempts) {
      if (now - attempts.firstAttempt < WINDOW_MS && attempts.count >= MAX_ATTEMPTS) {
        const remainingMs = WINDOW_MS - (now - attempts.firstAttempt)
        return NextResponse.json(
          { error: 'Too many login attempts. Please try again later.', retryAfterMs: remainingMs },
          { status: 429 }
        )
      }
      // Reset window if expired
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

    if (!user) {
      // §RATE-LIMIT: Record failed attempt
      recordFailedAttempt(ip, now)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Verify password (timing-safe)
    if (!verifyPassword(body.password, user.passwordHash)) {
      // §RATE-LIMIT: Record failed attempt
      recordFailedAttempt(ip, now)
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // §RATE-LIMIT: Clear failed attempts on successful login
    loginAttempts.delete(ip)

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
    return apiError(e, 'Login failed')
  }
}

// §RATE-LIMIT: Helper to record failed login attempts
function recordFailedAttempt(ip: string, now: number) {
  const existing = loginAttempts.get(ip)
  if (existing && now - existing.firstAttempt < WINDOW_MS) {
    existing.count++
  } else {
    loginAttempts.set(ip, { count: 1, firstAttempt: now })
  }
}
