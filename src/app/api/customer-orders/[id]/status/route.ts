import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// PATCH /api/customer-orders/[id]/status — owner: update order status.
// Body: { status: 'confirmed' | 'delivered' | 'cancelled' }
// Security: verifies the order belongs to the current business before updating.

const ALLOWED = new Set(['confirmed', 'delivered', 'cancelled'])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const status = String(body.status || '')

    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be confirmed | delivered | cancelled' },
        { status: 400 }
      )
    }

    // Multi-tenant isolation: get current business, verify ownership
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    // Verify the order belongs to this business
    const existing = await db.customerOrder.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Order not found in your business' }, { status: 404 })
    }

    const updated = await db.customerOrder.update({
      where: { id },
      data: { status },
    })

    return NextResponse.json({
      ...updated,
      items: updated.items ? JSON.parse(updated.items) : [],
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
