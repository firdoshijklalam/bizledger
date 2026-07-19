import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

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
