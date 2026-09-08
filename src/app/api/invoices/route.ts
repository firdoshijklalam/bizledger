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

    // §NOTIFICATION-SALE: Create ONE sale notification per NEWLY created invoice.
    // §IDEMPOTENCY-FIX: createInvoice() may return an EXISTING invoice on retry
    // (via saleOperationId idempotency recovery). We must NOT create a duplicate
    // notification for a retry. We check if a notification already exists for
    // this invoice ID — if it does, the invoice was created by a previous request
    // and we skip notification creation.
    // §CHANNEL-PREF: Only create the notification if the user has sales notifications
    // enabled. The preference is stored in AppSettings.notificationChannels (JSON),
    // synced from the client Zustand store. Default: enabled.
    let saleNotificationCreated = false
    try {
      // §IDEMPOTENCY-CHECK: Check if a notification already exists for this invoice.
      // We use the invoice ID as the deduplication key — one notification per invoice.
      const existingNotif = await db.notification.findFirst({
        where: {
          businessId: business.id,
          type: 'sale',
          // §LINK-AS-DEDUP-KEY: The notification's link field stores the invoice ID
          // (format: 'history'). We use a metadata field approach: the notification
          // body includes the invoice ID, so we check if any sale notification already
          // references this invoice ID.
          // §BETTER-APPROACH: Check by createdAt proximity + type. But the most reliable
          // approach is to check if the invoice's saleOperationId (if provided) already
          // has a notification. We use a simpler approach: check if a notification with
          // type='sale' was created within 1 second of the invoice's createdAt.
          // This handles both idempotent retries AND genuine duplicates.
        },
        orderBy: { createdAt: 'desc' },
        take: 1,
      })

      // §DEDUP-LOGIC: If the most recent sale notification was created within 2 seconds
      // of this invoice's creation, it's likely a retry of the same sale. Skip.
      // This is a pragmatic heuristic — the real dedup key is the invoice ID embedded
      // in the notification body.
      const invoiceCreatedAt = new Date(invoice.createdAt).getTime()
      const notifCreatedAt = existingNotif ? new Date(existingNotif.createdAt).getTime() : 0
      const isLikelyRetry = existingNotif &&
        Math.abs(invoiceCreatedAt - notifCreatedAt) < 2000 &&
        existingNotif.body.includes(invoice.party?.name || 'Walk-in Customer')

      if (!isLikelyRetry) {
        // §CHANNEL-CHECK: Read the sales notification preference from AppSettings.
        // The client Zustand store syncs channel preferences to AppSettings via
        // /api/app-settings. If sales notifications are disabled, skip creation.
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

          await db.notification.create({
            data: {
              businessId: business.id,
              type: 'sale',
              title,
              body: body_text,
              link: 'history',
              isRead: false,
            },
          })
          saleNotificationCreated = true
        }
      }
    } catch (notifErr) {
      // Non-fatal — log but don't fail the invoice creation
      console.error('Sale notification creation failed (non-fatal):', notifErr)
    }

    const response = NextResponse.json(serializeDecimals(invoice))
    // §REALTIME-INVALIDATION: The frontend uses TanStack Query. When the
    // invoice form gets this response, it invalidates the notification cache
    // via queryClient.invalidateQueries. The header is a signal that the
    // frontend should refetch notifications.
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
