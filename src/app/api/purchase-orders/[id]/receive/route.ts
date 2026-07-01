import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// /api/purchase-orders/[id]/receive — mark PO as received and restock items.
// Security: verifies the PO belongs to the current business.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Multi-tenant isolation
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const po = await db.purchaseOrder.findFirst({
      where: { id, businessId: business.id },
      include: { items: true },
    })
    if (!po) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    await db.purchaseOrder.update({ where: { id }, data: { status: 'received', receivedAt: new Date() } })
    const restocked: any[] = []
    for (const it of po.items) {
      if (it.matchedProductId) {
        // Verify product belongs to this business before incrementing
        const product = await db.product.findFirst({
      where: { id: it.matchedProductId, businessId: business.id },
    })
        if (product) {
          await db.product.update({ where: { id: it.matchedProductId }, data: { stock: { increment: it.quantity } } })
          restocked.push({ productName: it.productName, quantity: it.quantity, action: 'restocked', productId: it.matchedProductId })
        }
      } else {
        const p = await db.product.create({ data: { businessId: business.id, name: it.productName, category: it.category, purchasePrice: it.unitPrice, salePrice: it.unitPrice, stock: it.quantity, supplierId: po.supplierId } })
        restocked.push({ productName: it.productName, quantity: it.quantity, action: 'created', productId: p.id })
      }
    }
    return NextResponse.json({ received: true, restocked })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
