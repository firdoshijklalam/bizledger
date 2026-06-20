import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/business — get first business (single-tenant dev)
export async function GET() {
  const business = await db.business.findFirst()
  if (!business) {
    return NextResponse.json(null)
  }
  return NextResponse.json(business)
}

// PUT /api/business — update business profile
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const existing = await db.business.findFirst()
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }
    const updated = await db.business.update({
      where: { id: existing.id },
      data: {
        name: body.name,
        ownerName: body.ownerName,
        phone: body.phone,
        email: body.email,
        address: body.address,
        state: body.state,
        gstin: body.gstin,
        pan: body.pan,
        upiId: body.upiId,
        currency: body.currency,
        logoUrl: body.logoUrl,
      },
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
