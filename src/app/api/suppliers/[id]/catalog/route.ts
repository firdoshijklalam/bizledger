import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const items = await db.supplierCatalogItem.findMany({ where: { supplierId: id, isActive: true }, orderBy: { productName: 'asc' } })
  const supplier = await db.party.findUnique({ where: { id }, select: { name: true, phone: true } })
  return NextResponse.json(items.map(it => ({ ...it, supplierName: supplier?.name, supplierPhone: supplier?.phone, perUnitLandedCost: it.basePrice + it.transportFare + it.coolieCharge })))
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const body = await req.json()
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  const item = await db.supplierCatalogItem.create({ data: { businessId: business.id, supplierId: id, productName: body.productName, category: body.category || null, basePrice: Number(body.basePrice) || 0, transportFare: Number(body.transportFare) || 0, coolieCharge: Number(body.coolieCharge) || 0, unit: body.unit || 'pcs', minOrderQty: Number(body.minOrderQty) || 1, notes: body.notes || null, matchedProductId: body.matchedProductId || null } })
  return NextResponse.json(item)
}
