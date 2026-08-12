import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { checkRateLimit, getClientId, RATE_LIMITS } from '@/lib/rate-limit'

/**
 * §HEADLESS: Public Order Webhook — for external Quick-Commerce frontends.
 *
 * External apps (Next.js/React Native) POST new orders here. This endpoint:
 * 1. Validates the order payload.
 * 2. Checks product stock availability (single source of truth).
 * 3. Atomically decrements stock (transactional).
 * 4. Creates a CustomerOrder record.
 * 5. §REAL-TIME: Emits a WebSocket event to the admin app's Online Orders
 *    page so the merchant gets an instant push notification.
 *
 * §SINGLE-SOURCE-OF-TRUTH: Stock is decremented HERE. The external frontend
 * reads stock via /api/public/catalog — when stock hits 0, it shows "Out of Stock".
 *
 * Request body:
 *   {
 *     storeSlug: string,        // identifies the store
 *     customerName: string,
 *     customerPhone?: string,
 *     customerAddress?: string,
 *     customerLat?: number,
 *     customerLng?: number,
 *     items: Array<{ productId, name, quantity, unitPrice, total }>,
 *     deliveryCharge?: number,
 *     notes?: string,
 *     source?: string,          // "quick-commerce" | "catalog" | "invoice_link"
 *   }
 *
 * Response:
 *   { orderId, status, grandTotal, estimatedDelivery }
 */

interface OrderItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export async function POST(req: NextRequest) {
  try {
    // §RATE-LIMIT: 10 public orders per hour per IP — prevents spam orders from
    // anonymous clients before any DB work runs.
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
    const { storeSlug, customerName, customerPhone, customerAddress, customerLat, customerLng, items, deliveryCharge = 0, notes, source = 'quick-commerce' } = body

    // Validate required fields
    if (!storeSlug || !customerName || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'Missing required fields: storeSlug, customerName, items' }, { status: 400 })
    }

    // Find the business by store slug
    const business = await db.business.findUnique({
      where: { storeSlug },
      select: { id: true, name: true, currency: true }
    })
    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    // Validate items and check stock (single source of truth)
    const productIds = items.map((i: OrderItem) => i.productId)
    const products = await db.product.findMany({
      where: { id: { in: productIds }, businessId: business.id },
      select: { id: true, name: true, stock: true, looseStock: true, salePrice: true, retailEnabled: true, retailSalePrice: true, isPublished: true }
    })

    const productMap = new Map(products.map((p) => [p.id, p]))
    const validatedItems: OrderItem[] = []
    let subtotal = 0

    for (const item of items as OrderItem[]) {
      const product = productMap.get(item.productId)
      if (!product) {
        return NextResponse.json({ error: `Product not found: ${item.name}` }, { status: 400 })
      }
      if (!product.isPublished) {
        return NextResponse.json({ error: `Product not available: ${product.name}` }, { status: 400 })
      }
      // §SINGLE-SOURCE-OF-TRUTH: Check stock before accepting order
      const availableStock = product.stock + (product.looseStock || 0)
      if (availableStock < item.quantity) {
        return NextResponse.json({
          error: `Insufficient stock for ${product.name}. Available: ${availableStock}, Requested: ${item.quantity}`,
          productId: product.id,
          availableStock,
        }, { status: 409 }) // 409 Conflict
      }

      // Use the product's actual price as the source of truth
      const correctPrice = (product.retailEnabled && product.retailSalePrice
        ? product.retailSalePrice
        : product.salePrice).toNumber()
      const itemTotal = correctPrice * item.quantity
      subtotal += itemTotal

      validatedItems.push({
        productId: item.productId,
        name: product.name,
        quantity: item.quantity,
        unitPrice: correctPrice,
        total: itemTotal,
      })
    }

    const grandTotal = subtotal + Number(deliveryCharge)

    // §ATOMIC-STOCK-UPDATE: Use a transaction to decrement stock + create order.
    // This ensures stock is always consistent — no overselling.
    const order = await db.$transaction(async (tx) => {
      // Decrement stock for each item
      for (const item of validatedItems) {
        const product = productMap.get(item.productId)!
        // Decrement from bulk stock first, then loose stock
        let bulkDecrement = Math.min(item.quantity, product.stock)
        let looseDecrement = item.quantity - bulkDecrement

        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { decrement: bulkDecrement },
            ...(looseDecrement > 0 ? { looseStock: { decrement: looseDecrement } } : {}),
          },
        })
      }

      // Create the order
      return tx.customerOrder.create({
        data: {
          businessId: business.id,
          customerName,
          customerPhone: customerPhone || null,
          customerAddress: customerAddress || null,
          customerLat: customerLat || null,
          customerLng: customerLng || null,
          items: JSON.stringify(validatedItems),
          subtotal,
          deliveryCharge: Number(deliveryCharge),
          grandTotal,
          status: 'pending',
          notes: notes || null,
          source,
        },
      })
    })

    // §REAL-TIME: Emit WebSocket event to the admin app's Online Orders page.
    // The WebSocket mini-service listens for new orders via a polling mechanism
    // (or Redis pub/sub in production) and pushes them to connected admin clients.
    // We write a notification record that the mini-service picks up.
    try {
      await fetch(`http://localhost:3003/new-order?orderId=${order.id}&businessId=${business.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          customerName,
          grandTotal,
          itemCount: validatedItems.length,
          businessId: business.id,
        }),
      })
    } catch {
      // Mini-service might not be running in dev — fail silently.
      // The order is still saved; the merchant will see it on next page load.
    }

    return NextResponse.json({
      orderId: order.id,
      status: order.status,
      grandTotal: order.grandTotal,
      estimatedDelivery: '30-45 minutes',
      message: 'Order placed successfully',
    }, { status: 201 })
  } catch (e) {
    console.error('Public order webhook error:', e)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * GET /api/public/orders?slug=<storeSlug>&orderId=<orderId>
 * — for external apps to check order status.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get('slug')
    const orderId = searchParams.get('orderId')

    if (!slug || !orderId) {
      return NextResponse.json({ error: 'Missing slug or orderId' }, { status: 400 })
    }

    const business = await db.business.findUnique({
      where: { storeSlug: slug },
      select: { id: true }
    })
    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
    }

    const order = await db.customerOrder.findFirst({
      where: { id: orderId, businessId: business.id },
      select: {
        id: true,
        status: true,
        grandTotal: true,
        items: true,
        createdAt: true,
        updatedAt: true,
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    return NextResponse.json({
      ...order,
      items: order.items ? JSON.parse(order.items) : [],
    })
  } catch (e) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
