import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/forecast?months=1|3|6 — demand prediction per product based on sales history
// Trend math fix: 0% trend when no sales data (not 100%)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const monthsParam = searchParams.get('months')
  const months = [1, 3, 6].includes(Number(monthsParam)) ? Number(monthsParam) : 3

  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const products = await db.product.findMany({
    where: { businessId: business.id },
    include: {
      invoiceItems: {
        include: { invoice: { select: { createdAt: true } } },
      },
    },
  })

  const now = new Date()
  const msPerMonth = 30 * 86400000
  const windowStart = new Date(now.getTime() - months * msPerMonth)

  const forecasts = products.map((p) => {
    // Aggregate sales over the configured window
    const recentSales = p.invoiceItems.filter((it) => new Date(it.invoice.createdAt) >= windowStart)
    const recentQty = recentSales.reduce((s, it) => s + it.quantity, 0)
    const avgPerMonth = recentQty / months

    // Trend: compare the most recent half-window vs the older half-window
    const halfWindowMs = (months * msPerMonth) / 2
    const halfWindowStart = new Date(now.getTime() - halfWindowMs)
    const recentHalf = p.invoiceItems.filter((it) => new Date(it.invoice.createdAt) >= halfWindowStart)
      .reduce((s, it) => s + it.quantity, 0)
    const olderHalf = p.invoiceItems.filter((it) => {
      const d = new Date(it.invoice.createdAt)
      return d >= windowStart && d < halfWindowStart
    }).reduce((s, it) => s + it.quantity, 0)

    // FIXED: when both halves are zero, trend = 0 (not 100%)
    let trendPct = 0
    if (olderHalf === 0 && recentHalf === 0) {
      trendPct = 0
    } else if (olderHalf === 0) {
      // recent sales exist but no older — full growth
      trendPct = 100
    } else {
      trendPct = Math.round(((recentHalf - olderHalf) / olderHalf) * 100)
    }

    // Predicted next-month demand
    const trendFactor = 1 + (trendPct / 100) * 0.3
    const predicted = Math.max(0, Math.round(avgPerMonth * trendFactor))

    // Confidence based on data volume
    const confidence: 'high' | 'medium' | 'low' = recentSales.length >= 10 ? 'high' : recentSales.length >= 3 ? 'medium' : 'low'

    const daysUntilOutOfStock = avgPerMonth > 0 ? Math.round(p.stock / (avgPerMonth / 30)) : null

    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: p.stock,
      unit: p.unit,
      recentMonthlyAvg: Math.round(avgPerMonth * 10) / 10,
      predictedNextMonth: predicted,
      trend: trendPct,
      confidence,
      daysUntilOutOfStock,
      needsRestock: daysUntilOutOfStock !== null && daysUntilOutOfStock <= 14,
      supplierId: p.supplierId,
      months,
    }
  })

  return NextResponse.json(forecasts.sort((a, b) => b.predictedNextMonth - a.predictedNextMonth))
}
