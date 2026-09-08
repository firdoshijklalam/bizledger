import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { createInvoice, InvoiceValidationError } from '@/lib/invoice-service'

// §VERCEL-LIMIT: Allow up to 20s for invoice creation (stock validation + transaction with many items)
export const maxDuration = 20

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
