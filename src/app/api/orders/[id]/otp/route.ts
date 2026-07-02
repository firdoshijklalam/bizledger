import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import type { PaymentSplit } from '@prisma/client'

// POST /api/orders/[id]/otp — verify delivery OTP for an order split (PRD Part 36 §2.2).
//   Body: { otp: "1234" }
//   - Find OrderSplit by id.
//   - If deliveryOtp === otp → status='delivered', otpVerifiedAt=now.
//     Also settle the PaymentSplit (settlementStatus='settled', settledAt=now).
//     Return { ok: true, delivered: true }.
//   - If OTP mismatch → { ok: false, message: 'Invalid OTP' }.
//
// GET /api/orders/[id]/otp — return the OTP for the order (demo only; in prod sent via SMS).

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const split = await db.orderSplit.findUnique({ where: { id } })
    if (!split) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }
    return NextResponse.json({
      orderSplitId: split.id,
      deliveryOtp: split.deliveryOtp,
      status: split.status,
      otpVerifiedAt: split.otpVerifiedAt,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const otp = String(body.otp || '').trim()

    if (!otp) {
      return NextResponse.json(
        { error: 'otp is required' },
        { status: 400 }
      )
    }

    const split = await db.orderSplit.findUnique({ where: { id } })
    if (!split) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    // OTP mismatch.
    if (!split.deliveryOtp || split.deliveryOtp !== otp) {
      return NextResponse.json({ ok: false, message: 'Invalid OTP' })
    }

    const now = new Date()

    // Mark split as delivered.
    const updated = await db.orderSplit.update({
      where: { id },
      data: {
        status: 'delivered',
        otpVerifiedAt: now,
      },
    })

    // Settle the linked PaymentSplit.
    const paymentSplit = await db.paymentSplit.findFirst({
      where: { orderSplitId: id },
    })
    let settledPayment: PaymentSplit | null = null
    if (paymentSplit && paymentSplit.settlementStatus !== 'settled') {
      settledPayment = await db.paymentSplit.update({
        where: { id: paymentSplit.id },
        data: {
          settlementStatus: 'settled',
          settledAt: now,
        },
      })
    } else if (paymentSplit) {
      settledPayment = paymentSplit
    }

    // Also update parent CustomerOrder status to 'delivered' for owner dashboard.
    try {
      await db.customerOrder.update({
        where: { id: split.parentOrderId },
        data: { status: 'delivered' },
      })
    } catch {
      // Parent order may have been deleted; ignore.
    }

    return NextResponse.json({
      ok: true,
      delivered: true,
      orderSplit: {
        id: updated.id,
        status: updated.status,
        otpVerifiedAt: updated.otpVerifiedAt,
      },
      paymentSplit: settledPayment
        ? {
            id: settledPayment.id,
            settlementStatus: settledPayment.settlementStatus,
            settledAt: settledPayment.settledAt,
            merchantAmount: settledPayment.merchantAmount,
            commissionAmount: settledPayment.commissionAmount,
          }
        : null,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
