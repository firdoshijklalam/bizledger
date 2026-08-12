// PRD Part 34 §1 — Media assets CRUD endpoint for a product.
// GET:    list all media assets for the product, newest first.
// DELETE: ?assetId=X removes a specific asset.
// POST:   create a new media asset record (manual uploads / internal use).
//
// §AUTH: All handlers require an authenticated business (any role) and verify
// the product belongs to that business before serving/modifying its media
// assets. Mirrors the auth posture of /api/products/[id]/media-assets/[assetId].

import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §OWNERSHIP: Confirms the product belongs to the authenticated business.
async function getOwnedProduct(businessId: string, productId: string) {
  return db.product.findFirst({ where: { id: productId, businessId } })
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params

    // §OWNERSHIP: Verify the product belongs to this business before listing
    // its media assets.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const assets = await db.productMediaAsset.findMany({
      where: { productId: id, businessId: business.id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ assets })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // §AUTH: Use session-authenticated business, not a hardcoded fallback.
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // §OWNERSHIP: Verify the product belongs to this business before creating
    // any media assets for it. Previously used findUnique({ where: { id } })
    // which leaks the existence of foreign products.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const body = await req.json()

    const asset = await db.productMediaAsset.create({
      data: {
        productId: id,
        businessId: business.id,
        inputType: body.inputType === 'video' ? 'video' : 'image',
        inputUrl: body.inputUrl ?? null,
        inputCount: Number(body.inputCount) || 1,
        status: body.status ?? 'pending',
        progress: 0,
      },
    })

    return NextResponse.json({ asset })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const assetId = req.nextUrl.searchParams.get('assetId')
    if (!assetId) {
      return NextResponse.json({ error: 'assetId query param is required' }, { status: 400 })
    }

    // §OWNERSHIP: Verify the product belongs to this business before deleting
    // any of its media assets.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    await db.productMediaAsset.deleteMany({
      where: { id: assetId, productId: id, businessId: business.id },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
