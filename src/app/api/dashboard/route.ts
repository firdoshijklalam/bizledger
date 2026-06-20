import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/dashboard
export async function GET() {
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json(null)

  const parties = await db.party.findMany({ where: { businessId: business.id } })
  const products = await db.product.findMany({ where: { businessId: business.id } })
  const invoices = await db.invoice.findMany({
    where: { businessId: business.id },
    include: { party: true },
    orderBy: { createdAt: 'desc' },
  })
  const transactions = await db.transaction.findMany({
    where: { businessId: business.id },
    include: { party: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  })

  const totalReceivable = parties
    .filter((p) => p.balance > 0)
    .reduce((s, p) => s + p.balance, 0)
  const totalPayable = parties
    .filter((p) => p.balance < 0)
    .reduce((s, p) => s + Math.abs(p.balance), 0)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todaySales = invoices
    .filter((i) => new Date(i.createdAt) >= today)
    .reduce((s, i) => s + i.grandTotal, 0)

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const monthlyRevenue = invoices
    .filter((i) => new Date(i.createdAt) >= monthStart)
    .reduce((s, i) => s + i.grandTotal, 0)

  const lowStockCount = products.filter((p) => p.stock <= p.lowStockThreshold).length

  // Health score: weighted - receivable ratio + low stock + paid invoice ratio
  const paidInvoices = invoices.filter((i) => i.status === 'paid').length
  const paidRatio = invoices.length ? paidInvoices / invoices.length : 1
  const overdue = parties.filter((p) => p.qualityGrade === 'E').length
  const healthScore = Math.round(
    Math.max(0, Math.min(100, paidRatio * 50 + (1 - overdue / Math.max(parties.length, 1)) * 30 + (lowStockCount === 0 ? 20 : 10)))
  )

  // Top debtors
  const topDebtors = parties
    .filter((p) => p.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, balance: p.balance, grade: p.qualityGrade }))

  // Grade distribution
  const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
    grade,
    count: parties.filter((p) => p.qualityGrade === grade).length,
  }))

  // Sales trend - last 7 days
  const salesTrend: Array<{ date: string; revenue: number; expense: number; profit: number }> = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    d.setDate(d.getDate() - i)
    const next = new Date(d)
    next.setDate(d.getDate() + 1)
    const dayInvoices = invoices.filter(
      (inv) => new Date(inv.createdAt) >= d && new Date(inv.createdAt) < next
    )
    const revenue = dayInvoices.reduce((s, inv) => s + inv.grandTotal, 0)
    const expense = transactions
      .filter((t) => new Date(t.createdAt) >= d && new Date(t.createdAt) < next && t.type === 'debit')
      .reduce((s, t) => s + t.amount, 0)
    salesTrend.push({
      date: d.toLocaleDateString('en-IN', { weekday: 'short' }),
      revenue,
      expense,
      profit: revenue - expense,
    })
  }

  return NextResponse.json({
    totalReceivable,
    totalPayable,
    todaySales,
    monthlyRevenue,
    lowStockCount,
    healthScore,
    topDebtors,
    recentTransactions: transactions,
    salesTrend,
    gradeDistribution: gradeDist,
    partyCount: parties.length,
    productCount: products.length,
    invoiceCount: invoices.length,
  })
}
