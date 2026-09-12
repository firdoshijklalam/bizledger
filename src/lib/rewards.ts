import { Prisma } from '@prisma/client'
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

// §STEP4A-CONCURRENCY: maximum retry attempts for ACTIVE-cycle creation race.
// Each retry is triggered ONLY by a classified P2002 on the ACTIVE partial
// unique index (or cycleNumber unique). Source-invoice P2002 is terminal
// (idempotent return). Unrelated errors are rethrown (never retried blindly).
const MAX_CYCLE_CREATION_RETRIES = 5

// §P2002-CLASSIFICATION: the set of Prisma P2002 conflict targets that are
// EXPECTED concurrency races in this service and therefore eligible for
// recovery (refetch + retry). Any P2002 whose target is NOT in this set is
// rethrown — we never blindly swallow unexpected uniqueness violations.
const RECOVERABLE_P2002_TARGETS = new Set([
  'sourceInvoiceId',                          // idempotent duplicate (terminal — return existing)
  'businessId_partyId_active',                // partial unique index on ACTIVE cycle (PostgreSQL)
  'businessId_partyId_cycleNumber',           // cycleNumber unique (rare under retry)
])

// §INTERNAL: result type for the accrual function. Kept loose (`any`) for
// cycle/event because the shape is consumed by the rewards UI + tests, and the
// raw Prisma Decimal fields are serialized at the API boundary.
export type AccrualResult = {
  accrued: boolean
  event?: any
  cycle?: any
  error?: string
}

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
//
// ════════════════════════════════════════════════════════════════════════
// §STEP4A — CONCURRENCY HARDENING
// ════════════════════════════════════════════════════════════════════════
//
// §PROBLEM-A (same invoice, concurrent): both calls race to insert a
// PROFIT_ACCRUAL event. Unique(businessId, sourceInvoiceId) → second insert
// gets P2002. Handled by classifyP2002 → SOURCE_INVOICE → return existing.
//
// §PROBLEM-B (different invoices, same customer, concurrent, no ACTIVE cycle):
//   Both calls observe "no ACTIVE cycle".
//   Both attempt cycle.create → only one wins; the other gets P2002 on the
//   partial unique index `businessId_partyId_active` (PostgreSQL) OR on
//   `(businessId, partyId, cycleNumber)` if both pick the same cycleNumber.
//   The LOSER must NOT lose its invoice's profit — it refetches the winner's
//   ACTIVE cycle and retries the event insert + atomic increment against it.
//
// §PROBLEM-C (lost update): two concurrent accruals against the SAME ACTIVE
//   cycle. Read-modify-write of accumulatedProfit would clobber one update.
//   FIX: use `update({ data: { accumulatedProfit: { increment: profit } } })`
//   — this is a single atomic SQL UPDATE that takes a row-level lock and
//   adds `profit` to whatever the current DB value is. No read step, no
//   lost update. Concurrent increments serialize on the row lock and both
//   contributions are preserved.
//
// §PROBLEM-D (duplicate unlock): two concurrent accruals both push
//   accumulatedProfit past the threshold. Both must NOT create a
//   REWARD_UNLOCKED event. FIX: the unlock transition is a GUARDED UPDATE:
//   `UPDATE CustomerRewardCycle SET status='UNLOCKED', unlockedAt=now()
//    WHERE id=? AND status='ACTIVE'`. Only the transaction that holds the
//   row lock FIRST can observe `status='ACTIVE'` and flip it. The second
//   transaction's UPDATE matches 0 rows (status is already 'UNLOCKED'), so
//   it does NOT create a REWARD_UNLOCKED event. This is deterministic and
//   requires no application-level locks.
//
// §P2002-CLASSIFICATION-RULES:
//   - target includes `sourceInvoiceId`        → SOURCE_INVOICE   → terminal idempotent return
//   - target includes ACTIVE-index name OR
//     includes `cycleNumber`                  → CYCLE_RACE       → refetch ACTIVE, retry
//   - anything else                            → UNKNOWN          → rethrow (do NOT swallow)
//
// §NO-BLIND-SUCCESS: a P2002 is NEVER treated as success without
// classification. The classifyP2002 helper returns one of the three labels
// above, and only the labeled cases follow their specific recovery path.
export async function accrueCustomerRewardFromInvoice(
  businessId: string,
  invoiceId: string,
): Promise<AccrualResult> {
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

  // §STEP-2: Pre-check idempotency OUTSIDE the transaction (fast path).
  // The unique constraint is the AUTHORITATIVE guard; this is just an
  // optimization to avoid the profit calculation + transaction for the
  // common retry case.
  const existingEvent = await db.customerRewardEvent.findFirst({
    where: { businessId, sourceInvoiceId: invoice.id },
  })
  if (existingEvent) {
    return { accrued: false, event: existingEvent }
  }

  // §STEP-3: Calculate eligible profit (same formula as lifetime-profit API)
  const grossRevenue = invoice.subtotal.toNumber()
  const discountAmount = invoice.discountAmount.toNumber()
  const netRevenue = grossRevenue - discountAmount

  // Fetch products for fallback purchasePrice (when snapshot is null)
  const productIds = [...new Set(invoice.items.map(it => it.productId).filter(Boolean))] as string[]
  const products = productIds.length > 0
    ? await db.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, purchasePrice: true },
      })
    : []
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

  // §STEP-4: Get the reward threshold from AppSettings (snapshot at cycle
  // creation time, not at accrual time — the cycle row carries its own
  // threshold column).
  const settings = await db.appSettings.findUnique({
    where: { businessId },
    select: { rewardThreshold: true },
  })
  const threshold = settings?.rewardThreshold.toNumber() ?? DEFAULT_REWARD_THRESHOLD

  const partyId = invoice.partyId

  // ════════════════════════════════════════════════════════════════════════
  // §STEP4A-RETRY-LOOP: handles the ACTIVE-cycle creation race.
  //   attempt 0: optimistically try findFirst(ACTIVE) → create if missing
  //   on P2002 (CYCLE_RACE): refetch ACTIVE, retry the event insert + increment
  // The loop terminates on: success | SOURCE_INVOICE P2002 | UNKNOWN error |
  //   exhausted retries.
  // ════════════════════════════════════════════════════════════════════════
  let lastError: any = null
  for (let attempt = 0; attempt <= MAX_CYCLE_CREATION_RETRIES; attempt++) {
    try {
      return await runAccrualTransaction({
        businessId, partyId, invoiceId: invoice.id, profit, threshold,
      })
    } catch (e: any) {
      // §P2002-PATH: classify before any recovery action.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const classification = classifyP2002(e)

        if (classification === 'SOURCE_INVOICE') {
          // §IDEMPOTENT: this invoice was already accrued (race loser).
          // Fetch the existing event and return idempotent result. Do NOT
          // create a second event. Do NOT touch the cycle.
          const existing = await db.customerRewardEvent.findFirst({
            where: { businessId, sourceInvoiceId: invoice.id },
          })
          return { accrued: false, event: existing ?? undefined }
        }

        if (classification === 'CYCLE_RACE') {
          // §RECOVERABLE: another concurrent request created the ACTIVE
          // cycle (or stole the cycleNumber). Retry the loop — the next
          // attempt's findFirst(ACTIVE) will observe the winner's cycle and
          // accrue THIS invoice's profit against it. The invoice's profit
          // is NOT lost.
          lastError = e
          if (attempt < MAX_CYCLE_CREATION_RETRIES) {
            continue
          }
          // Exhausted retries on CYCLE_RACE — rethrow (should not happen
          // in practice; the partial unique index serializes creation).
          throw e
        }

        // §UNKNOWN-P2002: do NOT swallow. Rethrow so the caller sees the
        // real constraint violation (e.g., a future schema change adds a
        // new unique index we didn't anticipate).
        throw e
      }

      // Non-P2002 errors propagate unchanged.
      throw e
    }
  }

  // §UNREACHABLE: the loop either returns or throws. Defensive fallback.
  throw lastError ?? new Error('accrueCustomerRewardFromInvoice: exhausted retries without resolution')
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: classify a Prisma P2002 error by its `meta.target` field.
//
// Prisma populates `e.meta.target` with the column (or composite column list)
// that triggered the unique violation. We inspect this to decide recovery:
//
//   - includes 'sourceInvoiceId'  → SOURCE_INVOICE  (terminal idempotent)
//   - includes the partial-ACTIVE-index name OR 'cycleNumber' → CYCLE_RACE (retry)
//   - otherwise                    → UNKNOWN         (rethrow)
//
// §DEFENSIVE: if `meta.target` is missing or malformed (older Prisma
// versions, or a composite index reported differently), we return UNKNOWN
// rather than guessing. We NEVER default a P2002 to "recoverable" without
// positive identification — that would risk silently swallowing a real
// invariant violation.
// ════════════════════════════════════════════════════════════════════════
type P2002Classification = 'SOURCE_INVOICE' | 'CYCLE_RACE' | 'UNKNOWN'

