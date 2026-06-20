import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/parties — list parties, optional ?type=customer|supplier|both
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json([])

  const parties = await db.party.findMany({
    where: {
      businessId: business.id,
      ...(type ? { type } : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })
  return NextResponse.json(parties)
}

// POST /api/parties — create party
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await db.business.findFirst()
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
