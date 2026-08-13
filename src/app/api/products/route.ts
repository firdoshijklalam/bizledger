import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { phoneticSearch } from '@/lib/phonetic'
import { generateSearchTags, phoneticMatch } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/products — optimized with pagination + field selection
// Supports ?q=search&phonetic=true&lowStock=true&limit=50&offset=0&page=1
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const lowStock = searchParams.get('lowStock') === 'true'
  const q = searchParams.get('q') || ''
  const usePhonetic = searchParams.get('phonetic') === 'true'
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  // §PAGINATION: ?page (1-based) is an alias for ?offset (offset = (page-1) × limit).
  // If both are provided, ?page wins.
  const pageParam = searchParams.get('page')
  const offset = pageParam
    ? Math.max(0, (Math.max(1, Number(pageParam)) - 1) * limit)
    : Number(searchParams.get('offset')) || 0
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

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
    return NextResponse.json({ items: serializeDecimals(ranked.map((r) => r.item)), total: totalCount, hasMore: offset + limit < totalCount })
  }

  // §1: Fallback — if contains search returned 0 results, try phoneticMatch
  if (q && result.length === 0 && !usePhonetic) {
    const allProducts = await db.product.findMany({
      where: { businessId: business.id },
      take: 200,
    })
    const phoneticMatches = allProducts.filter((p) => phoneticMatch(q, p.name))
    if (phoneticMatches.length > 0) {
      return NextResponse.json({ items: serializeDecimals(phoneticMatches), total: phoneticMatches.length, hasMore: false })
    }
  }

  return NextResponse.json({ items: serializeDecimals(result), total: totalCount, hasMore: offset + limit < totalCount })
}

// POST /api/products
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §INPUT-VALIDATION: Validate required fields and numeric values
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Product name is required' }, { status: 400 })
    }
    const purchasePrice = Number(body.purchasePrice) || 0
    const salePrice = Number(body.salePrice) || 0
    const stock = Number(body.stock) || 0
    const gstRate = Number(body.gstRate) || 0
    // §GUARD: Reject negative prices/stock/gst
    if (purchasePrice < 0) return NextResponse.json({ error: 'Purchase price cannot be negative' }, { status: 400 })
    if (salePrice < 0) return NextResponse.json({ error: 'Sale price cannot be negative' }, { status: 400 })
    if (stock < 0) return NextResponse.json({ error: 'Stock cannot be negative' }, { status: 400 })
    if (gstRate < 0 || gstRate > 100) return NextResponse.json({ error: 'GST rate must be between 0 and 100' }, { status: 400 })

    // §3: Auto-generate phonetic search tags from the product name
    const searchTags = JSON.stringify(generateSearchTags(body.name || ''))

    const product = await db.product.create({
      data: {
        businessId: business.id,
        name: body.name.trim(),
        sku: body.sku || null,
        category: body.category || null,
        unit: body.unit || 'pcs',
        purchasePrice,
        salePrice,
        mrp: body.mrp ? Number(body.mrp) : null,
        wholesalePrice: body.wholesalePrice ? Number(body.wholesalePrice) : null,
        gstRate,
        stock,
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
    return NextResponse.json(serializeDecimals(product))
  } catch (e) {
    return apiError(e, "Failed to create product")
  }
}
