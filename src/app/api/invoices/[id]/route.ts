import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { apiError } from '@/lib/api-error'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'

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
        return apiError(e3, "Database error")
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
      const due = Math.max(0, total.toNumber() - paid)
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
    return apiError(e, "Update failed")
  }
}

// DELETE /api/invoices/[id]
// VOID/CANCEL an invoice with FULL atomic stock + balance + transaction reversal.
//
// §ATOMIC: All reversal operations (stock restore, party balance reversal,
// reversal transaction, invoice status) happen inside a single $transaction.
// If ANY step fails, ALL changes are rolled back — no inconsistent state.
//
// §STOCK-RESTORATION: For retail (loose) sales, only looseStock is restored
// (bulk stock was NOT decremented for a loose sale, so we don't touch it).
// For bulk sales, stock is incremented. This prevents phantom bulk stock
// creation when voiding a retail sale.
//
// §BALANCE-REVERSAL: The party balance is reversed by `amountDue` (the unpaid
// portion that was added at invoice creation). This correctly handles:
//   - Credit sale (amountDue = grandTotal): full reversal
//   - Partial cash (amountDue < grandTotal): only the due portion reversed
//   - Full cash (amountDue = 0): no balance change (was never owed)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  try {
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { items: { include: { product: true } }, party: true },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (invoice.status === 'void') {
      return NextResponse.json({ error: 'Already voided' }, { status: 400 })
    }

    const isPurchaseInvoice = invoice.type === 'purchase'
    const amountDue = invoice.amountDue.toNumber()

    // §ATOMIC: All reversals in a single transaction.
    const voided = await db.$transaction(async (tx) => {
      // 1. Reverse product stock (retail-aware)
      for (const item of invoice.items) {
        if (item.productId && item.product) {
          const product = item.product
          // Re-verify ownership inside the transaction
          const owned = await tx.product.findFirst({
            where: { id: product.id, businessId: business.id },
          })
          if (!owned) throw new Error(`Product not found or does not belong to this business: ${product.id}`)

          if (isPurchaseInvoice) {
            // Purchase: stock was incremented, so decrement to reverse
            await tx.product.update({
              where: { id: product.id },
              data: { stock: { decrement: item.quantity } },
            })
          } else {
            // §RETAIL-AWARE: Check if this was a retail (loose) sale.
            // If the item's unitPrice matches the product's retailSalePrice,
            // it was a loose sale — only restore looseStock, NOT bulk stock.
            const isRetailSale = product.retailEnabled &&
              product.retailSalePrice &&
              Math.abs(item.unitPrice.toNumber() - product.retailSalePrice.toNumber()) < 0.01

            if (isRetailSale) {
              // Retail sale: only looseStock was decremented → restore looseStock only
              await tx.product.update({
                where: { id: product.id },
                data: { looseStock: { increment: item.quantity } },
              })
            } else {
              // Bulk sale: stock was decremented → restore stock
              await tx.product.update({
                where: { id: product.id },
                data: { stock: { increment: item.quantity } },
              })
            }
          }
        }
      }

      // 2. Reverse party balance by amountDue (the unpaid portion that was added)
      // §BALANCE-FIX: Previously only reversed for paymentMode==='credit' and
      // reversed by grandTotal. Now reverses by amountDue for ALL sales where
      // amountDue > 0 — correctly handling partial cash payments.
      let currentPartyBalance: number | null = null
      if (invoice.partyId && amountDue > 0) {
        const party = await tx.party.findFirst({
          where: { id: invoice.partyId, businessId: business.id },
        })
        if (party) {
          const newBalance = party.balance.toNumber() - amountDue
          await tx.party.updateMany({
            where: { id: party.id, businessId: business.id },
            data: { balance: newBalance },
          })
          currentPartyBalance = newBalance
        }
      } else if (invoice.party) {
        currentPartyBalance = invoice.party.balance.toNumber()
      }

      // 3. Create a reversal transaction for audit trail
      if (invoice.partyId) {
        await tx.transaction.create({
          data: {
            businessId: business.id,
            partyId: invoice.partyId,
            type: 'debit', // money out / reversal
            amount: invoice.grandTotal,
            balanceAfter: currentPartyBalance,
            description: `Invoice ${invoice.invoiceNumber} voided/cancelled`,
            category: 'Invoice Voided',
            invoiceId: invoice.id,
          },
        })
      }

      // 4. Mark invoice as void (soft delete — keeps record for audit)
      const updated = await tx.invoice.update({
        where: { id: invoice.id },
        data: { status: 'void' },
      })

      return updated
    })

    // 5. Trigger grade recalculation (fire-and-forget, outside transaction)
    if (invoice.partyId) {
      recalculatePartyGrade(invoice.partyId).catch(() => {})
    }

    // §AUDIT-LOG: Log the invoice void/cancellation
    await logAudit({
      businessId: business.id,
      action: AUDIT_ACTIONS.INVOICE_VOID,
      entityType: ENTITY_TYPES.INVOICE,
      entityId: invoice.id,
      description: `Invoice ${invoice.invoiceNumber} voided (₹${invoice.grandTotal})`,
      metadata: JSON.stringify({ invoiceNumber: invoice.invoiceNumber, grandTotal: invoice.grandTotal, partyId: invoice.partyId }),
    })

    return NextResponse.json({ ok: true, invoice: voided })
  } catch (e: any) {
    return apiError(e, "Void failed")
  }
}

