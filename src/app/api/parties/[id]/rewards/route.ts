import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §REWARDS-API: Read-only reward cycle state for a customer.
//
// §TENANT-ISOLATION: businessId from getCurrentBusiness() — never from body.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Get current cycle (ACTIVE or UNLOCKED)
    const currentCycle = await db.customerRewardCycle.findFirst({
      where: { businessId: business.id, partyId, status: { in: ['ACTIVE', 'UNLOCKED'] } },
      orderBy: { cycleNumber: 'desc' },
      include: { events: { orderBy: { createdAt: 'desc' }, take: 5 } },
    })

    // Get all past cycles (REWARDED)
    const pastCycles = await db.customerRewardCycle.findMany({
      where: { businessId: business.id, partyId, status: 'REWARDED' },
      orderBy: { cycleNumber: 'desc' },
      select: {
        id: true, cycleNumber: true, threshold: true, accumulatedProfit: true,
        rewardGivenAt: true, rewardDescription: true, startedAt: true, unlockedAt: true,
      },
    })

    // Get settings threshold
    const settings = await db.appSettings.findUnique({
      where: { businessId: business.id },
      select: { rewardThreshold: true },
    })
    const threshold = settings?.rewardThreshold.toNumber() ?? 400

    // Calculate progress
    const accumulated = currentCycle?.accumulatedProfit.toNumber() ?? 0
    const cycleThreshold = currentCycle?.threshold.toNumber() ?? threshold
    const progressPct = cycleThreshold > 0 ? Math.min(100, (accumulated / cycleThreshold) * 100) : 0

    return NextResponse.json(serializeDecimals({
      partyId,
      currentCycle: currentCycle ?? null,
      threshold: cycleThreshold,
      accumulatedProfit: accumulated,
      progressPct: Math.round(progressPct * 100) / 100,
      status: currentCycle?.status ?? 'ACTIVE',
      unlocked: currentCycle?.status === 'UNLOCKED',
      rewardHistory: pastCycles,
    }))
  } catch (e) {
    return apiError(e, 'Failed to fetch rewards')
  }
}
