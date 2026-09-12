import { db } from '@/lib/db'

// §REWARD-CONSTANTS: shared types + constants for the reward cycle system.

export const REWARD_CYCLE_STATUSES = ['ACTIVE', 'UNLOCKED', 'REWARDED'] as const
export type RewardCycleStatus = typeof REWARD_CYCLE_STATUSES[number]

export const REWARD_EVENT_TYPES = [
  'PROFIT_ACCRUAL', 'REWARD_UNLOCKED', 'REWARD_GIVEN', 'CYCLE_RESET',
] as const
export type RewardEventType = typeof REWARD_EVENT_TYPES[number]

// §DEFAULT-THRESHOLD: default profit threshold for a new reward cycle (₹400)
export const DEFAULT_REWARD_THRESHOLD = 400

// §ACCURALS: Internal server-side function that accrues profit from an
// authoritative eligible invoice into the customer's current reward cycle.
//
// §AUTHORITATIVE-PROFIT: Uses the SAME formula as the Reports P&L and the
// lifetime-profit API:
//   netRevenue = subtotal - discountAmount
//   cogs = SUM(item.quantity × (item.purchasePriceSnapshot ?? Product.purchasePrice))
//   profit = netRevenue - cogs
//
// §IDEMPOTENCY: (businessId, sourceInvoiceId) unique constraint on
// CustomerRewardEvent prevents duplicate accrual. If called twice for the
// same invoice, the second call is a no-op (returns the existing event).
//
// §CARRY-OVER SEMANTICS: When an invoice pushes accumulatedProfit past the
// threshold, the FULL invoice profit is attributed to the current cycle.
// The cycle becomes UNLOCKED. The excess does NOT carry over — the next
// cycle starts at ₹0. This is the "no carry-over" model: each cycle is
// independent, and the threshold defines the "cost" of a reward.
//
// §ELIGIBILITY: Only non-voided sales/retail invoices are eligible.
// Purchase, challan, and void invoices are ignored.
//
// §NO-MUTATION: This function does NOT modify Invoice, Transaction, Product,
// or Party.balance. It only creates CustomerRewardEvent + updates
// CustomerRewardCycle (its own tables).
export async function accrueCustomerRewardFromInvoice(
  businessId: string,
  invoiceId: string,
): Promise<{ accrued: boolean; event?: any; cycle?: any; error?: string }> {
  // §STEP-1: Verify the invoice exists + belongs to the business + is eligible
  const invoice = await db.invoice.findFirst({
    where: {
      id: invoiceId,
      businessId,
      status: { not: 'void' },
      type: { in: ['sales', 'retail'] },
    },
    select: {
      id: true, partyId: true, subtotal: true, discountAmount: true,
      items: { select: { productId: true, quantity: true, purchasePriceSnapshot: true } },
    },
  })

  if (!invoice) {
    return { accrued: false, error: 'Invoice not found or not eligible (void/unsupported type)' }
  }

  if (!invoice.partyId) {
    return { accrued: false, error: 'Invoice has no partyId (walk-in sale)' }
  }

  // §STEP-2: Check idempotency — has this invoice already been processed?
  // Use findFirst instead of findUnique because sourceInvoiceId is nullable
  // (NULL for non-accrual events like REWARD_GIVEN).
  const existingEvent = await db.customerRewardEvent.findFirst({
    where: { businessId, sourceInvoiceId: invoice.id },
  })
  if (existingEvent) {
    // Already processed — idempotent return
    return { accrued: false, event: existingEvent }
  }

  // §STEP-3: Calculate eligible profit (same formula as lifetime-profit API)
  const grossRevenue = invoice.subtotal.toNumber()
  const discountAmount = invoice.discountAmount.toNumber()
  const netRevenue = grossRevenue - discountAmount

  // Fetch products for fallback
  const productIds = [...new Set(invoice.items.map(it => it.productId).filter(Boolean))] as string[]
  const products = await db.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, purchasePrice: true },
  })
  const productCostMap = new Map(products.map(p => [p.id, p.purchasePrice.toNumber()]))

  const cogs = invoice.items.reduce((sum, it) => {
    const snapshot = it.purchasePriceSnapshot?.toNumber()
    let costPerUnit: number
    if (snapshot != null && !Number.isNaN(snapshot)) {
      costPerUnit = snapshot
    } else if (it.productId) {
      costPerUnit = productCostMap.get(it.productId) ?? 0
    } else {
      costPerUnit = 0
    }
    return sum + (it.quantity * costPerUnit)
  }, 0)

  const profit = netRevenue - cogs

  // §STEP-4: Get or create the current ACTIVE cycle
  const settings = await db.appSettings.findUnique({
    where: { businessId },
    select: { rewardThreshold: true },
  })
  const threshold = settings?.rewardThreshold.toNumber() ?? DEFAULT_REWARD_THRESHOLD

  // §ATOMIC: Create cycle + event + update cycle in one transaction.
  // §CONCURRENCY: If two concurrent requests try to accrue the same invoice,
  // the unique constraint on (businessId, sourceInvoiceId) will reject the
  // second one with P2002. We catch this and return idempotent result.
  try {
    const result = await db.$transaction(async (tx) => {
    // Find or create the current ACTIVE cycle
    let cycle = await tx.customerRewardCycle.findFirst({
      where: { businessId, partyId: invoice.partyId!, status: 'ACTIVE' },
    })

    if (!cycle) {
      // Count existing cycles to determine next cycleNumber
      const cycleCount = await tx.customerRewardCycle.count({
        where: { businessId, partyId: invoice.partyId! },
      })
      cycle = await tx.customerRewardCycle.create({
        data: {
          businessId,
          partyId: invoice.partyId!,
          cycleNumber: cycleCount + 1,
          threshold,
          accumulatedProfit: 0,
          status: 'ACTIVE',
        },
      })
    }

    // §STEP-5: Create the PROFIT_ACCRUAL event
    const event = await tx.customerRewardEvent.create({
      data: {
        businessId,
        partyId: invoice.partyId!,
        cycleId: cycle.id,
        eventType: 'PROFIT_ACCRUAL',
        amount: profit,
        sourceInvoiceId: invoice.id,
        note: `Profit from invoice ${invoice.id.substring(0, 8)}`,
      },
    })

    // §STEP-6: Update cycle's accumulated profit
    const newAccumulated = cycle.accumulatedProfit.toNumber() + profit
    const thresholdValue = cycle.threshold.toNumber()

    if (newAccumulated >= thresholdValue) {
      // §THRESHOLD-REACHED: unlock the cycle
      const updatedCycle = await tx.customerRewardCycle.update({
        where: { id: cycle.id },
        data: {
          accumulatedProfit: newAccumulated,
          status: 'UNLOCKED',
          unlockedAt: new Date(),
        },
      })

      // Create REWARD_UNLOCKED event
      await tx.customerRewardEvent.create({
        data: {
          businessId,
          partyId: invoice.partyId!,
          cycleId: cycle.id,
          eventType: 'REWARD_UNLOCKED',
          amount: 0,
          note: `Threshold ₹${thresholdValue} reached (accumulated: ₹${newAccumulated.toFixed(2)})`,
        },
      })

      return { event, cycle: updatedCycle, unlocked: true }
    } else {
      // Still accumulating
      const updatedCycle = await tx.customerRewardCycle.update({
        where: { id: cycle.id },
        data: { accumulatedProfit: newAccumulated },
      })
      return { event, cycle: updatedCycle, unlocked: false }
    }
    }, { timeout: 30000 })

    return { accrued: true, event: result.event, cycle: result.cycle }
  } catch (e: any) {
    // §P2002: unique constraint on (businessId, sourceInvoiceId) — concurrent duplicate.
    // Return idempotent result: fetch the existing event.
    if (e?.code === 'P2002') {
      const existingEvent = await db.customerRewardEvent.findFirst({
        where: { businessId, sourceInvoiceId: invoice.id },
      })
      return { accrued: false, event: existingEvent }
    }
    throw e
  }
}
