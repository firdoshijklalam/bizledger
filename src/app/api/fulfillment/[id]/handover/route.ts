import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

/**
 * PUT /api/fulfillment/[id]/handover
 *
 * Marks items as handed over to the customer. Supports PARTIAL fulfillment —
 * the merchant can hand over a subset of the total quantity (e.g., 5 of 20 bags).
 *
 * Body:
 *   {
 *     items: Array<{ id: string, qty: number }>,  // item-level handover quantities
 *     pin?: string,  // §VERIFICATION: 4-digit PIN (last 4 of invoice number or phone)
 *   }
 *
 * Logic:
 *   - For each item, ADDS the handover qty to fulfilledQty (cumulative).
 *   - If fulfilledQty >= quantity for ALL items, marks the invoice as 'handed' (fully fulfilled).
 *   - If only partial, keeps deliveryStatus as 'ready' (still pending).
 *   - §PIN-VERIFICATION: If pin is provided, validates it against the last 4 digits
 *     of the invoice number OR the customer's phone number. Returns 403 on mismatch.
 *
 * Returns the updated invoice with fulfillment progress.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const body = await req.json()
    const items: Array<{ id: string; qty: number }> = body.items || []

    if (items.length === 0) {
      return NextResponse.json({ error: 'No items to hand over' }, { status: 400 })
    }

    // Fetch the invoice with items and party
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: {
        items: true,
        party: { select: { phone: true } },
      },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // §PIN-VERIFICATION: Validate 4-digit PIN against last 4 of invoice number or phone
    if (body.pin) {
      const invoiceLast4 = invoice.invoiceNumber.replace(/[^0-9]/g, '').slice(-4)
      const phoneLast4 = (invoice.party?.phone || '').replace(/[^0-9]/g, '').slice(-4)
      const validPins = [invoiceLast4, phoneLast4].filter((p) => p.length === 4)

      if (validPins.length > 0 && !validPins.includes(body.pin)) {
        return NextResponse.json(
          { error: 'Invalid PIN. Please verify the last 4 digits of the invoice number or customer phone.' },
          { status: 403 },
        )
      }
    }

    // §PARTIAL-FULFILLMENT: Update each item's fulfilledQty (cumulative)
    let allFullyFulfilled = true
    for (const handoverItem of items) {
      const dbItem = invoice.items.find((i) => i.id === handoverItem.id)
      if (!dbItem) continue

      const newFulfilledQty = Math.min(
        (dbItem.fulfilledQty || 0) + handoverItem.qty,
        dbItem.quantity, // cap at total quantity
      )

      await db.invoiceItem.update({
        where: { id: handoverItem.id },
        data: { fulfilledQty: newFulfilledQty },
      })

      if (newFulfilledQty < dbItem.quantity) {
        allFullyFulfilled = false
      }
    }

    // §STATUS-UPDATE: If all items are fully fulfilled, mark as 'handed'
    let newDeliveryStatus = invoice.deliveryStatus
    if (allFullyFulfilled) {
      newDeliveryStatus = 'handed'
      await db.invoice.update({
        where: { id },
        data: { deliveryStatus: 'handed' },
      })
    }

    // Fetch updated invoice with new fulfilledQty values
    const updated = await db.invoice.findFirst({
      where: { id },
      include: {
        items: true,
        party: { select: { name: true, phone: true } },
      },
    })

    const totalQty = updated?.items.reduce((s, i) => s + i.quantity, 0) || 0
    const fulfilledQty = updated?.items.reduce((s, i) => s + (i.fulfilledQty || 0), 0) || 0

    return NextResponse.json({
      ok: true,
      deliveryStatus: newDeliveryStatus,
      totalQty,
      fulfilledQty,
      fulfillmentPct: totalQty > 0 ? Math.round((fulfilledQty / totalQty) * 100) : 0,
      fullyFulfilled: allFullyFulfilled,
    })
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
