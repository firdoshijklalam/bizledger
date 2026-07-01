import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { phoneticSearch } from '@/lib/phonetic'

// GET /api/products — supports ?q=search&phonetic=true for cross-language phonetic search
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lowStock = searchParams.get('lowStock') === 'true'
  const q = searchParams.get('q') || ''
  const usePhonetic = searchParams.get('phonetic') === 'true'
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

  let products = await db.product.findMany({
    where: { businessId: business.id },
    orderBy: { updatedAt: 'desc' },
  })

  if (lowStock) {
    products = products.filter((p) => p.stock <= p.lowStockThreshold)
  }

  // Phonetic search (PRD v2 §12.2) — Bengali ↔ English sound matching
  if (q && usePhonetic) {
    const ranked = phoneticSearch(products, q)
    return NextResponse.json(ranked.map((r) => r.item))
  }

  // Regular text search
  if (q) {
    const query = q.toLowerCase()
    products = products.filter(
      (p) => p.name.toLowerCase().includes(query) || (p.sku || '').toLowerCase().includes(query)
    )
  }

  return NextResponse.json(products)
}

// POST /api/products
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
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
        // PRD Part 11: Dual-stock + retail config
        retailEnabled: body.retailEnabled ?? false,
        retailUnit: body.retailEnabled ? (body.retailUnit || null) : null,
        conversionFactor: body.retailEnabled ? (Number(body.conversionFactor) || null) : null,
        retailSalePrice: body.retailEnabled ? (Number(body.retailSalePrice) || 0) : null,
        looseStock: body.retailEnabled ? (Number(body.looseStock) || 0) : 0,
        subCategory: body.subCategory || null,
      },
    })
    return NextResponse.json(product)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
