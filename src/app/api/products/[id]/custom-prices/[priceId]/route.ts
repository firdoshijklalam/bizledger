import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// PUT /api/products/[id]/custom-prices/[priceId] — update custom price
// §FULL-EDIT: Allows editing BOTH the target entity (buyerId / buyerGroupName)
// AND the price fields of an existing custom/tiered price entry.
//
// §MULTI-PRICE: Body fields (all optional, only provided fields are updated):
//   - customSalePrice: number      (override for Product.salePrice)
//   - customMrp: number            (override for Product.mrp)
//   - customWholesalePrice: number (override for Product.wholesalePrice)
//   - customPrice: number          (legacy — maps to customSalePrice)
//   - buyerId: string | null       (specific buyer — set to null to clear)
//   - buyerGroupName: string | null (group/tier label — set to null to clear)
//
// §MUTUAL-EXCLUSION: A custom price targets EITHER a specific buyer OR a
// group, never both. If buyerId is provided (non-null), buyerGroupName is
// forced to null, and vice versa.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; priceId: string }> }) {
  const { id, priceId } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  try {
    const body = await req.json()

    // Build the update data — only include fields that are present in the body
    const updateData: Record<string, unknown> = {}

    // §MULTI-PRICE: Three-tier custom pricing
    if (body.customSalePrice !== undefined) {
      const v = Number(body.customSalePrice)
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'Invalid customSalePrice' }, { status: 400 })
      updateData.customSalePrice = v
      // Keep customPrice in sync for backward compat
      updateData.customPrice = v
    }
    if (body.customMrp !== undefined) {
      const v = Number(body.customMrp)
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'Invalid customMrp' }, { status: 400 })
      updateData.customMrp = v
    }
    if (body.customWholesalePrice !== undefined) {
      const v = Number(body.customWholesalePrice)
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'Invalid customWholesalePrice' }, { status: 400 })
      updateData.customWholesalePrice = v
    }

    // §LEGACY: single customPrice (maps to customSalePrice if customSalePrice not provided)
    if (body.customPrice !== undefined && updateData.customSalePrice === undefined) {
      const v = Number(body.customPrice)
      if (isNaN(v) || v < 0) return NextResponse.json({ error: 'Invalid price' }, { status: 400 })
      updateData.customPrice = v
      updateData.customSalePrice = v
    }

    // §ENTITY-EDIT: Allow changing the target buyer or group.
    // `buyerId` and `buyerGroupName` are mutually exclusive.
    if (body.buyerId !== undefined) {
      updateData.buyerId = body.buyerId || null
      // If switching to a specific buyer, clear the group name
      if (body.buyerId) {
        updateData.buyerGroupName = null
      }
    }
    if (body.buyerGroupName !== undefined) {
      updateData.buyerGroupName = (body.buyerGroupName && String(body.buyerGroupName).trim()) || null
      // If switching to a group, clear the buyer id
      if (updateData.buyerGroupName) {
        updateData.buyerId = null
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const updated = await db.customPrice.updateMany({
      where: { id: priceId, productId: id, businessId: business.id },
      data: updateData,
    })
    if (updated.count === 0) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true, ...updateData })
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
