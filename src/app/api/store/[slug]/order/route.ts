import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/store/[slug]/order — owner view: list last 50 orders for this store.
// POST /api/store/[slug]/order — PUBLIC customer order placement from the catalog.
//   Supports cross-merchant commission: if referrerBusinessId is supplied,
//   2% commission is computed on grandTotal and a CommissionLog entry is created.

const COMMISSION_PCT = 2 // default 2% commission for "More Shops" referrals

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const business = await db.business.findFirst({ where: { storeSlug: slug } })
    if (!business) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 })
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
    return NextResponse.json(parsed)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
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
    await Promise.all(
      items.map((it) =>
        db.product.update({
          where: { id: it.productId },
          data: { stock: { decrement: Number(it.quantity || 0) } },
        })
      )
    )

    return NextResponse.json({
      ...order,
      items: JSON.parse(order.items),
      commissionLogId,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
