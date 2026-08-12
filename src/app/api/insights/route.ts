import { NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/insights — smart business insights: top products, debtors, stock alerts, revenue trends
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json(null)

  const [parties, products, invoices, transactions] = await Promise.all([
    db.party.findMany({ where: { businessId: business.id } }),
    db.product.findMany({ where: { businessId: business.id }, include: { invoiceItems: { select: { quantity: true, total: true, invoice: { select: { createdAt: true } } } } } }),
    db.invoice.findMany({ where: { businessId: business.id }, include: { items: true, party: true } }),
    db.transaction.findMany({ where: { businessId: business.id } }),
  ])

  const currency = business.currency

  // Top selling products (by quantity)
  const topProducts = products
    .map((p) => ({
      id: p.id,
      name: p.name,
      unit: p.unit,
      totalSold: p.invoiceItems.reduce((s, it) => s + it.quantity, 0),
      revenue: p.invoiceItems.reduce((s, it) => s + it.total.toNumber(), 0),
      stock: p.stock,
    }))
    .filter((p) => p.totalSold > 0)
    .sort((a, b) => b.totalSold - a.totalSold)
    .slice(0, 5)

  // Top debtors
  const topDebtors = parties
    .filter((p) => p.balance.toNumber() > 0)
    .sort((a, b) => b.balance.toNumber() - a.balance.toNumber())
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, balance: p.balance, grade: p.qualityGrade }))

  // Stock alerts — products at or below threshold
  const stockAlerts = products
    .filter((p) => p.stock <= p.lowStockThreshold)
    .map((p) => ({ id: p.id, name: p.name, stock: p.stock, threshold: p.lowStockThreshold, unit: p.unit }))
    .sort((a, b) => a.stock - b.stock)

  // Revenue this month vs last month
  const now = new Date()
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const thisMonthRevenue = invoices.filter((i) => new Date(i.createdAt) >= thisMonthStart).reduce((s, i) => s + i.grandTotal.toNumber(), 0)
  const lastMonthRevenue = invoices
    .filter((i) => {
      const d = new Date(i.createdAt)
      return d >= lastMonthStart && d < thisMonthStart
    })
    .reduce((s, i) => s + i.grandTotal.toNumber(), 0)
  const revenueGrowth = lastMonthRevenue > 0 ? Math.round(((thisMonthRevenue - lastMonthRevenue) / lastMonthRevenue) * 100) : (thisMonthRevenue > 0 ? 100 : 0)

  // Payment collection rate
  const totalBilled = invoices.reduce((s, i) => s + i.grandTotal.toNumber(), 0)
  const totalCollected = invoices.reduce((s, i) => s + i.amountPaid.toNumber(), 0)
  const collectionRate = totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0

  // Overdue invoices
  const overdueInvoices = invoices.filter((i) => i.status !== 'paid' && i.amountDue.toNumber() > 0)

  // Slow-moving products (no sales in 30 days but have stock)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const slowMoving = products
    .filter((p) => p.stock > 0 && !p.invoiceItems.some((it) => new Date(it.invoice.createdAt) >= thirtyDaysAgo))
    .map((p) => ({ id: p.id, name: p.name, stock: p.stock, stockValue: p.stock * p.purchasePrice.toNumber() }))
    .sort((a, b) => b.stockValue - a.stockValue)

  return NextResponse.json({
    currency,
    topProducts,
    topDebtors,
    stockAlerts,
    revenue: {
      thisMonth: thisMonthRevenue,
      lastMonth: lastMonthRevenue,
      growth: revenueGrowth,
    },
    collectionRate,
    overdueCount: overdueInvoices.length,
    overdueAmount: overdueInvoices.reduce((s, i) => s + i.amountDue.toNumber(), 0),
    slowMoving,
    summary: {
      totalParties: parties.length,
      totalProducts: products.length,
      totalInvoices: invoices.length,
      totalTransactions: transactions.length,
    },
  })
}
