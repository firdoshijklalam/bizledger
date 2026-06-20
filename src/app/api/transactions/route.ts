import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'

// GET /api/transactions
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const business = await db.business.findFirst()
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
    const business = await db.business.findFirst()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const amount = Number(body.amount)
    const partyId = body.partyId

    // Update party balance
    let balanceAfter: number | null = null
    if (partyId) {
      const party = await db.party.findUnique({ where: { id: partyId } })
      if (party) {
        // credit (money in) reduces receivable balance; debit (money out) increases payable
        const newBalance =
          body.type === 'credit'
            ? party.balance - amount
            : body.type === 'debit'
            ? party.balance + amount
            : party.balance
        await db.party.update({ where: { id: partyId }, data: { balance: newBalance } })
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
    return NextResponse.json(txn)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
