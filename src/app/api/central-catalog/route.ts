import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §VERCEL-LIMIT: Allow up to 20s for multi-shop geo-query aggregation
export const maxDuration = 20

// GET /api/central-catalog — PRD Part 36 §1.1
// Merged catalog from ALL shops within the customer's geo-fence.
// Query params:
//   ?lat=X&lng=Y            — customer location for Haversine geo-fence
//   ?customerPhone=Z        — used to rank favorite shops into the Top Tier (§1.3)
//
// Response:
//   {
//     categories: [{ name, products: [...] }],
//     totalProducts: number,
//     shopsInRange: number
//   }
//
// Each product:
//   { id, name, category, salePrice, mrp, unit, stock, retailEnabled, retailUnit,
//     retailSalePrice, description, storeSlug, isFavorite, isSponsored,
//     tier: 'top'|'bottom', shopName: null | string (only if favorite) }
//
// 3-tier priority ranking (§1.3):
//   Top Tier    → products from favorite shops + sponsored shops (gold badge)
//   Bottom Tier → other shops' products (sorted by price ascending)
//
// businessName is HIDDEN by default for anonymous browse. It is only returned
// as `shopName` when the shop is in the customer's favorites.

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371 // km
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const latParam = searchParams.get('lat')
    const lngParam = searchParams.get('lng')
    const customerPhone = searchParams.get('customerPhone')?.trim() || ''

    const lat = latParam ? parseFloat(latParam) : NaN
    const lng = lngParam ? parseFloat(lngParam) : NaN
    const hasGeo = !Number.isNaN(lat) && !Number.isNaN(lng)

    // 1. Fetch ALL businesses with a storeSlug set.
    const businesses = await db.business.findMany({
      where: { storeSlug: { not: null } },
      include: {
        products: true,
        settings: true,
      },
    })

    // PRD Part 37 §1.1 — Merchant Control Toggles:
    //   If a business has AppSettings.onlineSalesEnabled = false (or
    //   offlineOnlyMode = true), ALL of its products are excluded from the
    //   central catalog and the shop is hidden from anonymous browse.
    const onlineBusinesses = businesses.filter((b) => {
      if (!b.settings) return true // no settings row → default to visible
      if (b.settings.offlineOnlyMode) return false
      return b.settings.onlineSalesEnabled
    })

    // 2. For each business with lat/lng, compute Haversine distance.
    //    Include shops within their deliveryRadiusKm.
    const now = new Date()
    const shopsInRange: Array<{
      id: string
      name: string
      storeSlug: string
      isSponsored: boolean
      distance: number | null
    }> = []

    for (const b of onlineBusinesses) {
      let distance: number | null = null
      if (hasGeo && b.latitude != null && b.longitude != null) {
        distance = haversine(lat, lng, b.latitude, b.longitude)
        if (distance > b.deliveryRadiusKm) continue
      } else if (hasGeo) {
        // Customer sent geo, business has no coords → skip.
        continue
      }
      // If no geo provided at all, include all shops (anonymous browse mode).
      const isSponsored =
        b.isSponsored && b.sponsoredUntil ? b.sponsoredUntil > now : false
      shopsInRange.push({
        id: b.id,
        name: b.name,
        storeSlug: b.storeSlug as string,
        isSponsored,
        distance,
      })
    }

    // 3. Fetch customer's favorite shops (if phone provided).
    let favoriteBusinessIds = new Set<string>()
    let favoriteShopNames = new Map<string, string>() // businessId → businessName
    if (customerPhone) {
      const favorites = await db.favoriteShop.findMany({
        where: { customerPhone },
      })
      for (const f of favorites) {
        favoriteBusinessIds.add(f.businessId)
        favoriteShopNames.set(f.businessId, f.businessName)
      }
    }

    // 4. Build a lookup of shopsInRange by businessId.
    const shopMeta = new Map<string, { storeSlug: string; isSponsored: boolean; isFavorite: boolean; shopName: string | null }>()
    for (const s of shopsInRange) {
      const isFav = favoriteBusinessIds.has(s.id)
      shopMeta.set(s.id, {
        storeSlug: s.storeSlug,
        isSponsored: s.isSponsored,
        isFavorite: isFav,
        // shopName is only returned if favorite
        shopName: isFav ? favoriteShopNames.get(s.id) ?? s.name : null,
      })
    }

    // 5. Fetch all published in-stock products from shops in range.
    const businessIds = shopsInRange.map((s) => s.id)
    const products = await db.product.findMany({
      where: {
        businessId: { in: businessIds },
        isPublished: true,
        stock: { gt: 0 },
      },
    })

    // 6. Build merged catalog entries with tier tags.
    type CatalogEntry = {
      id: string
      name: string
      category: string
      salePrice: number
      mrp: number | null
      unit: string
      stock: number
      retailEnabled: boolean
      retailUnit: string | null
      retailSalePrice: number | null
      description: string | null
      storeSlug: string
      businessId: string // needed by frontend to place multi-shop split orders (§2.1)
      isFavorite: boolean
      isSponsored: boolean
      tier: 'top' | 'bottom'
      shopName: string | null
      _sortPrice: number
    }

    const entries: CatalogEntry[] = products.map((p) => {
      const meta = shopMeta.get(p.businessId)!
      const isTop = meta.isFavorite || meta.isSponsored
      return {
        id: p.id,
        name: p.name,
        category: p.category || 'General',
        salePrice: p.salePrice.toNumber(),
        mrp: p.mrp ? p.mrp.toNumber() : null,
        unit: p.unit,
        stock: p.stock,
        retailEnabled: p.retailEnabled,
        retailUnit: p.retailUnit,
        retailSalePrice: p.retailSalePrice ? p.retailSalePrice.toNumber() : null,
        description: p.description,
        storeSlug: meta.storeSlug,
        businessId: p.businessId,
        isFavorite: meta.isFavorite,
        isSponsored: meta.isSponsored,
        tier: isTop ? 'top' : 'bottom',
        shopName: meta.shopName,
        _sortPrice: p.salePrice.toNumber(),
      }
    })

    // 7. 3-tier priority ranking:
    //    Top tier first (favorites → sponsored), then bottom tier sorted by price asc.
    entries.sort((a, b) => {
      const aTop = a.tier === 'top' ? 0 : 1
      const bTop = b.tier === 'top' ? 0 : 1
      if (aTop !== bTop) return aTop - bTop
      // Within top tier: favorites before sponsored.
      if (aTop === 0) {
        const aFav = a.isFavorite ? 0 : 1
        const bFav = b.isFavorite ? 0 : 1
        if (aFav !== bFav) return aFav - bFav
      }
      // Within bottom tier (and ties within top): sort by price ascending.
      return a._sortPrice - b._sortPrice
    })

    // 8. Group products by category for the Zepto-style UI.
    //    Preserve tier ordering: top-tier products appear first within each category.
    const categoryMap = new Map<string, CatalogEntry[]>()
    for (const e of entries) {
      const arr = categoryMap.get(e.category) || []
      arr.push(e)
      categoryMap.set(e.category, arr)
    }

    // Sort categories: those containing any top-tier product come first (alphabetical within group).
    const categories = Array.from(categoryMap.entries())
      .map(([name, products]) => {
        const hasTop = products.some((p) => p.tier === 'top')
        return { name, products: products.map(({ _sortPrice, ...rest }) => rest), _hasTop: hasTop }
      })
      .sort((a, b) => {
        if (a._hasTop !== b._hasTop) return a._hasTop ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      .map(({ name, products, _hasTop }) => ({ name, products, hasTopTier: _hasTop }))

    return NextResponse.json({
      categories,
      totalProducts: entries.length,
      shopsInRange: shopsInRange.length,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
