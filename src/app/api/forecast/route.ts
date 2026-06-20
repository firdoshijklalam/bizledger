import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/forecast — 3-month demand prediction per product based on sales history
export async function GET() {
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json([])

  const products = await db.product.findMany({
    where: { businessId: business.id },
    include: {
      invoiceItems: {
        include: { invoice: { select: { createdAt: true } } },
      },
    },
  })

  const now = new Date()
  const forecasts = products.map((p) => {
    // Last 90 days sales volume
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000)
    const recentSales = p.invoiceItems.filter((it) => new Date(it.invoice.createdAt) >= ninetyDaysAgo)
    const recentQty = recentSales.reduce((s, it) => s + it.quantity, 0)
    const avgPerMonth = recentQty / 3

    // Simple trend: compare last 30 days vs previous 30 days
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000)
    const last30 = p.invoiceItems.filter((it) => new Date(it.invoice.createdAt) >= thirtyDaysAgo).reduce((s, it) => s + it.quantity, 0)
    const prev30 = p.invoiceItems.filter((it) => {
      const d = new Date(it.invoice.createdAt)
      return d >= sixtyDaysAgo && d < thirtyDaysAgo
    }).reduce((s, it) => s + it.quantity, 0)

    const trend = prev30 > 0 ? (last30 - prev30) / prev30 : (last30 > 0 ? 1 : 0)
    const predicted = Math.max(0, Math.round(avgPerMonth * (1 + trend * 0.3)))

    // Confidence: based on data volume
    const confidence = recentSales.length >= 10 ? 'high' : recentSales.length >= 3 ? 'medium' : 'low'

    const daysUntilOutOfStock = avgPerMonth > 0 ? Math.round(p.stock / (avgPerMonth / 30)) : null

    return {
      productId: p.id,
      name: p.name,
      sku: p.sku,
      currentStock: p.stock,
      unit: p.unit,
      recentMonthlyAvg: Math.round(avgPerMonth * 10) / 10,
      predictedNextMonth: predicted,
      trend: Math.round(trend * 100),
      confidence,
      daysUntilOutOfStock,
      needsRestock: daysUntilOutOfStock !== null && daysUntilOutOfStock <= 14,
    }
  })

  // Sort by predicted demand descending
  return NextResponse.json(forecasts.sort((a, b) => b.predictedNextMonth - a.predictedNextMonth))
}
