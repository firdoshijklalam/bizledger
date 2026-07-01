import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { phoneticSearch } from '@/lib/phonetic'

// GET /api/parties — list parties, optional ?type=customer|supplier|both&q=search&phonetic=true
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const q = searchParams.get('q') || ''
  const usePhonetic = searchParams.get('phonetic') === 'true'
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

  let parties = await db.party.findMany({
    where: {
      businessId: business.id,
      ...(type ? { type } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })

  // Phonetic search (PRD v2 §12.2) — Bengali ↔ English sound matching
  if (q && usePhonetic) {
    const ranked = phoneticSearch(parties, q)
    return NextResponse.json(ranked.map((r) => r.item))
  }

  // Regular text search
  if (q) {
    const query = q.toLowerCase()
    parties = parties.filter(
      (p) => p.name.toLowerCase().includes(query) || (p.phone || '').includes(q)
    )
  }

  return NextResponse.json(parties)
}

// POST /api/parties — create party
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const party = await db.party.create({
      data: {
        businessId: business.id,
        name: body.name,
        phone: body.phone || null,
        type: body.type || 'customer',
        balance: Number(body.openingBalance) || 0,
        openingBalance: Number(body.openingBalance) || 0,
        qualityGrade: body.qualityGrade || 'B',
        creditLimit: body.creditLimit ? Number(body.creditLimit) : null,
        address: body.address || null,
        gstin: body.gstin || null,
        notes: body.notes || null,
      },
    })
    return NextResponse.json(party)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
