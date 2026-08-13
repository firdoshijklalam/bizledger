import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/transactions
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200).
// Returns { items, total, hasMore } — useFetch auto-extracts `.items`
// for backward compatibility with existing array-typed consumers.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
  const skip = (page - 1) * limit
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const where = {
    businessId: business.id,
    ...(partyId ? { partyId } : {}),
  }

  const [items, total] = await Promise.all([
    db.transaction.findMany({
      where,
      include: { party: true },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    db.transaction.count({ where }),
  ])
  // §DECIMAL-FIX-B: items[].amount/balanceAfter and nested items[].party.balance/
  // party.openingBalance/party.creditLimit are raw Prisma Decimals. Wrapping the
  // entire response object is safe — serializeDecimals is idempotent on numbers/booleans.
  return NextResponse.json(serializeDecimals({ items, total, hasMore: skip + limit < total }))
}

// POST /api/transactions
// §CONCURRENCY-FIX: Uses Prisma's atomic `increment`/`decrement` operators which
// translate to `UPDATE ... SET balance = balance ± amount` at the SQL level.
// This is atomic and safe against concurrent payments — no lost updates.
// Previously used read-then-write (fetch balance, compute new, write back) which
// had a race condition: two concurrent payments could both read the same balance,
// compute different new balances, and the last write wins.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

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

    // §ATOMIC-BALANCE: Use atomic increment/decrement inside a transaction.
    // credit (money in) reduces receivable balance → decrement
    // debit (money out) increases payable balance → increment
    // sale type does not affect balance (handled via invoice)
    let balanceAfter: number = 0
    let partyExists = false

    if (partyId) {
      // Verify ownership first (read-only check)
      const party = await db.party.findFirst({ where: { id: partyId, businessId: business.id } })
      if (party) {
        partyExists = true
        // §ATOMIC: Use $transaction with atomic increment/decrement.
        // The UPDATE is atomic at the SQL level — concurrent payments are safe.
        const result = await db.$transaction(async (tx) => {
          // Atomically update balance
          const updated = await tx.party.update({
            where: { id: partyId },
            data: {
              balance: body.type === 'credit'
                ? { decrement: amount }
                : body.type === 'debit'
                ? { increment: amount }
                : {},
            },
            select: { balance: true },
          })
          return updated.balance.toNumber()
        })
        balanceAfter = result
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
    if (partyId && partyExists) {
      recalculatePartyGrade(partyId).catch((e) => console.error('Grade recalc error:', e))
    }

    // §DECIMAL-FIX-B: txn.amount/balanceAfter are returned by Prisma as Decimal objects.
    return NextResponse.json(serializeDecimals(txn))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
