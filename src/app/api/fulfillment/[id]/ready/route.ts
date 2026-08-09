import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

/**
 * PUT /api/fulfillment/[id]/ready
 *
 * Marks a store pick-up order as "Ready for Pick-up" (deliveryStatus = 'ready').
 * The order moves from the "Pending / To Pack" column to the "Ready for Pick-up"
 * column in the Fulfillment Dashboard.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    // Verify ownership
    const existing = await db.invoice.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await db.invoice.update({
      where: { id },
      data: { deliveryStatus: 'ready' },
    })

    return NextResponse.json({ ok: true, deliveryStatus: 'ready' })
  } catch (e: any) {
    return apiError(e, "Request failed")
  }
}
