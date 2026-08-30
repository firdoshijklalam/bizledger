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

    // §P16-STEP1-E: invoiceId ownership validation — if the caller provides an
    // invoiceId, verify that the invoice belongs to the authenticated business
    // BEFORE creating the transaction. This prevents cross-tenant injection where
    // a crafted request could link a transaction to another business's invoice.
    if (body.invoiceId) {
      const linkedInvoice = await db.invoice.findFirst({
        where: { id: body.invoiceId, businessId: business.id },
        select: { id: true },
      })
      if (!linkedInvoice) {
        return NextResponse.json(
          { error: 'Invoice not found or does not belong to this business' },
          { status: 403 }
        )
      }
    }

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
        // §P16-STEP1-D: Atomicity fix — BOTH the party balance update AND the
        // transaction.create MUST be inside the same db.$transaction. Previously
        // transaction.create was OUTSIDE the transaction block, which meant a
        // failure between the two could leave an orphaned balance update (party
        // balance changed but no transaction record exists). Now both succeed or
        // both roll back — atomicity preserved.
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
          // §P16-STEP1-D: Create the transaction record INSIDE the same transaction
          // so it commits atomically with the balance update. If either fails,
          // both roll back — no orphan records.
          const txn = await tx.transaction.create({
            data: {
              businessId: business.id,
              partyId: partyId || null,
              type: body.type,
              amount,
              balanceAfter: updated.balance.toNumber(),
              description: body.description || null,
              category: body.category || null,
              invoiceId: body.invoiceId || null,
            },
          })
          return { balance: updated.balance.toNumber(), txn }
        })
        balanceAfter = result.balance
        // §P16-STEP1-D: Return the transaction created inside the transaction block
        return NextResponse.json(serializeDecimals(result.txn))
      }
    }

    // §P16-STEP1-D: If no partyId or party doesn't exist, create the transaction
    // standalone (no balance update needed). This is the fallback path for
    // transactions without a party linkage (e.g., generic expense without party).
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
