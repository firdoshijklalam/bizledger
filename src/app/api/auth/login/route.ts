import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { verifyPassword, createSession, setSessionCookie } from '@/lib/auth/session'

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok: true, user: { id, email, name, role, businessId } }
 * Sets: httpOnly session cookie
 */
export async function POST(req: NextRequest) {
  try {
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
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
    }

    // Verify password (timing-safe)
    if (!verifyPassword(body.password, user.passwordHash)) {
      return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
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
    return apiError(e, 'Login failed')
  }
}
