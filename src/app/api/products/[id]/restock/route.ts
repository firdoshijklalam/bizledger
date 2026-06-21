import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/products/[id]/restock — quick stock increment
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const addQty = Number(body.quantity)
    if (!addQty || addQty <= 0) {
      return NextResponse.json({ error: 'Invalid quantity' }, { status: 400 })
    }
    const updated = await db.product.update({
      where: { id },
      data: { stock: { increment: addQty } },
    })
    return NextResponse.json({ ok: true, product: updated })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