function classifyP2002(e: Prisma.PrismaClientKnownRequestError): P2002Classification {
  const target = (e.meta as any)?.target
  if (!Array.isArray(target)) {
    // §NO-TARGET: cannot classify safely → treat as UNKNOWN (rethrow).
    return 'UNKNOWN'
  }
  const targetStr = target.join(',')

  if (target.includes('sourceInvoiceId')) {
    return 'SOURCE_INVOICE'
  }

  // §PARTIAL-ACTIVE-INDEX: PostgreSQL reports the partial-unique-index name
  // as a single string element in `target` (e.g.,
  // ['businessId_partyId_active']). Match the index name we created in the
  // migration. Also accept 'cycleNumber' as a CYCLE_RACE signal (the
  // @@unique([businessId, partyId, cycleNumber]) constraint).
  if (
    target.includes('businessId_partyId_active') ||
    target.includes('cycleNumber') ||
    targetStr.includes('businessId_partyId_active') ||
    targetStr.includes('cycleNumber')
  ) {
    return 'CYCLE_RACE'
  }

  return 'UNKNOWN'
}

// ════════════════════════════════════════════════════════════════════════
// §INTERNAL: the single attempt — find/create ACTIVE cycle, insert event,
// atomically increment accumulatedProfit, guarded unlock transition.
//
// All writes happen inside ONE db.$transaction. The transaction's isolation
// level (default: Serializable on PostgreSQL via Prisma) plus the row-level
// locks taken by the UPDATE statements ensure:
//   - no lost updates (increment is atomic SQL, not read-modify-write)
//   - no duplicate unlock (guarded UPDATE matches at most one transaction)
//   - no partial state (any failure rolls back the whole transaction)
// ════════════════════════════════════════════════════════════════════════
async function runAccrualTransaction(params: {
  businessId: string
  partyId: string
  invoiceId: string
  profit: number
  threshold: number
}): Promise<AccrualResult> {
  const { businessId, partyId, invoiceId, profit, threshold } = params

  const result = await db.$transaction(async (tx) => {
    // §STEP-A: Find or create the current ACTIVE cycle.
    //
    // The findFirst is the fast path. If no ACTIVE cycle exists, we attempt
    // to create one. Under concurrency, two requests may both see no ACTIVE
    // cycle and both attempt create — exactly one wins; the loser receives
    // P2002 on the partial unique index (PostgreSQL) and the outer retry
    // loop refetches.
    let cycle = await tx.customerRewardCycle.findFirst({
      where: { businessId, partyId, status: 'ACTIVE' },
    })

    if (!cycle) {
      // §CYCLE-NUMBER: count existing cycles (any status) to determine the
      // next cycleNumber. Under concurrency, two requests may compute the
      // same count and both attempt create with the same cycleNumber — the
      // @@unique([businessId, partyId, cycleNumber]) rejects the loser with
      // P2002, classified as CYCLE_RACE, retried.
      const cycleCount = await tx.customerRewardCycle.count({
        where: { businessId, partyId },
      })
      try {
        cycle = await tx.customerRewardCycle.create({
          data: {
            businessId,
            partyId,
            cycleNumber: cycleCount + 1,
            threshold,
            accumulatedProfit: 0,
            status: 'ACTIVE',
          },
        })
      } catch (createErr: any) {
        // §RE-THROW-P2002: let the outer loop classify + recover. We must
        // NOT swallow here — the classifier decides.
        throw createErr
      }
    }

    // §STEP-B: Insert the PROFIT_ACCRUAL event.
    //
    // The unique(businessId, sourceInvoiceId) constraint is the
    // AUTHORITATIVE idempotency guard. If a concurrent request already
    // inserted an event for this invoice, this create throws P2002
    // (classified SOURCE_INVOICE → terminal idempotent return).
    //
    // We do this BEFORE incrementing accumulatedProfit so that if the
    // insert fails (idempotent duplicate), we have NOT mutated the cycle.
    const event = await tx.customerRewardEvent.create({
      data: {
        businessId,
        partyId,
        cycleId: cycle.id,
        eventType: 'PROFIT_ACCRUAL',
        amount: profit,
        sourceInvoiceId: invoiceId,
        note: `Profit from invoice ${invoiceId.substring(0, 8)}`,
      },
    })

    // §STEP-C: ATOMIC INCREMENT of accumulatedProfit.
    //
    // §LOST-UPDATE-PROTECTION: this is a single SQL UPDATE that adds
    // `profit` to whatever the current DB value is. It takes a row-level
    // lock (SELECT ... FOR UPDATE semantics on the UPDATEd row), so
    // concurrent increments SERIALIZE on the lock and BOTH contributions
    // are preserved. There is no read step, no chance of clobber.
    //
    // We re-read the updated row to learn the new accumulatedProfit value
    // (for the threshold check). The re-read is inside the same
    // transaction, so it sees our own uncommitted increment.
    const updatedCycle = await tx.customerRewardCycle.update({
      where: { id: cycle.id },
      data: { accumulatedProfit: { increment: profit } },
    })

    const newAccumulated = updatedCycle.accumulatedProfit.toNumber()
    const thresholdValue = updatedCycle.threshold.toNumber()

    // §STEP-D: GUARDED UNLOCK transition.
    //
    // §DETERMINISTIC-ONE-UNLOCK: the UPDATE below has a WHERE clause that
    // requires status='ACTIVE'. Under concurrency, two transactions both
    // increment accumulatedProfit past the threshold; both then attempt
    // this UPDATE. The FIRST transaction (holding the row lock from the
    // increment above) flips ACTIVE→UNLOCKED. The SECOND transaction,
    // waiting on the row lock, acquires it AFTER the first commits — at
    // which point status is already 'UNLOCKED', so its UPDATE matches 0
    // rows. We detect this via the `count` returned by updateMany and
    // create the REWARD_UNLOCKED event ONLY when count === 1.
    //
    // §ROW-LOCK-ORDERING: the atomic increment in STEP-C took a write lock
    // on the cycle row. Two concurrent transactions therefore serialize:
    //   T1: increment (lock acquired) → read newAccumulated → unlock-UPDATE
    //       (status='ACTIVE' → matches 1 row → flips to UNLOCKED) → commit
    //   T2: increment (waits for T1's lock) → resumes after T1 commits →
    //       read newAccumulated (sees T1's increment + own) → unlock-UPDATE
    //       (status='UNLOCKED' → matches 0 rows → no event) → commit
    //
    // Result: exactly one REWARD_UNLOCKED event, exactly one ACTIVE→UNLOCKED
    // transition, no duplicate unlock.
    if (newAccumulated >= thresholdValue) {
      // §GUARDED-UPDATE: only flips ACTIVE→UNLOCKED. The re-read via
      // updateMany's `count` tells us whether THIS transaction was the one
      // that performed the transition.
      const updateResult = await tx.customerRewardCycle.updateMany({
        where: { id: cycle.id, status: 'ACTIVE' },
        data: {
          status: 'UNLOCKED',
          unlockedAt: new Date(),
        },
      })

      if (updateResult.count === 1) {
        // §THIS-TRANSACTION-UNLOCKED: create the REWARD_UNLOCKED event.
        // Only the transaction that actually performed ACTIVE→UNLOCKED
        // records the event. Concurrent losers see count=0 and skip.
        await tx.customerRewardEvent.create({
          data: {
            businessId,
            partyId,
            cycleId: cycle.id,
            eventType: 'REWARD_UNLOCKED',
            amount: 0,
            note: `Threshold ₹${thresholdValue} reached (accumulated: ₹${newAccumulated.toFixed(2)})`,
          },
        })
      }
      // §ELSE: another concurrent transaction already unlocked this cycle.
      // Our profit was still added (STEP-C committed within this tx). We
      // do NOT create a duplicate REWARD_UNLOCKED event.
    }

    // §RETURN: re-fetch the cycle to return its final committed state.
    // (updateMany does not return the row, only count.)
    const finalCycle = await tx.customerRewardCycle.findUnique({
      where: { id: cycle.id },
    })

    return { event, cycle: finalCycle ?? updatedCycle }
  }, { timeout: 30000 })

  return { accrued: true, event: result.event, cycle: result.cycle }
}
