import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// /api/products/[id]/publish — toggle the online publishing status of a product (PRD Part 35 §3.1).
// GET: return the current publish status.
// POST: body `{ publish?: boolean }`. If `publish` is omitted, toggle the current value.

// GET /api/products/[id]/publish
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    const product = await db.product.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, name: true, isPublished: true, updatedAt: true },
    })
    if (!product) {
      return NextResponse.json({ error: 'Product not found in your business' }, { status: 404 })
    }

    return NextResponse.json({
      id: product.id,
      name: product.name,
      isPublished: product.isPublished,
      updatedAt: product.updatedAt,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// POST /api/products/[id]/publish
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business found' }, { status: 400 })

    const existing = await db.product.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, isPublished: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Product not found in your business' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    // If `publish` is explicitly provided, use it; otherwise toggle the current value.
    const nextValue =
      typeof body.publish === 'boolean' ? body.publish : !existing.isPublished

    const updated = await db.product.update({
      where: { id },
      data: { isPublished: nextValue },
    })

    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
