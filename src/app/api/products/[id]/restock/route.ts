import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// POST /api/products/[id]/restock — quick stock increment
// Security: verifies the product belongs to the current business.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const addQty = Number(body.quantity)
    if (!addQty || addQty <= 0) {
      return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 })
    }

    // Multi-tenant isolation: get current business, verify ownership
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const existing = await db.product.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Product not found in your business' }, { status: 404 })
    }

    const updated = await db.product.update({
      where: { id },
      data: { stock: { increment: addQty } },
    })
    return NextResponse.json({ ok: true, product: updated })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
