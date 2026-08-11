import { NextResponse } from 'next/server'
import { apiError } from '@/lib/api-error'
import { getCurrentUser } from '@/lib/auth/session'

/**
 * GET /api/auth/me
 * Returns the currently authenticated user, or 401 if not logged in.
 * Used by the frontend to check auth state on page load.
 */
export async function GET() {
  try {
    const user = await getCurrentUser()
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        businessId: user.businessId,
      },
    })
  } catch (e) {
    return apiError(e, 'Failed to get user')
  }
}
