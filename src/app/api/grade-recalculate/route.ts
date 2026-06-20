import { NextRequest, NextResponse } from 'next/server'
import { recalculatePartyGrade } from '@/lib/grade-calculator'

// POST /api/grade-recalculate — trigger grade recalculation for one or all parties
// Body: { partyId?: string }  — if partyId omitted, recalculate for all parties
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    if (body.partyId) {
      const result = await recalculatePartyGrade(body.partyId)
      return NextResponse.json({ ok: true, partyId: body.partyId, result })
    }
    // Recalculate for all parties
    const { db } = await import('@/lib/db')
    const parties = await db.party.findMany({ select: { id: true } })
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
