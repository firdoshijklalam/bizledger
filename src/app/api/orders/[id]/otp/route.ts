import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import type { PaymentSplit } from '@prisma/client'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// POST /api/orders/[id]/otp — verify delivery OTP for an order split (PRD Part 36 §2.2).
//   Body: { otp: "1234" }
//   - Find OrderSplit by id + businessId (ownership enforced).
//   - If deliveryOtp === otp → status='delivered', otpVerifiedAt=now.
//     Also settle the PaymentSplit (settlementStatus='settled', settledAt=now).
//     Return { ok: true, delivered: true }.
//   - If OTP mismatch → { ok: false, message: 'Invalid OTP' }.
//
// §SECURITY: GET endpoint REMOVED — it returned the OTP in plaintext, allowing
// anyone with an order ID to bypass delivery verification. In production, OTPs
// are sent via SMS to the customer. The merchant verifies via POST only.
// §AUTH: POST requires authentication + business ownership of the OrderSplit.

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { id } = await params
    const body = await req.json()
    const otp = String(body.otp || '').trim()

    if (!otp) {
      return NextResponse.json(
        { error: 'otp is required' },
        { status: 400 }
      )
    }

    // §OWNERSHIP: Use findFirst with businessId — never findUnique by id alone.
    // This ensures a merchant can only verify OTPs for their own OrderSplits.
    const split = await db.orderSplit.findFirst({
      where: { id, businessId: business.id },
    })
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

    // §ATOMIC: Mark split as delivered + settle payment in a single transaction.
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.orderSplit.update({
        where: { id },
        data: {
          status: 'delivered',
          otpVerifiedAt: now,
        },
      })

      // Settle the linked PaymentSplit (business-scoped).
      const paymentSplit = await tx.paymentSplit.findFirst({
        where: { orderSplitId: id, businessId: business.id },
      })
      let settledPayment: PaymentSplit | null = null
      if (paymentSplit && paymentSplit.settlementStatus !== 'settled') {
        settledPayment = await tx.paymentSplit.update({
          where: { id: paymentSplit.id },
          data: {
            settlementStatus: 'settled',
            settledAt: now,
          },
        })
      } else if (paymentSplit) {
        settledPayment = paymentSplit
      }

      // Also update parent CustomerOrder status to 'delivered'.
      try {
        await tx.customerOrder.updateMany({
          where: { id: split.parentOrderId, businessId: business.id },
          data: { status: 'delivered' },
        })
      } catch {
        // Parent order may have been deleted; ignore.
      }

      return { updated, settledPayment }
    })

    return NextResponse.json(serializeDecimals({
      ok: true,
      delivered: true,
      orderSplit: {
        id: result.updated.id,
        status: result.updated.status,
        otpVerifiedAt: result.updated.otpVerifiedAt,
      },
      paymentSplit: result.settledPayment
        ? {
            id: result.settledPayment.id,
            settlementStatus: result.settledPayment.settlementStatus,
            settledAt: result.settledPayment.settledAt,
            merchantAmount: result.settledPayment.merchantAmount,
            commissionAmount: result.settledPayment.commissionAmount,
          }
        : null,
    }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
