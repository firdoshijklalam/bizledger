import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/orders/split/[id] — return a specific order split with its items,
// linked payment split, and return requests.
//
// PATCH /api/orders/split/[id] — update order split status (owner confirmation).
//   Body: { status: 'pending' | 'confirmed' | 'delivered' | 'returned' | 'cancelled' }
//
// §AUTH: Both handlers require an authenticated merchant session and scope the
// lookup to the merchant's own businessId (ownership check via findFirst) so a
// merchant cannot view or mutate another business's order splits.

const ALLOWED_STATUSES = new Set([
  'pending',
  'confirmed',
  'delivered',
  'returned',
  'cancelled',
])

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params

    // §OWNERSHIP: findFirst scoped to businessId — never findUnique by id alone.
    const split = await db.orderSplit.findFirst({ where: { id, businessId: business.id } })
    if (!split) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    const [paymentSplit, returnRequests] = await Promise.all([
      db.paymentSplit.findFirst({ where: { orderSplitId: id } }),
      db.returnRequest.findMany({
        where: { orderSplitId: id },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    let parsedItems: any[] = []
    try {
      parsedItems = split.items ? JSON.parse(split.items) : []
    } catch {
      parsedItems = []
    }

    return NextResponse.json({
      id: split.id,
      parentOrderId: split.parentOrderId,
      businessId: split.businessId,
      businessName: split.businessName,
      items: parsedItems,
      subtotal: split.subtotal,
      commissionPct: split.commissionPct,
      commissionAmount: split.commissionAmount,
      merchantAmount: split.merchantAmount,
      status: split.status,
      deliveryOtp: split.deliveryOtp,
      otpVerifiedAt: split.otpVerifiedAt,
      createdAt: split.createdAt,
      updatedAt: split.updatedAt,
      paymentSplit: paymentSplit
        ? {
            id: paymentSplit.id,
            totalAmount: paymentSplit.totalAmount,
            commissionPct: paymentSplit.commissionPct,
            commissionAmount: paymentSplit.commissionAmount,
            merchantAmount: paymentSplit.merchantAmount,
            settlementStatus: paymentSplit.settlementStatus,
            settledAt: paymentSplit.settledAt,
            reversedAt: paymentSplit.reversedAt,
            createdAt: paymentSplit.createdAt,
          }
        : null,
      returnRequests,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // §AUTH: Require an authenticated business (any role).
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const status = String(body.status || '').trim()

    if (!ALLOWED_STATUSES.has(status)) {
      return NextResponse.json(
        {
          error:
            'Invalid status. Must be pending | confirmed | delivered | returned | cancelled',
        },
        { status: 400 }
      )
    }

    // §OWNERSHIP: findFirst scoped to businessId — never findUnique by id alone.
    const existing = await db.orderSplit.findFirst({ where: { id, businessId: business.id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    const updated = await db.orderSplit.update({
      where: { id },
      data: { status },
    })

    let parsedItems: any[] = []
    try {
      parsedItems = updated.items ? JSON.parse(updated.items) : []
    } catch {
      parsedItems = []
    }

    return NextResponse.json({
      ok: true,
      orderSplit: {
        id: updated.id,
        parentOrderId: updated.parentOrderId,
        businessId: updated.businessId,
        businessName: updated.businessName,
        items: parsedItems,
        subtotal: updated.subtotal,
        commissionPct: updated.commissionPct,
        commissionAmount: updated.commissionAmount,
        merchantAmount: updated.merchantAmount,
        status: updated.status,
        deliveryOtp: updated.deliveryOtp,
        otpVerifiedAt: updated.otpVerifiedAt,
        updatedAt: updated.updatedAt,
      },
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
