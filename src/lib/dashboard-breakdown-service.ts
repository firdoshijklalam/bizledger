import { db } from '@/lib/db'
import {
  computeRangeBounds,
  computeBuckets,
  type DashboardRange,
  type Bucket,
} from '@/lib/date-ranges'

/**
 * §P16-STEP3.8.1-DRILLDOWN: Dashboard breakdown service.
 *
 * Extracted from `src/app/api/dashboard/breakdown/route.ts` to enable
 * REAL DB + REAL CODE PATH testing without requiring a running Next.js
 * dev server or cookie/session context.
 *
 * §MIRRORS-INVOICE-SERVICE-PATTERN: Just as `createInvoice()` was extracted
 * from the invoices POST route to enable direct testing, this service
 * contains the core breakdown logic. The route handler is now a thin
 * wrapper that:
 *   1. Gets the authenticated business (from session cookie)
 *   2. Validates + parses query params
 *   3. Calls `getBreakdown(businessId, params)`
 *   4. Returns the response
 *
 * §NO-SEMANTIC-CHANGE: The accounting formulas, query structure, bucket
 * derivation, and response shape are IDENTICAL to the previous inline
 * implementation. This is a mechanical extraction — no behavior changed.
 *
 * §ACCOUNTING-FREEZE: This service is READ-ONLY. It does NOT create,
 * update, or delete any records. It does NOT modify any accounting
 * formulas or classifications.
 */

// §REVENUE-SCOPE: Same as dashboard route — only sales/retail invoices
// contribute to revenue/COGS. Purchase invoices (asset movement) and
// voided invoices are EXCLUDED.
const REVENUE_INVOICE_TYPES = ['sales', 'retail'] as const

// §EXPENSE-TYPES: Same as dashboard route's EXPENSE_TYPES. Used for
// legacy NULL-subtype classification. 'purchase' is intentionally NOT
// included (dead type, aligned with Reports).
const EXPENSE_TYPES = ['debit', 'expense'] as const

// §FIX-FINDING-2: REMOVED MAX_INVOICES_PER_BUCKET / MAX_TRANSACTIONS_PER_BUCKET
// caps. The dashboard route fetches ALL invoices/transactions in range with
// NO cap — keeping caps here would cause breakdown summary ≠ dashboard bucket
// summary for high-volume buckets. The endpoint is already scoped to one
// bucket + one business, so the query is bounded by the bucket's time window.

// §DECIMAL-FIX: Prisma Decimal fields return as string. Convert to Number.
const num = (v: any): number => Number(v) || 0

export const VALID_RANGES: DashboardRange[] = [
  '1d', 'yesterday', '2d', '3d', '5d', '7d',
  '1m', '3m', '6m', '1y', 'custom',
]

export class BreakdownValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BreakdownValidationError'
  }
}

export interface BreakdownParams {
  range: DashboardRange
  startDate?: string | null
  endDate?: string | null
  bucketIndex: number
}

export interface BreakdownResponse {
  period: {
    label: string
    fullLabel: string
    startISO: string
    endISO: string
    bucketType: 'hour' | 'day' | 'week' | 'month'
  }
  summary: {
    netRevenue: number
    cogs: number
    grossProfit: number
    operatingExpense: number
    legacyOpEx: number
    netProfit: number
  }
  breakdown: {
    revenueSources: Array<{
      invoiceId: string
      invoiceNumber: string
      partyId: string | null
      partyName: string | null
      netRevenueContribution: number
      grandTotal: number
      date: string
    }>
    cogsSources: Array<{
      productId: string
      productName: string
      quantitySold: number
      historicalCostPerUnit: number | null
      fallbackCostPerUnit: number | null
      totalCogsContribution: number
      invoiceId: string
      invoiceNumber: string
      isApproximate: boolean
    }>
    expenseSources: {
      authoritative: Array<{
        transactionId: string
        category: string
        description: string
        amount: number
        date: string
        isAuthoritative: true
      }>
      legacy: Array<{
        transactionId: string
        category: string
        description: string
        amount: number
        date: string
        isAuthoritative: false
        classificationNote: string
      }>
    }
  }
  cogsAccuracy: {
    snapshotItems: number
    fallbackItems: number
    isApproximate: boolean
  }
}

