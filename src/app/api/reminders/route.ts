import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/reminders — list parties with overdue balances + invoice due info
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200).
// Returns { items, total, hasMore } — useFetch auto-extracts `.items` for
// backward compatibility with existing array-typed consumers.
// Note: pagination is applied AFTER the reminders array is computed (since
// reminder rows are derived from party + invoice data, not a single table).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
  const skip = (page - 1) * limit
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ items: [], total: 0, hasMore: false })

  const parties = await db.party.findMany({
    where: { businessId: business.id, balance: { gt: 0 } },
    include: {
      invoices: {
        where: { status: { not: 'paid' } },
        select: { id: true, invoiceNumber: true, grandTotal: true, amountDue: true, createdAt: true },
      },
    },
  })

  const now = new Date()
  const reminders = parties
    .filter((p) => p.balance.toNumber() > 0)
    .map((p) => {
      const oldestInvoice = p.invoices.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[0]
      const daysOverdue = oldestInvoice
        ? Math.floor((now.getTime() - new Date(oldestInvoice.createdAt).getTime()) / 86400000)
        : 0
      return {
        id: p.id,
        name: p.name,
        phone: p.phone,
        balance: p.balance,
        grade: p.qualityGrade,
        overdueInvoices: p.invoices.length,
        daysOverdue,
        oldestInvoiceNumber: oldestInvoice?.invoiceNumber || null,
      }
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue)

  const total = reminders.length
  const items = reminders.slice(skip, skip + limit)
  return NextResponse.json({ items, total, hasMore: skip + limit < total })
}
