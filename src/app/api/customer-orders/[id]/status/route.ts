import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateSearchTags } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

/**
 * PATCH /api/customer-orders/[id]/status — update order status.
 *
 * §ONLINE-ORDERS: Extended status workflow for quick-commerce orders.
 *   pending → processing → out_for_delivery → completed | cancelled
 *
 * §AUTO-SYNC (CRITICAL): When an order is marked as 'completed', the system
 * automatically:
 *   a) Deducts sold quantities from the main Inventory/Stock database.
 *   b) Generates a digital transaction entry in the customer's Khata (Ledger)
 *      if it was a credit/COD order, OR adds it to the Cash/UPI book if prepaid.
 *   c) Creates an Invoice record for the completed order.
 *
 * §IDEMPOTENT: If the order was already completed (syncedTransactionId set),
 * the sync is skipped — calling 'completed' again just updates the status.
 */

const ALLOWED = new Set([
  'pending',         // New order, not yet accepted
  'processing',      // Accepted, being prepared
  'out_for_delivery', // Ready, out for delivery
  'completed',       // Delivered + synced to inventory/khata
  'cancelled',       // Cancelled
])

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const status = String(body.status || '')

    if (!ALLOWED.has(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be: pending | processing | out_for_delivery | completed | cancelled' },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const existing = await db.customerOrder.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // §AUTO-SYNC: Only sync when transitioning TO 'completed' AND not already synced.
    if (status === 'completed' && !existing.syncedTransactionId) {
      return await syncCompletedOrder(existing, business.id)
    }

    // Normal status update (no sync needed)
    const updated = await db.customerOrder.update({
      where: { id },
      data: { status },
    })

    // §DECIMAL-FIX-C: CustomerOrder.subtotal/deliveryCharge/grandTotal/
    // commissionAmount are raw Decimals — wrap whole payload.
    return NextResponse.json(serializeDecimals({
      ...updated,
      items: updated.items ? JSON.parse(updated.items) : [],
    }))
  } catch (e) {
    console.error('Order status update error:', e)
    return apiError(e, "Request failed")
  }
}

/**
 * §AUTO-SYNC: Synchronize a completed order with inventory + khata + invoices.
 * This is a transactional operation — either all steps succeed or none do.
 */
