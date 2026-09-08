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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const invoice = await createInvoice(body, business)

    // §NOTIFICATION-SALE: Create ONE sale notification per invoice, deterministically.
    //
    // §DEDUP-DESIGN: We use the invoice's ID as the durable dedup key. The
    // Notification table has a unique constraint on (businessId, invoiceId).
    // createInvoice() may return an EXISTING invoice on retry (saleOperationId
    // idempotency recovery). We check if a notification with this invoiceId
    // already exists — if so, skip (idempotent retry). If not, create one.
    // Two racing requests for the same saleOperationId will both try to
    // create with the same invoiceId — the unique constraint ensures only
    // one succeeds (the other gets P2002, which we catch and ignore).
    //
    // §CHANNEL-PREF: Read from AppSettings.notificationChannels (server-authoritative).
    // The client Zustand store syncs via /api/app-settings PUT.
    let saleNotificationCreated = false
    try {
      // §DEDUP-CHECK: Does a notification already exist for this invoice?
      const existingNotif = await db.notification.findFirst({
        where: {
          businessId: business.id,
          invoiceId: invoice.id,
        },
        select: { id: true },
      })

      if (!existingNotif) {
        // §CHANNEL-CHECK: Read the sales notification preference from AppSettings.
        const settings = await db.appSettings.findUnique({
          where: { businessId: business.id },
          select: { notificationChannels: true },
        })
        const channels = settings?.notificationChannels
          ? (typeof settings.notificationChannels === 'string'
            ? JSON.parse(settings.notificationChannels)
            : settings.notificationChannels)
          : null
        const salesEnabled = channels ? channels.sales !== false : true

        if (salesEnabled) {
          const itemCount = invoice.items?.length ?? 0
          const partyName = invoice.party?.name || 'Walk-in Customer'
          const total = Number(invoice.grandTotal) || 0
          const title = 'New Sale'
          const body_text = `${partyName} • ${itemCount} ${itemCount === 1 ? 'item' : 'items'} • ₹${total.toLocaleString('en-IN')}`

          // §UNIQUE-CONSTRAINT: The (businessId, invoiceId) unique constraint
          // ensures at most one notification per invoice. If two racing requests
          // both pass the findFirst check, the second create() throws P2002 —
          // we catch it and treat as success (the notification was already
          // created by the winner).
          try {
            await db.notification.create({
              data: {
                businessId: business.id,
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
            // §P2002-HANDLING: Unique constraint violation = another request
            // already created the notification for this invoice. Not an error.
            if (createErr?.code === 'P2002') {
              // Idempotent — notification already exists. This is fine.
            } else {
              throw createErr // Re-throw non-P2002 errors
            }
          }
        }
      }
    } catch (notifErr) {
      // Non-fatal — log but don't fail the invoice creation
      console.error('Sale notification creation failed (non-fatal):', notifErr)
    }

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
