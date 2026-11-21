import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// Invoice auto-tagging sub-tags (PRD Part 32 §4.3).
// PATCH — selectively update collectedByName/Role and paidToName/Role on an
//         invoice, leaving all other fields untouched. Produces an audit trail
//         so receipts can be stamped "[Collected by: Rahim's Son]" etc.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()

    // Build a selective update object — only fields that are explicitly
    // present in the request body are touched.
    const data: Record<string, string | null> = {}
    if (Object.prototype.hasOwnProperty.call(body, 'collectedByName')) {
      data.collectedByName = body.collectedByName ?? null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'collectedByRole')) {
      data.collectedByRole = body.collectedByRole ?? null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'paidToName')) {
      data.paidToName = body.paidToName ?? null
    }
    if (Object.prototype.hasOwnProperty.call(body, 'paidToRole')) {
      data.paidToRole = body.paidToRole ?? null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        { error: 'No sub-tag fields supplied to update' },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const existing = await db.invoice.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Invoice not found in your business' }, { status: 404 })
    }

    const updated = await db.invoice.update({
      where: { id },
      data,
      include: { party: true, items: { include: { product: true } } },
    })

    return NextResponse.json({ ok: true, invoice: updated })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
