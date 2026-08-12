import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateSearchTags } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// /api/products/[id] — CRUD for a single product.
// Security: all operations verify the product belongs to the current business.
// §RBAC: PUT (adjust stock, prices, retail config) and DELETE require
// OWNER/ADMIN. STAFF users must not be able to adjust stock levels (manual
// restock is owner-controlled), alter prices, or delete products.

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
      return apiError(e2, "Database error")
    }
  }
}

// PUT /api/products/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §RBAC: Require OWNER or ADMIN — STAFF must not adjust stock or alter prices.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.product.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    const body = await req.json()

    // §INPUT-VALIDATION: Validate numeric fields — reject negative values
    const purchasePrice = body.purchasePrice !== undefined ? Number(body.purchasePrice) : existing.purchasePrice.toNumber()
    const salePrice = body.salePrice !== undefined ? Number(body.salePrice) : existing.salePrice.toNumber()
    const stock = body.stock !== undefined ? Number(body.stock) : existing.stock
    const gstRate = body.gstRate !== undefined ? Number(body.gstRate) : existing.gstRate
    if (purchasePrice < 0) return NextResponse.json({ error: 'Purchase price cannot be negative' }, { status: 400 })
    if (salePrice < 0) return NextResponse.json({ error: 'Sale price cannot be negative' }, { status: 400 })
    if (stock < 0) return NextResponse.json({ error: 'Stock cannot be negative' }, { status: 400 })
    if (gstRate < 0 || gstRate > 100) return NextResponse.json({ error: 'GST rate must be between 0 and 100' }, { status: 400 })

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
        purchasePrice,
        salePrice,
        mrp: body.mrp ? Number(body.mrp) : null,
        wholesalePrice: body.wholesalePrice ? Number(body.wholesalePrice) : null,
        gstRate,
        stock,
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
    // §RBAC: Require OWNER or ADMIN — destructive operation.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

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
