import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { checkRateLimit, getClientId, RATE_LIMITS } from '@/lib/rate-limit'
import { serializeDecimals } from '@/lib/decimal-serializer'

// POST /api/orders/split — PRD Part 36 §2.1
// Auto-splits a global cart order by shop.
//
// §SECURITY: This is a PUBLIC endpoint (customers place multi-shop orders from
// the central marketplace catalog without an account). However, each item's
// businessId is VERIFIED against the product's actual businessId in the DB —
// a client cannot supply an arbitrary businessId to decrement another
// business's stock. If the product doesn't belong to the claimed businessId,
// the stock decrement is skipped (the order still records the item for the
// merchant to see, but no stock is tampered with).
//
// Body:
//   {
//     customerName, customerPhone,
//     items: [{ productId, name, quantity, unitPrice, total, storeSlug, businessId, businessName }],
//     deliveryCharge, source
//   }

const COMMISSION_PCT = 2 // default 2% commission per split

interface CartItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  storeSlug: string
  businessId: string
  businessName: string
}

function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export async function POST(req: NextRequest) {
  try {
    // §RATE-LIMIT: 10 split orders per hour per IP — prevents spam multi-shop
    // orders from anonymous marketplace clients before any DB work runs.
    const clientId = getClientId(req)
    const rateResult = await checkRateLimit(
      clientId,
      RATE_LIMITS.PUBLIC_ORDER.name,
      RATE_LIMITS.PUBLIC_ORDER.limit,
      RATE_LIMITS.PUBLIC_ORDER.window
    )
    if (!rateResult.success) {
      return NextResponse.json(
        { error: 'Rate limit exceeded. Please try again later.' },
        {
          status: 429,
          headers: {
            'Retry-After': String(Math.ceil(rateResult.reset / 1000) || 60),
            'X-RateLimit-Limit': String(rateResult.limit),
            'X-RateLimit-Remaining': String(rateResult.remaining),
          },
        }
      )
    }

    const body = await req.json()
    const customerName = String(body.customerName || 'Walk-in Customer')
    const customerPhone = body.customerPhone ? String(body.customerPhone) : null
    const deliveryCharge = Number(body.deliveryCharge || 0)
    const source = String(body.source || 'central_catalog')
    const items: CartItem[] = Array.isArray(body.items) ? body.items : []

    if (items.length === 0) {
      return NextResponse.json(
        { error: 'Cart is empty' },
        { status: 400 }
      )
    }

    // 1. Group items by businessId (preserve insertion order).
    const byShop = new Map<string, CartItem[]>()
    const shopMeta = new Map<string, { businessName: string; storeSlug: string }>()
    for (const it of items) {
      const arr = byShop.get(it.businessId) || []
      arr.push(it)
      byShop.set(it.businessId, arr)
      if (!shopMeta.has(it.businessId)) {
        shopMeta.set(it.businessId, {
          businessName: it.businessName,
          storeSlug: it.storeSlug,
        })
      }
    }

    const splits: any[] = []
    const parentOrders: any[] = []
    const shopCount = byShop.size
    // Split delivery charge evenly across shops (integer-safe).
    const perShopDelivery = shopCount > 0 ? deliveryCharge / shopCount : 0

    // 2-4. Create CustomerOrder + OrderSplit + PaymentSplit per shop.
    for (const [businessId, shopItems] of byShop.entries()) {
      const meta = shopMeta.get(businessId)!
      const subtotal = shopItems.reduce(
        (sum, it) => sum + Number(it.total || 0),
        0
      )
      const grandTotal = subtotal + perShopDelivery
      const commissionAmount = (subtotal * COMMISSION_PCT) / 100
      const merchantAmount = subtotal - commissionAmount
      const otp = generateOtp()

      // 2. Parent CustomerOrder for this shop.
      const parentOrder = await db.customerOrder.create({
        data: {
          businessId,
          customerName,
          customerPhone,
          items: JSON.stringify(shopItems),
          subtotal,
          deliveryCharge: perShopDelivery,
          grandTotal,
          status: 'pending',
          source,
          commissionAmount,
        },
      })

      // 3. OrderSplit record.
      const split = await db.orderSplit.create({
        data: {
          parentOrderId: parentOrder.id,
          businessId,
          businessName: meta.businessName,
          items: JSON.stringify(shopItems),
          subtotal,
          commissionPct: COMMISSION_PCT,
          commissionAmount,
          merchantAmount,
          status: 'pending',
          deliveryOtp: otp,
        },
      })

      // 4. PaymentSplit record.
      const paymentSplit = await db.paymentSplit.create({
        data: {
          orderSplitId: split.id,
          businessId,
          totalAmount: subtotal,
          commissionPct: COMMISSION_PCT,
          commissionAmount,
          merchantAmount,
          settlementStatus: 'pending',
        },
      })

      // 5. Decrement stock for each item (loose-stock aware).
      // §OWNERSHIP: Verify the product belongs to the claimed businessId.
      // If a client supplies a foreign productId + businessId combination,
      // the product won't be found → stock NOT decremented (no cross-tenant tampering).
      await Promise.all(
        shopItems.map(async (it) => {
          const product = await db.product.findFirst({
            where: { id: it.productId, businessId },
          })
          if (!product) return

          const orderedQty = Number(it.quantity || 0)

          // Loose order detection: unitPrice matches retailSalePrice.
          const isLooseOrder =
            product.retailEnabled &&
            product.retailSalePrice != null &&
            Math.abs(Number(it.unitPrice) - product.retailSalePrice.toNumber()) < 0.01

          if (isLooseOrder && product.conversionFactor) {
            let currentLoose = product.looseStock || 0
            let bulkStock = product.stock

            // Auto-convert bulk → loose when loose runs out.
            while (currentLoose < orderedQty && bulkStock > 0) {
              const converted = product.conversionFactor
              await db.product.update({
                where: { id: product.id },
                data: {
                  stock: { decrement: 1 },
                  looseStock: { increment: converted },
                },
              })
              currentLoose += converted
              bulkStock -= 1
            }

            await db.product.update({
              where: { id: product.id },
              data: { looseStock: { decrement: orderedQty } },
            })
          } else {
            await db.product.update({
              where: { id: product.id },
              data: { stock: { decrement: orderedQty } },
            })
          }
        })
      )

      // 6. §1.2: Auto-add shop to favorites if source === 'merchant_link'.
      if (source === 'merchant_link' && customerPhone) {
        try {
          await db.favoriteShop.upsert({
            where: {
              customerPhone_businessId: {
                customerPhone,
                businessId,
              },
            },
            update: {
              businessName: meta.businessName,
              storeSlug: meta.storeSlug,
            },
            create: {
              customerPhone,
              businessId,
              businessName: meta.businessName,
              storeSlug: meta.storeSlug,
            },
          })
        } catch {
          // Favorite upsert failure must not break order flow.
        }
      }

      splits.push({
        ...split,
        items: JSON.parse(split.items),
        paymentSplit: {
          id: paymentSplit.id,
          settlementStatus: paymentSplit.settlementStatus,
          merchantAmount: paymentSplit.merchantAmount,
          commissionAmount: paymentSplit.commissionAmount,
        },
      })
      parentOrders.push({
        ...parentOrder,
        items: JSON.parse(parentOrder.items),
      })
    }

    // §DECIMAL-FIX-C: splits (OrderSpread + nested paymentSplit) and parentOrders
    // (CustomerOrder) contain raw Decimal fields: subtotal, deliveryCharge,
    // grandTotal, commissionAmount, merchantAmount. Wrap whole payload.
    return NextResponse.json(serializeDecimals({ ok: true, splits, parentOrders }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
