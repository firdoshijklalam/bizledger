// PRD Part 34 §1 — 3D reconstruction status polling endpoint.
// GET: return the current/latest (or specific ?assetId=X) media asset
// including status, progress, and all score fields.
//
// §AUTH: Requires an authenticated business (any role) and verifies the
// product belongs to that business before serving its media asset data.
// Matches the auth posture of POST /api/products/[id]/3d-reconstruct.

import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const assetId = req.nextUrl.searchParams.get('assetId')

    // §OWNERSHIP: Verify the product belongs to this business before reading
    // any of its media assets.
    const product = await db.product.findFirst({
      where: { id, businessId: business.id },
      select: { id: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    let asset
    if (assetId) {
      asset = await db.productMediaAsset.findFirst({
        where: { id: assetId, productId: id, businessId: business.id },
      })
      if (!asset) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
      }
    } else {
      asset = await db.productMediaAsset.findFirst({
        where: { productId: id, businessId: business.id },
        orderBy: { createdAt: 'desc' },
      })
    }

    return NextResponse.json({ asset })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
