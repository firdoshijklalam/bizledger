import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/transactions/summary
// Returns a daily summary for the History/Reports module.
// Query params:
//   range: 'today' | 'yesterday' | 'week' | 'custom'  (default 'today')
//   startDate, endDate: ISO date strings (YYYY-MM-DD) for custom range
//
// Returns:
// {
//   range, startDate, endDate,
//   grossSales: number,        // sum of invoice.grandTotal (sales/retail type)
//   netSales: number,          // grossSales - discountAmount
//   cashReceived: number,      // sum of transaction.amount where type=credit AND category LIKE 'Payment%' or 'Sale' with cash
//   upiReceived: number,
//   creditGiven: number,       // sum of invoices where paymentMode='credit' grandTotal
//   dueCollected: number,      // sum of transactions type=credit category='Payment In'
//   invoiceCount: number,
//   transactionCount: number,
//   byPaymentMode: { cash, upi, credit, cheque },
//   byCategory: { [category: string]: number },
// }

function getRangeBounds(range: string, startDate?: string | null, endDate?: string | null) {
  const now = new Date()
  // Use local midnight boundaries so "today" matches the shopkeeper's day.
  const startOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(0, 0, 0, 0)
    return x
  }
  const endOfDay = (d: Date) => {
    const x = new Date(d)
    x.setHours(23, 59, 59, 999)
    return x
  }

  switch (range) {
    case 'yesterday': {
      const y = new Date(now)
      y.setDate(y.getDate() - 1)
      return { start: startOfDay(y), end: endOfDay(y) }
    }
    case 'week': {
      // Current week (Mon-Sun)
      const start = startOfDay(now)
      const day = start.getDay() // 0=Sun..6=Sat
      const diff = day === 0 ? 6 : day - 1 // back to Monday
      start.setDate(start.getDate() - diff)
      return { start, end: endOfDay(now) }
    }
    case 'custom': {
      if (startDate && endDate) {
        const s = new Date(startDate + 'T00:00:00')
        const e = new Date(endDate + 'T23:59:59.999')
        if (!isNaN(s.getTime()) && !isNaN(e.getTime())) return { start: s, end: e }
      }
      return { start: startOfDay(now), end: endOfDay(now) }
    }
    case 'today':
    default:
      return { start: startOfDay(now), end: endOfDay(now) }
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const range = searchParams.get('range') || 'today'
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  const business = await getCurrentBusiness()
  if (!business) {
    return NextNextEmpty()
  }

  const { start, end } = getRangeBounds(range, startDate, endDate)

  try {
    // Fetch invoices in range (sales/retail = product sales; exclude purchase/challan)
    const invoices = await db.invoice.findMany({
      where: {
        businessId: business.id,
        createdAt: { gte: start, lte: end },
        type: { in: ['sales', 'retail'] },
      },
      include: { items: true },
    })

    // Fetch transactions in range
    const transactions = await db.transaction.findMany({
      where: {
        businessId: business.id,
        createdAt: { gte: start, lte: end },
      },
    })

    // ---- Aggregate ----
    const grossSales = invoices.reduce((s, i) => s + (i.grandTotal || 0), 0)
    const netSales = grossSales - invoices.reduce((s, i) => s + (i.discountAmount || 0), 0)

    // Cash/UPI received: from invoices' paymentMode + amountPaid
    const byPaymentMode = { cash: 0, upi: 0, credit: 0, cheque: 0 }
    for (const inv of invoices) {
      const mode = (inv.paymentMode || 'cash') as keyof typeof byPaymentMode
      if (mode in byPaymentMode) byPaymentMode[mode] += inv.amountPaid || 0
    }

    // Credit given today = invoices where paymentMode = credit (the due portion)
    const creditGiven = invoices
      .filter((i) => i.paymentMode === 'credit')
      .reduce((s, i) => s + (i.amountDue || 0), 0)

    // Due collected today = transactions type=credit (money in) — these are
    // "Payment In" / due collection receipts, NOT new product sales.
    const dueCollected = transactions
      .filter((t) => t.type === 'credit')
      .reduce((s, t) => s + (t.amount || 0), 0)

    // Cash/UPI received also includes due-collection transactions.
    // We approximate by adding due-collected transactions to cash (since
    // most due collections are cash). For a precise split, the transaction
    // would need a paymentMode field (future enhancement).
    const cashReceived = byPaymentMode.cash + dueCollected
    const upiReceived = byPaymentMode.upi

    // Category breakdown of transactions
    const byCategory: Record<string, number> = {}
    for (const t of transactions) {
      const cat = t.category || (t.type === 'credit' ? 'Payment In' : t.type === 'debit' ? 'Payment Out' : t.type)
      byCategory[cat] = (byCategory[cat] || 0) + (t.amount || 0)
    }

    return NextResponse.json({
      range,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      grossSales,
      netSales,
      cashReceived,
      upiReceived,
      creditGiven,
      dueCollected,
      invoiceCount: invoices.length,
      transactionCount: transactions.length,
      byPaymentMode,
      byCategory,
    })
  } catch (e: any) {
    return NextResponse.json(
      apiError(e, 'Summary calculation failed'),
      { status: 500 }
    )
  }
}

function NextNextEmpty() {
  return NextResponse.json({
    range: 'today',
    grossSales: 0,
    netSales: 0,
    cashReceived: 0,
    upiReceived: 0,
    creditGiven: 0,
    dueCollected: 0,
    invoiceCount: 0,
    transactionCount: 0,
    byPaymentMode: { cash: 0, upi: 0, credit: 0, cheque: 0 },
    byCategory: {},
  })
}
