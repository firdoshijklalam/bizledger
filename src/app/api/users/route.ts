import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireAuth } from '@/lib/auth/session'

// §USERS-API: Business-scoped user list for assignee dropdowns + UI.
//
// §AUTH: requires authentication (any role — OWNER, ADMIN, STAFF). The
// businessId is derived from the authenticated session, NEVER from the client.
//
// §TENANT-ISOLATION: only returns users belonging to the current business.
// Cross-tenant access is impossible — the query is scoped by businessId
// from requireAuth().
//
// §FIELDS: returns only id, name, email, role — no sensitive fields
// (no passwordHash, no sessions, no tokens).
//
// §ORDERING: name ASC (nulls last), then id ASC for deterministic ordering.

export async function GET(_req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const users = await db.user.findMany({
      where: { businessId: user.businessId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    })

    return NextResponse.json({ items: users })
  } catch (e) {
    return apiError(e, 'Failed to fetch users')
  }
}
