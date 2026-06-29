import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const product = await db.product.findUnique({
    where: { id },
    include: { images: { orderBy: { order: 'asc' } } },
  })
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(product)
}

// PUT /api/products/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const updated = await db.product.update({
    where: { id },
    data: {
      name: body.name,
      sku: body.sku,
      category: body.category,
      unit: body.unit,
      purchasePrice: Number(body.purchasePrice),
      salePrice: Number(body.salePrice),
      mrp: body.mrp ? Number(body.mrp) : null,
      wholesalePrice: body.wholesalePrice ? Number(body.wholesalePrice) : null,
      gstRate: Number(body.gstRate) || 0,
      stock: Number(body.stock) || 0,
      lowStockThreshold: Number(body.lowStockThreshold) || 5,
      supplierId: body.supplierId || null,
      // PRD Part 11: Dual-stock + retail config
      retailEnabled: body.retailEnabled ?? false,
      retailUnit: body.retailEnabled ? (body.retailUnit || null) : null,
      conversionFactor: body.retailEnabled ? (Number(body.conversionFactor) || null) : null,
      retailSalePrice: body.retailEnabled ? (Number(body.retailSalePrice) || 0) : null,
      looseStock: body.retailEnabled ? (Number(body.looseStock) || 0) : 0,
      subCategory: body.subCategory || null,
    },
  })
  return NextResponse.json(updated)
}

// DELETE /api/products/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.product.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
