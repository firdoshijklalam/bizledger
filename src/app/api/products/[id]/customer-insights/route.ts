import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

/**
 * GET /api/products/[id]/customer-insights
 *
 * Returns customer analytics for a specific product:
 * 1. Active/Top Buyers — customers who bought this product, sorted by volume
 * 2. Churned Buyers — customers who used to buy but haven't in 60+ days
 * 3. Refill Prediction — customers due for a refill based on avg purchase cycle
 *
 * Uses InvoiceItem → Invoice → Party joins for historical purchase data.
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
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const { searchParams } = new URL(req.url)
  const churnDays = Number(searchParams.get('churnDays')) || 60

  // Verify product belongs to this business
  const product = await db.product.findFirst({
    where: { id, businessId: business.id },
    select: { id: true, name: true, category: true, unit: true }
  })
  if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 })

  // Fetch all invoice items for this product, joined with invoice + party
  const items = await db.invoiceItem.findMany({
    where: { productId: id },
    include: {
      invoice: {
        select: {
          id: true,
          partyId: true,
          date: true,
          party: { select: { id: true, name: true, phone: true } }
        }
      }
    },
    orderBy: { invoice: { date: 'asc' } }
  })

  // Aggregate by party
  const partyMap = new Map<string, BuyerRecord>()

  for (const item of items) {
    const party = item.invoice.party
    if (!party) continue

    const existing = partyMap.get(party.id)
    if (existing) {
      existing.totalQuantity += item.quantity
      existing.totalSpend += item.total
      existing.purchaseCount += 1
      if (item.invoice.date < new Date(existing.firstPurchase)) {
        existing.firstPurchase = item.invoice.date.toISOString()
      }
      if (item.invoice.date > new Date(existing.lastPurchase)) {
        existing.lastPurchase = item.invoice.date.toISOString()
      }
    } else {
      partyMap.set(party.id, {
        partyId: party.id,
        partyName: party.name,
        partyPhone: party.phone,
        totalQuantity: item.quantity,
        totalSpend: item.total,
        purchaseCount: 1,
        firstPurchase: item.invoice.date.toISOString(),
        lastPurchase: item.invoice.date.toISOString(),
        avgDaysBetweenPurchases: 0,
      })
    }
  }

  // Calculate avg days between purchases for each buyer
  const allBuyers = Array.from(partyMap.values())
  for (const buyer of allBuyers) {
    if (buyer.purchaseCount >= 2) {
      const first = new Date(buyer.firstPurchase).getTime()
      const last = new Date(buyer.lastPurchase).getTime()
      const daysSpan = (last - first) / (1000 * 60 * 60 * 24)
      buyer.avgDaysBetweenPurchases = Math.round(daysSpan / (buyer.purchaseCount - 1))
    }
  }

  // Sort by total spend (descending)
  allBuyers.sort((a, b) => b.totalSpend - a.totalSpend)

  // 1. Active/Top Buyers — bought within the last 60 days
  const now = Date.now()
  const activeBuyers = allBuyers.filter((b) => {
    const daysSinceLast = (now - new Date(b.lastPurchase).getTime()) / (1000 * 60 * 60 * 24)
    return daysSinceLast < churnDays
  })

  // Mark top 10% as VIP
  const vipThreshold = Math.max(1, Math.ceil(activeBuyers.length * 0.1))
  const topBuyers = activeBuyers.map((b, i) => ({
    ...b,
    isVIP: i < vipThreshold,
  }))

  // 2. Churned Buyers — used to buy but haven't in 60+ days
  const churnedBuyers = allBuyers.filter((b) => {
    const daysSinceLast = (now - new Date(b.lastPurchase).getTime()) / (1000 * 60 * 60 * 24)
    return daysSinceLast >= churnDays
  }).map((b) => {
    const daysSinceLast = Math.floor((now - new Date(b.lastPurchase).getTime()) / (1000 * 60 * 60 * 24))
    const monthsAgo = Math.floor(daysSinceLast / 30)
    return {
      ...b,
      daysSinceLastPurchase: daysSinceLast,
      lastBoughtLabel: monthsAgo >= 1 ? `${monthsAgo} month${monthsAgo > 1 ? 's' : ''} ago` : `${daysSinceLast} days ago`,
    }
  })

  // 3. Refill Prediction — active buyers whose avg cycle has passed
  const refillDue = activeBuyers.filter((b) => {
    if (b.avgDaysBetweenPurchases < 7) return false // Skip very frequent buyers
    const daysSinceLast = (now - new Date(b.lastPurchase).getTime()) / (1000 * 60 * 60 * 24)
    // Due if days since last purchase >= 80% of avg cycle
    return daysSinceLast >= b.avgDaysBetweenPurchases * 0.8
  }).map((b) => {
    const daysSinceLast = Math.floor((now - new Date(b.lastPurchase).getTime()) / (1000 * 60 * 60 * 24))
    const expectedRefillDay = Math.round(b.avgDaysBetweenPurchases - daysSinceLast)
    return {
      ...b,
      daysSinceLastPurchase: daysSinceLast,
      avgCycleDays: b.avgDaysBetweenPurchases,
      expectedInDays: expectedRefillDay,
      status: expectedRefillDay <= 0 ? 'overdue' : expectedRefillDay <= 7 ? 'due-soon' : 'upcoming',
    }
  })

  return NextResponse.json({
    product: { id: product.id, name: product.name, category: product.category, unit: product.unit },
    topBuyers,
    churnedBuyers,
    refillDue,
    summary: {
      totalBuyers: allBuyers.length,
      activeCount: activeBuyers.length,
      churnedCount: churnedBuyers.length,
      refillDueCount: refillDue.length,
      vipCount: vipThreshold,
      totalRevenue: allBuyers.reduce((s, b) => s + b.totalSpend, 0),
      totalQuantitySold: allBuyers.reduce((s, b) => s + b.totalQuantity, 0),
    }
  })
}
