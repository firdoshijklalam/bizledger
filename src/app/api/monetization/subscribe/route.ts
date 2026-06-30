import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/monetization/subscribe — owner: activate SaaS subscription (₹199/month default).
// Body: { plan?: 'monthly' | 'yearly' } (default 'monthly').
// Sets subscriptionPlan='active', subscriptionEndsAt = now + 30/365 days, clears trialEndsAt.

const DAY_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const plan: 'monthly' | 'yearly' = body.plan === 'yearly' ? 'yearly' : 'monthly'
    const days = plan === 'yearly' ? 365 : 30

    const existing = await db.business.findFirst()
    if (!existing) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }

    const now = new Date()
    const subscriptionEndsAt = new Date(now.getTime() + days * DAY_MS)

    const updated = await db.business.update({
      where: { id: existing.id },
      data: {
        subscriptionPlan: 'active',
        subscriptionEndsAt,
        trialEndsAt: null,
      },
    })

    return NextResponse.json({
      success: true,
      plan,
      subscriptionEndsAt,
      business: updated,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
