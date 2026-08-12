import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// POST /api/returns — create a return request (PRD Part 36 §3.1).
//   Body: { orderSplitId, customerPhone, reason }
//   Logic:
//     1. Find OrderSplit. refundAmount = subtotal.
//     2. Create ReturnRequest (refundStatus='refunded', refundedAt=now).
//     3. Reverse the PaymentSplit (settlementStatus='reversed', reversedAt=now).
//     4. Update OrderSplit.status='returned'.
//     5. Restore product stock (+1 per item, or +weight for loose items).
//     6. Update CustomerTrustScore:
//        - totalReturns += 1
//        - consecutiveReturns += 1
//        - If consecutiveReturns >= 3 → codLocked = true, trustScore -= 1.0 (min 0)
//        - lastReturnAt = now
//     7. Return { ok, refundAmount, stockRestored, trustScore }.
//
// GET /api/returns?orderSplitId=X — return return requests for an order.

export async function GET(req: NextRequest) {
  try {
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

    // §OWNERSHIP: Verify the order split belongs to this business
    const split = await db.orderSplit.findFirst({
      where: { id: orderSplitId, businessId: business.id },
      select: { id: true },
    })
    if (!split) {
      return NextResponse.json({ error: 'Order split not found' }, { status: 404 })
    }

    const returns = await db.returnRequest.findMany({
      where: { orderSplitId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ returns })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

interface SplitItem {
  productId: string
  name: string
  quantity: number
  unitPrice: number
  total: number
}

export async function POST(req: NextRequest) {
  try {
    // §OWNERSHIP-CHECK: Verify the current business before processing returns.
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json()
    const orderSplitId = String(body.orderSplitId || '').trim()
    const customerPhone = body.customerPhone ? String(body.customerPhone).trim() : null
    const reason = String(body.reason || 'other').trim()

    if (!orderSplitId) {
      return NextResponse.json(
        { error: 'orderSplitId is required' },
        { status: 400 }
      )
    }

    // §OWNERSHIP: Use findFirst with businessId scope
    const orderSplit = await db.orderSplit.findFirst({
      where: { id: orderSplitId, businessId: business.id },
    })
    if (!orderSplit) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    // §IDEMPOTENCY: Prevent double-return. If a return already exists for this
    // order split with refundStatus='refunded', reject the duplicate.
    const existingReturn = await db.returnRequest.findFirst({
      where: { orderSplitId, refundStatus: 'refunded' },
    })
    if (existingReturn) {
      return NextResponse.json(
        { error: 'This order has already been returned', returnRequestId: existingReturn.id },
        { status: 409 }
      )
    }

    const refundAmount = orderSplit.subtotal.toNumber()
    const now = new Date()

    let items: SplitItem[] = []
    try {
      items = orderSplit.items ? JSON.parse(orderSplit.items) : []
    } catch {
      items = []
    }

    // §ATOMIC: All reversal operations in a single transaction.
    const result = await db.$transaction(async (tx) => {
      // 1. Create the ReturnRequest.
      const returnRequest = await tx.returnRequest.create({
        data: {
          orderSplitId,
          customerPhone,
          reason,
          refundAmount,
          refundStatus: 'refunded',
          refundedAt: now,
          stockRestored: false,
        },
      })

      // 2. Reverse the PaymentSplit (business-scoped).
      const paymentSplit = await tx.paymentSplit.findFirst({
        where: { orderSplitId, businessId: business.id },
      })
      if (paymentSplit) {
        await tx.paymentSplit.update({
          where: { id: paymentSplit.id },
          data: {
            settlementStatus: 'reversed',
            reversedAt: now,
          },
        })
      }

      // 3. Update OrderSplit status.
      await tx.orderSplit.update({
        where: { id: orderSplitId },
        data: { status: 'returned' },
      })

      // 4. Restore product stock (retail-aware, ownership-verified).
      for (const it of items) {
        const product = await tx.product.findFirst({
          where: { id: it.productId, businessId: business.id },
        })
        if (!product) continue

        const returnQty = Number(it.quantity || 0)

        // Loose order detection: unitPrice matches retailSalePrice.
        const isLooseOrder =
          product.retailEnabled &&
          product.retailSalePrice != null &&
          Math.abs(Number(it.unitPrice) - product.retailSalePrice.toNumber()) < 0.01

        if (isLooseOrder) {
          await tx.product.update({
            where: { id: product.id },
            data: { looseStock: { increment: returnQty } },
          })
        } else {
          await tx.product.update({
            where: { id: product.id },
            data: { stock: { increment: returnQty } },
          })
        }
      }

      // Mark stock as restored on the return record.
      await tx.returnRequest.update({
        where: { id: returnRequest.id },
        data: { stockRestored: true },
      })

      // 5. Update CustomerTrustScore.
      let trustScoreValue = 5.0
      let codLocked = false
      if (customerPhone) {
        const existing = await tx.customerTrustScore.findUnique({
          where: { customerPhone },
        })

        const totalReturns = (existing?.totalReturns ?? 0) + 1
        const consecutiveReturns = (existing?.consecutiveReturns ?? 0) + 1
        const totalOrders = existing?.totalOrders ?? 0

        let newTrust = existing?.trustScore ?? 5.0
        let newCodLocked = existing?.codLocked ?? false
        if (consecutiveReturns >= 3) {
          newCodLocked = true
          newTrust = Math.max(0, newTrust - 1.0)
        }

        const updated = await tx.customerTrustScore.upsert({
          where: { customerPhone },
          update: {
            totalReturns,
            consecutiveReturns,
            codLocked: newCodLocked,
            trustScore: newTrust,
            lastReturnAt: now,
          },
          create: {
            customerPhone,
            trustScore: newTrust,
            totalOrders,
            totalReturns,
            consecutiveReturns,
            codLocked: newCodLocked,
            lastReturnAt: now,
          },
        })

        trustScoreValue = updated.trustScore
        codLocked = updated.codLocked
      }

      return { returnRequest, trustScoreValue, codLocked }
    })

    return NextResponse.json({
      ok: true,
      refundAmount,
      stockRestored: true,
      trustScore: result.trustScoreValue,
      codLocked: result.codLocked,
      returnRequestId: result.returnRequest.id,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
