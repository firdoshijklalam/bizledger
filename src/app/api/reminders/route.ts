import { NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/reminders — list parties with overdue balances + invoice due info
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

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

  return NextResponse.json(reminders)
}
