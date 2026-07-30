import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// PUT /api/products/[id]/custom-prices/[priceId] — update custom price
// §EDIT: Allows editing the price of an existing custom/tiered price entry.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; priceId: string }> }) {
  const { id, priceId } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  try {
    const body = await req.json()
    const customPrice = Number(body.customPrice)
    if (isNaN(customPrice) || customPrice < 0) {
      return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
    }
    const updated = await db.customPrice.updateMany({
      where: { id: priceId, productId: id, businessId: business.id },
      data: { customPrice },
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, customPrice })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}

// DELETE /api/products/[id]/custom-prices/[priceId]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; priceId: string }> }) {
  const { id, priceId } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  try {
    await db.customPrice.deleteMany({ where: { id: priceId, productId: id, businessId: business.id } })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
