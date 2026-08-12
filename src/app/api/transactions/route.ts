import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { apiError } from '@/lib/api-error'

// GET /api/transactions
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

  const transactions = await db.transaction.findMany({
    where: {
      businessId: business.id,
      ...(partyId ? { partyId } : {}),
    },
    include: { party: true },
    orderBy: { createdAt: 'desc' },
    take: 200,
  })
  return NextResponse.json(transactions)
}

// POST /api/transactions
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §INPUT-VALIDATION: Amount must be a positive number
    const amount = Number(body.amount)
    if (isNaN(amount) || amount <= 0) {
      return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 400 })
    }
    // §VALIDATION: Type must be credit or debit
    if (body.type !== 'credit' && body.type !== 'debit' && body.type !== 'sale') {
      return NextResponse.json({ error: 'Type must be credit, debit, or sale' }, { status: 400 })
    }
    const partyId = body.partyId

    // Update party balance — §2 FIX: default to 0 instead of null for walk-in customers
    // §OWNERSHIP-CHECK: Verify the party belongs to the current business before modifying.
    let balanceAfter: number = 0
    if (partyId) {
      const party = await db.party.findFirst({ where: { id: partyId, businessId: business.id } })
      if (party) {
        // credit (money in) reduces receivable balance; debit (money out) increases payable
        const newBalance =
          body.type === 'credit'
            ? party.balance.toNumber() - amount
            : body.type === 'debit'
            ? party.balance.toNumber() + amount
            : party.balance.toNumber()
        await db.party.updateMany({ where: { id: partyId, businessId: business.id }, data: { balance: newBalance } })
        balanceAfter = newBalance
      }
    }

    const txn = await db.transaction.create({
      data: {
        businessId: business.id,
        partyId: partyId || null,
        type: body.type,
        amount,
        balanceAfter,
        description: body.description || null,
        category: body.category || null,
        invoiceId: body.invoiceId || null,
      },
    })

    // Trigger grade recalculation for this party (fire-and-forget)
    if (partyId) {
      recalculatePartyGrade(partyId).catch((e) => console.error('Grade recalc error:', e))
    }

    return NextResponse.json(txn)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
