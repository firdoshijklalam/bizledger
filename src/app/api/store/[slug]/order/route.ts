import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/store/[slug]/order — OWNER view: list last 50 orders for this store.
//   §SECURITY: Requires authentication + the store must belong to the
//   authenticated user's business. Previously this was unauthenticated,
//   leaking customer names/phones/addresses for any store by slug.
// POST /api/store/[slug]/order — PUBLIC customer order placement from the catalog.
//   This is intentionally public (customers don't have accounts).

const COMMISSION_PCT = 2 // default 2% commission for "More Shops" referrals

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { slug } = await params
    // §OWNERSHIP: Only the store owner can view their orders. Verify the
    // storeSlug belongs to the authenticated business.
    if (business.storeSlug !== slug) {
      return NextResponse.json({ error: 'Forbidden — this store does not belong to your business' }, { status: 403 })
    }
    const orders = await db.customerOrder.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    })
    const parsed = orders.map((o) => ({
      ...o,
      items: o.items ? JSON.parse(o.items) : [],
    }))
    // §DECIMAL-FIX-C: orders array contains CustomerOrder records with raw
    // Decimal fields (subtotal, deliveryCharge, grandTotal, commissionAmount).
    return NextResponse.json(serializeDecimals(parsed))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

interface OrderItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await req.json()

    const business = await db.business.findFirst({ where: { storeSlug: slug } })
    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const items: OrderItem[] = Array.isArray(body.items) ? body.items : []
    const subtotal = items.reduce((sum, it) => sum + Number(it.total || 0), 0)
    const deliveryCharge = Number(body.deliveryCharge || 0)
    const grandTotal = subtotal + deliveryCharge

    // Cross-merchant commission handling.
    let commissionAmount = 0
    let commissionLogId: string | null = null
    const referrerBusinessId: string | undefined = body.referrerBusinessId
    if (referrerBusinessId && referrerBusinessId !== business.id) {
      commissionAmount = (grandTotal * COMMISSION_PCT) / 100
    }

    // Persist the order.
    const order = await db.customerOrder.create({
      data: {
        businessId: business.id,
        customerName: String(body.customerName || 'Walk-in Customer'),
        customerPhone: body.customerPhone ?? null,
        customerAddress: body.customerAddress ?? null,
        customerLat: body.customerLat ?? null,
        customerLng: body.customerLng ?? null,
        items: JSON.stringify(items),
        subtotal,
        deliveryCharge,
        grandTotal,
        status: 'pending',
        notes: body.notes ?? null,
        source: body.source ?? 'catalog',
        referrerBusinessId: referrerBusinessId ?? null,
        commissionAmount,
      },
    })

    // Create commission log entry if a referrer is present.
    if (referrerBusinessId && referrerBusinessId !== business.id) {
      const log = await db.commissionLog.create({
        data: {
          recipientBusinessId: referrerBusinessId,
          payerBusinessId: business.id,
          customerOrderId: order.id,
          orderAmount: grandTotal,
          commissionPct: COMMISSION_PCT,
          commissionAmount,
          status: 'pending',
        },
      })
      commissionLogId = log.id
    }

    // Decrement product stock for each ordered item.
    // §OWNERSHIP: Every product MUST belong to the store's business.
    // Client-supplied productId from another business → rejected.
    // PRD Part 35 §3.3: For loose/retail products, reduce looseStock AND auto-convert bulk stock.
    await Promise.all(
      items.map(async (it) => {
        const product = await db.product.findFirst({ where: { id: it.productId, businessId: business.id } })
        if (!product) return

        const orderedQty = Number(it.quantity || 0)

        // Check if this is a loose/retail order (unitPrice matches retailSalePrice)
        const isLooseOrder = product.retailEnabled &&
          product.retailSalePrice &&
          Math.abs(Number(it.unitPrice) - product.retailSalePrice.toNumber()) < 0.01

        if (isLooseOrder && product.conversionFactor) {
          // Loose order: reduce looseStock, auto-convert bulk if needed
          let currentLoose = product.looseStock || 0

          // If not enough loose stock, convert bulk → loose
          while (currentLoose < orderedQty && product.stock > 0) {
            // Convert 1 bulk unit to loose
            const converted = product.conversionFactor
            await db.product.update({
              where: { id: product.id },
              data: {
                stock: { decrement: 1 },
                looseStock: { increment: converted },
              },
            })
            currentLoose += converted
            product.stock -= 1
            product.looseStock = currentLoose
          }

          // Now decrement looseStock by ordered weight
          await db.product.update({
            where: { id: product.id },
            data: {
              looseStock: { decrement: orderedQty },
            },
          })
        } else {
          // Bulk order: reduce stock directly
          await db.product.update({
            where: { id: product.id },
            data: { stock: { decrement: orderedQty } },
          })
        }
      })
    )

    // §DECIMAL-FIX-C: order is a CustomerOrder with raw Decimal fields
    // (subtotal, deliveryCharge, grandTotal, commissionAmount).
    return NextResponse.json(serializeDecimals({
      ...order,
      items: JSON.parse(order.items),
      commissionLogId,
    }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
