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
//   { buyerId?: string, buyerGroupName?: string, customPrice: number, buyerBusinessId?: string }
// If a custom price for the same (productId, buyerId) OR (productId, buyerGroupName) exists,
// it is updated (upsert-like). Also creates a Notification for the targeted buyer
// (if buyerId + buyerBusinessId provided) — "New stock of [Product] is available!
// Your special price is ₹[Custom_Price]."
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const body = await req.json()
    const customPrice = Number(body.customPrice)
    if (isNaN(customPrice) || customPrice < 0) {
      return NextResponse.json({ error: 'Invalid customPrice' }, { status: 400 })
    }
    const buyerId = body.buyerId || null
    const buyerGroupName = body.buyerGroupName || null
    if (!buyerId && !buyerGroupName) {
      return NextResponse.json({ error: 'Either buyerId or buyerGroupName is required' }, { status: 400 })
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
      cp = await db.customPrice.update({ where: { id: existing.id }, data: { customPrice } })
    } else {
      cp = await db.customPrice.create({
        data: {
          businessId: business.id,
          productId: id,
          buyerId,
          buyerGroupName,
          customPrice,
        },
      })
    }

    // §NOTIFICATIONS: notify the targeted buyer business.
    // buyerBusinessId = the business that the buyer Party belongs to (if provided
    // by the client). In a single-tenant sandbox we also create the notification
    // for the current business so it's visible in the notifications feed.
    const product = await db.product.findUnique({ where: { id }, select: { name: true } })
    const productName = product?.name || 'Product'
    const buyerName = body.buyerName || (buyerGroupName || 'a buyer')
    const notifBody = `New stock of ${productName} is available! Your special price is ₹${customPrice.toFixed(2)}.`
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
