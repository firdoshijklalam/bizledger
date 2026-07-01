import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// POST /api/monetization/sponsor — owner: become a sponsored/featured shop.
// Body: { area?: string, days?: number } (default 30 days).
// DELETE /api/monetization/sponsor — owner: cancel sponsorship.

const DAY_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE() {
  try {
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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