/**
 * Get the Profit/Loss breakdown for a specific bucket in a dashboard range.
 *
 * §CORRECTION-4 (Server-derived): The client sends ONLY range + customStart
 * + customEnd + bucketIndex. The server derives rangeStart, rangeEnd,
 * bucketType, bucketCount, bucketStart, bucketEnd via computeRangeBounds()
 * + computeBuckets() — the SAME functions the dashboard uses.
 *
 * §CORRECTION-5 (Accounting semantics):
 *   - Net Revenue      = SUM(invoice.subtotal - invoice.discountAmount) — tax-exclusive
 *   - COGS             = SUM(item.quantity × (snapshot ?? product.purchasePrice ?? 0))
 *   - Gross Profit     = Net Revenue - COGS
 *   - Operating Expense= AUTHORITATIVE ONLY (subtype='operating_expense')
 *   - Legacy OpEx      = NULL-subtype + type debit/expense + invoiceId IS NULL
 *   - Net Profit       = Gross Profit - authoritative Operating Expense
 *
 * §CORRECTION-6 (Traceability): Every displayed number traces to a DB record.
 *
 * @throws {BreakdownValidationError} for 400-level client errors
 * @throws {Error} for 500-level server errors
 */
export async function getBreakdown(
  businessId: string,
  params: BreakdownParams,
): Promise<BreakdownResponse> {
  const { range: rangeParam, startDate, endDate, bucketIndex } = params

  // ─── §VALIDATE-RANGE ────────────────────────────────────────────────
  if (!rangeParam || !VALID_RANGES.includes(rangeParam)) {
    throw new BreakdownValidationError('Invalid range')
  }
  if (rangeParam === 'custom' && (!startDate || !endDate)) {
    throw new BreakdownValidationError('Custom range requires startDate and endDate')
  }

  // ─── §VALIDATE-BUCKET-INDEX ────────────────────────────────────────
  if (!Number.isInteger(bucketIndex) || bucketIndex < 0) {
    throw new BreakdownValidationError('Invalid bucketIndex')
  }

  // ─── §SERVER-DERIVED-RANGE-BOUNDARIES ─────────────────────────────
  const bounds = computeRangeBounds(rangeParam, startDate, endDate)
  if (!bounds) {
    throw new BreakdownValidationError('Invalid range: could not compute boundaries')
  }
  const rangeStart: Date = bounds.start
  const rangeEnd: Date = bounds.end

  // ─── §SERVER-DERIVED-BUCKET-CONFIG ─────────────────────────────────
  const rangeDays = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000)
  let bucketType: 'hour' | 'day' | 'week' | 'month' = 'day'
  let bucketCount = 7
  if (rangeParam === '1d' || rangeParam === 'yesterday') {
    bucketType = 'hour'; bucketCount = 24
  } else if (rangeParam === '2d' || rangeParam === '3d' || rangeParam === '5d') {
    bucketType = 'day'; bucketCount = Math.max(2, rangeDays)
  } else if (rangeParam === '7d') {
    bucketType = 'day'; bucketCount = 7
  } else if (rangeParam === '1m') {
    bucketType = 'day'; bucketCount = 30
  } else if (rangeParam === '3m') {
    bucketType = 'week'; bucketCount = 13
  } else if (rangeParam === '6m') {
    bucketType = 'month'; bucketCount = 6
  } else if (rangeParam === '1y') {
    bucketType = 'month'; bucketCount = 12
  } else if (rangeParam === 'custom') {
    if (rangeDays <= 1) {
      bucketType = 'hour'; bucketCount = 24
    } else if (rangeDays <= 7) {
      bucketType = 'day'; bucketCount = rangeDays
    } else if (rangeDays <= 90) {
      bucketType = 'week'; bucketCount = Math.ceil(rangeDays / 7)
    } else if (rangeDays <= 720) {
      bucketType = 'month'; bucketCount = Math.ceil(rangeDays / 30)
    } else {
      bucketType = 'month'; bucketCount = 24
    }
  }

  // ─── §VALIDATE-BUCKET-INDEX-AGAINST-COUNT ─────────────────────────
  if (bucketIndex >= bucketCount) {
    throw new BreakdownValidationError('bucketIndex out of range')
  }

  // ─── §SERVER-DERIVED-BUCKET-BOUNDARIES ────────────────────────────
  const buckets: Bucket[] = computeBuckets(rangeStart, rangeEnd, bucketType, bucketCount)
  const bucket: Bucket = buckets[bucketIndex]
  const bucketStart: Date = bucket.start
  const bucketEnd: Date = bucket.end

  // ─── §SELF-CONTAINED-QUERIES ──────────────────────────────────────
  // §FIX-FINDING-1: Use HALF-OPEN interval [bucketStart, bucketEnd) — matching
  // the dashboard route's in-memory filter (line 337: >= bucketStart && < bucketEnd).
  // The previous `lte: bucketEnd` could double-count records exactly at bucket
  // boundaries (where bucket[N].end === bucket[N+1].start).
  // §FIX-FINDING-2: REMOVED take: 200 / take: 100 caps. The dashboard route
  // fetches ALL invoices/transactions in range with NO cap. Keeping caps here
  // would cause breakdown summary ≠ dashboard bucket summary for high-volume
  // buckets (>200 invoices or >100 expense transactions). The endpoint is
  // already scoped to one bucket + one business, so the query is bounded by
  // the bucket's time window, not an arbitrary row count.
  const [bucketInvoices, bucketExpenseTxns] = await Promise.all([
    db.invoice.findMany({
      where: {
        businessId,
        type: { in: [...REVENUE_INVOICE_TYPES] },
        status: { not: 'void' },
        createdAt: { gte: bucketStart, lt: bucketEnd },
      },
      include: {
        party: { select: { id: true, name: true } },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                purchasePrice: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    }),
    db.transaction.findMany({
      where: {
        businessId,
        createdAt: { gte: bucketStart, lt: bucketEnd },
        OR: [
          { transactionSubtype: 'operating_expense' },
          {
            transactionSubtype: null,
            type: { in: [...EXPENSE_TYPES] },
            invoiceId: null,
          },
        ],
      },
      orderBy: { createdAt: 'desc' },
    }),
  ])

  // ─── §BUILD-BREAKDOWN ─────────────────────────────────────────────

  // §REVENUE-SOURCES
  const revenueSources = bucketInvoices.map((inv) => {
    const subtotal = num(inv.subtotal)
    const discountAmount = num(inv.discountAmount)
    const netRevenueContribution = subtotal - discountAmount
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      partyId: inv.partyId,
      partyName: inv.party?.name ?? null,
      netRevenueContribution,
      grandTotal: num(inv.grandTotal),
      date: inv.createdAt.toISOString(),
    }
  })

  // §COGS-SOURCES
  let snapshotItems = 0
  let fallbackItems = 0
  const cogsSources: Array<{
    productId: string
    productName: string
    quantitySold: number
    historicalCostPerUnit: number | null
    fallbackCostPerUnit: number | null
    totalCogsContribution: number
    invoiceId: string
    invoiceNumber: string
    isApproximate: boolean
  }> = []
  for (const inv of bucketInvoices) {
    for (const item of inv.items) {
      const quantitySold = item.quantity
      const snapshot = item.purchasePriceSnapshot != null ? num(item.purchasePriceSnapshot) : null
      const fallback = item.product ? num(item.product.purchasePrice) : null
      const costPerUnit = snapshot != null ? snapshot : (fallback ?? 0)
      const isApproximate = snapshot == null
      const totalCogsContribution = quantitySold * costPerUnit
      if (isApproximate) {
        fallbackItems++
      } else {
        snapshotItems++
      }
      if (!item.productId) continue
      cogsSources.push({
        productId: item.productId,
        productName: item.product?.name ?? item.name,
        quantitySold,
        historicalCostPerUnit: snapshot,
        fallbackCostPerUnit: fallback,
        totalCogsContribution,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        isApproximate,
      })
    }
  }

  // §OPERATING-EXPENSE-SOURCES: authoritative + legacy SEPARATE (never merged)
  const authoritativeExpenses = bucketExpenseTxns
    .filter((t) => t.transactionSubtype === 'operating_expense')
    .map((t) => ({
      transactionId: t.id,
      category: t.category ?? 'Uncategorized',
      description: t.description ?? '',
      amount: num(t.amount),
      date: t.createdAt.toISOString(),
      isAuthoritative: true as const,
    }))
  const legacyExpenses = bucketExpenseTxns
    .filter(
      (t) =>
        t.transactionSubtype == null &&
        EXPENSE_TYPES.includes(t.type as any) &&
        !t.invoiceId,
    )
    .map((t) => ({
      transactionId: t.id,
      category: t.category ?? 'Uncategorized',
      description: t.description ?? '',
      amount: num(t.amount),
      date: t.createdAt.toISOString(),
      isAuthoritative: false as const,
      classificationNote:
        'Unclassified (pre-Step 3.1) — not included in authoritative Net Profit',
    }))

  // §SUMMARY-TOTALS — server-authoritative, recomputed from REAL records
  const netRevenue = revenueSources.reduce(
    (s, r) => s + r.netRevenueContribution,
    0,
  )
  const cogs = cogsSources.reduce((s, c) => s + c.totalCogsContribution, 0)
  const grossProfit = netRevenue - cogs
  const operatingExpense = authoritativeExpenses.reduce((s, e) => s + e.amount, 0)
  const legacyOpEx = legacyExpenses.reduce((s, e) => s + e.amount, 0)
  const netProfit = grossProfit - operatingExpense

  // §PERIOD-LABEL — server-derived, IST timezone
  const IST_TZ = 'Asia/Kolkata'
  let fullLabel: string
  try {
    if (bucketType === 'hour') {
      const endHour = new Date(bucketStart.getTime() + 60 * 60 * 1000)
      const dateStr = bucketStart.toLocaleDateString('en-US', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ,
      })
      const startTime = bucketStart.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ,
      })
      const endTime = endHour.toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ,
      })
      fullLabel = `${dateStr}, ${startTime} – ${endTime}`
    } else if (bucketType === 'week') {
      const endWeek = new Date(bucketStart.getTime() + 7 * 24 * 60 * 60 * 1000)
      const startStr = bucketStart.toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ,
      })
      const endStr = endWeek.toLocaleDateString('en-US', {
        day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ,
      })
      fullLabel = `${startStr} – ${endStr}`
    } else if (bucketType === 'month') {
      fullLabel = bucketStart.toLocaleDateString('en-US', {
        month: 'long', year: 'numeric', timeZone: IST_TZ,
      })
    } else {
      fullLabel = bucketStart.toLocaleDateString('en-US', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ,
      })
    }
  } catch {
    fullLabel = bucket.label
  }

  return {
    period: {
      label: bucket.label,
      fullLabel,
      startISO: bucketStart.toISOString(),
      endISO: bucketEnd.toISOString(),
      bucketType,
    },
    summary: {
      netRevenue,
      cogs,
      grossProfit,
      operatingExpense,
      legacyOpEx,
      netProfit,
    },
    breakdown: {
      revenueSources,
      cogsSources,
      expenseSources: {
        authoritative: authoritativeExpenses,
        legacy: legacyExpenses,
      },
    },
    cogsAccuracy: {
      snapshotItems,
      fallbackItems,
      isApproximate: fallbackItems > 0,
    },
  }
}
