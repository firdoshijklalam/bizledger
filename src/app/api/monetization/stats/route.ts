import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/monetization/stats — owner: revenue + commission + sponsorship summary.
// Returns subscription status, commission earned (as referrer), commission paid (as payer),
// catalog orders summary, and current sponsored-ad status.

export async function GET() {
  try {
    const business = await db.business.findFirst()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }

    // Commission earned: this business is the referrer (recipient).
    const [earnedAll, earnedPending, earnedPaid, earnedCount] = await Promise.all([
      db.commissionLog.aggregate({
        where: { recipientBusinessId: business.id },
        _sum: { commissionAmount: true },
      }),
      db.commissionLog.aggregate({
        where: { recipientBusinessId: business.id, status: 'pending' },
        _sum: { commissionAmount: true },
      }),
      db.commissionLog.aggregate({
        where: { recipientBusinessId: business.id, status: 'paid' },
        _sum: { commissionAmount: true },
      }),
      db.commissionLog.count({
        where: { recipientBusinessId: business.id },
      }),
    ])

    // Commission paid: this business is the payer (orders from other shops via More Shops).
    const [paidAll, paidPending, paidCount] = await Promise.all([
      db.commissionLog.aggregate({
        where: { payerBusinessId: business.id },
        _sum: { commissionAmount: true },
      }),
      db.commissionLog.aggregate({
        where: { payerBusinessId: business.id, status: 'pending' },
        _sum: { commissionAmount: true },
      }),
      db.commissionLog.count({
        where: { payerBusinessId: business.id },
      }),
    ])

    // Catalog orders: customer orders placed on this business's store.
    const [catalogCount, catalogPending, catalogRevenue] = await Promise.all([
      db.customerOrder.count({
        where: { businessId: business.id },
      }),
      db.customerOrder.count({
        where: { businessId: business.id, status: 'pending' },
      }),
      db.customerOrder.aggregate({
        where: { businessId: business.id },
        _sum: { grandTotal: true },
      }),
    ])

    return NextResponse.json({
      subscriptionPlan: business.subscriptionPlan,
      trialEndsAt: business.trialEndsAt,
      subscriptionEndsAt: business.subscriptionEndsAt,
      commissionEarned: {
        total: earnedAll._sum.commissionAmount ?? 0,
        pending: earnedPending._sum.commissionAmount ?? 0,
        paid: earnedPaid._sum.commissionAmount ?? 0,
        count: earnedCount,
      },
      commissionPaid: {
        total: paidAll._sum.commissionAmount ?? 0,
        pending: paidPending._sum.commissionAmount ?? 0,
        count: paidCount,
      },
      catalogOrders: {
        total: catalogCount,
        pending: catalogPending,
        revenue: catalogRevenue._sum.grandTotal ?? 0,
      },
      isSponsored: business.isSponsored,
      sponsoredUntil: business.sponsoredUntil,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
