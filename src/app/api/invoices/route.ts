import { NextRequest, NextResponse } from 'next/server'
import { getCurrentBusiness } from '@/lib/db'
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
    return NextResponse.json(serializeDecimals(invoice))
  } catch (e: any) {
    // §P16-STEP3.8.1: InvoiceValidationError → HTTP 400 (client error).
    // Never exposed to client as P2002 or Prisma stack trace — the service
    // catches P2002 internally and returns the existing invoice.
    if (e instanceof InvoiceValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    console.error('Invoice create error:', e)
    // §SECURITY: Don't expose internal DB error details in production
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to create invoice'
      : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
