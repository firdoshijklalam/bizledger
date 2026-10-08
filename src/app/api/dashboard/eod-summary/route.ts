import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { calendarTodayStartIST } from '@/lib/date-ranges'

/**
 * GET /api/dashboard/eod-summary
 *
 * §EOD-SUMMARY: "End of Day" summary for the Day Summary card on the Dashboard.
 * Aggregates TODAY's (IST-aligned, shared boundary logic with /api/dashboard)
 * business activity into a single merchant-shareable snapshot:
 *
 *   - salesTotal / salesCount  — sales+retail invoices created today (void excluded)
 *   - newCreditGiven           — amountDue sum of today's invoices (credit given today)
 *   - collections              — money-in transactions today (type='credit')
 *   - expenses                 — expense transactions today (type='expense')
 *   - topCustomer              — party with highest invoice total today (null if none);
 *                                includes partyId for drill-through navigation
 *   - pendingFollowUps         — active follow-ups (PENDING/IN_PROGRESS/SNOOZED)
 *   - lowStockCount            — products at/below their low-stock threshold
 *
 * §PERFORMANCE: All queries run in a single Promise.all (mirrors the dashboard
 * route's §PARALLEL-ALL pattern). Product low-stock is computed in JS from a
 * minimal select because SQLite/Prisma cannot compare two columns in a WHERE.
 *
 * §VOID-EXCLUSION: Voided invoices are excluded from all financial figures
 * (same contract as /api/dashboard).
 *
 * Response numbers pass through serializeDecimals() (Decimal → number) per the
 * API serialization convention.
 */
export const maxDuration = 30

const ACTIVE_FOLLOWUP_STATUSES = ['PENDING', 'IN_PROGRESS', 'SNOOZED']

export async function GET(_req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const todayStart = calendarTodayStartIST()
    // §IST-DATE-STRING: The display date must be the IST calendar date, NOT
    // toISOString() of the boundary (IST midnight = 18:30 UTC the PREVIOUS
    // day, so a UTC slice would show yesterday). en-CA yields YYYY-MM-DD.
    const istDateString = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date())
    const bizWhere = { businessId: business.id }
    const todayInvoiceWhere = {
      ...bizWhere,
      type: { in: ['sales', 'retail'] },
      status: { not: 'void' },
      createdAt: { gte: todayStart },
    }

    const [
      invoiceAgg,
      txGroupByType,
      topInvoiceParty,
      pendingFollowUps,
      products,
    ] = await Promise.all([
      // §COMBINED-INVOICE: one aggregate for sales total/count + credit given
      db.invoice.aggregate({
        where: todayInvoiceWhere,
        _sum: { grandTotal: true, amountDue: true },
        _count: true,
      }),
      // §TXN-BY-TYPE: today's money-in (credit) and expenses, grouped by type.
      // type is the stable discriminator for EOD display; subtype stays
      // authoritative for accounting-grade reports (see /api/reports).
      db.transaction.groupBy({
        by: ['type'],
        where: { ...bizWhere, createdAt: { gte: todayStart } },
        _sum: { amount: true },
      }),
      // §TOP-CUSTOMER: highest billed party today (partyId may be null → walk-in)
      db.invoice.groupBy({
        by: ['partyId'],
        where: todayInvoiceWhere,
        _sum: { grandTotal: true },
        orderBy: { _sum: { grandTotal: 'desc' } },
        take: 1,
      }),
      db.followUp.count({
        where: { ...bizWhere, status: { in: ACTIVE_FOLLOWUP_STATUSES } },
      }),
      // §LOW-STOCK: minimal select + JS comparison (SQLite can't compare columns)
      db.product.findMany({
        where: bizWhere,
        select: { stock: true, lowStockThreshold: true },
      }),
    ])

    const salesTotal = Number(invoiceAgg._sum.grandTotal ?? 0)
    const salesCount = invoiceAgg._count
    const newCreditGiven = Number(invoiceAgg._sum.amountDue ?? 0)

    const txByType = new Map(txGroupByType.map((g) => [g.type, Number(g._sum.amount ?? 0)]))
    const collections = txByType.get('credit') ?? 0
    const expenses = txByType.get('expense') ?? 0

    // §TOP-CUSTOMER-RESOLVE: groupBy returns partyId; resolve name (walk-in → null)
    // §DRILL-THROUGH: partyId is included so the EOD card's Top Customer row can
    // open the party profile overlay without a second lookup.
    let topCustomer: { name: string; amount: number; partyId: string | null } | null = null
    const topPartyId = topInvoiceParty[0]?.partyId
    const topAmount = Number(topInvoiceParty[0]?._sum.grandTotal ?? 0)
    if (topPartyId) {
      const party = await db.party.findUnique({
        where: { id: topPartyId },
        select: { name: true },
      })
      if (party) topCustomer = { name: party.name, amount: topAmount, partyId: topPartyId }
    } else if (topInvoiceParty.length > 0 && topAmount > 0) {
      // Retail walk-in sale without a party
      topCustomer = { name: '__WALK_IN__', amount: topAmount, partyId: null }
    }

    const lowStockCount = products.filter(
      (p) => p.stock <= (p.lowStockThreshold ?? 0)
    ).length

    return NextResponse.json(
      serializeDecimals({
        date: istDateString,
        salesTotal,
        salesCount,
        collections,
        expenses,
        newCreditGiven,
        topCustomer,
        pendingFollowUps,
        lowStockCount,
      })
    )
  } catch (e) {
    return apiError(e, 'GET /api/dashboard/eod-summary')
  }
}
