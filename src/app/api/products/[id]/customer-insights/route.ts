import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

/**
 * GET /api/products/[id]/customer-insights
 *
 * Returns customer analytics for a specific product:
 * 1. Top/VIP Buyers — customers who bought this product, sorted by spend (top 5)
 * 2. Refill Prediction — active buyers whose average purchase cycle has passed
 *    (e.g., "Alam usually buys every 30 days; last bought 28 days ago")
 * 3. Churned Buyers — customers who used to buy but haven't in 60+ days
 * 4. Summary stats — total buyers, revenue, quantity sold
 *
 * Uses InvoiceItem → Invoice → Party joins for historical purchase data.
 * Efficiently fetches all items in a single query, then aggregates in-memory
 * to avoid N+1 queries.
 *
 * §FIX: Uses `createdAt` (not `date`) — the Invoice model has no `date` field.
 */

interface BuyerRecord {
  partyId: string
  partyName: string
  partyPhone: string | null
  totalQuantity: number
  totalSpend: number
  purchaseCount: number
  firstPurchase: string
  lastPurchase: string
  avgDaysBetweenPurchases: number
  // §COMPUTED-FIELDS (added during aggregation):
  isVIP?: boolean
  daysSinceLastPurchase?: number
  lastBoughtLabel?: string
  avgCycleDays?: number
  expectedInDays?: number
  expectedRefillDate?: string
  status?: string
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  // §CONFIGURABLE: Churn threshold (default 60 days). Refill "overdue" uses
  // this same threshold to separate "due for refill" from "churned".
  const churnDays = Number(searchParams.get('churnDays')) || 60

  // Verify product belongs to this business
  const product = await db.product.findFirst({
    where: { id, businessId: business.id },
    select: { id: true, name: true, category: true, unit: true }
  })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // §SINGLE-QUERY: Fetch all invoice items for this product, joined with
  // invoice + party. Ordered by invoice date ascending so we can calculate
  // avg days between purchases.
  const items = await db.invoiceItem.findMany({
    where: { productId: id },
    include: {
      invoice: {
        select: {
          id: true,
          partyId: true,
          createdAt: true,
          status: true,
          party: { select: { id: true, name: true, phone: true } }
        }
      }
    },
    orderBy: { invoice: { createdAt: 'asc' } }
  })

  // Filter out voided invoices (they shouldn't count as sales)
  const validItems = items.filter((item) => item.invoice.status !== 'void')

  // §AGGREGATION: Group by party and compute totals + purchase dates.
  const partyMap = new Map<string, BuyerRecord>()

  for (const item of validItems) {
    const party = item.invoice.party
    if (!party) continue

    const existing = partyMap.get(party.id)
    if (existing) {
      existing.totalQuantity += item.quantity
      existing.totalSpend += item.total
      existing.purchaseCount += 1
      if (item.invoice.createdAt < new Date(existing.firstPurchase)) {
        existing.firstPurchase = item.invoice.createdAt.toISOString()
      }
      if (item.invoice.createdAt > new Date(existing.lastPurchase)) {
        existing.lastPurchase = item.invoice.createdAt.toISOString()
      }
    } else {
      partyMap.set(party.id, {
        partyId: party.id,
        partyName: party.name,
        partyPhone: party.phone,
        totalQuantity: item.quantity,
        totalSpend: item.total,
        purchaseCount: 1,
        firstPurchase: item.invoice.createdAt.toISOString(),
        lastPurchase: item.invoice.createdAt.toISOString(),
        avgDaysBetweenPurchases: 0,
      })
    }
  }

  // §AVG-CYCLE: Calculate average days between purchases for each buyer.
  // Only meaningful for buyers with 2+ purchases.
  const allBuyers = Array.from(partyMap.values())
  const now = Date.now()

  for (const buyer of allBuyers) {
    if (buyer.purchaseCount >= 2) {
      const first = new Date(buyer.firstPurchase).getTime()
      const last = new Date(buyer.lastPurchase).getTime()
      const daysSpan = (last - first) / (1000 * 60 * 60 * 24)
      buyer.avgDaysBetweenPurchases = Math.round(daysSpan / (buyer.purchaseCount - 1))
    }
    // Compute days since last purchase for all buyers
    buyer.daysSinceLastPurchase = Math.floor((now - new Date(buyer.lastPurchase).getTime()) / (1000 * 60 * 60 * 24))
  }

  // Sort by total spend (descending) — highest spender first
  allBuyers.sort((a, b) => b.totalSpend - a.totalSpend)

