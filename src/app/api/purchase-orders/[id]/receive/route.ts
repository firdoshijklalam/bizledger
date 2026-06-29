import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true } })
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await db.purchaseOrder.update({ where: { id }, data: { status: 'received', receivedAt: new Date() } })
  const restocked: any[] = []
  for (const it of po.items) {
    if (it.matchedProductId) {
      await db.product.update({ where: { id: it.matchedProductId }, data: { stock: { increment: it.quantity } } })
      restocked.push({ productName: it.productName, quantity: it.quantity, action: 'restocked', productId: it.matchedProductId })
    } else {
      const p = await db.product.create({ data: { businessId: po.businessId, name: it.productName, category: it.category, purchasePrice: it.unitPrice, salePrice: it.unitPrice, stock: it.quantity, supplierId: po.supplierId } })
      restocked.push({ productName: it.productName, quantity: it.quantity, action: 'created', productId: p.id })
    }
  }
  return NextResponse.json({ received: true, restocked })
}
