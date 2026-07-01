import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/business — get the current business (single-tenant dev).
// Security: prefers "Sharma Trading Co." (the owner's business) over demo shops.
export async function GET() {
  // Prefer the owner's business (Sharma Trading Co.) if it exists
  let business = await db.business.findFirst({
    where: { name: 'Sharma Trading Co.' },
  })
  // Fallback: if no Sharma business, return the first business by creation order
  if (!business) {
    business = await db.business.findFirst({
      orderBy: { createdAt: 'asc' },
    })
  }
  if (!business) {
    return NextResponse.json(null)
  }
  return NextResponse.json(business)
}

// PUT /api/business — update business profile
// Security: only updates the current (Sharma) business, never demo shops.
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    // Prefer Sharma Trading Co., fallback to first by creation order
    let existing = await db.business.findFirst({
      where: { name: 'Sharma Trading Co.' },
    })
    if (!existing) {
      existing = await db.business.findFirst({
        orderBy: { createdAt: 'asc' },
      })
    }
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }
    // Only update non-null fields (partial update)
    const data: Record<string, any> = {}
    const fields = ['name', 'ownerName', 'phone', 'email', 'address', 'state', 'gstin', 'pan', 'upiId', 'currency', 'logoUrl', 'storeSlug', 'deliveryRadiusKm', 'latitude', 'longitude']
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f]
    }
    const updated = await db.business.update({
      where: { id: existing.id },
      data,
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
