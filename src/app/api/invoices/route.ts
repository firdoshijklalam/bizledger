import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { createInvoice, InvoiceValidationError } from '@/lib/invoice-service'
import { processOutboxRowForInvoice } from '@/lib/reward-outbox'
import { createProductFeedbackRecord } from '@/lib/product-feedback'

// §VERCEL-LIMIT: Allow up to 20s for invoice creation (stock validation + transaction with many items)
export const maxDuration = 20

// §FEEDBACK-AUTO-REQUEST: Fire-and-forget product-feedback-request creation
// for a paid sales invoice with a party. Mirrors the existing reward-outbox
// pattern: durable, non-fatal, catches all errors so the sale remains
// committed even if feedback scheduling fails. Idempotent — duplicate
// (409/P2002) is silently skipped. The lib function does the dedupKey +
// partial unique index dance; this wrapper only resolves the productId
// from the invoice's first item.
//
// §GATE: only paid sales invoices with a partyId. Purchase invoices, walk-in
// sales (no party), unpaid sales — skip.
export async function maybeCreateProductFeedbackForInvoice(
  businessId: string,
  invoice: { id: string; status: string; partyId?: string | null; type?: string },
): Promise<void> {
  // §GATE: paid sales invoices with a party only.
  if (invoice.status !== 'paid') return
  if (!invoice.partyId) return
  if (invoice.type && invoice.type !== 'sales') return

  try {
    // §FIRST-PRODUCT: pick the first productId from the invoice's items (if any).
    // A feedback request is tied to a specific product when possible, otherwise
    // it's a generic purchase feedback. InvoiceItem has no createdAt column;
    // sort by id (cuid — monotonically increasing by timestamp prefix).
    const firstItem = await db.invoiceItem.findFirst({
      where: { invoiceId: invoice.id },
      select: { productId: true },
      orderBy: { id: 'asc' },
    })
    const productId = firstItem?.productId ?? null

    // §SHARED-CORE: invoke the canonical create function. It resolves the
    // effective delay (Product.feedbackDelayHours > AppSettings.feedbackDelayHours),
    // computes dedupKey, does the atomic transaction, catches P2002.
    const result = await createProductFeedbackRecord(db, {
      businessId,
      partyId: invoice.partyId,
      invoiceId: invoice.id,
      productId,
      actorUserId: null, // §SYSTEM-TRIGGERED — no human actor for invoice-flow
    })
    if (result.created) {
      // §SUCCESS: feedback request scheduled. Non-fatal — nothing more to do.
      return
    }
    // §DUPLICATE: an active feedback request already exists for this tuple
    // (e.g. merchant already manually requested feedback before the invoice
    // hook fired). Silently skip — the existing request stands.
    return
  } catch (e) {
    // §NON-FATAL: invoice is already committed. Log + move on. The customer
    // can still be manually asked for feedback later.
    console.error('Product feedback auto-request failed (non-fatal):', e)
  }
}

