import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * §HEADLESS: Public Catalog API — for external Quick-Commerce frontends.
 *
 * This endpoint is PUBLIC (no auth required) and returns published products
 * for a specific store (by storeSlug). External apps (Next.js/React Native)
 * can query this to display the product catalog with real-time stock.
 *
 * §SINGLE-SOURCE-OF-TRUTH: Stock is managed HERE (the admin app). The
 * customer frontend reads stock via this API. When stock hits 0, the
 * frontend shows "Out of Stock" immediately.
 *
 * Query params:
 *   ?slug=<storeSlug>        — required, identifies the store
 *   ?q=<search>              — search by name/category/searchTags
 *   ?category=<category>     — filter by category
 *   ?limit=50&offset=0       — pagination
 *   ?includeOutOfStock=false — hide out-of-stock items (default: false)
 *
 * Response:
 *   { store: {...}, products: [...], total, hasMore }
 */

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get('slug')
    if (!slug) {
      return NextResponse.json({ error: 'Missing slug parameter' }, { status: 400 })
    }

    // Find the business by store slug
    const business = await db.business.findUnique({
      where: { storeSlug: slug },
      select: {
        id: true,
        name: true,
        storeSlug: true,
        deliveryRadiusKm: true,
        latitude: true,
        longitude: true,
        serviceableAreas: true,
        currency: true,
        logoUrl: true,
        address: true,
        phone: true,
      },
    })

    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const q = searchParams.get('q') || ''
    const category = searchParams.get('category')
    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
    const offset = Number(searchParams.get('offset')) || 0
    const includeOutOfStock = searchParams.get('includeOutOfStock') === 'true'

    // Build where clause — only published products
    const where: any = {
      businessId: business.id,
      isPublished: true,
    }

    // §SINGLE-SOURCE-OF-TRUTH: Hide out-of-stock items unless explicitly requested.
    // Stock is the admin app's responsibility — the frontend trusts this value.
    if (!includeOutOfStock) {
      where.OR = [
        { stock: { gt: 0 } },
        { looseStock: { gt: 0 } },
      ]
    }

    if (q) {
      where.AND = where.AND || []
      where.AND.push({
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { sku: { contains: q, mode: 'insensitive' } },
          { category: { contains: q, mode: 'insensitive' } },
          { subCategory: { contains: q, mode: 'insensitive' } },
          { searchTags: { contains: q.toLowerCase(), mode: 'insensitive' } },
        ],
      })
    }

    if (category) {
      where.OR = where.OR || []
      where.AND = where.AND || []
      where.AND.push({
        OR: [
          { category: { equals: category, mode: 'insensitive' } },
          { categoryPath: { contains: category, mode: 'insensitive' } },
        ],
      })
    }

    const [products, totalCount] = await Promise.all([
      db.product.findMany({
        where,
        select: {
          id: true,
          name: true,
          sku: true,
          category: true,
          subCategory: true,
          categoryPath: true,
          unit: true,
          salePrice: true,
          mrp: true,
          wholesalePrice: true,
          // §SINGLE-SOURCE-OF-TRUTH: Stock fields exposed for real-time display
          stock: true,
          looseStock: true,
          retailEnabled: true,
          retailUnit: true,
          retailSalePrice: true,
          retailMrp: true,
          lowStockThreshold: true,
          description: true,
          isPublished: true,
          images: {
            select: { url: true, isPrimary: true, order: true },
            orderBy: { order: 'asc' },
          },
          updatedAt: true,
        },
        orderBy: { updatedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      db.product.count({ where }),
    ])

    // Compute display fields for the frontend
    const catalogProducts = products.map((p) => {
      const inStock = p.stock > 0 || p.looseStock > 0
      const lowStock = p.stock > 0 && p.stock <= p.lowStockThreshold
      // Discount % for display (MRP vs salePrice)
      const discountPct = p.mrp && p.mrp > p.salePrice
        ? Math.round(((p.mrp - p.salePrice) / p.mrp) * 100)
        : 0

      return {
        ...p,
        inStock,
        lowStock,
        displayPrice: p.retailEnabled && p.retailSalePrice ? p.retailSalePrice : p.salePrice,
        displayMrp: p.retailEnabled && p.retailMrp ? p.retailMrp : p.mrp,
        discountPct,
        primaryImage: p.images.find((i) => i.isPrimary)?.url || p.images[0]?.url || null,
      }
    })

    return NextResponse.json({
      store: business,
      products: catalogProducts,
      total: totalCount,
      hasMore: offset + limit < totalCount,
    })
  } catch (e) {
    console.error('Public catalog API error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
