import { db } from '@/lib/db'

// §FEEDBACK-RECONCILIATION: Cursor-based incremental safety net for the
// PRODUCT-FEEDBACK side. Mirrors src/lib/reward-reconciliation.ts (Step 7A).
//
// §PURPOSE: finds eligible committed invoices that have NO FeedbackOutbox
// row and creates a PENDING one for them. The outbox worker (cron + immediate
// post-commit path) then creates the ProductFeedback records. This closes the
// reliability gap where a FeedbackOutbox row was missed at invoice-creation
// time (historical bug, backup-restore, manual import, partial write) —
// without it, that invoice's feedback request would be silently lost forever.
//
// §ELIGIBILITY: matches the invoice-creation gate in invoice-service.ts
// EXACTLY: type !== 'purchase' AND status === 'paid' AND partyId NOT NULL.
//   - purchase → excluded (suppliers are not asked for product feedback)
//   - unpaid/partial → excluded (sale not completed yet)
//   - no party (walk-in) → excluded (no one to ask)
//
// §LOOKBACK-WINDOW (deliberate deviation from the reward mirror): the scan
// only considers invoices created within the last 60 days (2× the 30-day
// FEEDBACK_EXPIRY_DAYS window). Rationale: a feedback request for a
// months-old purchase is immediately-stale noise — the customer will not
// remember the product and the request can never realistically be answered.
// Reward accrual is MONEY and never stale, so the reward side rightly scans
// all history; feedback requests are perishable, so healing an ancient
// invoice adds noise, not value. 60 days = 30-day expiry × 2 safety margin
// (covers the case "business was on holiday for a month" while still
// bounded). The cursor still walks the FULL history — old rows are simply
// scanned-and-skipped by the window filter, so cursor advancement +
// cyclic wrap behave identically to the reward side.
//
// §CURSOR-KEY / §SCAN-DIRECTION / §BUSINESS-SCOPED / §ADVANCEMENT-SAFETY /
// §FAILURE-REPLAY-SAFETY / §CYCLIC-WRAP: identical semantics to
// reward-reconciliation.ts — see that file for the full rationale
// ((lastCreatedAt, lastInvoiceId) composite cursor, oldest-first, one cursor
// per business via @unique(businessId), advances on SCANNED rows, P2002-safe
// idempotent replay, wrap-to-oldest + cycleCount when the batch runs dry).
//
// §IDEMPOTENCY: FeedbackOutbox.invoiceId is @unique — creating a duplicate
// for an invoice that already has a row hits P2002 → caught + counted as
// alreadyHadOutbox. Reconciliation NEVER creates ProductFeedback records
// directly — it only creates durable pending work. The processor is
// per-product dedupKey-idempotent, so even a legacy invoice whose feedback
// was created by the old fire-and-forget path is safe: the healed outbox row
// processes → processor's createProductFeedbackRecord short-circuits per
// product → row completes with created=0.
//
// §PRODUCTIDS: recomputed from InvoiceItem rows (deterministic: first
// appearance, ordered by id ASC as a stable proxy for insertion order —
// exactly like the invoice-creation path's first-appearance order). null
// when the invoice has no product-backed items → processor creates one
// generic feedback record.

export const FEEDBACK_RECONCILIATION_LIMIT = 500

// §LOOKBACK-WINDOW: 60 days (see header comment for rationale).
export const FEEDBACK_RECONCILIATION_LOOKBACK_MS = 60 * 24 * 60 * 60 * 1000

const CURSOR_INIT_DATE = new Date(0) // 1970-01-01T00:00:00.000Z
const CURSOR_INIT_ID = ''

export type FeedbackReconciliationSummary = {
  businessId: string | null
  scanned: number
  missingFound: number
  outboxCreated: number
  alreadyHadOutbox: number
  skippedOutOfWindow: number
  errors: string[]
  cursorAdvanced: boolean
  cycleCompleted: boolean
  cursorPosition: { lastCreatedAt: string; lastInvoiceId: string } | null
}

// ════════════════════════════════════════════════════════════════════════
// §ELIGIBILITY-FILTER: shared by the per-business scan + the find-all-
// businesses discovery query. Kept in ONE place so the two can never drift
// apart (a mismatch would make a business discoverable but never healed,
// or vice versa).
// ════════════════════════════════════════════════════════════════════════
function eligibleInvoiceWhere(businessId: string) {
  return {
    businessId,
    type: { not: 'purchase' },
    status: 'paid',
    partyId: { not: null },
  }
}

