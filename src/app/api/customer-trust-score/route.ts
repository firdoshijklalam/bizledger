import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth/session'
import { apiError } from '@/lib/api-error'

// GET /api/customer-trust-score?customerPhone=X
//   Returns the customer's trust score, totalOrders, totalReturns,
//   consecutiveReturns, codLocked.
//   §AUTH: INTENTIONALLY PUBLIC — merchants look up a customer's trust score
//   during checkout flow (also used by customer-facing COD gating). The data
//   is read-only and contains no PII beyond an aggregate numeric score.
//
// POST /api/customer-trust-score
//   Body: { customerPhone }
//   Creates or updates trust score on successful delivery:
//     - totalOrders += 1
//     - consecutiveReturns = 0 (good behaviour resets the streak)
//   §RBAC: OWNER/ADMIN only — this endpoint increments the trust score and
//   must not be callable by unauthenticated callers (would allow trust-score
//   inflation abuse).

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
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Incrementing a customer's trust score requires OWNER/ADMIN to
    // prevent trust-score inflation abuse (e.g. automated callers bumping a
    // phone's order count without a real delivery).
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

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
    return apiError(e, "Request failed")
  }
}