// GET /api/invoices — optimized with pagination
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  // §PAGINATION: ?page (1-based) is an alias for ?offset (offset = (page-1) × limit).
  // If both are provided, ?page wins.
  const pageParam = searchParams.get('page')
  const offset = pageParam
    ? Math.max(0, (Math.max(1, Number(pageParam)) - 1) * limit)
    : Number(searchParams.get('offset')) || 0
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const where = {
    businessId: business.id,
    ...(partyId ? { partyId } : {}),
  }

  const { db } = await import('@/lib/db')
  const [invoices, totalCount] = await Promise.all([
    db.invoice.findMany({
      where,
      include: { party: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.invoice.count({ where }),
  ])

  return NextResponse.json(serializeDecimals({ items: invoices, total: totalCount, hasMore: offset + limit < totalCount }))
}

// POST /api/invoices
//
// §P16-STEP3.8.1: The invoice creation logic (including the P2002 idempotency
// recovery) lives in `src/lib/invoice-service.ts` so it can be tested with
// REAL DB + REAL CODE PATH (same function the route calls) without requiring
// a running Next.js dev server. This handler is a thin HTTP wrapper.
// §EXTRACTED-CORE: Sale notification creation logic, extracted into a
// testable function. This is the SAME logic the POST handler runs after
// createInvoice() succeeds. Tests can call this directly with a test
// businessId + mock invoice, bypassing getCurrentBusiness() + createInvoice().
//
// §DEDUP-DESIGN: Uses invoiceId as the durable dedup key. The Notification
// table has @@unique([businessId, invoiceId]). If a notification already
// exists for this invoice, skip creation (idempotent retry).
//
// §CHANNEL-PREF: Reads from NotificationChannelPreference (normalized table).
// Missing row → default enabled (true).
export async function createSaleNotification(
  businessId: string,
  invoice: { id: string; items?: any[]; party?: { name?: string }; grandTotal: any },
): Promise<boolean> {
  let saleNotificationCreated = false
  try {
    // §DEDUP-CHECK
    const existingNotif = await db.notification.findFirst({
      where: { businessId, invoiceId: invoice.id },
      select: { id: true },
    })

    if (!existingNotif) {
      // §CHANNEL-CHECK
      const salesPref = await db.notificationChannelPreference.findUnique({
        where: { businessId_key: { businessId, key: 'sales' } },
        select: { enabled: true },
      })
      const salesEnabled = salesPref ? salesPref.enabled : true

      if (salesEnabled) {
        const itemCount = invoice.items?.length ?? 0
        const partyName = invoice.party?.name || 'Walk-in Customer'
        const total = Number(invoice.grandTotal) || 0
        const title = 'New Sale'
        const body_text = `${partyName} • ${itemCount} ${itemCount === 1 ? 'item' : 'items'} • ₹${total.toLocaleString('en-IN')}`

        try {
          await db.notification.create({
            data: {
              businessId,
              type: 'sale',
              title,
              body: body_text,
              link: 'history',
              isRead: false,
              invoiceId: invoice.id,
            },
          })
          saleNotificationCreated = true
        } catch (createErr: any) {
          if (createErr?.code !== 'P2002') throw createErr
        }
      }
    }
  } catch (notifErr) {
    console.error('Sale notification creation failed (non-fatal):', notifErr)
  }
  return saleNotificationCreated
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const invoice = await createInvoice(body, business)

    // §NOTIFICATION-SALE: Call the extracted core function (same logic, testable)
    const saleNotificationCreated = await createSaleNotification(business.id, invoice)

    // §STEP7-REWARD-OUTBOX: durable post-commit processing. Replaces the old
    // fire-and-forget accrueCustomerRewardFromInvoice(...).catch(console.error).
    //
    // The outbox row was created atomically INSIDE createInvoice's
    // $transaction (src/lib/invoice-service.ts). This call invokes
    // processOutboxRowForInvoice which:
    //   1. finds the outbox row (already committed with the invoice)
    //   2. invokes accrueCustomerRewardFromInvoice (idempotent by sourceInvoiceId)
    //   3. marks the outbox row COMPLETED (success) or FAILED (error + attempts++)
    //
    // §NON-FATAL: if this fails, the sale remains committed. The outbox row
    // stays PENDING/FAILED and the cron worker will retry.
    // §NON-BLOCKING: this is fire-and-forget (not awaited) — the response is
    // returned immediately. The outbox row is the durable record.
    // §IDEMPOTENCY: CustomerRewardEvent.@@unique([businessId, sourceInvoiceId])
    // guarantees at-most-once accrual (idempotent / at-most-once per invoice).
    // The outbox row is the at-least-once trigger (the cron + immediate
    // handler may both invoke accrual). Together: effectively exactly-once
    // business effect.
    processOutboxRowForInvoice(business.id, invoice.id)

    // §PRODUCT-FEEDBACK-AUTO-REQUEST: fire-and-forget creation of a product
    // feedback request for paid sales invoices with a party. Non-fatal —
    // invoice is already committed. Catches all errors including duplicate
    // (P2002/409) so the sale remains intact. Mirrors the reward-outbox
    // pattern (fire-and-forget, non-blocking).
    maybeCreateProductFeedbackForInvoice(business.id, invoice)

    const response = NextResponse.json(serializeDecimals(invoice))
    if (saleNotificationCreated) {
      response.headers.set('X-Notification-Created', 'sale')
    }
    return response
  } catch (e: any) {
    if (e instanceof InvoiceValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('Invoice create error:', e)
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to create invoice'
      : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
