import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { phoneticSearch } from '@/lib/phonetic'
import { generateSearchTags } from '@/lib/transliteration'

// GET /api/products — optimized with pagination + field selection
// Supports ?q=search&phonetic=true&lowStock=true&limit=50&offset=0
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lowStock = searchParams.get('lowStock') === 'true'
  const q = searchParams.get('q') || ''
  const usePhonetic = searchParams.get('phonetic') === 'true'
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  const offset = Number(searchParams.get('offset')) || 0
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ items: [], total: 0, hasMore: false })

  // Build optimized where clause
  const where: any = { businessId: business.id }
  if (q && !usePhonetic) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { sku: { contains: q, mode: 'insensitive' } },
      // §3: Also search the phonetic searchTags JSON field
      { searchTags: { contains: q.toLowerCase(), mode: 'insensitive' } },
    ]
  }

  const [products, totalCount] = await Promise.all([
    db.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.product.count({ where }),
  ])

  let result = products
  if (lowStock) {
    result = products.filter((p) => p.stock <= p.lowStockThreshold)
  }

  // Phonetic search (PRD v2 §12.2) — on the fetched chunk only
  if (q && usePhonetic) {
    const ranked = phoneticSearch(result as any[], q)
    return NextResponse.json({ items: ranked.map((r) => r.item), total: totalCount, hasMore: offset + limit < totalCount })
  }

  return NextResponse.json({ items: result, total: totalCount, hasMore: offset + limit < totalCount })
}

// POST /api/products
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §3: Auto-generate phonetic search tags from the product name
    const searchTags = JSON.stringify(generateSearchTags(body.name || ''))

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
        retailMrp: body.retailEnabled ? (body.retailMrp ? Number(body.retailMrp) : null) : null,
        looseStock: body.retailEnabled ? (Number(body.looseStock) || 0) : 0,
        subCategory: body.subCategory || null,
        // PRD Part 35: AI auto-fill + nested category + publishing
        description: body.description || null,
        isPublished: body.isPublished ?? true,
        categoryPath: body.categoryPath || null,
        searchTags,
      },
    })
    return NextResponse.json(product)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
