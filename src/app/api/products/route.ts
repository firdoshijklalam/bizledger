import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/products
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lowStock = searchParams.get('lowStock') === 'true'
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json([])

  const products = await db.product.findMany({
    where: {
      businessId: business.id,
      ...(lowStock ? {} : {}),
    },
    orderBy: { updatedAt: 'desc' },
  })

  const filtered = lowStock
    ? products.filter((p) => p.stock <= p.lowStockThreshold)
    : products

  return NextResponse.json(filtered)
}

// POST /api/products
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await db.business.findFirst()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const product = await db.product.create({
      data: {
        businessId: business.id,
        name: body.name,
        sku: body.sku || null,
        category: body.category || null,
        unit: body.unit || 'pcs',
        purchasePrice: Number(body.purchasePrice) || 0,
        salePrice: Number(body.salePrice) || 0,
        mrp: body.mrp ? Number(body.mrp) : null,
        wholesalePrice: body.wholesalePrice ? Number(body.wholesalePrice) : null,
        gstRate: Number(body.gstRate) || 0,
        stock: Number(body.stock) || 0,
        lowStockThreshold: Number(body.lowStockThreshold) || 5,
        supplierId: body.supplierId || null,
      },
    })
    return NextResponse.json(product)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
