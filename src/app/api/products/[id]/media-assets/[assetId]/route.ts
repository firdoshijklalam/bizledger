// PRD Part 34 §1 — Single media asset CRUD by ID.
// GET:    return a specific media asset.
// PATCH:  update fields (status, progress, scores, urls, etc.) — used for
//         internal status updates and manual overrides.
// DELETE: remove the asset.
//
// §AUTH: All handlers require an authenticated business and verify the product
// belongs to that business before touching its media assets.

import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §OWNERSHIP: Confirms the product belongs to the authenticated business.
// Returns the product or null (caller responds 404 on null).
async function getOwnedProduct(businessId: string, productId: string) {
  return db.product.findFirst({ where: { id: productId, businessId } })
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id, assetId } = await params

    // §OWNERSHIP: Verify the product belongs to this business before reading
    // any of its media assets.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const asset = await db.productMediaAsset.findFirst({
      where: { id: assetId, productId: id },
    })
    if (!asset) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }
    return NextResponse.json({ asset })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id, assetId } = await params

    // §OWNERSHIP: Verify the product belongs to this business before updating
    // any of its media assets.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    const body = await req.json()

    // Verify ownership before update
    const existing = await db.productMediaAsset.findFirst({
      where: { id: assetId, productId: id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
    }

    // Whitelist updatable fields
    const allowed: Record<string, unknown> = {}
    const numericFields = [
      'progress',
      'qualityScore',
      'symmetryScore',
      'volumeMatch',
      'matchScore',
      'inputCount',
    ]
    const stringFields = [
      'status',
      'inputType',
      'inputUrl',
      'meshData',
      'processedImageUrl',
      'spinVideoUrl',
      'frontViewUrl',
      'backViewUrl',
      'leftViewUrl',
      'rightViewUrl',
      'rejectionReason',
    ]
    const booleanFields = ['ironingApplied', 'textRestored', 'bgRemoved']

    for (const f of numericFields) {
      if (body[f] !== undefined) allowed[f] = Number(body[f])
    }
    for (const f of stringFields) {
      if (body[f] !== undefined) allowed[f] = body[f]
    }
    for (const f of booleanFields) {
      if (body[f] !== undefined) allowed[f] = Boolean(body[f])
    }

    const updated = await db.productMediaAsset.update({
      where: { id: assetId },
      data: allowed,
    })

    return NextResponse.json({ asset: updated })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; assetId: string }> }
) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id, assetId } = await params

    // §OWNERSHIP: Verify the product belongs to this business before deleting
    // any of its media assets.
    const product = await getOwnedProduct(business.id, id)
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    await db.productMediaAsset.deleteMany({
      where: { id: assetId, productId: id },
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
