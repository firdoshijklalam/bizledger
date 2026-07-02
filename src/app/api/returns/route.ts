import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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
    const { searchParams } = new URL(req.url)
    const orderSplitId = searchParams.get('orderSplitId')?.trim()

    if (!orderSplitId) {
      return NextResponse.json(
        { error: 'orderSplitId is required' },
        { status: 400 }
      )
    }

    const returns = await db.returnRequest.findMany({
      where: { orderSplitId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ returns })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
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

    const orderSplit = await db.orderSplit.findUnique({
      where: { id: orderSplitId },
    })
    if (!orderSplit) {
      return NextResponse.json(
        { error: 'Order split not found' },
        { status: 404 }
      )
    }

    const refundAmount = orderSplit.subtotal
    const now = new Date()

    // 1. Create the ReturnRequest.
    const returnRequest = await db.returnRequest.create({
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

    // 2. Reverse the PaymentSplit.
    const paymentSplit = await db.paymentSplit.findFirst({
      where: { orderSplitId },
    })
    if (paymentSplit) {
      await db.paymentSplit.update({
        where: { id: paymentSplit.id },
        data: {
          settlementStatus: 'reversed',
          reversedAt: now,
        },
      })
    }

    // 3. Update OrderSplit status.
    await db.orderSplit.update({
      where: { id: orderSplitId },
      data: { status: 'returned' },
    })

    // 4. Restore product stock.
    let items: SplitItem[] = []
    try {
      items = orderSplit.items ? JSON.parse(orderSplit.items) : []
    } catch {
      items = []
    }

    await Promise.all(
      items.map(async (it) => {
        const product = await db.product.findUnique({
          where: { id: it.productId },
        })
        if (!product) return

        const returnQty = Number(it.quantity || 0)

        // Loose order detection: unitPrice matches retailSalePrice.
        const isLooseOrder =
          product.retailEnabled &&
          product.retailSalePrice != null &&
          Math.abs(Number(it.unitPrice) - product.retailSalePrice) < 0.01

        if (isLooseOrder) {
          // Restore loose stock first; if loose stock exceeds one bulk unit,
          // optionally convert back to bulk (keep simple: just increment looseStock).
          await db.product.update({
            where: { id: product.id },
            data: { looseStock: { increment: returnQty } },
          })
        } else {
          await db.product.update({
            where: { id: product.id },
            data: { stock: { increment: returnQty } },
          })
        }
      })
    )

    // Mark stock as restored on the return record.
    await db.returnRequest.update({
      where: { id: returnRequest.id },
      data: { stockRestored: true },
    })

    // 5. Update CustomerTrustScore.
    let trustScoreValue = 5.0
    let codLocked = false
    if (customerPhone) {
      const existing = await db.customerTrustScore.findUnique({
        where: { customerPhone },
      })

      const totalReturns = (existing?.totalReturns ?? 0) + 1
      const consecutiveReturns = (existing?.consecutiveReturns ?? 0) + 1
      const totalOrders = existing?.totalOrders ?? 0

      // Trust penalty: -1.0 per return when consecutiveReturns >= 3
      let newTrust = existing?.trustScore ?? 5.0
      let newCodLocked = existing?.codLocked ?? false
      if (consecutiveReturns >= 3) {
        newCodLocked = true
        newTrust = Math.max(0, newTrust - 1.0)
      }

      const updated = await db.customerTrustScore.upsert({
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

    return NextResponse.json({
      ok: true,
      refundAmount,
      stockRestored: true,
      trustScore: trustScoreValue,
      codLocked,
      returnRequestId: returnRequest.id,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
