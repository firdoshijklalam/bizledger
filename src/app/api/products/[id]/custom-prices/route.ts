import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/products/[id]/custom-prices
// Lists all custom prices (per buyer + per group) for a product.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])
  const prices = await db.customPrice.findMany({
    where: { productId: id, businessId: business.id },
    include: { buyer: { select: { id: true, name: true, phone: true, buyerGroup: true } } },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(prices)
}

// POST /api/products/[id]/custom-prices
// Create or update a custom price. Body:
//   {
//     buyerId?: string,
//     buyerGroupName?: string,
//     // §MULTI-PRICE: Three-tier custom pricing
//     customSalePrice?: number,       // override for Product.salePrice
//     customMrp?: number,             // override for Product.mrp
//     customWholesalePrice?: number,  // override for Product.wholesalePrice
//     // §LEGACY: single customPrice (backward compat — maps to customSalePrice)
//     customPrice?: number,
//     buyerName?: string,
//     buyerBusinessId?: string
//   }
// If a custom price for the same (productId, buyerId) OR (productId, buyerGroupName) exists,
// it is updated (upsert-like).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const body = await req.json()
    const buyerId = body.buyerId || null
    const buyerGroupName = body.buyerGroupName || null
    if (!buyerId && !buyerGroupName) {
      return NextResponse.json({ error: 'Either buyerId or buyerGroupName is required' }, { status: 400 })
    }

    // §MULTI-PRICE: Parse the price fields. All are optional individually,
    // but at least one must be provided.
    const customSalePrice = body.customSalePrice !== undefined ? Number(body.customSalePrice) : undefined
    const customMrp = body.customMrp !== undefined ? Number(body.customMrp) : undefined
    const customWholesalePrice = body.customWholesalePrice !== undefined ? Number(body.customWholesalePrice) : undefined
    // §RETAIL-ISOLATION: Retail-specific prices (per kg/pcs) — separate from bulk
    const customRetailSalePrice = body.customRetailSalePrice !== undefined ? Number(body.customRetailSalePrice) : undefined
    const customRetailMrp = body.customRetailMrp !== undefined ? Number(body.customRetailMrp) : undefined

    // §LEGACY: If only customPrice is provided (old clients), map it to customSalePrice
    const legacyPrice = body.customPrice !== undefined ? Number(body.customPrice) : undefined

    if (
      (customSalePrice === undefined || isNaN(customSalePrice) || customSalePrice < 0) &&
      (customMrp === undefined || isNaN(customMrp) || customMrp < 0) &&
      (customWholesalePrice === undefined || isNaN(customWholesalePrice) || customWholesalePrice < 0) &&
      (customRetailSalePrice === undefined || isNaN(customRetailSalePrice) || customRetailSalePrice < 0) &&
      (customRetailMrp === undefined || isNaN(customRetailMrp) || customRetailMrp < 0) &&
      (legacyPrice === undefined || isNaN(legacyPrice) || legacyPrice < 0)
    ) {
      return NextResponse.json({ error: 'At least one valid price is required' }, { status: 400 })
    }

    // Build the data object — only include fields that are provided
    const data: Record<string, unknown> = {}
    if (customSalePrice !== undefined && !isNaN(customSalePrice)) data.customSalePrice = customSalePrice
    if (customMrp !== undefined && !isNaN(customMrp)) data.customMrp = customMrp
    if (customWholesalePrice !== undefined && !isNaN(customWholesalePrice)) data.customWholesalePrice = customWholesalePrice
    // §RETAIL-ISOLATION: Store retail-specific prices
    if (customRetailSalePrice !== undefined && !isNaN(customRetailSalePrice)) data.customRetailSalePrice = customRetailSalePrice
    if (customRetailMrp !== undefined && !isNaN(customRetailMrp)) data.customRetailMrp = customRetailMrp

    // §LEGACY: Map legacy customPrice to customSalePrice + keep customPrice for backward compat
    if (legacyPrice !== undefined && !isNaN(legacyPrice)) {
      data.customPrice = legacyPrice
      if (data.customSalePrice === undefined) data.customSalePrice = legacyPrice
    } else if (customSalePrice !== undefined) {
      // Keep customPrice in sync with customSalePrice for backward compat
      data.customPrice = customSalePrice
    } else {
      data.customPrice = 0
    }

    // Upsert: find existing by (productId, buyerId) or (productId, buyerGroupName, buyerId=null)
    const existing = await db.customPrice.findFirst({
      where: {
        productId: id,
        businessId: business.id,
        buyerId: buyerId,
        ...(buyerId ? {} : { buyerGroupName: buyerGroupName }),
      },
    })

    let cp
    if (existing) {
      cp = await db.customPrice.update({ where: { id: existing.id }, data })
    } else {
      cp = await db.customPrice.create({
        data: {
          businessId: business.id,
          productId: id,
          buyerId,
          buyerGroupName,
          ...data,
        },
      })
    }

    // §NOTIFICATIONS: notify the targeted buyer business.
    const product = await db.product.findUnique({ where: { id }, select: { name: true } })
    const productName = product?.name || 'Product'
    const buyerName = body.buyerName || (buyerGroupName || 'a buyer')
    // Build a readable price summary for the notification
    const priceParts: string[] = []
    if (data.customSalePrice !== undefined) priceParts.push(`Sale ₹${Number(data.customSalePrice).toFixed(2)}`)
    if (data.customMrp !== undefined) priceParts.push(`MRP ₹${Number(data.customMrp).toFixed(2)}`)
    if (data.customWholesalePrice !== undefined) priceParts.push(`Wholesale ₹${Number(data.customWholesalePrice).toFixed(2)}`)
    const priceSummary = priceParts.length > 0 ? priceParts.join(', ') : `₹${Number(data.customPrice).toFixed(2)}`
    const notifBody = `New stock of ${productName} is available! Your special pricing: ${priceSummary}.`
    const targetBusinessId = body.buyerBusinessId || business.id
    await db.notification.create({
      data: {
        businessId: targetBusinessId,
        type: 'custom-price',
        title: `Special price set: ${productName}`,
        body: notifBody,
        link: '/?sourcing=1',
      },
    }).catch(() => {}) // non-fatal

    return NextResponse.json({ ok: true, customPrice: cp })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
