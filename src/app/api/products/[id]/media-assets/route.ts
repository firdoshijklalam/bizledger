// PRD Part 34 §1 — Media assets CRUD endpoint for a product.
// GET:    list all media assets for the product, newest first.
// DELETE: ?assetId=X removes a specific asset.
// POST:   create a new media asset record (manual uploads / internal use).

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const assets = await db.productMediaAsset.findMany({
      where: { productId: id },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ assets })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    // Verify product exists
    const product = await db.product.findUnique({ where: { id } })
    if (!product) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 })
    }

    // Single-tenant dev: first business
    const business = await db.business.findFirst({ orderBy: { createdAt: 'asc' } })
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

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
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const assetId = req.nextUrl.searchParams.get('assetId')
    if (!assetId) {
      return NextResponse.json({ error: 'assetId query param is required' }, { status: 400 })
    }

    await db.productMediaAsset.deleteMany({
      where: { id: assetId, productId: id },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
