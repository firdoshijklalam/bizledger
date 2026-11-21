import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// POST /api/payments/split — simulate payment split settlement (PRD Part 36 §2.2).
//   Body: { orderSplitId }
//   - Find OrderSplit + PaymentSplit.
//   - If already 'settled' → return error.
//   - Set settlementStatus='settled', settledAt=now.
//   - Return { ok, merchantAmount, commissionAmount, settledAt }.
//
// GET /api/payments/split?orderSplitId=X — return payment split details.

export async function GET(req: NextRequest) {
  try {
    // §AUTH: Require an authenticated business (any role). The GET handler
    // previously had no auth — exposing any payment split's settlement
    // details (commission, merchant amount, settlement status) to
    // unauthenticated callers. Mirrors the auth posture of the POST handler.
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const { searchParams } = new URL(req.url)
    const orderSplitId = searchParams.get('orderSplitId')?.trim()

    if (!orderSplitId) {
      return NextResponse.json(
        { error: 'orderSplitId is required' },
        { status: 400 }
      )
    }

    // §OWNERSHIP: Verify the order split belongs to this business before
    // serving the linked payment split.
    const orderSplit = await db.orderSplit.findFirst({
      where: { id: orderSplitId, businessId: business.id },
      select: { id: true },
    })
    if (!orderSplit) {
      return NextResponse.json(
        { error: 'Payment split not found' },
        { status: 404 }
      )
    }

    const paymentSplit = await db.paymentSplit.findFirst({
      where: { orderSplitId, businessId: business.id },
    })
    if (!paymentSplit) {
      return NextResponse.json(
        { error: 'Payment split not found' },
        { status: 404 }
      )
    }

    // §DECIMAL-FIX-C: paymentSplit.totalAmount/commissionAmount/merchantAmount
    // are raw Decimals — wrap whole payload.
    return NextResponse.json(serializeDecimals({
      id: paymentSplit.id,
      orderSplitId: paymentSplit.orderSplitId,
      businessId: paymentSplit.businessId,
      totalAmount: paymentSplit.totalAmount,
      commissionPct: paymentSplit.commissionPct,
      commissionAmount: paymentSplit.commissionAmount,
      merchantAmount: paymentSplit.merchantAmount,
      settlementStatus: paymentSplit.settlementStatus,
      settledAt: paymentSplit.settledAt,
      reversedAt: paymentSplit.reversedAt,
      createdAt: paymentSplit.createdAt,
    }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    // §OWNERSHIP-CHECK: Verify the current business before settling payments.
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()
    const orderSplitId = String(body.orderSplitId || '').trim()

    if (!orderSplitId) {
      return NextResponse.json(
        { error: 'orderSplitId is required' },
        { status: 400 }
      )
    }

    // §OWNERSHIP: Use findFirst with businessId scope instead of findUnique
    const orderSplit = await db.orderSplit.findFirst({
      where: { id: orderSplitId, businessId: business.id },
    })
    if (!orderSplit) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    const paymentSplit = await db.paymentSplit.findFirst({
      where: { orderSplitId },
    })
    if (!paymentSplit) {
      return NextResponse.json(
        { error: 'Payment split not found for this order split' },
        { status: 404 }
      )
    }

    if (paymentSplit.settlementStatus === 'settled') {
      return NextResponse.json(
        { error: 'Payment split is already settled', settledAt: paymentSplit.settledAt },
        { status: 400 }
      )
    }

    if (paymentSplit.settlementStatus === 'reversed') {
      return NextResponse.json(
        { error: 'Payment split was reversed; cannot settle' },
        { status: 400 }
      )
    }

    const now = new Date()
    const updated = await db.paymentSplit.update({
      where: { id: paymentSplit.id },
      data: {
        settlementStatus: 'settled',
        settledAt: now,
      },
    })

    // §DECIMAL-FIX-C: updated.merchantAmount/commissionAmount are raw Decimals.
    return NextResponse.json(serializeDecimals({
      ok: true,
      merchantAmount: updated.merchantAmount,
      commissionAmount: updated.commissionAmount,
      settledAt: updated.settledAt,
      settlementStatus: updated.settlementStatus,
    }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
