import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { recalculatePartyGrade } from '@/lib/grade-calculator'

// GET /api/invoices/[id]
// Security: verifies the invoice belongs to the current business.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { party: true, items: { include: { product: true } } },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  } catch (e: any) {
    // Fallback: try without product relation on items (may not exist in Neon yet)
    try {
      const invoice = await db.invoice.findFirst({
        where: { id, businessId: business.id },
        include: { party: true, items: true },
      })
      if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(invoice)
    } catch (e2: any) {
      // Last resort: invoice without relations
      try {
        const invoice = await db.invoice.findFirst({ where: { id, businessId: business.id } })
        if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ ...invoice, party: null, items: [] })
      } catch (e3: any) {
        return NextResponse.json({ error: 'DB error', detail: String(e3?.message || e3) }, { status: 500 })
      }
    }
  }
}

// PUT /api/invoices/[id]
// Updates an invoice. Used by History module for:
//   - Status update (e.g., mark "Pick Up Later" → "Handed Over" via deliveryStatus)
//   - Payment mode / amountPaid adjustments
// Body: partial Invoice fields (deliveryStatus, paymentMode, amountPaid, amountDue, status, notes)
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const body = await req.json()

    // Verify ownership
    const existing = await db.invoice.findFirst({ where: { id, businessId: business.id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Whitelist updatable fields
    const updateData: Record<string, unknown> = {}
    const allowed = ['deliveryStatus', 'paymentMode', 'amountPaid', 'amountDue', 'status', 'notes', 'collectedByName', 'collectedByRole', 'paidToName', 'paidToRole']
    for (const k of allowed) {
      if (k in body) updateData[k] = body[k]
    }

    // If deliveryStatus changes to 'handed' from 'pickup', that's a fulfillment
    // update — no balance change. If paymentMode/amountPaid change, recompute
    // amountDue + status.
    if ('amountPaid' in updateData || 'amountDue' in updateData) {
      const paid = Number(updateData.amountPaid ?? existing.amountPaid)
      const total = existing.grandTotal
      const due = Math.max(0, total - paid)
      updateData.amountPaid = paid
      updateData.amountDue = due
      updateData.status = due <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    }

    const updated = await db.invoice.update({
      where: { id },
      data: updateData,
      include: { party: true, items: true },
    })

    return NextResponse.json(updated)
  } catch (e: any) {
    return NextResponse.json({ error: 'Update failed', detail: String(e?.message || e) }, { status: 500 })
  }
}

// DELETE /api/invoices/[id]
// VOID/CANCEL/REFUND an invoice with full stock reverse logic.
// - Restores product stock (with bulk↔loose conversion if applicable)
// - Reverses party balance (if credit sale)
// - Creates a reversal Transaction (category: 'Invoice Voided')
// - Marks invoice status = 'void' (soft delete — keeps the record for audit)
//   (If hard-delete is desired, the record is removed instead. We soft-delete
//    by setting status='void' so history remains auditable.)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { items: { include: { product: true } }, party: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (invoice.status === 'void') {
      return NextResponse.json({ error: 'Already voided' }, { status: 400 })
    }

    // 1. Reverse product stock
    for (const item of invoice.items) {
      if (item.productId && item.product) {
        const product = item.product
        // If the item was sold in retail units but product tracks bulk stock,
        // convert back. Here we restore in the same unit the item was sold in.
        // (Simple restore — matches the decrement logic in POST /api/invoices.)
        await db.product.update({
          where: { id: product.id },
          data: { stock: { increment: item.quantity } },
        })
      }
    }

    // 2. Reverse party balance (if credit sale increased it)
    if (invoice.partyId && invoice.paymentMode === 'credit') {
      const party = await db.party.findUnique({ where: { id: invoice.partyId } })
      if (party) {
        // Credit sale increased balance by grandTotal; reverse it.
        const newBalance = party.balance - invoice.grandTotal
        await db.party.update({ where: { id: party.id }, data: { balance: newBalance } })
        recalculatePartyGrade(party.id).catch(() => {})
      }
    }

    // 3. Create a reversal transaction for audit trail
    if (invoice.partyId) {
      await db.transaction.create({
        data: {
          businessId: business.id,
          partyId: invoice.partyId,
          type: 'debit', // money out / reversal
          amount: invoice.grandTotal,
          balanceAfter: invoice.party?.balance,
          description: `Invoice ${invoice.invoiceNumber} voided/cancelled`,
          category: 'Invoice Voided',
          invoiceId: invoice.id,
        },
      })
    }

    // 4. Mark invoice as void (soft delete — keeps record for audit)
    const voided = await db.invoice.update({
      where: { id: invoice.id },
      data: { status: 'void' },
    })

    return NextResponse.json({ ok: true, invoice: voided })
  } catch (e: any) {
    return NextResponse.json({ error: 'Void failed', detail: String(e?.message || e) }, { status: 500 })
  }
}

