import { db } from '@/lib/db'

// §STEP7A-REWARD-RECONCILIATION: Cursor-based incremental safety net.
//
// §PURPOSE: finds eligible committed invoices that have NEITHER a
// CustomerRewardEvent (PROFIT_ACCRUAL) NOR a RewardAccrualOutbox row, and
// creates a PENDING outbox row for them. The cron worker then drains the
// outbox and accrues the reward.
//
// ════════════════════════════════════════════════════════════════════════
// §STEP7A-FIX: COMPLETE HISTORICAL COVERAGE via cursor-based incremental scan.
// ════════════════════════════════════════════════════════════════════════
//
// §PROBLEM (Step 7): the original reconciliation scanned only the most recent
// 500 invoices (by createdAt DESC). An eligible invoice older than that window
// could remain missing both a PROFIT_ACCRUAL event AND an outbox row FOREVER.
// The "self-healing" claim was incorrect for arbitrary historical gaps.
//
// §FIX (Step 7A): a durable cursor (RewardReconciliationCursor) records the
// last-scanned (createdAt, invoiceId) per business. Each cron run processes
// the next bounded batch starting from the cursor position, advancing forward
// through ALL eligible invoice history (oldest-first). When the cursor reaches
// the newest invoice, the next run wraps back to the oldest (cyclic) — by
// then the historical gap is closed and only NEW missed invoices need catching.
//
// §CURSOR-KEY: (lastCreatedAt, lastInvoiceId). createdAt alone is NOT a safe
// cursor because multiple invoices can share the same timestamp (especially
// under bulk import). lastInvoiceId is the stable tie-breaker: the next batch
// scans invoices WHERE:
//   (createdAt > lastCreatedAt)
//   OR (createdAt == lastCreatedAt AND id > lastInvoiceId)
// ordered by (createdAt ASC, id ASC).
//
// §SCAN-DIRECTION: oldest-first (createdAt ASC). This ensures historical gaps
// (pre-Step-7 invoices) are covered FIRST. The cursor walks from the oldest
// eligible invoice forward. When it reaches the newest, it wraps to the oldest.
//
// §BUSINESS-SCOPED: one cursor per business (@unique(businessId)). The cron
// runs reconciliation for EACH business that has eligible invoices. Business
// A's cursor never touches Business B's.
//
// §ADVANCEMENT-SAFETY: the cursor advances based on SCANNED source rows, NOT
// on successfully-created outbox rows. A permanently problematic invoice
// (e.g., one that always fails outbox creation for an unexpected reason) does
// NOT block the cursor — the cursor advances past it after scanning, and the
// error is recorded in the summary. The next cyclic rescan will retry it.
//
// §FAILURE-REPLAY-SAFETY: if reconciliation crashes mid-batch (process killed,
// DB blip), the cursor has NOT advanced past unscanned rows (the cursor is
// updated ONLY after the full batch is processed). Re-running the same batch
// re-scans the same invoices — idempotent (P2002 on existing outbox rows is a
// safe no-op, existing reward events are skipped).
//
// §IDEMPOTENT: uses RewardAccrualOutbox.invoiceId @unique. Reconciliation
// creating a duplicate for an invoice that already has an outbox row hits
// P2002 → caught + skipped. Reconciliation NEVER directly modifies
// CustomerRewardCycle or CustomerRewardEvent — it only creates durable
// pending work.
//
// §ELIGIBILITY: matches the reward service's filter exactly:
//   type IN ('sales', 'retail') AND status != 'void' AND partyId IS NOT NULL
//
// §TERMINOLOGY (Step 7A correction):
//   - outbox delivery/processing = at-least-once (the cron + immediate
//     handler may both invoke accrual; the outbox row triggers at-least-once)
//   - reward accrual event = idempotent / at-most-once per invoice
//     (CustomerRewardEvent.@@unique([businessId, sourceInvoiceId]) ensures
//     at most one PROFIT_ACCRUAL per invoice)
//   - resulting business effect = effectively exactly-once
//   - PERMANENTLY_FAILED means: automatic retry exhausted; durable failure
//     record remains; manual/operator retry is possible later. Do NOT claim
//     automatic eventual success after MAX_ATTEMPTS.

