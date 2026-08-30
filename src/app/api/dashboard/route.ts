import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { computeRangeBounds, calendarMonthStartIST, calendarTodayStartIST, computeBuckets, type DashboardRange } from '@/lib/date-ranges'

// GET /api/dashboard?range=1d|2d|3d|5d|7d|1m|3m|6m|1y|custom&startDate=...&endDate=...
//
// §PERFORMANCE: This route uses SQL aggregation (Prisma `aggregate`/`groupBy`) and
// date-filtered queries instead of loading entire tables into memory. This ensures
// the dashboard scales to thousands of invoices/transactions without 504 timeouts.
//
// §VOID-EXCLUSION: Voided invoices (status='void') are excluded from all financial
// calculations (sales, revenue, trends, top products, etc.).
//
// §SHARED-DATE-RANGES: Date boundary computation is delegated to
// `src/lib/date-ranges.ts` — the single source of truth shared with History and
// Reports APIs. This guarantees Dashboard, History, and Reports compute IDENTICAL
// date windows for any given range, eliminating the Phase 4 D1 date-context bug
// where Dashboard "3 Days" → History "This Week" (different window).
//
// §IST-TIMEZONE-FIX: Prior to this commit, the Dashboard API computed date
// boundaries using `new Date().setHours(0,0,0,0)` which uses the SERVER's local
// timezone (UTC on Vercel). This caused "Today" to mean UTC-midnight-to-UTC-now,
// which is wrong for IST users (UTC midnight = 05:30 IST, so a sale at 4 AM IST
// on Aug 26 was counted under Aug 25 "Today"). The shared utility now computes
// IST-aligned boundaries (Asia/Kolkata, UTC+5:30) so "Today" means IST today
// 00:00:00 → 23:59:59.999 IST. This is a behavior change but fixes a demonstrable
// timezone bug the user explicitly flagged.

