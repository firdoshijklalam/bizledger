import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { itemId } = await params; const body = await req.json()
  const item = await db.supplierCatalogItem.update({ where: { id: itemId }, data: { productName: body.productName, category: body.category, basePrice: Number(body.basePrice), transportFare: Number(body.transportFare), coolieCharge: Number(body.coolieCharge), unit: body.unit, minOrderQty: Number(body.minOrderQty), notes: body.notes, isActive: body.isActive ?? true } })
  return NextResponse.json(item)
}
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { itemId } = await params
  await db.supplierCatalogItem.delete({ where: { id: itemId } })
  return NextResponse.json({ ok: true })
}
