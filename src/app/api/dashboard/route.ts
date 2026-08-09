import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/dashboard?range=1d|2d|3d|5d|7d|1m|3m|6m|1y|custom&startDate=...&endDate=...
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') || '7d'
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json(null)

  const parties = await db.party.findMany({ where: { businessId: business.id } })
  const products = await db.product.findMany({ where: { businessId: business.id } })
  const invoices = await db.invoice.findMany({
    where: { businessId: business.id },
    include: { party: true, items: true },
    orderBy: { createdAt: 'desc' },
  })
  const allTransactions = await db.transaction.findMany({
    where: { businessId: business.id },
    include: { party: true },
    orderBy: { createdAt: 'desc' },
  })
  const transactions = allTransactions.slice(0, 8)

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

  const totalReceivable = parties.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0)
  const totalPayable = parties.filter((p) => p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todaySales = invoices.filter((i) => new Date(i.createdAt) >= today).reduce((s, i) => s + i.grandTotal, 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthlyRevenue = invoices.filter((i) => new Date(i.createdAt) >= monthStart).reduce((s, i) => s + i.grandTotal, 0)

  // §LOCALIZED-CARD-FILTERS: range-aware totals for the time-dependent metric
  // cards (Sales, Collection, Expense). Each card fetches /api/dashboard with
  // its own range and reads these fields. Computed over [rangeStart, rangeEnd].
  const rangeInvoices = invoices.filter((i) => {
    const d = new Date(i.createdAt)
    return d >= rangeStart && d <= rangeEnd
  })
  const rangeTransactions = allTransactions.filter((t) => {
    const d = new Date(t.createdAt)
    return d >= rangeStart && d <= rangeEnd
  })
  const rangeSales = rangeInvoices.reduce((s, i) => s + i.grandTotal, 0)
  const rangeCollection = rangeTransactions.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const rangeExpense = rangeTransactions.filter((t) => t.type === 'debit' || t.type === 'expense' || t.type === 'purchase').reduce((s, t) => s + t.amount, 0)

  const lowStockCount = products.filter((p) => p.stock <= p.lowStockThreshold).length

  const paidInvoices = invoices.filter((i) => i.status === 'paid').length
  const paidRatio = invoices.length ? paidInvoices / invoices.length : 1
  const overdue = parties.filter((p) => p.qualityGrade === 'E').length
  const healthScore = Math.round(
    Math.max(0, Math.min(100, paidRatio * 50 + (1 - overdue / Math.max(parties.length, 1)) * 30 + (lowStockCount === 0 ? 20 : 10)))
  )

  const topDebtors = parties
    .filter((p) => p.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, balance: p.balance, grade: p.qualityGrade }))

  const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
    grade,
    count: parties.filter((p) => p.qualityGrade === grade).length,
  }))

  // Generate dynamic time buckets (PRD P4-1.2)
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

    const dayInvoices = invoices.filter(
      (inv) => new Date(inv.createdAt) >= bucketStart && new Date(inv.createdAt) < bucketEnd
    )
    const revenue = dayInvoices.reduce((s, inv) => s + inv.grandTotal, 0)
    const dayTxns = allTransactions.filter(
      (t) => new Date(t.createdAt) >= bucketStart && new Date(t.createdAt) < bucketEnd
    )
    const expense = dayTxns.filter((t) => t.type === 'debit').reduce((s, t) => s + t.amount, 0)

    // Collections vs New Credit (PRD P4-3.1)
    const collected = dayTxns.filter((t) => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
    const creditGiven = dayInvoices
      .filter((inv) => inv.paymentMode === 'credit')
      .reduce((s, inv) => s + inv.grandTotal, 0)

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

  // Top Category & Product Sales (PRD P4-3.2)
  const categorySales: Record<string, number> = {}
  const productSales: Record<string, number> = {}
  invoices.forEach((inv) => {
    inv.items?.forEach((item) => {
      const product = products.find((p) => p.id === item.productId)
      const cat = product?.category || 'Uncategorized'
      categorySales[cat] = (categorySales[cat] || 0) + item.total
      if (product) {
        productSales[product.name] = (productSales[product.name] || 0) + item.total
      }
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

  // §DATA-BINDING-FIX: Top Buyers = customers sorted by total purchase volume
  // (sum of invoice grandTotal where partyId is set). Top Products by Units =
  // inventory items sorted by total quantity sold (not revenue).
  const buyerSales: Record<string, { id: string; name: string; total: number }> = {}
  invoices.forEach((inv) => {
    if (inv.partyId && inv.party) {
      const key = inv.partyId
      if (!buyerSales[key]) buyerSales[key] = { id: inv.partyId, name: inv.party.name, total: 0 }
      buyerSales[key].total += inv.grandTotal
    }
  })
  const topBuyers = Object.values(buyerSales)
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)
    .map((b) => ({ id: b.id, name: b.name, value: b.total }))

  // §DATA-BINDING-FIX: Top Products by Units sold (quantity, not revenue)
  const productUnits: Record<string, { name: string; units: number; revenue: number }> = {}
  invoices.forEach((inv) => {
    inv.items?.forEach((item) => {
      const product = products.find((p) => p.id === item.productId)
      const name = product?.name || item.name
      if (!productUnits[name]) productUnits[name] = { name, units: 0, revenue: 0 }
      productUnits[name].units += item.quantity
      productUnits[name].revenue += item.total
    })
  })
  const topProductsByUnits = Object.values(productUnits)
    .sort((a, b) => b.units - a.units)
    .slice(0, 10)
    .map((p) => ({ name: p.name, value: p.units, revenue: p.revenue }))

  // Inventory Value Trend (PRD P4-3.3)
  const inventoryValue = products.reduce((s, p) => s + p.stock * p.purchasePrice, 0)
  const inventoryTrend: Array<{ month: string; value: number }> = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    const pastInvoices = invoices.filter((inv) => new Date(inv.createdAt) <= d)
    const soldValue = pastInvoices.reduce((s, inv) => s + (inv.items?.reduce((ss, it) => ss + it.total, 0) || 0), 0)
    const trendValue = Math.max(0, inventoryValue + soldValue * 0.1 - i * 500)
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
    // §LOCALIZED-CARD-FILTERS: range-aware totals for time-dependent cards
    rangeSales,
    rangeCollection,
    rangeExpense,
    lowStockCount,
    healthScore,
    topDebtors,
    recentTransactions: transactions,
    salesTrend,
    gradeDistribution: gradeDist,
    partyCount: parties.length,
    productCount: products.length,
    invoiceCount: invoices.length,
    // Advanced chart data (PRD P4-3)
    topCategories,
    topProductsBySales,
    topBuyers,
    topProductsByUnits,
    inventoryValue,
    inventoryTrend,
  })
}
