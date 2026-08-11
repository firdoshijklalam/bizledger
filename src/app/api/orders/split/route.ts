import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// POST /api/orders/split — PRD Part 36 §2.1
// Auto-splits a global cart order by shop.
//
// Body:
//   {
//     customerName, customerPhone,
//     items: [{ productId, name, quantity, unitPrice, total, storeSlug, businessId, businessName }],
//     deliveryCharge, source
//   }
//
// Logic:
//   1. Group items by businessId.
//   2. Create a CustomerOrder per shop (the parent order).
//   3. Create an OrderSplit per shop (subtotal, 2% commission, 4-digit OTP, status=pending).
//   4. Create a PaymentSplit per split (settlementStatus=pending).
//   5. Decrement stock for each product (loose-stock aware).
//   6. §1.2: Auto-add shop to FavoriteShop if source === 'merchant_link'.
//   7. Return { ok, splits, parentOrders }.

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
      await Promise.all(
        shopItems.map(async (it) => {
          const product = await db.product.findUnique({
            where: { id: it.productId },
          })
          if (!product) return

          const orderedQty = Number(it.quantity || 0)

          // Loose order detection: unitPrice matches retailSalePrice.
          const isLooseOrder =
            product.retailEnabled &&
            product.retailSalePrice != null &&
            Math.abs(Number(it.unitPrice) - product.retailSalePrice) < 0.01

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

    return NextResponse.json({ ok: true, splits, parentOrders })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
