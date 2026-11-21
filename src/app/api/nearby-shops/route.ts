import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/nearby-shops — PUBLIC geo-fenced shop discovery.
// Accepts ?lat=X&lng=Y (Haversine distance match against deliveryRadiusKm)
// OR ?area=Z (case-insensitive substring match against serviceableAreas JSON array).
// Sponsored shops (isSponsored=true AND sponsoredUntil in future) sort first, then by distance asc.
//
// Optional ?all=1 — bypass the radius/area filter and return ALL published shops
// (still computes distance when lat+lng are supplied). Used by the "Unserviceable
// Location" AI recommendation panel (PRD Part 33 §3.3) to surface the nearest
// shops anyway. Backward-compatible: no behavior change when this flag is absent.

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
    const area = searchParams.get('area')?.toLowerCase().trim()
    const includeAll = searchParams.get('all') === '1'

    const lat = latParam ? parseFloat(latParam) : NaN
    const lng = lngParam ? parseFloat(lngParam) : NaN
    const hasGeo = !Number.isNaN(lat) && !Number.isNaN(lng)

    if (!hasGeo && !area && !includeAll) {
      return NextResponse.json(
        { error: 'Provide lat+lng or area query parameter' },
        { status: 400 }
      )
    }

    // Fetch all businesses with a published storeSlug.
    const businesses = await db.business.findMany({
      where: { storeSlug: { not: null } },
      include: {
        products: { select: { category: true, stock: true } },
        settings: true,
      },
    })

    // PRD Part 37 §1.1 — Merchant Control Toggles:
    //   Exclude businesses whose onlineSalesEnabled is false (or
    //   offlineOnlyMode is true). These merchants have opted out of the public
    //   marketplace and must not appear in nearby-shops discovery.
    const onlineBusinesses = businesses.filter((b) => {
      if (!b.settings) return true // no settings row → default to visible
      if (b.settings.offlineOnlyMode) return false
      return b.settings.onlineSalesEnabled
    })

    const now = new Date()
    const results = onlineBusinesses
      .map((b) => {
        let distance: number | null = null

        // Geo match: only include if business has lat/lng and is within radius.
        if (hasGeo && b.latitude != null && b.longitude != null) {
          distance = haversine(lat, lng, b.latitude, b.longitude)
          if (!includeAll && distance > b.deliveryRadiusKm) return null
        } else if (hasGeo && !includeAll) {
          // Customer sent geo, business has no coords → skip.
          return null
        }

        // Area match: only include if at least one serviceable area matches.
        if (!hasGeo && area && !includeAll) {
          let areas: string[] = []
          try {
            areas = b.serviceableAreas ? JSON.parse(b.serviceableAreas) : []
          } catch {
            areas = []
          }
          const matched = areas.some((a) => a.toLowerCase().includes(area))
          if (!matched) return null
        }

        const isSponsored = b.isSponsored && b.sponsoredUntil ? b.sponsoredUntil > now : false
        const inStockProducts = b.products.filter((p) => p.stock > 0)
        const productCount = inStockProducts.length
        const category = inStockProducts.find((p) => p.category)?.category || 'General'

        return {
          id: b.id,
          name: b.name,
          ownerName: b.ownerName,
          address: b.address,
          logoUrl: b.logoUrl,
          storeSlug: b.storeSlug,
          deliveryRadiusKm: b.deliveryRadiusKm,
          distance,
          isSponsored,
          productCount,
          category,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)

    // Sponsored first, then by distance ascending (null distance sorts last).
    results.sort((a, b) => {
      if (a.isSponsored !== b.isSponsored) return a.isSponsored ? -1 : 1
      const da = a.distance ?? Number.POSITIVE_INFINITY
      const db_ = b.distance ?? Number.POSITIVE_INFINITY
      return da - db_
    })

    return NextResponse.json(results)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
