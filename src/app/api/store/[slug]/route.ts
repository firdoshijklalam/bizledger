import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/store/[slug] — PUBLIC customer-facing store catalog.
// Fetches the Business by storeSlug and returns only in-stock products.
// If a business has no storeSlug yet, auto-generates one from its name as a convenience fallback
// (matches when the requested slug is empty or matches the first business with no slug).
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params

    let business = await db.business.findFirst({
      where: { storeSlug: slug },
      include: {
        products: {
          // PRD Part 35 §3.1: only return published products with stock
          where: { stock: { gt: 0 }, isPublished: true },
          orderBy: { name: 'asc' },
        },
      },
    })

    // Convenience fallback: if no business has this slug, and any business
    // has no storeSlug yet, auto-generate one based on its name and persist it.
    if (!business) {
      const candidates = await db.business.findMany({
        where: { storeSlug: null },
      })
      for (const c of candidates) {
        const generated = slugify(c.name)
        if (generated === slug) {
          try {
            business = await db.business.update({
              where: { id: c.id },
              data: { storeSlug: generated },
              include: {
                products: {
                  where: { stock: { gt: 0 } },
                  orderBy: { name: 'asc' },
                },
              },
            })
          } catch {
            // unique constraint collision — ignore and continue
          }
          break
        }
      }
    }

    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const products = business.products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      unit: p.unit,
      salePrice: p.salePrice,
      mrp: p.mrp,
      wholesalePrice: p.wholesalePrice,
      gstRate: p.gstRate,
      stock: p.stock,
      retailEnabled: p.retailEnabled,
      retailUnit: p.retailUnit,
      retailSalePrice: p.retailSalePrice,
      subCategory: p.subCategory,
      // PRD Part 35: AI description + category path
      description: p.description,
      categoryPath: p.categoryPath,
      isPublished: p.isPublished,
    }))

    return NextResponse.json({
      id: business.id,
      name: business.name,
      ownerName: business.ownerName,
      phone: business.phone,
      address: business.address,
      state: business.state,
      logoUrl: business.logoUrl,
      upiId: business.upiId,
      currency: business.currency,
      deliveryRadiusKm: business.deliveryRadiusKm,
      latitude: business.latitude,
      longitude: business.longitude,
      products,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
