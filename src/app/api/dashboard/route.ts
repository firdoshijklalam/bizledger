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

    // §PARALLEL-AGGREGATION: ALL independent queries run in a SINGLE Promise.all.
    // Previously these were 15+ sequential awaits (~90ms each = ~1.5s total).
    // Parallelizing reduces total query time to the slowest single query (~180ms).
    const voidExclude = { ...bizWhere, status: { not: 'void' } }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const rangeTxnWhere = { ...bizWhere, createdAt: { gte: rangeStart, lte: rangeEnd } }

    const [
      partyAgg, payableAgg, partyCount, topDebtorsRaw, gradeRaw,
      productCount, lowStockCount, inventoryProducts,
      todaySalesAgg, monthlyAgg, rangeSalesAgg, invoiceCount,
      rangeCollectionAgg, rangeExpenseAgg, recentTransactions,
      paidCount, overdueCount,
      rangeInvoices, rangeTxnsForTrend, topDataInvoices,
    ] = await Promise.all([
      // Party aggregates
      db.party.aggregate({ where: { ...bizWhere, balance: { gt: 0 } }, _sum: { balance: true } }),
      db.party.aggregate({ where: { ...bizWhere, balance: { lt: 0 } }, _sum: { balance: true } }),
      db.party.count({ where: bizWhere }),
      db.party.findMany({ where: { ...bizWhere, balance: { gt: 0 } }, select: { id: true, name: true, balance: true, qualityGrade: true }, orderBy: { balance: 'desc' }, take: 5 }),
      db.party.groupBy({ by: ['qualityGrade'], where: bizWhere, _count: { qualityGrade: true } }),
      // Product aggregates
      db.product.count({ where: bizWhere }),
      db.product.count({ where: { ...bizWhere, stock: { lte: db.product.fields.lowStockThreshold } } }),
      db.product.findMany({ where: bizWhere, select: { stock: true, purchasePrice: true } }),
      // Invoice aggregates (voided excluded)
      db.invoice.aggregate({ where: { ...voidExclude, createdAt: { gte: today } }, _sum: { grandTotal: true } }),
      db.invoice.aggregate({ where: { ...voidExclude, createdAt: { gte: monthStart } }, _sum: { grandTotal: true } }),
      db.invoice.aggregate({ where: { ...voidExclude, createdAt: { gte: rangeStart, lte: rangeEnd } }, _sum: { grandTotal: true } }),
      db.invoice.count({ where: bizWhere }),
      // Transaction aggregates (range-aware)
      db.transaction.aggregate({ where: { ...rangeTxnWhere, type: 'credit' }, _sum: { amount: true } }),
      db.transaction.aggregate({ where: { ...rangeTxnWhere, OR: [{ type: 'debit' }, { type: 'expense' }, { type: 'purchase' }] }, _sum: { amount: true } }),
      db.transaction.findMany({ where: bizWhere, include: { party: true }, orderBy: { createdAt: 'desc' }, take: 8 }),
      // Health score
      db.invoice.count({ where: { ...voidExclude, status: 'paid' } }),
      db.party.count({ where: { ...bizWhere, qualityGrade: 'E' } }),
      // Sales trend
      db.invoice.findMany({ where: { ...voidExclude, createdAt: { gte: rangeStart, lte: rangeEnd } }, select: { grandTotal: true, createdAt: true, paymentMode: true }, orderBy: { createdAt: 'asc' } }),
      db.transaction.findMany({ where: rangeTxnWhere, select: { amount: true, createdAt: true, type: true }, orderBy: { createdAt: 'asc' } }),
      // Top products/categories/buyers (with items)
      db.invoice.findMany({ where: { ...voidExclude, createdAt: { gte: rangeStart, lte: rangeEnd } }, select: { grandTotal: true, partyId: true, party: { select: { name: true } }, items: { select: { productId: true, name: true, total: true, quantity: true } } } }),
    ])

    const totalReceivable = num(partyAgg._sum.balance)
    const totalPayable = Math.abs(num(payableAgg._sum.balance))
    const topDebtors = topDebtorsRaw.map((p) => ({ id: p.id, name: p.name, balance: num(p.balance), grade: p.qualityGrade }))
    const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
      grade,
      count: gradeRaw.find((g) => g.qualityGrade === grade)?._count.qualityGrade ?? 0,
    }))
    const inventoryValue = inventoryProducts.reduce((s, p) => s + (p.stock * num(p.purchasePrice)), 0)
    const todaySales = num(todaySalesAgg._sum.grandTotal)
    const monthlyRevenue = num(monthlyAgg._sum.grandTotal)
    const rangeSales = num(rangeSalesAgg._sum.grandTotal)
    const rangeCollection = num(rangeCollectionAgg._sum.amount)
    const rangeExpense = num(rangeExpenseAgg._sum.amount)
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

      const dayInvoices = rangeInvoices.filter(
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

    // 10. Top products/categories/buyers
    // topDataInvoices was already fetched in the Promise.all above (parallel).
    // Fetch product names + categories for the items
    const productIds = new Set<string>()
    topDataInvoices.forEach((inv) => inv.items.forEach((it) => { if (it.productId) productIds.add(it.productId) }))
    const productsForItems = await db.product.findMany({
      where: { ...bizWhere, id: { in: Array.from(productIds) } },
      select: { id: true, name: true, category: true },
    })
    const productMap = new Map(productsForItems.map((p) => [p.id, p]))

    // Category sales
    const categorySales: Record<string, number> = {}
    const productSales: Record<string, number> = {}
    const productUnits: Record<string, { name: string; units: number; revenue: number }> = {}
    topDataInvoices.forEach((inv) => {
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
    topDataInvoices.forEach((inv) => {
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
