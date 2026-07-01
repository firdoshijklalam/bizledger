import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { verifyLocation, type LocationVerification } from '@/lib/security'

/**
 * PRD Part 34 — Threat 3: GPS Spoofing Prevention
 *
 * POST /api/verify-location
 * Cross-verifies GPS coordinates with cell tower + IP geolocation (triangulation).
 * Rejects orders from spoofed locations.
 *
 * Body: {
 *   gpsLat, gpsLng, gpsAccuracy,
 *   cellTowerLat?, cellTowerLng?,
 *   ipLat?, ipLng?,
 *   storeSlug: string  // the shop the customer is trying to order from
 * }
 *
 * Returns: { trusted, trustScore, reason, triangulatedLat, triangulatedLng, spoofingDetected, withinDeliveryRadius }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as LocationVerification & { storeSlug?: string }

    if (!body.gpsLat || !body.gpsLng) {
      return NextResponse.json({
        error: 'GPS coordinates required',
        trusted: false,
      }, { status: 400 })
    }

    // Run triangulation verification
    const result = verifyLocation({
      gpsLat: body.gpsLat,
      gpsLng: body.gpsLng,
      gpsAccuracy: body.gpsAccuracy || 50,
      cellTowerLat: body.cellTowerLat,
      cellTowerLng: body.cellTowerLng,
      ipLat: body.ipLat,
      ipLng: body.ipLng,
    })

    // If a store slug is provided, check if the customer is within delivery radius
    let withinDeliveryRadius = false
    let distanceToShop: number | null = null
    if (body.storeSlug) {
      const shop = await db.business.findFirst({
        where: { storeSlug: body.storeSlug },
        select: { latitude: true, longitude: true, deliveryRadiusKm: true, name: true },
      })

      if (shop && shop.latitude && shop.longitude) {
        // Use the TRIANGULATED position (not raw GPS) for distance calculation
        distanceToShop = haversineKm(
          result.triangulatedLat,
          result.triangulatedLng,
          shop.latitude,
          shop.longitude
        )
        withinDeliveryRadius = distanceToShop <= shop.deliveryRadiusKm
      }
    }

    // If spoofing detected, reject the order
    if (result.spoofingDetected) {
      return NextResponse.json({
        ...result,
        withinDeliveryRadius: false,
        distanceToShop,
        orderAllowed: false,
        message: 'GPS spoofing detected. Order blocked. Your location must be verified via triangulation.',
      }, { status: 403 })
    }

    // If not within delivery radius, recommend nearby shops (Threat 3 fix: AI recommendation)
    if (body.storeSlug && !withinDeliveryRadius) {
      return NextResponse.json({
        ...result,
        withinDeliveryRadius: false,
        distanceToShop,
        orderAllowed: false,
        message: 'You are outside the delivery radius for this shop. Please find a closer shop.',
      })
    }

    return NextResponse.json({
      ...result,
      withinDeliveryRadius,
      distanceToShop,
      orderAllowed: result.trusted && withinDeliveryRadius,
      message: result.trusted
        ? 'Location verified via 3-source triangulation. Order allowed.'
        : 'Location verification failed. Please enable GPS + WiFi for accurate location.',
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
