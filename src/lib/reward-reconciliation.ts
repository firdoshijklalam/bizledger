import { db } from '@/lib/db'

// §STEP7-REWARD-RECONCILIATION: Safety net for the outbox.
//
// §PURPOSE: finds eligible committed invoices that have NEITHER a
// CustomerRewardEvent (PROFIT_ACCRUAL) NOR a RewardAccrualOutbox row, and
// creates a PENDING outbox row for them. The cron worker then drains the
// outbox and accrues the reward.
//
// §WHY-NEEDED: even with the transactional outbox, there are edge cases:
//   - outbox row creation failed inside the invoice $transaction (extremely
//     rare — would roll back the invoice too, but defensive)
//   - the invoice was created BEFORE the outbox feature was deployed (historical
//     gap — pre-Step-7 invoices that never got accrued)
//   - any bug in the wiring that skips outbox creation
//
// §IDEMPOTENT: uses RewardAccrualOutbox.invoiceId @unique. Reconciliation
// creating a duplicate for an invoice that already has an outbox row hits
// P2002 → caught + skipped. Reconciliation itself never directly modifies
// reward cycles — it only creates durable pending work.
//
// §BOUNDED: scans a bounded window of recent invoices per invocation to stay
// within Vercel's maxDuration. Does NOT scan the entire invoice table.
//
// §STRATEGY: scan the most recent N invoices (default 500, by createdAt DESC)
// for the given business (or all businesses if businessId is null). This
// catches recent misses without a full-table scan. A separate weekly job
// (out of scope) could scan the full table if needed.
//
// §ELIGIBILITY: matches the reward service's filter:
//   type IN ('sales', 'retail') AND status != 'void' AND partyId IS NOT NULL
//
// §NO-DIRECT-REWARD-MUTATION: reconciliation NEVER calls
// accrueCustomerRewardFromInvoice directly. It only creates outbox rows. The
// cron worker + immediate post-commit handler do the actual accrual. This
// separation ensures reconciliation cannot create duplicate PROFIT_ACCRUAL
// events — it only schedules work.

// §RECONCILIATION-LIMIT: bounded scan window per invocation. 500 invoices
// is ~5s of DB time on a cold Neon connection — well within cron limits.
export const RECONCILIATION_LIMIT = 500

export type ReconciliationSummary = {
  scanned: number
  missingFound: number
  outboxCreated: number
  alreadyHadOutbox: number
  alreadyAccrued: number
  errors: string[]
}

// ════════════════════════════════════════════════════════════════════════
// §RECONCILE: scan recent eligible invoices + create outbox rows for any
// that are missing both a PROFIT_ACCRUAL event AND an outbox row.
//
// §PARAMS:
//   - businessId: if provided, scan only that business's invoices. If null,
//     scan all businesses (used by the global cron).
//   - limit: max invoices to scan (default 500)
//
// §RETURNS: summary of the scan. Used for observability + tests.
//
// §BOUNDED-WINDOW: scans the most recent `limit` invoices by createdAt DESC.
// This catches recent misses without a full-table scan. The cron runs every
// 5 minutes, so any missed invoice is caught within 5 minutes of its creation
// (or within 5 minutes of the feature being deployed, for historical gaps).
// ════════════════════════════════════════════════════════════════════════
export async function reconcileRewardAccrualOutbox(
  businessId: string | null = null,
  limit: number = RECONCILIATION_LIMIT,
): Promise<ReconciliationSummary> {
  const summary: ReconciliationSummary = {
    scanned: 0,
    missingFound: 0,
    outboxCreated: 0,
    alreadyHadOutbox: 0,
    alreadyAccrued: 0,
    errors: [],
  }

  // §STEP-1: fetch recent eligible invoices (bounded window).
  // §ELIGIBILITY: matches accrueCustomerRewardFromInvoice's filter exactly.
  const recentInvoices = await db.invoice.findMany({
    where: {
      ...(businessId ? { businessId } : {}),
      type: { in: ['sales', 'retail'] },
      status: { not: 'void' },
      partyId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: { id: true, businessId: true },
  })

  summary.scanned = recentInvoices.length
  if (recentInvoices.length === 0) return summary

  // §STEP-2: batch-check which invoices already have a PROFIT_ACCRUAL event.
  // §IDEMPOTENCY: if the event exists, the reward was already accrued — no
  // outbox needed.
  const invoiceIds = recentInvoices.map(i => i.id)
  const existingEvents = await db.customerRewardEvent.findMany({
    where: {
      sourceInvoiceId: { in: invoiceIds },
      eventType: 'PROFIT_ACCRUAL',
    },
    select: { sourceInvoiceId: true },
  })
  const invoicedWithEvent = new Set(existingEvents.map(e => e.sourceInvoiceId))

  // §STEP-3: batch-check which invoices already have an outbox row.
  // §IDEMPOTENCY: if the outbox row exists (any status), skip — it's already
  // scheduled or completed.
  const existingOutbox = await db.rewardAccrualOutbox.findMany({
    where: { invoiceId: { in: invoiceIds } },
    select: { invoiceId: true },
  })
  const invoicesWithOutbox = new Set(existingOutbox.map(o => o.invoiceId))

  // §STEP-4: for invoices missing BOTH, create a PENDING outbox row.
  for (const inv of recentInvoices) {
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
        // §IDEMPOTENT: row already exists. Count as already-had-outbox.
        summary.alreadyHadOutbox++
        continue
      }
      // §UNEXPECTED: record the error + continue. Do not abort the whole scan.
      summary.errors.push(`invoice ${inv.id}: ${String(e?.message ?? e).slice(0, 200)}`)
    }
  }

  return summary
}
