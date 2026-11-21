import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// /api/suppliers/[id]/catalog/[itemId] — update/delete a supplier catalog item.
// Security: verifies the catalog item belongs to the current business.

async function getBusinessId() {
  const business = await getCurrentBusiness()
  return business?.id ?? null
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { itemId } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.supplierCatalogItem.findFirst({
      where: { id: itemId, businessId },
    })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    const body = await req.json()
    const item = await db.supplierCatalogItem.update({
      where: { id: itemId },
      data: {
        productName: body.productName,
        category: body.category,
        basePrice: Number(body.basePrice),
        transportFare: Number(body.transportFare),
        coolieCharge: Number(body.coolieCharge),
        unit: body.unit,
        minOrderQty: Number(body.minOrderQty),
        notes: body.notes,
        isActive: body.isActive ?? true,
      },
    })
    // §DECIMAL-FIX-D: basePrice, transportFare, coolieCharge are Decimal
    return NextResponse.json(serializeDecimals(item))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const { itemId } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.supplierCatalogItem.findFirst({
      where: { id: itemId, businessId },
    })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    await db.supplierCatalogItem.delete({ where: { id: itemId } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
