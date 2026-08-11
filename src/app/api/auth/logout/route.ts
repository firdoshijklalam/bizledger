import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api-error'
import { getSessionToken, deleteSession, clearSessionCookie } from '@/lib/auth/session'

/**
 * POST /api/auth/logout
 * Clears the session cookie and deletes the session from the DB.
 */
export async function POST() {
  try {
    const token = getSessionToken()
    if (token) {
      await deleteSession(token)
    }

    const response = NextResponse.json({ ok: true, message: 'Logged out successfully' })
    clearSessionCookie(response)
    return response
  } catch (e) {
    return apiError(e, 'Logout failed')
  }
}
