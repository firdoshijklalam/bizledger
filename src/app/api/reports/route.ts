import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/reports — aggregated report data
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json(null)

  const parties = await db.party.findMany({ where: { businessId: business.id } })
  const products = await db.product.findMany({ where: { businessId: business.id } })
  const invoices = await db.invoice.findMany({
    where: { businessId: business.id },
    include: { party: true, items: true },
    orderBy: { createdAt: 'desc' },
  })
  const transactions = await db.transaction.findMany({
    where: { businessId: business.id },
    include: { party: true },
    orderBy: { createdAt: 'desc' },
  })

  const totalRevenue = invoices
    .filter((i) => i.type === 'sales' || i.type === 'retail')
    .reduce((s, i) => s + i.subtotal, 0)
  const totalGst = invoices
    .filter((i) => i.type === 'sales' || i.type === 'retail')
    .reduce((s, i) => s + i.gstAmount, 0)
  const totalDiscount = invoices.reduce((s, i) => s + i.discountAmount, 0)
  // §ACCOUNTING: Net Revenue = Total Sales (subtotal) − Discounts Given.
  // This is the actual revenue realized after discounts, before COGS.
  const netRevenue = totalRevenue - totalDiscount
  // §ACCOUNTING: Split expenses into COGS (purchase cost) vs Indirect Expenses.
  // COGS = transactions of type 'purchase' (inventory bought for resale).
  // Indirect Expenses = transactions of type 'expense' (rent, salaries, utilities).
  // 'debit' type is a legacy catch-all — count it as indirect expense.
  const cogs = transactions
    .filter((t) => t.type === 'purchase')
    .reduce((s, t) => s + t.amount, 0)
  const indirectExpenses = transactions
    .filter((t) => t.type === 'expense' || t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0)
  const totalExpense = cogs + indirectExpenses
  // §ACCOUNTING: Gross Profit = Net Revenue − COGS.
  // Net Profit = Gross Profit − Indirect Expenses.
  const grossProfit = netRevenue - cogs
  const netProfit = grossProfit - indirectExpenses
  const totalReceivable = parties.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0)
  const totalPayable = parties.filter((p) => p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0)

  // GST breakdown
  const gstBreakdown = invoices
    .filter((i) => i.isGst)
    .flatMap((i) => i.items.map((it) => ({ rate: it.gstRate, taxable: it.total, gst: (it.total * it.gstRate) / 100 })))
  const gstByRate = gstBreakdown.reduce((acc, g) => {
    const key = String(g.rate)
    if (!acc[key]) acc[key] = { rate: g.rate, taxable: 0, gst: 0 }
    acc[key].taxable += g.taxable
    acc[key].gst += g.gst
    return acc
  }, {} as Record<string, { rate: number; taxable: number; gst: number }>)

  // Stock ageing
  const stockAgeing = products.map((p) => ({
    name: p.name,
    stock: p.stock,
    value: p.stock * p.purchasePrice,
    threshold: p.lowStockThreshold,
    status: p.stock <= p.lowStockThreshold ? 'low' : p.stock <= p.lowStockThreshold * 2 ? 'medium' : 'good',
  }))

  // Grade distribution
  const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
    grade,
    count: parties.filter((p) => p.qualityGrade === grade).length,
    balance: parties.filter((p) => p.qualityGrade === grade).reduce((s, p) => s + Math.max(0, p.balance), 0),
  }))

  // Party ledger summary
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
      expense: totalExpense,
      netProfit,
      gst: totalGst,
    },
    gst: {
      totalGst,
      breakdown: Object.values(gstByRate),
    },
    partyLedger,
    outstanding: {
      totalReceivable,
      totalPayable,
      receivables: parties.filter((p) => p.balance > 0).map((p) => ({ name: p.name, amount: p.balance, grade: p.qualityGrade })),
      payables: parties.filter((p) => p.balance < 0).map((p) => ({ name: p.name, amount: Math.abs(p.balance) })),
    },
    stockAgeing,
    gradeDistribution: gradeDist,
    invoiceCount: invoices.length,
    recentInvoices: invoices.slice(0, 10).map((i) => ({
      id: i.id,
      number: i.invoiceNumber,
      party: i.party?.name || 'Walk-in',
      total: i.grandTotal,
      due: i.amountDue,
      status: i.status,
      date: i.createdAt,
    })),
  })
}
