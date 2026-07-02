import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/customer-trust-score?customerPhone=X
//   Returns the customer's trust score, totalOrders, totalReturns,
//   consecutiveReturns, codLocked.
//
// POST /api/customer-trust-score
//   Body: { customerPhone }
//   Creates or updates trust score on successful delivery:
//     - totalOrders += 1
//     - consecutiveReturns = 0 (good behaviour resets the streak)

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerPhone = searchParams.get('customerPhone')?.trim()

    if (!customerPhone) {
      return NextResponse.json(
        { error: 'customerPhone is required' },
        { status: 400 }
      )
    }

    const score = await db.customerTrustScore.findUnique({
      where: { customerPhone },
    })

    if (!score) {
      return NextResponse.json({
        customerPhone,
        trustScore: 5.0,
        totalOrders: 0,
        totalReturns: 0,
        consecutiveReturns: 0,
        codLocked: false,
        lastReturnAt: null,
      })
    }

    return NextResponse.json({
      customerPhone: score.customerPhone,
      trustScore: score.trustScore,
      totalOrders: score.totalOrders,
      totalReturns: score.totalReturns,
      consecutiveReturns: score.consecutiveReturns,
      codLocked: score.codLocked,
      lastReturnAt: score.lastReturnAt,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const customerPhone = String(body.customerPhone || '').trim()

    if (!customerPhone) {
      return NextResponse.json(
        { error: 'customerPhone is required' },
        { status: 400 }
      )
    }

    // Successful delivery: bump totalOrders, reset consecutiveReturns streak.
    const existing = await db.customerTrustScore.findUnique({
      where: { customerPhone },
    })

    const totalOrders = (existing?.totalOrders ?? 0) + 1
    const updated = await db.customerTrustScore.upsert({
      where: { customerPhone },
      update: {
        totalOrders,
        consecutiveReturns: 0,
      },
      create: {
        customerPhone,
        trustScore: 5.0,
        totalOrders,
        totalReturns: 0,
        consecutiveReturns: 0,
        codLocked: false,
      },
    })

    return NextResponse.json({
      ok: true,
      customerPhone: updated.customerPhone,
      trustScore: updated.trustScore,
      totalOrders: updated.totalOrders,
      totalReturns: updated.totalReturns,
      consecutiveReturns: updated.consecutiveReturns,
      codLocked: updated.codLocked,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