// ════════════════════════════════════════════════════════════════════════
// §RECONCILE-ONE-BUSINESS: cursor-based incremental scan for ONE business.
// ════════════════════════════════════════════════════════════════════════
export async function reconcileFeedbackOutboxForBusiness(
  businessId: string,
  limit: number = FEEDBACK_RECONCILIATION_LIMIT,
): Promise<FeedbackReconciliationSummary> {
  const summary: FeedbackReconciliationSummary = {
    businessId,
    scanned: 0,
    missingFound: 0,
    outboxCreated: 0,
    alreadyHadOutbox: 0,
    skippedOutOfWindow: 0,
    errors: [],
    cursorAdvanced: false,
    cycleCompleted: false,
    cursorPosition: null,
  }

  // §STEP-1: get-or-create the cursor for this business.
  let cursor = await db.feedbackReconciliationCursor.findUnique({
    where: { businessId },
  })
  if (!cursor) {
    try {
      cursor = await db.feedbackReconciliationCursor.create({
        data: {
          businessId,
          lastCreatedAt: CURSOR_INIT_DATE,
          lastInvoiceId: CURSOR_INIT_ID,
        },
      })
    } catch (e: any) {
      // §CURSOR-CREATE-RACE: same TOCTOU guard as the reward side
      // (reward-reconciliation.ts §CURSOR-CREATE-RACE) — a concurrent
      // reconciliation run won the insert; re-read instead of crashing.
      if (e?.code === 'P2002') {
        cursor = await db.feedbackReconciliationCursor.findUnique({
          where: { businessId },
        })
      }
      if (!cursor) throw e
    }
  }

  // §STEP-2: fetch the next bounded batch of eligible invoices AFTER the
  // cursor position (createdAt ASC, id ASC — composite cursor, same as the
  // reward side). The 60-day lookback is applied INSIDE the window-check
  // below, NOT in this query — see §CURSOR-vs-WINDOW note.
  const batch = await db.invoice.findMany({
    where: {
      ...eligibleInvoiceWhere(businessId),
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
    select: { id: true, businessId: true, partyId: true, createdAt: true },
  })

  summary.scanned = batch.length

  if (batch.length === 0) {
    // §END-OF-TABLE: wrap to the start (cyclic) — next run rescans from the
    // oldest, catching any NEW missed invoices + retrying problematic ones.
    await db.feedbackReconciliationCursor.update({
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

  // §STEP-3: batch-check which invoices already have an outbox row (any
  // status — scheduled, completed, or failed-but-recorded all count).
  const invoiceIds = batch.map(i => i.id)
  const existingOutbox = await db.feedbackOutbox.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { invoiceId: true },
  })
  const invoicesWithOutbox = new Set(existingOutbox.map(o => o.invoiceId))

  // §STEP-4: determine which of the missing-outbox invoices are inside the
  // lookback window. §CURSOR-vs-WINDOW: the window is checked HERE (not in
  // the batch query) so the CURSOR still advances past old rows — otherwise
  // a business with a large pre-window history would need one full
  // limit-bounded batch per cron run JUST to skip them, delaying the
  // discovery of genuinely-new gaps by days.
  const windowStart = Date.now() - FEEDBACK_RECONCILIATION_LOOKBACK_MS

  // §STEP-5: for in-window invoices missing an outbox row, recompute the
  // productIds payload from the invoice's items (batch query, one round-trip).
  const toHeal = batch.filter(
    inv =>
      !invoicesWithOutbox.has(inv.id) &&
      inv.createdAt.getTime() >= windowStart &&
      inv.partyId,
  )

  if (toHeal.length > 0) {
    const healIds = toHeal.map(i => i.id)
    // §DETERMINISTIC-ORDER: id ASC is a stable total order on InvoiceItem
    // rows; first-appearance per invoice mirrors the creation path's
    // serverItems walk. (Exact interleaving vs insertion order doesn't
    // matter functionally — the processor creates one record per unique
    // productId regardless of order.)
    const items = await db.invoiceItem.findMany({
      where: { invoiceId: { in: healIds } },
      orderBy: { id: 'asc' },
      select: { invoiceId: true, productId: true },
    })
    const productIdsByInvoice = new Map<string, string[]>()
    for (const item of items) {
      if (typeof item.productId !== 'string' || item.productId.length === 0) continue
      let list = productIdsByInvoice.get(item.invoiceId)
      if (!list) {
        list = []
        productIdsByInvoice.set(item.invoiceId, list)
      }
      if (!list.includes(item.productId)) {
        list.push(item.productId)
      }
    }

    // §STEP-6: create PENDING outbox rows (idempotent — P2002 counts as
    // alreadyHadOutbox). Processed in batch order for deterministic
    // summaries; the cursor advances past errors regardless.
    for (const inv of toHeal) {
      summary.missingFound++
      try {
        const productIds = productIdsByInvoice.get(inv.id) ?? []
        await db.feedbackOutbox.create({
          data: {
            businessId: inv.businessId,
            invoiceId: inv.id,
            partyId: inv.partyId,
            // §JSON: empty array → null (processor creates one generic
            // feedback record with productId=null) — same convention as the
            // invoice-creation path.
            productIds: productIds.length > 0 ? JSON.stringify(productIds) : null,
            status: 'PENDING',
            attempts: 0,
          },
        })
        summary.outboxCreated++
      } catch (e: any) {
        // §P2002: a concurrent creator (invoice creation / another
        // reconciliation run) won the race — the row exists, which is all
        // we wanted.
        if (e?.code === 'P2002') {
          summary.alreadyHadOutbox++
          continue
        }
        // §UNEXPECTED: record + continue. The cursor advances on SCANNED
        // rows — a problematic invoice does NOT block progress, and the
        // cyclic rescan retries it next cycle.
        summary.errors.push(`invoice ${inv.id}: ${String(e?.message ?? e).slice(0, 200)}`)
      }
    }
  }

  // §STEP-7: count skipped-out-of-window for observability (these are the
  // "scanned but deliberately not healed" rows — see §LOOKBACK-WINDOW).
  summary.skippedOutOfWindow = batch.filter(
    inv => !invoicesWithOutbox.has(inv.id) && inv.createdAt.getTime() < windowStart,
  ).length
  summary.alreadyHadOutbox += batch.filter(inv => invoicesWithOutbox.has(inv.id)).length

  // §STEP-8: advance the cursor to the LAST scanned invoice (batch order
  // guarantees it is the highest cursor position). This advances PAST
  // out-of-window rows too — see §CURSOR-vs-WINDOW above.
  const lastScanned = batch[batch.length - 1]
  await db.feedbackReconciliationCursor.update({
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

  // §CYCLE-CHECK: batch < limit means the next run finds 0 rows and wraps
  // (cycleCompleted on THAT run). We only note it here for observability.
  if (batch.length < limit) {
    summary.cycleCompleted = false // will be true on the NEXT run
  }

  return summary
}

// ════════════════════════════════════════════════════════════════════════
// §RECONCILE-ALL-BUSINESSES: entry point for the cron route. Mirrors the
// reward-side contract: _businessId null → all businesses (bounded to 1000);
// non-null → that single business.
// ════════════════════════════════════════════════════════════════════════
export async function reconcileFeedbackOutbox(
  _businessId: string | null = null,
  limit: number = FEEDBACK_RECONCILIATION_LIMIT,
): Promise<FeedbackReconciliationSummary> {
  // §FIND-BUSINESSES: distinct businessIds with at least one eligible
  // invoice (uses the SHARED eligibility filter — see its comment).
  const businessesWithInvoices = await db.invoice.findMany({
    where: {
      type: { not: 'purchase' },
      status: 'paid',
      partyId: { not: null },
      ...(_businessId ? { businessId: _businessId } : {}),
    },
    distinct: ['businessId'],
    select: { businessId: true },
    take: 1000, // §BOUNDED: safety cap, same as the reward side
  })

  if (businessesWithInvoices.length === 0) {
    return {
      businessId: _businessId,
      scanned: 0,
      missingFound: 0,
      outboxCreated: 0,
      alreadyHadOutbox: 0,
      skippedOutOfWindow: 0,
      errors: [],
      cursorAdvanced: false,
      cycleCompleted: false,
      cursorPosition: null,
    }
  }

  const summaries: FeedbackReconciliationSummary[] = []
  for (const { businessId } of businessesWithInvoices) {
    summaries.push(await reconcileFeedbackOutboxForBusiness(businessId, limit))
  }

  // §AGGREGATE: combine per-business summaries into one for the cron
  // response. cursorPosition reports the LAST business's cursor (the
  // reward side does the same — it's for observability, not correctness).
  return summaries.reduce((acc, s) => {
    acc.scanned += s.scanned
    acc.missingFound += s.missingFound
    acc.outboxCreated += s.outboxCreated
    acc.alreadyHadOutbox += s.alreadyHadOutbox
    acc.skippedOutOfWindow += s.skippedOutOfWindow
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
    skippedOutOfWindow: 0,
    errors: [] as string[],
    cursorAdvanced: false,
    cycleCompleted: false,
    cursorPosition: null,
  } as FeedbackReconciliationSummary)
}

// ════════════════════════════════════════════════════════════════════════
// §GET-CURSOR-STATE: read the cursor for a business (observability/tests).
// ════════════════════════════════════════════════════════════════════════
export async function getFeedbackReconciliationCursor(businessId: string): Promise<{
  lastCreatedAt: Date
  lastInvoiceId: string
  scannedCount: number
  cycleCount: number
  updatedAt: Date
} | null> {
  const cursor = await db.feedbackReconciliationCursor.findUnique({
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
