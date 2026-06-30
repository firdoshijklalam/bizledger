import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// PATCH /api/customer-orders/[id]/status — owner: update order status.
// Body: { status: 'confirmed' | 'delivered' | 'cancelled' }

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
