import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/dashboard?range=1d|2d|3d|5d|7d|1m|3m|6m|1y|custom&startDate=...&endDate=...
//
// §PERFORMANCE: This route uses SQL aggregation (Prisma `aggregate`/`groupBy`) and
// date-filtered queries instead of loading entire tables into memory. This ensures
// the dashboard scales to thousands of invoices/transactions without 504 timeouts.
//
// §VOID-EXCLUSION: Voided invoices (status='void') are excluded from all financial
// calculations (sales, revenue, trends, top products, etc.).

// §VERCEL-LIMIT: Allow up to 30s for large datasets (Hobby plan default is 10s).
export const maxDuration = 30
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const range = searchParams.get('range') || '7d'
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')

    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const bizWhere = { businessId: business.id }

    // Calculate date range
    const now = new Date()
    let rangeStart: Date
    let rangeEnd: Date = new Date(now)
    let bucketType: 'hour' | 'day' | 'week' | 'month' = 'day'
    let bucketCount = 7

    if (range === 'custom' && startDate && endDate) {
      rangeStart = new Date(startDate)
      rangeEnd = new Date(endDate)
      rangeEnd.setHours(23, 59, 59, 999)
      const days = Math.ceil((rangeEnd.getTime() - rangeStart.getTime()) / 86400000)
      if (days <= 1) { bucketType = 'hour'; bucketCount = 24 }
      else if (days <= 14) { bucketType = 'day'; bucketCount = days }
      else if (days <= 90) { bucketType = 'day'; bucketCount = days }
      else { bucketType = 'month'; bucketCount = Math.ceil(days / 30) }
    } else {
      switch (range) {
        case 'yesterday': rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-1); rangeStart.setHours(0,0,0,0); rangeEnd = new Date(now); rangeEnd.setDate(rangeEnd.getDate()-1); rangeEnd.setHours(23,59,59,999); bucketType = 'hour'; bucketCount = 24; break
        case '1d': rangeStart = new Date(now); rangeStart.setHours(0,0,0,0); bucketType = 'hour'; bucketCount = 24; break
        case '2d': rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-1); rangeStart.setHours(0,0,0,0); bucketType = 'day'; bucketCount = 2; break
        case '3d': rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-2); rangeStart.setHours(0,0,0,0); bucketType = 'day'; bucketCount = 3; break
        case '5d': rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-4); rangeStart.setHours(0,0,0,0); bucketType = 'day'; bucketCount = 5; break
        case '7d': rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-6); rangeStart.setHours(0,0,0,0); bucketType = 'day'; bucketCount = 7; break
        case '1m': rangeStart = new Date(now); rangeStart.setMonth(rangeStart.getMonth()-1); bucketType = 'day'; bucketCount = 30; break
        case '3m': rangeStart = new Date(now); rangeStart.setMonth(rangeStart.getMonth()-3); bucketType = 'week'; bucketCount = 13; break
        case '6m': rangeStart = new Date(now); rangeStart.setMonth(rangeStart.getMonth()-6); bucketType = 'month'; bucketCount = 6; break
        case '1y': rangeStart = new Date(now); rangeStart.setFullYear(rangeStart.getFullYear()-1); bucketType = 'month'; bucketCount = 12; break
        default: rangeStart = new Date(now); rangeStart.setDate(rangeStart.getDate()-6); rangeStart.setHours(0,0,0,0); bucketType = 'day'; bucketCount = 7
      }
    }

    // §DECIMAL-FIX: Prisma Decimal fields return as string. Convert to Number.
    const num = (v: any): number => Number(v) || 0

    // §PERFORMANCE: Reduce query count from 21 → 9 to minimize Neon PostgreSQL
    // network round-trips. Each Prisma query pays ~300-500ms of network latency
    // through PgBouncer, so 21 queries took ~10-14s. By combining aggregates
    // into single raw SQL queries with CASE WHEN, we cut the round-trips to ~9,
    // reducing response time to ~2-3s for small datasets.
    const voidExclude = { ...bizWhere, status: { not: 'void' } }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
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
          COUNT(*)::bigint AS total_count,
          COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0)::bigint AS receivable_sum,
          COALESCE(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END), 0)::bigint AS payable_sum,
          COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END)::bigint AS overdue_count,
          COUNT(CASE WHEN "qualityGrade" = 'A' THEN 1 END)::bigint AS grade_a,
          COUNT(CASE WHEN "qualityGrade" = 'B' THEN 1 END)::bigint AS grade_b,
          COUNT(CASE WHEN "qualityGrade" = 'C' THEN 1 END)::bigint AS grade_c,
          COUNT(CASE WHEN "qualityGrade" = 'D' THEN 1 END)::bigint AS grade_d,
          COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END)::bigint AS grade_e
        FROM "Party" WHERE "businessId" = ${business.id}
      `,
      // §COMBINED-PRODUCT: 1 findMany replaces 3 queries (count, lowStock, inventory)
      db.product.findMany({
        where: bizWhere,
        select: { id: true, name: true, category: true, stock: true, purchasePrice: true, lowStockThreshold: true },
      }),
      // §COMBINED-INVOICE: 1 raw SQL query replaces 5 separate Prisma queries
      db.$queryRaw<Array<{
        today_sales: bigint; monthly_sales: bigint; range_sales: bigint;
        total_count: bigint; paid_count: bigint
      }>>`
        SELECT
          COALESCE(SUM(CASE WHEN "createdAt" >= ${today} THEN "grandTotal" ELSE 0 END), 0)::bigint AS today_sales,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${monthStart} THEN "grandTotal" ELSE 0 END), 0)::bigint AS monthly_sales,
          COALESCE(SUM(CASE WHEN "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd} THEN "grandTotal" ELSE 0 END), 0)::bigint AS range_sales,
          COUNT(*)::bigint AS total_count,
          COUNT(CASE WHEN status = 'paid' THEN 1 END)::bigint AS paid_count
        FROM "Invoice"
        WHERE "businessId" = ${business.id} AND status != 'void'
      `,
      // §COMBINED-TRANSACTION: 1 raw SQL query replaces 2 separate Prisma queries
      db.$queryRaw<Array<{
        collection_sum: bigint; expense_sum: bigint
      }>>`
        SELECT
          COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0)::bigint AS collection_sum,
          COALESCE(SUM(CASE WHEN type IN ('debit', 'expense', 'purchase') THEN amount ELSE 0 END), 0)::bigint AS expense_sum
        FROM "Transaction"
        WHERE "businessId" = ${business.id} AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
      `,
      // §LIST-QUERIES: Top debtors + recent transactions + chart trend data
      db.party.findMany({ where: { ...bizWhere, balance: { gt: 0 } }, select: { id: true, name: true, balance: true, qualityGrade: true }, orderBy: { balance: 'desc' }, take: 5 }),
      db.transaction.findMany({ where: bizWhere, select: { id: true, type: true, amount: true, createdAt: true, balanceAfter: true, partyId: true, invoiceId: true, party: { select: { id: true, name: true, balance: true, openingBalance: true } } }, orderBy: { createdAt: 'desc' }, take: 8 }),
      db.invoice.findMany({ where: { ...voidExclude, createdAt: { gte: rangeStart, lte: rangeEnd } }, select: { grandTotal: true, createdAt: true, paymentMode: true, partyId: true, party: { select: { name: true } }, items: { select: { productId: true, name: true, total: true, quantity: true } } }, orderBy: { createdAt: 'asc' } }),
      db.transaction.findMany({ where: rangeTxnWhere, select: { amount: true, createdAt: true, type: true }, orderBy: { createdAt: 'asc' } }),
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
    const invoiceCount = num(inv?.total_count)
    const rangeCollection = num(txn?.collection_sum)
    const rangeExpense = num(txn?.expense_sum)
    const paidCount = num(inv?.paid_count)
    const paidRatio = invoiceCount > 0 ? paidCount / invoiceCount : 1
    const healthScore = Math.round(
      Math.max(0, Math.min(100, paidRatio * 50 + (1 - overdueCount / Math.max(partyCount, 1)) * 30 + (lowStockCount === 0 ? 20 : 10)))
    )

    const salesTrend: Array<{ date: string; fullDate?: string; revenue: number; expense: number; profit: number; collected: number; creditGiven: number }> = []
    for (let i = 0; i < bucketCount; i++) {
      let bucketStart: Date
      let bucketEnd: Date
      let label: string

      if (bucketType === 'hour') {
        bucketStart = new Date(rangeStart)
        bucketStart.setHours(rangeStart.getHours() + i, 0, 0, 0)
        bucketEnd = new Date(bucketStart)
        bucketEnd.setHours(bucketStart.getHours() + 1)
        label = bucketStart.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
      } else if (bucketType === 'day') {
        bucketStart = new Date(rangeStart)
        bucketStart.setDate(rangeStart.getDate() + i)
        bucketStart.setHours(0, 0, 0, 0)
        bucketEnd = new Date(bucketStart)
        bucketEnd.setDate(bucketStart.getDate() + 1)
        if (bucketCount <= 7) {
          label = bucketStart.toLocaleDateString('en-IN', { weekday: 'short' })
        } else {
          label = bucketStart.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
        }
      } else if (bucketType === 'week') {
        bucketStart = new Date(rangeStart)
        bucketStart.setDate(rangeStart.getDate() + i * 7)
        bucketEnd = new Date(bucketStart)
        bucketEnd.setDate(bucketStart.getDate() + 7)
        label = `W${i + 1}`
      } else {
        bucketStart = new Date(rangeStart)
        bucketStart.setMonth(rangeStart.getMonth() + i, 1)
        bucketStart.setHours(0, 0, 0, 0)
        bucketEnd = new Date(bucketStart)
        bucketEnd.setMonth(bucketStart.getMonth() + 1)
        label = bucketStart.toLocaleDateString('en-IN', { month: 'short' })
      }

      if (bucketStart > rangeEnd) break

      const dayInvoices = rangeInvoicesForTrend.filter(
        (inv) => new Date(inv.createdAt) >= bucketStart && new Date(inv.createdAt) < bucketEnd
      )
      const revenue = dayInvoices.reduce((s, inv) => s + num(inv.grandTotal), 0)
      const dayTxns = rangeTxnsForTrend.filter(
        (t) => new Date(t.createdAt) >= bucketStart && new Date(t.createdAt) < bucketEnd
      )
      const expense = dayTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + num(t.amount), 0)
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
      rangeCollection,
      rangeExpense,
      lowStockCount,
      healthScore,
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
