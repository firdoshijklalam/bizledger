import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { parseReportDateRange } from '@/lib/reports-csv'

// §VERCEL-LIMIT: Allow up to 30s for report aggregation across many invoices/items
export const maxDuration = 30

// GET /api/reports — aggregated report data
//
// §QUERY-PARAMS:
//   - ?start=YYYY-MM-DD&end=YYYY-MM-DD   (optional date range)
//   When provided, the report filters invoices + transactions by createdAt.
//   When omitted, the report includes all-time data (backward compatible).
//
// §ACCOUNTING-FIXES:
// 1. Voided invoices (status='void') are EXCLUDED from all sales/GST/revenue/profit
//    calculations. They remain in the invoice list for audit but contribute nothing.
// 2. COGS is calculated from ACTUAL purchase invoice items, not from transactions.
//    Previously COGS was always 0 because transactions were created with type='debit'
//    for purchases (not type='purchase'). Now COGS = sum of (quantity × purchasePrice)
//    for all items in non-voided purchase invoices.
//    §COSTING-METHOD: The costing method is SPECIFIC IDENTIFICATION — each sale's
//    COGS is based on the product's current purchasePrice. This is a simplification
//    of weighted-average cost. For exact FIFO/weighted-average, a stock movement
//    ledger would be needed (future enhancement).
export async function GET(req: NextRequest) {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  // §DATE-RANGE: Parse optional start/end query params. Returns null when no
  // valid range is provided → the API defaults to all-time (backward compatible).
  const url = new URL(req.url)
  const dateRange = parseReportDateRange(url.searchParams)

  const parties = await db.party.findMany({ where: { businessId: business.id } })
  const products = await db.product.findMany({ where: { businessId: business.id } })

  // §VOID-EXCLUSION: Only include non-voided invoices in financial calculations.
  // §DATE-FILTER: When a date range is provided, only include invoices whose
  //   createdAt falls within [start, end] (inclusive on both ends).
  const dateWhere = dateRange
    ? {
        businessId: business.id,
        status: { not: 'void' },
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      }
    : { businessId: business.id, status: { not: 'void' } }

  const invoices = await db.invoice.findMany({
    where: dateWhere,
    include: { party: true, items: true },
    orderBy: { createdAt: 'desc' },
  })

  // §VOID-INCLUSIVE: For the invoice count and recent list, include ALL invoices
  // (even voided) so the merchant can see voided invoices in the UI.
  // Date filter still applies (only invoices within the range are shown).
  const allInvoicesWhere = dateRange
    ? {
        businessId: business.id,
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      }
    : { businessId: business.id }

  const allInvoices = await db.invoice.findMany({
    where: allInvoicesWhere,
    include: { party: true },
    orderBy: { createdAt: 'desc' },
    take: 10,
  })

  // §DATE-FILTER: Transactions are also filtered by the date range when provided.
  const txnWhere = dateRange
    ? {
        businessId: business.id,
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      }
    : { businessId: business.id }

  const transactions = await db.transaction.findMany({
    where: txnWhere,
    include: { party: true },
    orderBy: { createdAt: 'desc' },
  })

  // §REVENUE: Only non-voided sales/retail invoices contribute to revenue.
  const salesInvoices = invoices.filter((i) => i.type === 'sales' || i.type === 'retail')
  const totalRevenue = salesInvoices.reduce((s, i) => s + i.subtotal.toNumber(), 0)
  const totalGst = salesInvoices.reduce((s, i) => s + i.gstAmount.toNumber(), 0)
  const totalDiscount = salesInvoices.reduce((s, i) => s + i.discountAmount.toNumber(), 0)

  // §NET-REVENUE: Total Sales (subtotal) − Discounts Given.
  const netRevenue = totalRevenue - totalDiscount

  // §COGS: Cost of Goods Sold = sum of (item.quantity × product.purchasePrice) for
  // all non-voided SALES invoices. This represents the cost of inventory that was
  // sold during the period.
  // §COSTING-METHOD: Specific identification using current purchasePrice. This is
  // a simplification — for exact FIFO/weighted-average, a stock movement ledger
  // would track the actual cost of each unit sold.
  const productCostMap = new Map(products.map((p) => [p.id, p.purchasePrice.toNumber()]))
  const cogs = salesInvoices.reduce((s, inv) => {
    return s + inv.items.reduce((itemSum, it) => {
      const costPerUnit = it.productId ? (productCostMap.get(it.productId) ?? 0) : 0
      return itemSum + (it.quantity * costPerUnit)
    }, 0)
  }, 0)

  // §INDIRECT-EXPENSES: Transactions of type 'expense' or 'debit' (excluding
  // purchase-type transactions which are inventory, not expenses).
  const indirectExpenses = transactions
    .filter((t) => t.type === 'expense' || t.type === 'debit')
    .reduce((s, t) => s + t.amount.toNumber(), 0)
  const totalExpense = cogs + indirectExpenses

  // §PROFIT: Gross Profit = Net Revenue − COGS. Net Profit = Gross Profit − Indirect Expenses.
  const grossProfit = netRevenue - cogs
  const netProfit = grossProfit - indirectExpenses

  const totalReceivable = parties.filter((p) => p.balance.toNumber() > 0).reduce((s, p) => s + p.balance.toNumber(), 0)
  const totalPayable = parties.filter((p) => p.balance.toNumber() < 0).reduce((s, p) => s + Math.abs(p.balance.toNumber()), 0)

  // §GST-BREAKDOWN: Only non-voided GST invoices contribute to GST liability.
  const gstBreakdown = salesInvoices
    .filter((i) => i.isGst)
    .flatMap((i) => i.items.map((it) => ({
      rate: it.gstRate.toNumber(),
      taxable: it.total.toNumber(),
      gst: (it.total.toNumber() * it.gstRate.toNumber()) / 100,
    })))
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
    value: p.stock * p.purchasePrice.toNumber(),
    threshold: p.lowStockThreshold,
    status: p.stock <= p.lowStockThreshold ? 'low' : p.stock <= p.lowStockThreshold * 2 ? 'medium' : 'good',
  }))

  // Grade distribution
  const gradeDist = (['A', 'B', 'C', 'D', 'E'] as const).map((grade) => ({
    grade,
    count: parties.filter((p) => p.qualityGrade === grade).length,
    balance: parties.filter((p) => p.qualityGrade === grade).reduce((s, p) => s + Math.max(0, p.balance.toNumber()), 0),
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
    invoiceCount: allInvoices.length,
    recentInvoices: serializeDecimals(allInvoices.map((i) => ({
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
