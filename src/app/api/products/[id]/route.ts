import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateSearchTags } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'

// /api/products/[id] — CRUD for a single product.
// Security: all operations verify the product belongs to the current business.

async function getBusinessId() {
  const business = await getCurrentBusiness()
  return business?.id ?? null
}

// GET /api/products/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const businessId = await getBusinessId()
  if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const product = await db.product.findFirst({
      where: { id, businessId },
      include: { images: { orderBy: { order: 'asc' } } },
    })
    if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(product)
  } catch (e: any) {
    // Fallback: return product without images relation (may not exist in Neon yet)
    try {
      const product = await db.product.findFirst({ where: { id, businessId } })
      if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ ...product, images: [] })
    } catch (e2: any) {
      return apiError(e3, "Database error")
    }
  }
}

// PUT /api/products/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.product.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    const body = await req.json()
    // §3: Regenerate search tags if name changed
    const searchTags = body.name !== existing.name
      ? JSON.stringify(generateSearchTags(body.name || ''))
      : undefined
    const updated = await db.product.update({
      where: { id },
      data: {
        name: body.name,
        sku: body.sku,
        category: body.category,
        unit: body.unit,
        purchasePrice: Number(body.purchasePrice),
        salePrice: Number(body.salePrice),
        mrp: body.mrp ? Number(body.mrp) : null,
        wholesalePrice: body.wholesalePrice ? Number(body.wholesalePrice) : null,
        gstRate: Number(body.gstRate) || 0,
        stock: Number(body.stock) || 0,
        lowStockThreshold: Number(body.lowStockThreshold) || 5,
        supplierId: body.supplierId || null,
        // PRD Part 11: Dual-stock + retail config
        retailEnabled: body.retailEnabled ?? false,
        retailUnit: body.retailEnabled ? (body.retailUnit || null) : null,
        conversionFactor: body.retailEnabled ? (Number(body.conversionFactor) || null) : null,
        retailSalePrice: body.retailEnabled ? (Number(body.retailSalePrice) || 0) : null,
        retailMrp: body.retailEnabled ? (body.retailMrp ? Number(body.retailMrp) : null) : null,
        looseStock: body.retailEnabled ? (Number(body.looseStock) || 0) : 0,
        subCategory: body.subCategory || null,
        // PRD Part 35: AI auto-fill + nested category + publishing
        description: body.description || null,
        isPublished: body.isPublished ?? true,
        categoryPath: body.categoryPath || null,
        ...(searchTags ? { searchTags } : {}),
      },
    })
    return NextResponse.json(updated)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// DELETE /api/products/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.product.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    await db.product.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
