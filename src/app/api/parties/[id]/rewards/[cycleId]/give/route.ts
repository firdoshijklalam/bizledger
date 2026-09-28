import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { logAudit } from '@/lib/audit'
import { DEFAULT_REWARD_THRESHOLD } from '@/lib/rewards'

// §GIVE-REWARD: Merchant confirms the reward was given.
//
// §REQUIREMENTS:
// - Only UNLOCKED cycle can be rewarded
// - Cannot reward twice
// - Record REWARD_GIVEN event
// - Close current cycle (status=REWARDED)
// - Create next ACTIVE cycle
// - All state changes atomic
//
// §CARRY-OVER: The next cycle starts at ₹0 (no carry-over from the completed cycle).
// This is the "no carry-over" model — each cycle is independent.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; cycleId: string }> }) {
  try {
    const { id: partyId, cycleId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK: verify party belongs to business
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // §OWNERSHIP-CHECK: verify cycle belongs to business + party
    const cycle = await db.customerRewardCycle.findFirst({
      where: { id: cycleId, businessId: business.id, partyId },
    })
    if (!cycle) return NextResponse.json({ error: 'Cycle not found' }, { status: 404 })

    // §STATE-CHECK: only UNLOCKED cycle can be rewarded
    if (cycle.status !== 'UNLOCKED') {
      return NextResponse.json({ error: `Cycle is ${cycle.status}, not UNLOCKED. Only unlocked cycles can be rewarded.` }, { status: 400 })
    }

    // Parse optional description
    const body = await req.json().catch(() => ({}))
    const rewardDescription = typeof body.rewardDescription === 'string'
      ? body.rewardDescription.trim().slice(0, 500) || null
      : null

    // §ATOMIC: reward current cycle + create next cycle in one transaction
    const result = await db.$transaction(async (tx) => {
      // 1. Mark current cycle as REWARDED
      const rewardedCycle = await tx.customerRewardCycle.update({
        where: { id: cycleId },
        data: {
          status: 'REWARDED',
          rewardGivenAt: new Date(),
          rewardDescription,
        },
      })

      // 2. Create REWARD_GIVEN event
      await tx.customerRewardEvent.create({
        data: {
          businessId: business.id,
          partyId,
          cycleId,
          eventType: 'REWARD_GIVEN',
          amount: 0,
          note: rewardDescription || 'Reward given to customer',
        },
      })

      // 3. Create next ACTIVE cycle (starts at ₹0 — no carry-over of PROFIT).
      // §THRESHOLD-SNAPSHOT: the next cycle snapshots the CURRENT configured
      // threshold from AppSettings (NOT the old cycle's threshold), so that
      // changes to the global reward threshold take effect for new cycles
      // created via give-reward. Existing cycle history is untouched (each
      // cycle carries its own snapshotted threshold — see schema comment).
      const settings = await tx.appSettings.findUnique({
        where: { businessId: business.id },
        select: { rewardThreshold: true },
      })
      const nextThreshold = settings?.rewardThreshold.toNumber() ?? DEFAULT_REWARD_THRESHOLD
      const nextCycle = await tx.customerRewardCycle.create({
        data: {
          businessId: business.id,
          partyId,
          cycleNumber: cycle.cycleNumber + 1,
          threshold: nextThreshold,
          accumulatedProfit: 0,
          status: 'ACTIVE',
        },
      })

      // 4. Create CYCLE_RESET event
      await tx.customerRewardEvent.create({
        data: {
          businessId: business.id,
          partyId,
          cycleId: nextCycle.id,
          eventType: 'CYCLE_RESET',
          amount: 0,
          note: `Cycle ${nextCycle.cycleNumber} started after reward for cycle ${cycle.cycleNumber}`,
        },
      })

      return { rewardedCycle, nextCycle }
    })

    // §AUDIT
    await logAudit({
      businessId: business.id,
      action: 'reward_given',
      entityType: 'party',
      entityId: partyId,
      description: `Reward given for cycle ${cycle.cycleNumber} to ${party.name}`,
      metadata: JSON.stringify({
        cycleId, cycleNumber: cycle.cycleNumber,
        accumulatedProfit: cycle.accumulatedProfit.toNumber(),
        threshold: cycle.threshold.toNumber(),
        nextCycleId: result.nextCycle.id,
        nextCycleNumber: result.nextCycle.cycleNumber,
      }),
    })

    return NextResponse.json(serializeDecimals({
      ok: true,
      rewardedCycle: result.rewardedCycle,
      nextCycle: result.nextCycle,
    }))
  } catch (e) {
    return apiError(e, 'Failed to give reward')
  }
}
