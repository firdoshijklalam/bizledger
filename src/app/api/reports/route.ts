import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { parseReportDateRange } from '@/lib/reports-csv'
import { computeRangeBounds, type DashboardRange } from '@/lib/date-ranges'

// §VERCEL-LIMIT: Allow up to 30s for report aggregation across many invoices/items
export const maxDuration = 30

// GET /api/reports — aggregated report data
//
// §QUERY-PARAMS:
//   - ?start=YYYY-MM-DD&end=YYYY-MM-DD   (optional date range)
//   When provided, the report filters invoices + transactions by createdAt.
//   When omitted, the report includes all-time data (backward compatible).
//
// §PERFORMANCE-OPTIMIZATION:
// Previously this route loaded ALL invoices with `include: { party: true, items: true }`
// and aggregated in JavaScript. On production Neon PostgreSQL with real data volume,
// this took 10+ seconds (exceeding the frontend's 10s timeout, causing the Reports
// page to stay stuck on "Loading…" forever).
//
// The optimized version:
// 1. Uses Prisma `aggregate` for financial sums (revenue, discount, gst, expenses) —
//    pushes SUM to SQL instead of loading all records into memory.
// 2. Uses Prisma `groupBy` for GST rate-wise breakdown — pushes GROUP BY + SUM to SQL.
// 3. Uses `invoiceItem.findMany` with `select` for COGS — avoids loading full invoice
//    records with party relation just to access item.productId + item.quantity.
// 4. Uses `select` on all queries to minimize the payload transferred from DB.
// 5. Runs all independent queries in parallel via Promise.all.
// 6. Requires composite @@index([businessId, createdAt]) on Invoice + Transaction
//    (added to schema.prisma) so date-range queries use an index scan instead of a
//    full table scan.
//
// §ACCOUNTING-FIXES (preserved from previous version):
// 1. Voided invoices (status='void') are EXCLUDED from all sales/GST/revenue/profit
//    calculations. They remain in the invoice list for audit but contribute nothing.
// 2. COGS is calculated from ACTUAL purchase invoice items, not from transactions.
//    COGS = sum of (quantity × product.purchasePrice) for all items in non-voided
//    sales invoices. Uses SPECIFIC IDENTIFICATION costing method.
export async function GET(req: NextRequest) {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // §DATE-RANGE: Two paths for date filtering:
  //   (1) ?range=3d&startDate=...&endDate=...  ← NEW: dashboard-card click path.
  //       Uses `computeRangeBounds` from `src/lib/date-ranges.ts` — SAME utility
  //       the Dashboard API uses. Guarantees identical date boundaries.
  //   (2) ?start=YYYY-MM-DD&end=YYYY-MM-DD      ← LEGACY: Reports view's own
  //       P&L/GST filter path. Preserved for backward compatibility (existing
  //       callers, existing tests).
  // If both are provided, `range` takes precedence (dashboard click is the
  // user's most recent intent).
  const url = new URL(req.url)
  const rangeParam = url.searchParams.get('range') as DashboardRange | null
  let dateRange: { start: Date; end: Date } | null = null
  if (rangeParam) {
    // §SHARED-BOUNDARIES: Dashboard card click path. Computes the same start/end
    // as the Dashboard API — so a card showing "3 Days: ₹X" navigates to Reports
    // showing the EXACT same 3-day window.
    const startDate = url.searchParams.get('startDate')
    const endDate = url.searchParams.get('endDate')
    dateRange = computeRangeBounds(rangeParam, startDate, endDate)
    // §FALLBACK: If 'custom' range had invalid dates, fall back to legacy
    // ?start=&end= parsing (or null = all-time).
    if (!dateRange) {
      dateRange = parseReportDateRange(url.searchParams)
    }
  } else {
    // §LEGACY-PATH: Reports view's own P&L/GST filter sends ?start=&end=
    // YYYY-MM-DD strings. Preserved as-is for backward compatibility.
    dateRange = parseReportDateRange(url.searchParams)
  }

  // Build the createdAt filter object (undefined = no date filter = all-time)
  const createdAtFilter = dateRange
    ? { gte: dateRange.start, lte: dateRange.end }
    : undefined

  // §PARALLEL-QUERIES: Run all independent queries in parallel. Each query is
  // optimized to use `select` (not `include`) and fetch only the fields needed.
  const [
    parties,
    products,
    salesAgg,
    cogsItems,
    gstGroups,
    expenseAgg,
    authoritativeOpExAgg,  // §P16-VERIFY-3: only subtype='operating_expense'
    legacyOpExAgg,          // §P16-VERIFY-3: NULL-subtype + type IN (expense/debit) + invoiceId IS NULL
    recentInvoices,
  ] = await Promise.all([
    // 1. Parties — for partyLedger, outstanding, gradeDist (not date-filtered)
    db.party.findMany({
      where: { businessId: business.id },
      select: {
        id: true,
        name: true,
        type: true,
        qualityGrade: true,
        balance: true,
        phone: true,
      },
    }),

    // 2. Products — for stockAgeing + COGS productCostMap (not date-filtered)
    db.product.findMany({
      where: { businessId: business.id },
      select: {
        id: true,
        name: true,
        stock: true,
        purchasePrice: true,
        lowStockThreshold: true,
      },
    }),

    // 3. §DB-AGGREGATE: Sales invoice totals (revenue, discount, gst) —
    // pushes SUM to SQL instead of loading all invoices into memory.
    // Only non-voided sales/retail invoices contribute to revenue.
    db.invoice.aggregate({
      where: {
        businessId: business.id,
        status: { not: 'void' },
        type: { in: ['sales', 'retail'] },
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      _sum: {
        subtotal: true,
        discountAmount: true,
        gstAmount: true,
      },
    }),

    // 4. §COGS-ITEMS: Invoice items for COGS calculation — only fetches
    // productId + quantity (not the full invoice record with party relation).
    // This replaces the expensive `include: { items: true }` on all invoices.
    db.invoiceItem.findMany({
      where: {
        invoice: {
          businessId: business.id,
          status: { not: 'void' },
          type: { in: ['sales', 'retail'] },
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
      },
      select: {
        productId: true,
        quantity: true,
        // §P16-STEP2: Fetch purchasePriceSnapshot — historical cost at sale time.
        // Used for accurate COGS. NULL for legacy InvoiceItems (pre-Step-2 sales).
        purchasePriceSnapshot: true,
      },
    }),

    // 5. §GST-GROUPBY: GST breakdown by rate — pushes GROUP BY + SUM to SQL.
    // Only non-voided GST sales/retail invoices contribute to GST liability.
    db.invoiceItem.groupBy({
      by: ['gstRate'],
      where: {
        invoice: {
          businessId: business.id,
          status: { not: 'void' },
          isGst: true,
          type: { in: ['sales', 'retail'] },
          ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
        },
      },
      _sum: {
        total: true,
      },
    }),

    // 6. §DB-AGGREGATE: Indirect expenses — sum of expense + debit transactions.
    // Pushes SUM to SQL instead of loading all transactions into memory.
    // §P16-STEP1-C: Exclude invoice-linked transaction rows (purchase side-effects
    // created as `type='debit'` at `invoices/route.ts:363`, void reversals at
    // `invoices/[id]/route.ts:205`). These are NOT operating expenses — purchase
    // cost flows through COGS at sale time (line 218), and void reversals are
    // contra entries. Without this filter, purchase cost was double-counted:
    // once in indirectExpenses (at purchase) and again in COGS (at sale).
    // §P16-STEP2: Hybrid subtype + invoiceId filter (mirrors Dashboard logic).
    // §P16-VERIFY-3 (Option C): Separate authoritative OpEx from legacy unclassified.
    //   - authoritativeIndirectExpenses: only subtype='operating_expense' (currently ₹0)
    //   - legacyIndirectExpenses: NULL-subtype + type IN (expense/debit) + invoiceId IS NULL
    //   - indirectExpenses (total) = authoritative + legacy (for backward compat with P&L)
    //   Both are returned so the difference is NOT hidden.
    db.transaction.aggregate({
      where: {
        businessId: business.id,
        OR: [
          { transactionSubtype: 'operating_expense' },
          {
            transactionSubtype: null,
            type: { in: ['expense', 'debit'] },
            invoiceId: null,
          },
        ],
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      _sum: {
        amount: true,
      },
    }),

    // §P16-VERIFY-3: Authoritative OpEx — only subtype='operating_expense'
    db.transaction.aggregate({
      where: {
        businessId: business.id,
        transactionSubtype: 'operating_expense',
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      _sum: { amount: true },
    }),

    // §P16-VERIFY-3: Legacy unclassified OpEx — NULL-subtype + type IN (expense/debit) + invoiceId IS NULL
    db.transaction.aggregate({
      where: {
        businessId: business.id,
        transactionSubtype: null,
        type: { in: ['expense', 'debit'] },
        invoiceId: null,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      _sum: { amount: true },
    }),

    // 7. §RECENT-INVOICES: Recent 10 invoices (voided or not) for the list.
    // Uses `select` with nested `select` on party for minimal payload.
    db.invoice.findMany({
      where: {
        businessId: business.id,
        ...(createdAtFilter ? { createdAt: createdAtFilter } : {}),
      },
      select: {
        id: true,
        invoiceNumber: true,
        grandTotal: true,
        amountDue: true,
        status: true,
        createdAt: true,
        party: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ])

  // ─── Calculate financial totals from aggregate results ───────────────────

  // §REVENUE: Total Sales (subtotal) from non-voided sales/retail invoices.
  const totalRevenue = salesAgg._sum.subtotal?.toNumber() ?? 0
  const totalGst = salesAgg._sum.gstAmount?.toNumber() ?? 0
  const totalDiscount = salesAgg._sum.discountAmount?.toNumber() ?? 0

  // §NET-REVENUE: Total Sales (subtotal) − Discounts Given.
  const netRevenue = totalRevenue - totalDiscount

  // §COGS: Cost of Goods Sold = sum of (item.quantity × historical_cost_per_unit)
  // for all items in non-voided SALES invoices.
  // §P16-STEP2: Use purchasePriceSnapshot (captured at sale time) when available.
  // This ensures historical COGS is NOT distorted by later product price changes.
  // LEGACY FALLBACK: For InvoiceItems where snapshot IS NULL (pre-Step-2 sales),
  // fall back to current Product.purchasePrice. This is an approximation — the
  // historical cost may have been different. The `legacyCogsCount` metric below
  // tracks how many items used the fallback so the report can disclose this.
  const productCostMap = new Map(products.map((p) => [p.id, p.purchasePrice.toNumber()]))
  let legacyCogsCount = 0  // count of InvoiceItems that used LEGACY FALLBACK
  let snapshotCogsCount = 0  // count of InvoiceItems that used authoritative snapshot
  const cogs = cogsItems.reduce((s, it) => {
    // §P16-STEP2: prefer snapshot, fall back to current product.purchasePrice
    const snapshot = it.purchasePriceSnapshot?.toNumber()
    let costPerUnit: number
    if (snapshot != null && !Number.isNaN(snapshot)) {
      costPerUnit = snapshot
      snapshotCogsCount++
    } else if (it.productId) {
      // LEGACY FALLBACK: snapshot is NULL → use current product price (approximate)
      costPerUnit = productCostMap.get(it.productId) ?? 0
      legacyCogsCount++
    } else {
      costPerUnit = 0
    }
    return s + (it.quantity * costPerUnit)
  }, 0)

  // §INDIRECT-EXPENSES: Sum of expense + debit transactions (total = authoritative + legacy).
  const indirectExpenses = expenseAgg._sum.amount?.toNumber() ?? 0
  // §P16-VERIFY-3: Separate authoritative OpEx from legacy unclassified.
  const authoritativeIndirectExpenses = authoritativeOpExAgg._sum.amount?.toNumber() ?? 0
  const legacyIndirectExpenses = legacyOpExAgg._sum.amount?.toNumber() ?? 0
  const totalExpense = cogs + indirectExpenses

  // §PROFIT: Gross Profit = Net Revenue − COGS. Net Profit = Gross Profit − Authoritative Operating Expense.
  // §P16-STEP3.1-PARITY-FIX: Net Profit now uses authoritativeIndirectExpenses ONLY (not hybrid).
  // This aligns Reports with Dashboard: both use ONLY subtype='operating_expense' for Net Profit.
  // Legacy/unclassified expenses (legacyIndirectExpenses) are still exposed separately for disclosure
  // but do NOT silently reduce authoritative Net Profit.
  const grossProfit = netRevenue - cogs
  const netProfit = grossProfit - authoritativeIndirectExpenses

  // §GST-BREAKDOWN: Convert groupBy results to the same format as before.
  // gst = total × gstRate / 100 for each rate group.
  const gstBreakdown = gstGroups.map((g) => {
    const rate = g.gstRate.toNumber()
    const taxable = g._sum.total?.toNumber() ?? 0
    return {
      rate,
      taxable,
      gst: (taxable * rate) / 100,
    }
  })

  // §OUTSTANDING: Total receivable/payable from party balances (not date-filtered).
  const totalReceivable = parties
    .filter((p) => p.balance.toNumber() > 0)
    .reduce((s, p) => s + p.balance.toNumber(), 0)
  const totalPayable = parties
    .filter((p) => p.balance.toNumber() < 0)
    .reduce((s, p) => s + Math.abs(p.balance.toNumber()), 0)

  // §STOCK-AGEING: From products (not date-filtered).
  const stockAgeing = products.map((p) => ({
    name: p.name,
    stock: p.stock,
    value: p.stock * p.purchasePrice.toNumber(),
    threshold: p.lowStockThreshold,
    status: p.stock <= p.lowStockThreshold ? 'low' : p.stock <= p.lowStockThreshold * 2 ? 'medium' : 'good',
  }))

  // §GRADE-DISTRIBUTION: From parties (not date-filtered).
  const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
    grade,
    count: parties.filter((p) => p.qualityGrade === grade).length,
    balance: parties.filter((p) => p.qualityGrade === grade).reduce((s, p) => s + Math.max(0, p.balance.toNumber()), 0),
  }))

  // §PARTY-LEDGER: Summary of all parties.
  const partyLedger = parties.map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    grade: p.qualityGrade,
    balance: p.balance,
    phone: p.phone,
  }))

  return NextResponse.json({
    business,
    profitLoss: {
      revenue: totalRevenue,
      netRevenue,
      discount: totalDiscount,
      cogs,
      grossProfit,
      indirectExpenses,
      // §P16-VERIFY-3: OpEx breakdown — authoritative vs legacy unclassified.
      // authoritativeIndirectExpenses = only subtype='operating_expense' (currently ₹0)
      // legacyIndirectExpenses = NULL-subtype debits (ambiguous, not authoritative)
      // indirectExpenses = authoritative + legacy (total, for P&L backward compat)
      authoritativeIndirectExpenses,
      legacyIndirectExpenses,
      expense: totalExpense,
      netProfit,
      gst: totalGst,
      // §P16-STEP2: COGS accuracy disclosure — how many items used authoritative
      // snapshot vs LEGACY FALLBACK (current product price). Frontend can show
      // a warning if legacyCogsCount > 0 (historical COGS is approximate).
      cogsAccuracy: {
        snapshotItems: snapshotCogsCount,
        legacyFallbackItems: legacyCogsCount,
        isApproximate: legacyCogsCount > 0,
      },
    },
    gst: {
      totalGst,
      breakdown: gstBreakdown,
    },
    // §DECIMAL-FIX-B: partyLedger.balance and outstanding.receivables[].amount
    // are raw Prisma Decimals; recentInvoices.total/due are raw Prisma Decimals.
    // payables[].amount is already a number (Math.abs(...toNumber())) but
    // serializeDecimals is idempotent and leaves numbers as-is.
    partyLedger: serializeDecimals(partyLedger),
    outstanding: serializeDecimals({
      totalReceivable,
      totalPayable,
      receivables: parties.filter((p) => p.balance.toNumber() > 0).map((p) => ({ name: p.name, amount: p.balance, grade: p.qualityGrade })),
      payables: parties.filter((p) => p.balance.toNumber() < 0).map((p) => ({ name: p.name, amount: Math.abs(p.balance.toNumber()) })),
    }),
    stockAgeing,
    gradeDistribution: gradeDist,
    // §INVOICE-COUNT: Preserved as recentInvoices.length (≤10) for backward compat.
    // This field is in the response shape but not currently rendered in the UI.
    invoiceCount: recentInvoices.length,
    recentInvoices: serializeDecimals(recentInvoices.map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      party: i.party?.name || 'Walk-in',
      total: i.grandTotal,
      due: i.amountDue,
      status: i.status,
      date: i.createdAt,
    }))),
  })
}
