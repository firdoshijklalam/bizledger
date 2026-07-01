import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// POST /api/grade-recalculate — trigger grade recalculation for one or all parties
// Body: { partyId?: string }  — if partyId omitted, recalculate for all parties of current business
// Security: scoped to current business only.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    if (body.partyId) {
      // Verify the party belongs to this business
      const party = await db.party.findFirst({
        where: { id: body.partyId, businessId: business.id },
      })
      if (!party) {
        return NextResponse.json({ error: 'Party not found in your business' }, { status: 404 })
      }
      const { recalculatePartyGrade } = await import('@/lib/grade-calculator')
      const result = await recalculatePartyGrade(body.partyId)
      return NextResponse.json({ ok: true, partyId: body.partyId, result })
    }

    // Recalculate for all parties of THIS business only (multi-tenant isolation)
    const { recalculatePartyGrade } = await import('@/lib/grade-calculator')
    const parties = await db.party.findMany({
      where: { businessId: business.id },
      select: { id: true },
    })
    const results = []
    for (const p of parties) {
      const r = await recalculatePartyGrade(p.id)
      results.push({ partyId: p.id, grade: r?.grade })
    }
    return NextResponse.json({ ok: true, count: results.length, results })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
