import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// POST /api/monetization/subscribe — owner: activate SaaS subscription (₹199/month default).
// Body: { plan?: 'monthly' | 'yearly' } (default 'monthly').
// Sets subscriptionPlan='active', subscriptionEndsAt = now + 30/365 days, clears trialEndsAt.
//
// §RBAC: Requires OWNER/ADMIN. Subscription activation is a paid SaaS
// decision — STAFF must not be able to flip subscription state (would allow
// bypassing trial expiry or unauthorised plan changes).

const DAY_MS = 24 * 60 * 60 * 1000

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Require OWNER or ADMIN.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const body = await req.json().catch(() => ({}))
    const plan: 'monthly' | 'yearly' = body.plan === 'yearly' ? 'yearly' : 'monthly'
    const days = plan === 'yearly' ? 365 : 30

    const existing = await getCurrentBusiness()
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
    return apiError(e, "Request failed")
  }
}