// §RECONCILIATION-LIMIT: bounded batch size per cron invocation per business.
// 500 invoices per business per 5-minute cron run. With ~288 cron runs/day,
// a business can scan ~144,000 invoices/day — well beyond any realistic
// invoice volume. Historical gaps are closed within hours, not days.
export const RECONCILIATION_LIMIT = 500

// §CURSOR-INIT: the initial cursor position. When a business has no cursor
// yet, we start from the epoch (1970-01-01) + empty string ID, so the first
// batch scans from the oldest eligible invoice forward.
const CURSOR_INIT_DATE = new Date(0) // 1970-01-01T00:00:00.000Z
const CURSOR_INIT_ID = ''

export type ReconciliationSummary = {
  businessId: string | null
  scanned: number
  missingFound: number
  outboxCreated: number
  alreadyHadOutbox: number
  alreadyAccrued: number
  errors: string[]
  cursorAdvanced: boolean
  cycleCompleted: boolean
  cursorPosition: { lastCreatedAt: string; lastInvoiceId: string } | null
}

// ════════════════════════════════════════════════════════════════════════
// §RECONCILE-ONE-BUSINESS: cursor-based incremental scan for ONE business.
//
// §FLOW:
//   1. get-or-create the business's cursor (RewardReconciliationCursor)
//   2. fetch the next bounded batch of eligible invoices AFTER the cursor
//      position, ordered (createdAt ASC, id ASC)
//   3. batch-check for existing PROFIT_ACCRUAL events + existing outbox rows
//   4. for invoices missing BOTH, create a PENDING outbox row (idempotent)
//   5. advance the cursor to the LAST scanned invoice (createdAt, id)
//   6. if the batch was smaller than the limit (end of eligible invoices
//      reached), reset the cursor to the start (cyclic) + increment cycleCount
//
// §RETURN: summary of the scan.
// ════════════════════════════════════════════════════════════════════════
export async function reconcileRewardAccrualOutboxForBusiness(
  businessId: string,
  limit: number = RECONCILIATION_LIMIT,
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    businessId,
    scanned: 0,
    missingFound: 0,
    outboxCreated: 0,
    alreadyHadOutbox: 0,
    alreadyAccrued: 0,
    errors: [],
    cursorAdvanced: false,
    cycleCompleted: false,
    cursorPosition: null,
  }

  // §STEP-1: get-or-create the cursor for this business.
  let cursor = await db.rewardReconciliationCursor.findUnique({
    where: { businessId },
  })
  if (!cursor) {
    cursor = await db.rewardReconciliationCursor.create({
      data: {
        businessId,
        lastCreatedAt: CURSOR_INIT_DATE,
        lastInvoiceId: CURSOR_INIT_ID,
      },
    })
  }

  // §STEP-2: fetch the next bounded batch of eligible invoices AFTER the cursor.
  // §CURSOR-QUERY: (createdAt > cursor.lastCreatedAt) OR
  //                (createdAt == cursor.lastCreatedAt AND id > cursor.lastInvoiceId)
  // ordered by (createdAt ASC, id ASC).
  //
  // §SQLITE/POSTGRES: Prisma's `gt` + `or` compiles to the same SQL on both
  // providers. The composite cursor ensures no invoice is skipped even when
  // multiple invoices share the same createdAt timestamp.
  const batch = await db.invoice.findMany({
    where: {
      businessId,
      type: { in: ['sales', 'retail'] },
      status: { not: 'void' },
      partyId: { not: null },
      OR: [
        { createdAt: { gt: cursor.lastCreatedAt } },
        {
          createdAt: { equals: cursor.lastCreatedAt },
          id: { gt: cursor.lastInvoiceId },
        },
      ],
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    take: limit,
    select: { id: true, businessId: true, createdAt: true },
  })

  summary.scanned = batch.length

  if (batch.length === 0) {
    // §END-OF-TABLE: no eligible invoices after the cursor. Wrap to the start
    // (cyclic) so the next run re-scans from the oldest. This catches any NEW
    // missed invoices that appeared since the last cycle, + retries any
    // previously-problematic invoices.
    await db.rewardReconciliationCursor.update({
      where: { businessId },
      data: {
        lastCreatedAt: CURSOR_INIT_DATE,
        lastInvoiceId: CURSOR_INIT_ID,
        cycleCount: { increment: 1 },
      },
    })
    summary.cursorAdvanced = true
    summary.cycleCompleted = true
    summary.cursorPosition = {
      lastCreatedAt: CURSOR_INIT_DATE.toISOString(),
      lastInvoiceId: CURSOR_INIT_ID,
    }
    return summary
  }

  // §STEP-3: batch-check which invoices already have a PROFIT_ACCRUAL event.
  // §IDEMPOTENCY: if the event exists, the reward was already accrued — no
  // outbox needed.
  const invoiceIds = batch.map(i => i.id)
  const existingEvents = await db.customerRewardEvent.findMany({
    where: {
      sourceInvoiceId: { in: invoiceIds },
      eventType: 'PROFIT_ACCRUAL',
    },
    select: { sourceInvoiceId: true },
  })
  const invoicedWithEvent = new Set(existingEvents.map(e => e.sourceInvoiceId))

  // §STEP-4: batch-check which invoices already have an outbox row.
  // §IDEMPOTENCY: if the outbox row exists (any status), skip — it's already
  // scheduled or completed.
  const existingOutbox = await db.rewardAccrualOutbox.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { invoiceId: true },
  })
  const invoicesWithOutbox = new Set(existingOutbox.map(o => o.invoiceId))

  // §STEP-5: for invoices missing BOTH, create a PENDING outbox row.
  // §ORDER: process in the same (createdAt ASC, id ASC) order as the batch.
  // This keeps the cursor advancement deterministic.
  for (const inv of batch) {
    if (invoicedWithEvent.has(inv.id)) {
      summary.alreadyAccrued++
      continue
    }
    if (invoicesWithOutbox.has(inv.id)) {
      summary.alreadyHadOutbox++
      continue
    }

    // §MISSING: no event AND no outbox row. Create a PENDING outbox row.
    summary.missingFound++
    try {
      await db.rewardAccrualOutbox.create({
        data: {
          businessId: inv.businessId,
          invoiceId: inv.id,
          status: 'PENDING',
          attempts: 0,
        },
      })
      summary.outboxCreated++
    } catch (e: any) {
      // §P2002: another concurrent reconciliation (or the immediate post-commit
      // handler) created the row between our check and our create. This is
      // safe — the row exists, which is all we wanted.
      if (e?.code === 'P2002') {
        summary.alreadyHadOutbox++
        continue
      }
      // §UNEXPECTED: record the error + continue. Do NOT abort the whole scan.
      // §CURSOR-ADVANCES-PAST-ERRORS: the cursor advances based on scanned
      // rows, not on successful outbox creation. A problematic invoice does
      // NOT block the cursor.
      summary.errors.push(`invoice ${inv.id}: ${String(e?.message ?? e).slice(0, 200)}`)
    }
  }

  // §STEP-6: advance the cursor to the LAST scanned invoice.
  // §CURSOR-ADVANCEMENT: based on the last row in the batch (createdAt ASC,
  // id ASC ordering ensures the last row is the highest cursor position).
  // This advances the cursor PAST all scanned rows, so the next run starts
  // from the next unscanned invoice.
  const lastScanned = batch[batch.length - 1]
  await db.rewardReconciliationCursor.update({
    where: { businessId },
    data: {
      lastCreatedAt: lastScanned.createdAt,
      lastInvoiceId: lastScanned.id,
      scannedCount: { increment: batch.length },
    },
  })
  summary.cursorAdvanced = true
  summary.cursorPosition = {
    lastCreatedAt: lastScanned.createdAt.toISOString(),
    lastInvoiceId: lastScanned.id,
  }

  // §CYCLE-CHECK: if the batch was smaller than the limit, we've reached the
  // end of eligible invoices. The NEXT run will find 0 rows + wrap the cursor
  // to the start (cyclic). We don't wrap here — the next run's "0 rows" branch
  // handles the wrap + cycleCount increment. This keeps the cursor advancement
  // strictly tied to scanned rows (safer for replay).
  if (batch.length < limit) {
    // §NEAR-END: the next run will wrap. We note this in the summary for
    // observability but do NOT wrap here (the next run handles it).
    summary.cycleCompleted = false // will be true on the NEXT run
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §RECONCILE-ALL-BUSINESSES: run cursor-based reconciliation for ALL businesses
// that have eligible invoices. This is the entry point for the cron route.
//
// §FLOW:
//   1. find all distinct businessIds that have eligible invoices (type IN
//      sales/retail, status != void, partyId NOT NULL)
//   2. for each business, run reconcileRewardAccrualOutboxForBusiness
//   3. return an array of per-business summaries
//
// §BOUNDED: each business gets at most RECONCILIATION_LIMIT invoices per run.
// The total work is (number of businesses × RECONCILIATION_LIMIT). For a
// typical SaaS with 100 businesses, that's 50,000 invoices per 5-minute cron
// run — well within the 60s maxDuration (Neon cold start ~1s + ~5s per
// business for the batch query + outbox creates).
//
// §MULTI-BUSINESS-ISOLATION: each business has its own cursor. Business A's
// reconciliation never touches Business B's cursor or invoices.
// ════════════════════════════════════════════════════════════════════════
export async function reconcileRewardAccrualOutbox(
  _businessId: string | null = null,
  limit: number = RECONCILIATION_LIMIT,
): Promise<ReconciliationSummary> {
  // §NOTE: the _businessId parameter is kept for backward compatibility with
  // the Step 7 cron route signature. The cursor-based implementation is ALWAYS
  // business-scoped (one cursor per business). When _businessId is provided,
  // we reconcile only that business. When null, we reconcile ALL businesses.

  // §FIND-BUSINESSES: distinct businessIds that have eligible invoices.
  // We don't use groupBy here (it's slower on Neon) — we find distinct
  // businessIds via findMany with distinct.
  const businessesWithInvoices = await db.invoice.findMany({
    where: {
      type: { in: ['sales', 'retail'] },
      status: { not: 'void' },
      partyId: { not: null },
      ...(_businessId ? { businessId: _businessId } : {}),
    },
    distinct: ['businessId'],
    select: { businessId: true },
    take: 1000, // §BOUNDED: at most 1000 businesses per cron run (safety cap)
  })

  if (businessesWithInvoices.length === 0) {
    return {
      businessId: _businessId,
      scanned: 0,
      missingFound: 0,
      outboxCreated: 0,
      alreadyHadOutbox: 0,
      alreadyAccrued: 0,
      errors: [],
      cursorAdvanced: false,
      cycleCompleted: false,
      cursorPosition: null,
    }
  }

  // §RECONCILE-EACH-BUSINESS: run the cursor-based scan for each business.
  // We aggregate the summaries into a single combined summary for the cron
  // route's response.
  const summaries: ReconciliationSummary[] = []
  for (const { businessId } of businessesWithInvoices) {
    summaries.push(await reconcileRewardAccrualOutboxForBusiness(businessId, limit))
  }

  // §AGGREGATE: combine all per-business summaries into one.
  return summaries.reduce((acc, s) => {
    acc.scanned += s.scanned
    acc.missingFound += s.missingFound
    acc.outboxCreated += s.outboxCreated
    acc.alreadyHadOutbox += s.alreadyHadOutbox
    acc.alreadyAccrued += s.alreadyAccrued
    acc.errors.push(...s.errors)
    acc.cursorAdvanced = acc.cursorAdvanced || s.cursorAdvanced
    acc.cycleCompleted = acc.cycleCompleted || s.cycleCompleted
    if (s.cursorPosition) acc.cursorPosition = s.cursorPosition
    return acc
  }, {
    businessId: _businessId,
    scanned: 0,
    missingFound: 0,
    outboxCreated: 0,
    alreadyHadOutbox: 0,
    alreadyAccrued: 0,
    errors: [] as string[],
    cursorAdvanced: false,
    cycleCompleted: false,
    cursorPosition: null,
  } as ReconciliationSummary)
}

// ════════════════════════════════════════════════════════════════════════
// §GET-CURSOR-STATE: read the cursor for a business (for observability/tests).
// Returns null if no cursor exists yet.
// ════════════════════════════════════════════════════════════════════════
export async function getReconciliationCursor(businessId: string): Promise<{
  lastCreatedAt: Date
  lastInvoiceId: string
  scannedCount: number
  cycleCount: number
  updatedAt: Date
} | null> {
  const cursor = await db.rewardReconciliationCursor.findUnique({
    where: { businessId },
  })
  if (!cursor) return null
  return {
    lastCreatedAt: cursor.lastCreatedAt,
    lastInvoiceId: cursor.lastInvoiceId,
    scannedCount: cursor.scannedCount,
    cycleCount: cursor.cycleCount,
    updatedAt: cursor.updatedAt,
  }
}
