import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/business/delivery-config — owner: current delivery radius, location, serviceable areas.
// PUT /api/business/delivery-config — owner: update delivery radius / lat / lng / serviceableAreas.

export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }
    let serviceableAreas: string[] = []
    try {
      serviceableAreas = business.serviceableAreas
        ? JSON.parse(business.serviceableAreas)
        : []
    } catch {
      serviceableAreas = []
    }
    return NextResponse.json({
      deliveryRadiusKm: business.deliveryRadiusKm,
      latitude: business.latitude,
      longitude: business.longitude,
      serviceableAreas,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const existing = await getCurrentBusiness()
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }

    const data: Record<string, unknown> = {}
    if (body.deliveryRadiusKm !== undefined) {
      data.deliveryRadiusKm = Number(body.deliveryRadiusKm)
    }
    if (body.latitude !== undefined) {
      data.latitude = body.latitude === null ? null : Number(body.latitude)
    }
    if (body.longitude !== undefined) {
      data.longitude = body.longitude === null ? null : Number(body.longitude)
    }
    if (Array.isArray(body.serviceableAreas)) {
      data.serviceableAreas = JSON.stringify(body.serviceableAreas)
    }

    const updated = await db.business.update({
      where: { id: existing.id },
      data,
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
