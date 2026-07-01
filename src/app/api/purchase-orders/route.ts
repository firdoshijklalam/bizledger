import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { calcLandedCost } from '@/lib/landed-cost'
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])
  const pos = await db.purchaseOrder.findMany({ where: { businessId: business.id }, include: { items: true, supplier: true }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(pos)
}
export async function POST(req: NextRequest) {
  const body = await req.json(); const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  if (!body.supplierId) return NextResponse.json({ error: 'supplierId required' }, { status: 400 })
  const year = new Date().getFullYear()
  const count = await db.purchaseOrder.count({ where: { businessId: business.id, createdAt: { gte: new Date(year, 0, 1), lt: new Date(year+1, 0, 1) } } })
  const poNumber = `PO-${year}-${String(count+1).padStart(4,'0')}`
  let totalAmount = 0
  const itemsData = (body.items as any[]).map(it => { const q=Number(it.quantity)||0, up=Number(it.unitPrice)||0, tf=Number(it.transportFare)||0, cc=Number(it.coolieCharge)||0; const l=calcLandedCost({basePrice:up,transportFare:tf,coolieCharge:cc,quantity:q}); totalAmount+=l.totalCost; return { catalogItemId: it.catalogItemId||null, productName: String(it.productName||''), category: it.category?String(it.category):null, quantity:q, unitPrice:up, transportFare:tf, coolieCharge:cc, totalCost:l.totalCost, matchedProductId: it.matchedProductId?String(it.matchedProductId):null } })
  const po = await db.purchaseOrder.create({ data: { businessId: business.id, supplierId: body.supplierId, poNumber, status: 'sent', totalAmount, notes: body.notes?String(body.notes):null, items: { create: itemsData } }, include: { items: true, supplier: true } })
  return NextResponse.json(po)
}