// §VERCEL-LIMIT: Allow up to 30s for large datasets (Hobby plan default is 10s).
export const maxDuration = 30
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const rangeParam = (searchParams.get('range') || '7d') as DashboardRange
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const bizWhere = { businessId: business.id }

    // §SHARED-BOUNDARIES: Delegate to computeRangeBounds — single source of truth.
    // Returns null only for 'custom' with missing/invalid customStart/customEnd;
    // in that case we fall back to '7d' rolling (matching pre-fix default behavior).
    const bounds = computeRangeBounds(rangeParam, startDate, endDate)
    const rangeStart: Date = bounds?.start ?? computeRangeBounds('7d')!.start
    const rangeEnd: Date = bounds?.end ?? computeRangeBounds('7d')!.end

    // §BUCKET-CONFIG: Chart bucket sizing based on range duration.
    // Kept here (not in date-ranges.ts) because bucketing is a Dashboard chart
    // concern, not a date-boundary concern.
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
      // Custom: choose bucket type based on span
      if (rangeDays <= 1) { bucketType = 'hour'; bucketCount = 24 }
      else if (rangeDays <= 90) { bucketType = 'day'; bucketCount = rangeDays }
      else { bucketType = 'month'; bucketCount = Math.ceil(rangeDays / 30) }
    }

    // §DECIMAL-FIX: Prisma Decimal fields return as string. Convert to Number.
    const num = (v: any): number => Number(v) || 0

    // §PERFORMANCE: Reduce query count from 21 → 9 to minimize Neon PostgreSQL
    // network round-trips. Each Prisma query pays ~300-500ms of network latency
    // through PgBouncer, so 21 queries took ~10-14s. By combining aggregates
    // into single raw SQL queries with CASE WHEN, we cut the round-trips to ~9,
    // reducing response time to ~2-3s for small datasets.
    // §P16-STEP1-A: Authoritative revenue scope = sales + retail invoices only.
    // Purchase invoices (inventory asset movement) and challan invoices (delivery
    // notes) MUST NOT contribute to revenue, sales, top buyers, top products,
    // top categories, chart trend, or any other revenue-oriented aggregate.
    // This aligns Dashboard with Reports P&L (`type: { in: ['sales','retail'] }`).
    const voidExclude = { ...bizWhere, status: { not: 'void' }, type: { in: ['sales', 'retail'] } }
    // §IST-TODAY-MONTH: Use IST-aligned boundaries for today/monthStart.
    //
    // §CALENDAR-MONTH-FIX (pre-commit FIX 1): `monthStart` uses CALENDAR
    // month-to-date (1st of current IST month → now), NOT rolling 1 month.
    // The previous commit `94647ee` accidentally used `computeRangeBounds('1m')`
    // here — that gave ROLLING 1 month (same day last month → now), which
    // changed `monthlyRevenue` semantics from calendar-month-to-date to
    // rolling-month. This restores the original `a0dfe64` semantics
    // (which used `new Date(); setDate(1); setHours(0,0,0,0)`) but with
    // IST-safe boundaries (the old `setHours(0,0,0,0)` gave UTC midnight =
    // 05:30 IST — wrong for Indian users).
    //
    // §SEPARATE-FROM-1M: `computeRangeBounds('1m')` is ROLLING and is used
    // by the dashboard card click (Total Sales/Collection with "1 Month"
    // selected means "rolling 1 month"). But `monthlyRevenue` field is a
    // SEPARATE concept — "revenue this calendar month" — which is what the
    // "Monthly Revenue" card label says. Do NOT conflate the two.
    const todayBounds = calendarTodayStartIST()
    const monthStart = calendarMonthStartIST()
    const rangeTxnWhere = { ...bizWhere, createdAt: { gte: rangeStart, lte: rangeEnd } }

    // §PARALLEL-ALL: ALL queries run in a SINGLE Promise.all — including the
    // raw SQL aggregates. Previously the 4 raw SQL queries ran sequentially
    // before the Promise.all, adding ~2s of serial latency. Running all 8
    // queries in parallel reduces total time to the slowest single query.
    const [
      partyRow, allProducts, invoiceRow, txnRow,
      topDebtorsRaw, recentTransactions,
      rangeInvoicesForTrend, rangeTxnsForTrend,
    ] = await Promise.all([
      // §COMBINED-PARTY: 1 raw SQL query replaces 4 separate Prisma queries
      db.$queryRaw<Array<{
        total_count: bigint; receivable_sum: bigint; payable_sum: bigint; overdue_count: bigint;
        grade_a: bigint; grade_b: bigint; grade_c: bigint; grade_d: bigint; grade_e: bigint
      }>>`
        SELECT
          COUNT(*) AS total_count,
          COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS receivable_sum,
          COALESCE(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END), 0) AS payable_sum,
          COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END) AS overdue_count,
          COUNT(CASE WHEN "qualityGrade" = 'A' THEN 1 END) AS grade_a,
          COUNT(CASE WHEN "qualityGrade" = 'B' THEN 1 END) AS grade_b,
          COUNT(CASE WHEN "qualityGrade" = 'C' THEN 1 END) AS grade_c,
          COUNT(CASE WHEN "qualityGrade" = 'D' THEN 1 END) AS grade_d,
          COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END) AS grade_e
        FROM "Party" WHERE "businessId" = ${business.id}
      `,
      // §COMBINED-PRODUCT: 1 findMany replaces 3 queries (count, lowStock, inventory)
      db.product.findMany({
        where: bizWhere,
        select: { id: true, name: true, category: true, stock: true, purchasePrice: true, lowStockThreshold: true },
      }),
      // §COMBINED-INVOICE: 1 raw SQL query replaces 5 separate Prisma queries
      // §NET-REVENUE: Added range_net_revenue + range_discount columns to support
      // the Total Revenue card showing a value DIFFERENT from Total Sales.
      //   range_sales        = SUM(grandTotal) — what customer paid (incl. GST, after discount)
      //   range_net_revenue  = SUM(subtotal - discountAmount) — pre-tax, post-discount
      // Total Sales card shows range_sales; Total Revenue card shows range_net_revenue.
      db.$queryRaw<Array<{
        today_sales: bigint; monthly_sales: bigint; range_sales: bigint;
        range_net_revenue: bigint; range_discount: bigint;
        total_count: bigint; paid_count: bigint
      }>>`
        SELECT
          COALESCE(SUM(CASE WHEN "createdAt" >= ${todayBounds} THEN "grandTotal" ELSE 0 END), 0) AS today_sales,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${monthStart} THEN "grandTotal" ELSE 0 END), 0) AS monthly_sales,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd} THEN "grandTotal" ELSE 0 END), 0) AS range_sales,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd} THEN "subtotal" - "discountAmount" ELSE 0 END), 0) AS range_net_revenue,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd} THEN "discountAmount" ELSE 0 END), 0) AS range_discount,
          COUNT(*) AS total_count,
          COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count
        FROM "Invoice"
        WHERE "businessId" = ${business.id} AND status != 'void'
          AND "type" IN ('sales', 'retail')
      `,
      // §COMBINED-TRANSACTION: 1 raw SQL query replaces 2 separate Prisma queries
      // §P16-STEP1-B: expense_sum now excludes invoice-linked transaction rows
      // (purchase side-effects `type='debit'` with `invoiceId IS NOT NULL`, void
      // reversals `type='debit'` with `invoiceId IS NOT NULL`). These are NOT
      // operating expenses — purchase cost flows through COGS at sale time, and
      // void reversals are contra entries. collection_sum is intentionally NOT
      // filtered (keeps all `type='credit'` rows — manual cash-in + online order
      // collections). The online-COD edge case (credit sale, not cash received)
      // will be resolved in Step 2 via transactionSubtype discriminator.
      // §P16-STEP2: Hybrid subtype + invoiceId filter. Per user instruction:
      //   - Rows with subtype='operating_expense' → always counted (authoritative)
      //   - Rows with subtype IN (purchase_inventory_*, supplier_payment, void_reversal,
      //     customer_refund, ocr_purchase, manual_cash_out, customer_collection, etc.)
      //     → explicitly EXCLUDED from OpEx (they have known non-OpEx meaning)
      //   - Rows with subtype IS NULL (legacy or ambiguous) → fall back to Step 1
      //     heuristic: type IN (debit/expense/purchase) AND invoiceId IS NULL.
      //   This ensures new classified rows use authoritative semantics while legacy
      //   rows retain Step 1 behavior (no regression).
      db.$queryRaw<Array<{
        collection_sum: bigint; expense_sum: bigint
      }>>`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS collection_sum,
          COALESCE(SUM(CASE
            WHEN "transactionSubtype" = 'operating_expense' THEN amount
            WHEN "transactionSubtype" IS NOT NULL THEN 0
            ELSE CASE WHEN type IN ('debit', 'expense', 'purchase') AND "invoiceId" IS NULL THEN amount ELSE 0 END
          END), 0) AS expense_sum
        FROM "Transaction"
        WHERE "businessId" = ${business.id} AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
      `,
      // §LIST-QUERIES: Top debtors + recent transactions + chart trend data
      db.party.findMany({ where: { ...bizWhere, balance: { gt: 0 } }, select: { id: true, name: true, balance: true, qualityGrade: true }, orderBy: { balance: 'desc' }, take: 5 }),
      db.transaction.findMany({ where: bizWhere, select: { id: true, type: true, amount: true, createdAt: true, balanceAfter: true, partyId: true, invoiceId: true, party: { select: { id: true, name: true, balance: true, openingBalance: true } } }, orderBy: { createdAt: 'desc' }, take: 8 }),
      db.invoice.findMany({ where: { ...voidExclude, createdAt: { gte: rangeStart, lte: rangeEnd } }, select: { grandTotal: true, createdAt: true, paymentMode: true, partyId: true, party: { select: { name: true } }, items: { select: { productId: true, name: true, total: true, quantity: true } } }, orderBy: { createdAt: 'asc' } }),
      db.transaction.findMany({ where: rangeTxnWhere, select: { amount: true, createdAt: true, type: true, invoiceId: true, transactionSubtype: true }, orderBy: { createdAt: 'asc' } }),
    ])

    const p = partyRow[0]
    const inv = invoiceRow[0]
    const txn = txnRow[0]
    const partyCount = num(p?.total_count)
    const totalReceivable = num(p?.receivable_sum)
    const totalPayable = Math.abs(num(p?.payable_sum))
    const overdueCount = num(p?.overdue_count)
    const productCount = allProducts.length
    const lowStockCount = allProducts.filter(pr => pr.stock <= pr.lowStockThreshold).length
    const inventoryValue = allProducts.reduce((s, pr) => s + (pr.stock * num(pr.purchasePrice)), 0)
    const productMap = new Map(allProducts.map(pr => [pr.id, pr]))
    const topDebtors = topDebtorsRaw.map((d) => ({ id: d.id, name: d.name, balance: num(d.balance), grade: d.qualityGrade }))
    const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
      grade,
      count: num(grade === 'A' ? p?.grade_a : grade === 'B' ? p?.grade_b : grade === 'C' ? p?.grade_c : grade === 'D' ? p?.grade_d : p?.grade_e),
    }))
    const todaySales = num(inv?.today_sales)
    const monthlyRevenue = num(inv?.monthly_sales)
    const rangeSales = num(inv?.range_sales)
    // §NET-REVENUE: Pre-tax, post-discount — different from rangeSales (which
    // includes GST and is net of discounts). Used by Total Revenue card.
    const rangeNetRevenue = num(inv?.range_net_revenue)
    const rangeDiscount = num(inv?.range_discount)
    const invoiceCount = num(inv?.total_count)
    const rangeCollection = num(txn?.collection_sum)
    const rangeExpense = num(txn?.expense_sum)
    const paidCount = num(inv?.paid_count)
    const paidRatio = invoiceCount > 0 ? paidCount / invoiceCount : 1
    const nonOverdueRatio = 1 - overdueCount / Math.max(partyCount, 1)
    const stockBonus = lowStockCount === 0 ? 20 : 10
    const healthScore = Math.round(
      Math.max(0, Math.min(100, paidRatio * 50 + nonOverdueRatio * 30 + stockBonus))
    )
    // §HEALTH-DRILL-DOWN: Decompose health score into its 3 components so the
    // Business Health card click can show users WHAT contributes to the score
    // and WHAT to improve. Used by Reports P&L view's new "Health Breakdown"
    // section (Phase 4 D4 fix — minimal addition, no new view/route).
    const healthBreakdown = {
      score: healthScore,
      paidRatio: Math.round(paidRatio * 100) / 100,           // 0..1 → 50 points max
      nonOverdueRatio: Math.round(nonOverdueRatio * 100) / 100, // 0..1 → 30 points max
      lowStockCount,
      stockBonus,                                                // 10 or 20
      components: [
        {
          id: 'paid',
          label: 'Invoice Payment Rate',
          value: Math.round(paidRatio * 50 * 10) / 10,
          max: 50,
          hint: `${Math.round(paidRatio * 100)}% of invoices (${paidCount}/${invoiceCount}) are paid`,
        },
        {
          id: 'overdue',
          label: 'Customer Non-Overdue Rate',
          value: Math.round(nonOverdueRatio * 30 * 10) / 10,
          max: 30,
          hint: `${overdueCount} of ${partyCount} customers are overdue (Grade E)`,
        },
        {
          id: 'stock',
          label: 'Stock Health',
          value: stockBonus,
          max: 20,
          hint: lowStockCount === 0 ? 'No low-stock items' : `${lowStockCount} products below threshold`,
        },
      ],
    }

    // §FIX-2B: Use shared computeBuckets() from date-ranges.ts — eliminates the
    // 30-minute IST truncation bug that occurred when setUTCHours(18,0,0,0)
    // truncated rangeStart from 18:30 UTC (00:00 IST) to 18:00 UTC (23:30 IST).
    // Now uses time arithmetic (getTime() + i * unitMs) — exact IST boundaries.
    const salesTrend: Array<{ date: string; fullDate?: string; revenue: number; expense: number; profit: number; collected: number; creditGiven: number }> = []
    const EXPENSE_TYPES = ['debit', 'expense', 'purchase'] as const
    const buckets = computeBuckets(rangeStart, rangeEnd, bucketType, bucketCount)
    for (const { start: bucketStart, end: bucketEnd, label } of buckets) {
      const dayInvoices = rangeInvoicesForTrend.filter(
        (inv) => new Date(inv.createdAt) >= bucketStart && new Date(inv.createdAt) < bucketEnd
      )
      const revenue = dayInvoices.reduce((s, inv) => s + num(inv.grandTotal), 0)
      const dayTxns = rangeTxnsForTrend.filter(
        (t) => new Date(t.createdAt) >= bucketStart && new Date(t.createdAt) < bucketEnd
      )
      // §FIX-1: Chart expense now matches card expense scope exactly.
      // Card SQL: type IN ('debit', 'expense', 'purchase') AND invoiceId IS NULL
      // Chart JS: was type === 'debit' only — missed 'expense' and 'purchase'.
      // §P16-STEP1-B: Also exclude invoice-linked transactions (purchase side-effects,
      // void reversals) — these are NOT operating expenses. Matches card SQL.
      // §P16-STEP2: Hybrid subtype filter — mirrors the card SQL logic.
      //   - subtype='operating_expense' → counted (authoritative)
      //   - subtype is non-NULL and != 'operating_expense' → excluded (known non-OpEx)
      //   - subtype IS NULL (legacy) → fall back to Step 1 heuristic
      const isOperatingExpense = (t: any): boolean => {
        if (t.transactionSubtype === 'operating_expense') return true
        if (t.transactionSubtype != null) return false  // any other non-null subtype → excluded
        // legacy NULL-subtype row: apply Step 1 heuristic
        return EXPENSE_TYPES.includes(t.type as any) && !t.invoiceId
      }
      const expense = dayTxns.filter((t) => isOperatingExpense(t)).reduce((s, t) => s + num(t.amount), 0)
      const collected = dayTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + num(t.amount), 0)
      const creditGiven = dayInvoices
        .filter((inv) => inv.paymentMode === 'credit')
        .reduce((s, inv) => s + num(inv.grandTotal), 0)

      salesTrend.push({
        date: label,
        fullDate: bucketStart.toISOString(),
        revenue,
        expense,
        profit: revenue - expense,
        collected,
        creditGiven,
      })
    }

    // §TOP-DATA: Top products/categories/buyers computed from rangeInvoicesForTrend
    // (which was already fetched in Promise.all). Uses productMap built from
    // allProducts (also already fetched) — no additional query needed.
    // Previously this ran a SEQUENTIAL db.product.findMany (productsForItems)
    // after the Promise.all, adding ~500ms latency.
    // Category sales
    const categorySales: Record<string, number> = {}
    const productSales: Record<string, number> = {}
    const productUnits: Record<string, { name: string; units: number; revenue: number }> = {}
    rangeInvoicesForTrend.forEach((inv) => {
      inv.items.forEach((item) => {
        const product = item.productId ? productMap.get(item.productId) : null
        const cat = product?.category || 'Uncategorized'
        categorySales[cat] = (categorySales[cat] || 0) + num(item.total)
        const pname = product?.name || item.name
        if (product) {
          productSales[pname] = (productSales[pname] || 0) + num(item.total)
        }
        if (!productUnits[pname]) productUnits[pname] = { name: pname, units: 0, revenue: 0 }
        productUnits[pname].units += item.quantity
        productUnits[pname].revenue += num(item.total)
      })
    })

    const topCategories = Object.entries(categorySales)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
    const topProductsBySales = Object.entries(productSales)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
    const topProductsByUnits = Object.values(productUnits)
      .sort((a, b) => b.units - a.units)
      .slice(0, 10)
      .map((p) => ({ name: p.name, value: p.units, revenue: p.revenue }))

    // Top buyers
    const buyerSales: Record<string, { id: string; name: string; total: number }> = {}
    rangeInvoicesForTrend.forEach((inv) => {
      if (inv.partyId && inv.party) {
        if (!buyerSales[inv.partyId]) buyerSales[inv.partyId] = { id: inv.partyId, name: inv.party.name, total: 0 }
        buyerSales[inv.partyId].total += num(inv.grandTotal)
      }
    })
    const topBuyers = Object.values(buyerSales)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map((b) => ({ id: b.id, name: b.name, value: b.total }))

    // 11. Inventory trend (6 months — simplified, uses current inventory value)
    const inventoryTrend: Array<{ month: string; value: number }> = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date()
      d.setMonth(d.getMonth() - i)
      const trendValue = Math.max(0, inventoryValue - i * 500)
      inventoryTrend.push({
        month: d.toLocaleDateString('en-IN', { month: 'short' }),
        value: Math.round(trendValue),
      })
    }

    return NextResponse.json({
      totalReceivable,
      totalPayable,
      todaySales,
      monthlyRevenue,
      rangeSales,
      // §NET-REVENUE: Distinct from rangeSales. Used by Total Revenue card so
      // it shows a DIFFERENT number from Total Sales (which uses rangeSales).
      // rangeSales = SUM(grandTotal) — what customer paid (incl GST, after discount)
      // rangeNetRevenue = SUM(subtotal - discountAmount) — pre-tax, post-discount
      rangeNetRevenue,
      rangeDiscount,
      rangeCollection,
      rangeExpense,
      lowStockCount,
      healthScore,
      // §HEALTH-BREAKDOWN: Decomposed score components — used by Reports P&L
      // view's Health Breakdown section (Phase 4 D4 fix). Frontend reads
      // `healthBreakdown.components[]` to show what contributes to the score.
      healthBreakdown,
      topDebtors,
      // §DECIMAL-FIX-B: recentTransactions contains raw Prisma records with Decimal
      // `amount`/`balanceAfter` and nested `party.balance`/`party.openingBalance`.
      // topDebtors already uses num() so no conversion needed there.
      recentTransactions: serializeDecimals(recentTransactions),
      salesTrend,
      gradeDistribution: gradeDist,
      partyCount,
      productCount,
      invoiceCount,
      topCategories,
      topProductsBySales,
      topBuyers,
      topProductsByUnits,
      inventoryValue,
      inventoryTrend,
    })
  } catch (e) {
    return apiError(e, 'Dashboard request failed')
  }
}
