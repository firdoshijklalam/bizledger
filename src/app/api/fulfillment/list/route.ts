import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

/**
 * GET /api/fulfillment/list
 *
 * Returns orders for the Fulfillment Dashboard, separated by origin.
 *
 * Query params:
 *   - origin: 'store' | 'online' (default: 'store')
 *
 * §STORE-PICKUPS: Invoices with deliveryStatus = 'pickup' or 'ready'
 *   (POS bills marked "Pick Up Later"). Grouped by status:
 *   - pickup → Pending / To Pack
 *   - ready → Ready for Pick-up
 *   - handed → Fulfilled (history)
 *
 * §ONLINE-ORDERS: Customer orders from the quick-commerce frontend.
 *   Uses the CustomerOrder model (status: pending/processing/completed/cancelled).
 *
 * Response includes InvoiceItem with fulfilledQty for partial fulfillment tracking.
 */
export async function GET(req: NextRequest) {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const origin = searchParams.get('origin') || 'store'

  if (origin === 'store') {
    // §STORE-PICKUPS: Fetch invoices with deliveryStatus 'pickup' or 'ready'
    // (pending and ready-for-pickup). 'handed' orders are history.
    const status = searchParams.get('status') // 'pending' | 'ready' | 'handed'
    let whereStatus: string[] = ['pickup', 'ready']
    if (status === 'pending') whereStatus = ['pickup']
    else if (status === 'ready') whereStatus = ['ready']
    else if (status === 'handed') whereStatus = ['handed']

    const invoices = await db.invoice.findMany({
      where: {
        businessId: business.id,
        deliveryStatus: { in: whereStatus },
        type: 'sales', // only sales invoices, not purchases
      },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        items: { include: { product: { select: { id: true, name: true, unit: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    })

    // §COMPUTE: Add fulfillment progress (totalQty, fulfilledQty) per invoice
    const result = invoices.map((inv) => {
      const totalQty = inv.items.reduce((s, i) => s + i.quantity, 0)
      const fulfilledQty = inv.items.reduce((s, i) => s + (i.fulfilledQty || 0), 0)
      return {
        ...inv,
        totalQty,
        fulfilledQty,
        fulfillmentPct: totalQty > 0 ? Math.round((fulfilledQty / totalQty) * 100) : 0,
      }
    })

    return NextResponse.json({ items: result })
  }

  // §ONLINE-ORDERS: Fetch customer orders
  const status = searchParams.get('status') // 'pending' | 'processing' | 'completed' | 'cancelled'
  const where: any = { businessId: business.id }
  if (status) where.status = status

  const orders = await (db as any).customerOrder.findMany({
    where,
    include: {
      items: true,
      party: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { createdAt: 'desc' },
  }).catch(() => [])

  return NextResponse.json({ items: orders || [] })
}