  // ─── 1. TOP/VIP BUYERS ──────────────────────────────────────────────────
  // Active buyers (bought within churnDays), sorted by spend.
  // Top 3-5 shown. VIP = top 20% (or at least 1).
  const activeBuyers = allBuyers.filter((b) => (b.daysSinceLastPurchase || 0) < churnDays)

  const vipCount = Math.max(1, Math.ceil(activeBuyers.length * 0.2))
  const topBuyers = activeBuyers.map((b, i) => ({
    ...b,
    isVIP: i < vipCount,
    lastBoughtLabel: formatLastBought(b.daysSinceLastPurchase || 0),
  }))

  // ─── 2. REFILL PREDICTION ───────────────────────────────────────────────
  // Active buyers (not churned) whose average purchase cycle has passed
  // or is about to pass. Only includes buyers with a meaningful cycle
  // (7+ days avg) and 2+ purchases (need history to predict).
  //
  // Logic:
  //   - "overdue":   daysSinceLast >= avgCycle (should have bought by now)
  //   - "due-soon":  daysSinceLast >= avgCycle * 0.8 (within 20% of cycle)
  //   - "upcoming":  daysSinceLast >= avgCycle * 0.5 (approaching cycle end)
  //
  // Example: Rahul buys every 31 days. Last bought 28 days ago.
  //   avgCycle=31, 0.8*31=24.8. 28 >= 24.8 → "due-soon", expectedIn=31-28=3 days
  const refillDue = activeBuyers.filter((b) => {
    if (b.avgDaysBetweenPurchases < 7) return false // Skip very frequent buyers
    if (b.purchaseCount < 2) return false // Need history to predict
    const threshold = b.avgDaysBetweenPurchases * 0.5
    return (b.daysSinceLastPurchase || 0) >= threshold
  }).map((b) => {
    const avgCycle = b.avgDaysBetweenPurchases
    const daysSince = b.daysSinceLastPurchase || 0
    const expectedIn = Math.round(avgCycle - daysSince)
    const expectedDate = new Date(now + expectedIn * 24 * 60 * 60 * 1000).toISOString()
    let status: string
    if (daysSince >= avgCycle) {
      status = 'overdue'
    } else if (daysSince >= avgCycle * 0.8) {
      status = 'due-soon'
    } else {
      status = 'upcoming'
    }
    return {
      ...b,
      avgCycleDays: avgCycle,
      expectedInDays: expectedIn,
      expectedRefillDate: expectedDate,
      lastBoughtLabel: formatLastBought(daysSince),
      status,
    }
  // Sort: overdue first, then due-soon, then upcoming
  }).sort((a, b) => {
    const order = { overdue: 0, 'due-soon': 1, upcoming: 2 }
    return (order[a.status as keyof typeof order] || 3) - (order[b.status as keyof typeof order] || 3)
  })

  // ─── 3. CHURNED BUYERS ──────────────────────────────────────────────────
  // Customers who used to buy but haven't in churnDays+ days.
  const churnedBuyers = allBuyers.filter((b) => (b.daysSinceLastPurchase || 0) >= churnDays).map((b) => {
    const daysSince = b.daysSinceLastPurchase || 0
    return {
      ...b,
      lastBoughtLabel: formatLastBought(daysSince),
    }
  // Sort: most recently lapsed first (closest to churn threshold)
  }).sort((a, b) => (a.daysSinceLastPurchase || 0) - (b.daysSinceLastPurchase || 0))

  return NextResponse.json({
    product: { id: product.id, name: product.name, category: product.category, unit: product.unit },
    topBuyers: topBuyers.slice(0, 5), // Top 5 max
    churnedBuyers,
    refillDue,
    summary: {
      totalBuyers: allBuyers.length,
      activeCount: activeBuyers.length,
      churnedCount: churnedBuyers.length,
      refillDueCount: refillDue.length,
      vipCount,
      totalRevenue: allBuyers.reduce((s, b) => s + b.totalSpend, 0),
      totalQuantitySold: allBuyers.reduce((s, b) => s + b.totalQuantity, 0),
    }
  })
}

// ─── Helper: format "last bought" label ────────────────────────────────────
function formatLastBought(daysSince: number): string {
  if (daysSince < 1) return 'today'
  if (daysSince === 1) return 'yesterday'
  if (daysSince < 7) return `${daysSince} days ago`
  if (daysSince < 14) return '1 week ago'
  if (daysSince < 30) return `${Math.floor(daysSince / 7)} weeks ago`
  if (daysSince < 60) return `${Math.floor(daysSince / 30)} month ago`
  return `${Math.floor(daysSince / 30)} months ago`
}