async function syncCompletedOrder(order: any, businessId: string) {
  const items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; total: number }> =
    order.items ? JSON.parse(order.items) : []

  // §STEP-1: Find or create the customer as a Party (for Khata entry)
  let party = await db.party.findFirst({
    where: {
      businessId,
      OR: [
        { name: { equals: order.customerName } },
        ...(order.customerPhone ? [{ phone: order.customerPhone }] : []),
      ],
    },
  })

  if (!party) {
    party = await db.party.create({
      data: {
        businessId,
        name: order.customerName,
        phone: order.customerPhone || null,
        address: order.customerAddress || null,
        type: 'customer',
        qualityGrade: 'B',
        openingBalance: 0,
        balance: 0,
        searchTags: JSON.stringify(generateSearchTags(order.customerName)),
      },
    })
  }

  // §STEP-2: Determine payment type based on paymentMode
  // COD = credit (customer pays on delivery, so it's a receivable)
  // Prepaid = the customer already paid (cash/UPI received)
  const isPrepaid = order.paymentMode === 'prepaid'
  const transactionType = isPrepaid ? 'credit' : 'credit' // Both create a credit entry
  // For COD: the customer owes us money (receivable) → credit entry in their khata
  // For Prepaid: we received payment → credit entry (cash/UPI book)

  // §STEP-3: Run the full sync in a transaction
  const result = await db.$transaction(async (tx) => {
    // §STOCK-DEDUCT: Deduct quantities from inventory for each item.
    // NOTE: If the order was placed via /api/public/orders, stock was already
    // decremented at order time. Here we check syncedTransactionId to avoid
    // double-decrementing. If the order came from the public orders API,
    // the stock was already decremented — we skip stock deduction here.
    // If the order was created manually (e.g., from the catalog), we deduct now.
    const wasStockAlreadyDeducted = order.source === 'quick-commerce' || order.source === 'catalog'

    // §P16-STEP2: Pre-fetch product purchasePrices for InvoiceItem snapshot.
    // We need the historical cost at sale time for accurate COGS in Reports.
    // Fetch all productIds in one query (avoids N+1 inside the loop below).
    const _productIdsForSnapshot = items.map((i) => i.productId).filter(Boolean)
    const _productsForSnapshot = _productIdsForSnapshot.length > 0
      ? await db.product.findMany({
          where: { id: { in: _productIdsForSnapshot }, businessId },
          select: { id: true, purchasePrice: true },
        })
      : []
    const productPurchasePriceMap = Object.fromEntries(
      _productsForSnapshot.map((p) => [p.id, p.purchasePrice.toNumber()])
    )

    if (!wasStockAlreadyDeducted) {
      for (const item of items) {
        const product = await tx.product.findFirst({
          where: { id: item.productId, businessId },
          select: { id: true, stock: true, looseStock: true },
        })
        if (product) {
          const bulkDecrement = Math.min(item.quantity, product.stock)
          const looseDecrement = item.quantity - bulkDecrement
          await tx.product.update({
            where: { id: item.productId },
            data: {
              stock: { decrement: bulkDecrement },
              ...(looseDecrement > 0 ? { looseStock: { decrement: looseDecrement } } : {}),
            },
          })
        }
      }
    }

    // §TRANSACTION: Create a transaction entry in the customer's Khata.
    // For COD: This is a credit entry (customer will pay us → receivable).
    //   The customer's balance increases (they owe us).
    // For Prepaid: This is also a credit entry (we received payment).
    //   The customer's balance stays 0 (already paid).
    // §P16-STEP2: Classify subtype — online_order_cod (receivable ↑, NO cash yet)
    // vs online_order_prepaid (cash received NOW). isPrepaid computed at L121.
    const transaction = await tx.transaction.create({
      data: {
        businessId,
        partyId: party.id,
        type: transactionType,
        amount: order.grandTotal,
        description: `Online Order ${order.id.substring(0, 8)} — ${items.length} item(s)`,
        category: 'online-order',
        invoiceId: null, // Will be linked after invoice creation
        transactionSubtype: isPrepaid ? 'online_order_prepaid' : 'online_order_cod',
        source: 'online_order',
      },
    })

    // §PARTY-BALANCE: Update the party's balance.
    // For COD (credit): customer owes us → balance increases.
    // For Prepaid: customer already paid → balance stays the same.
    if (!isPrepaid) {
      await tx.party.update({
        where: { id: party.id },
        data: { balance: { increment: order.grandTotal } },
      })
    }

    // §INVOICE: Create an Invoice record for the completed order.
    const invoice = await tx.invoice.create({
      data: {
        businessId,
        partyId: party.id,
        invoiceNumber: `ORD-${order.id.substring(0, 8).toUpperCase()}`,
        type: 'retail',
        subtotal: order.subtotal,
        discountAmount: 0,
        gstAmount: 0,
        grandTotal: order.grandTotal,
        amountPaid: isPrepaid ? order.grandTotal : 0,
        amountDue: isPrepaid ? 0 : order.grandTotal,
        status: isPrepaid ? 'paid' : 'unpaid',
        paymentMode: isPrepaid ? 'upi' : 'credit',
        notes: `Online order from ${order.source}`,
        items: {
          create: items.map((item) => ({
            productId: item.productId,
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            total: item.total,
            // §P16-STEP2: Snapshot product purchasePrice at sale time for accurate historical COGS.
            // Falls back to null if product not found (Reports will use current price as LEGACY FALLBACK).
            purchasePriceSnapshot: item.productId
              ? (productPurchasePriceMap[item.productId] ?? null)
              : null,
          })),
        },
      },
    })

    // Link the transaction to the invoice
    await tx.transaction.update({
      where: { id: transaction.id },
      data: { invoiceId: invoice.id },
    })

    // §ORDER-SYNC: Mark the order as completed + link the transaction + invoice.
    const updatedOrder = await tx.customerOrder.update({
      where: { id: order.id },
      data: {
        status: 'completed',
        syncedTransactionId: transaction.id,
        syncedInvoiceId: invoice.id,
      },
    })

    return { order: updatedOrder, transaction, invoice, party }
  })

  // §DECIMAL-FIX-C: result.order is a CustomerOrder with raw Decimal fields
  // (subtotal, deliveryCharge, grandTotal, commissionAmount).
  return NextResponse.json(serializeDecimals({
    ...result.order,
    items: result.order.items ? JSON.parse(result.order.items) : [],
    synced: {
      transactionId: result.transaction.id,
      invoiceId: result.invoice.id,
      partyId: result.party.id,
      partyName: result.party.name,
      stockDeducted: !result.order.source || (result.order.source !== 'quick-commerce' && result.order.source !== 'catalog'),
    },
  }))
}
