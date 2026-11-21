import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// POST /api/monetization/sponsor — owner: become a sponsored/featured shop.
// Body: { area?: string, days?: number } (default 30 days).
// DELETE /api/monetization/sponsor — owner: cancel sponsorship.
//
// §RBAC: Both handlers require OWNER/ADMIN. Sponsorship is a paid
// marketplace advertising decision and affects the business's paid placement
// in nearby-shops / central-catalog results — STAFF must not be able to
// toggle it (would allow unauthorized spend or unauthorised cancellation).

const DAY_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Require OWNER or ADMIN.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const body = await req.json().catch(() => ({}))
    const days = Number(body.days) > 0 ? Number(body.days) : 30
    const area = typeof body.area === 'string' ? body.area : null

    const existing = await getCurrentBusiness()
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }

    const now = new Date()
    const sponsoredUntil = new Date(now.getTime() + days * DAY_MS)

    const updated = await db.business.update({
      where: { id: existing.id },
      data: {
        isSponsored: true,
        sponsoredUntil,
        sponsoredArea: area,
      },
    })

    return NextResponse.json({
      success: true,
      sponsoredUntil,
      business: updated,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE() {
  try {
    // §RBAC: Require OWNER or ADMIN.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const existing = await getCurrentBusiness()
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }
    const updated = await db.business.update({
      where: { id: existing.id },
      data: {
        isSponsored: false,
        sponsoredUntil: null,
        sponsoredArea: null,
      },
    })
    return NextResponse.json({ success: true, business: updated })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
