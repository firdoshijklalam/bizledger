import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'

// §FEEDBACK-ANALYTICS-API: business-wide product-feedback rollup for the
// Reports "Feedback" tab and the Inventory rating badges.
//
// §TENANT-ISOLATION: businessId always from requireAuth() (session-derived) —
// never from body/URL. The whole query is scoped by businessId.
//
// §AGGREGATION-STRATEGY: a single findMany of lightweight rows (status,
// rating, productId + party/product names, submittedAt, comment) capped at
// MAX_ROWS, then JS-side aggregation. Feedback volume for one SMB business is
// small (dozens–low thousands); one round-trip beats a fan of groupBy queries
// that would still need a second findMany to join product names.
//
// §METRIC-DEFINITIONS (consistent with the party/product insights strips):
//   - avgRating   : mean rating over SUBMITTED records WITH a rating (1–5)
//   - responseRate: submitted / total (all statuses), rounded to %
//   - distribution: count of each star value 5→1 over rated records
//   - per-product : same two metrics scoped to one productId (name via join)

const MAX_ROWS = 5000

// GET /api/feedback/analytics — business-wide feedback analytics rollup
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const rows = await db.productFeedback.findMany({
      where: { businessId: user.businessId },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      select: {
        id: true,
        status: true,
        rating: true,
        comment: true,
        requestedAt: true,
        submittedAt: true,
        createdAt: true,
        party: { select: { name: true } },
        product: { select: { id: true, name: true, sku: true } },
      },
    })

    // §STATUS-COUNTS: every known status, always present (zeros included) so
    // the frontend can render a stable status chip row.
    const byStatus: Record<string, number> = {
      scheduled: 0,
      pending: 0,
      submitted: 0,
      skipped: 0,
      expired: 0,
    }
    const distribution: Record<string, number> = { '5': 0, '4': 0, '3': 0, '2': 0, '1': 0 }
    const productAgg = new Map<
      string,
      { productId: string; name: string; sku: string | null; total: number; submitted: number; ratingSum: number; ratedCount: number }
    >()

    let submitted = 0
    let rated = 0
    let ratingSum = 0
    let withComment = 0

    for (const r of rows) {
      byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
      const isSubmitted = r.status === 'submitted'
      if (isSubmitted) submitted += 1
      if (r.rating != null) {
        rated += 1
        ratingSum += r.rating
        const key = String(Math.min(5, Math.max(1, r.rating)))
        distribution[key] = (distribution[key] ?? 0) + 1
      }
      if (isSubmitted && r.comment) withComment += 1

      // §PER-PRODUCT: only rows tied to a product contribute to the product
      // leaderboard; generic feedback (productId=null) still counts in the
      // business-wide totals above.
      if (r.product) {
        const agg = productAgg.get(r.product.id) ?? {
          productId: r.product.id,
          name: r.product.name,
          sku: r.product.sku,
          total: 0,
          submitted: 0,
          ratingSum: 0,
          ratedCount: 0,
        }
        agg.total += 1
        if (isSubmitted) agg.submitted += 1
        if (r.rating != null) {
          agg.ratingSum += r.rating
          agg.ratedCount += 1
        }
        productAgg.set(r.product.id, agg)
      }
    }

    const total = rows.length
    const avgRating = rated > 0 ? ratingSum / rated : null
    const responseRate = total > 0 ? Math.round((submitted / total) * 100) : 0

    // §PRODUCT-LEADERBOARD: per-product avg + response rate + review count.
    // Sorted by avgRating desc, then review count desc. Flat array (Prisma
    // schema primitives cannot be lists) — the frontend renders the top N.
    const products = Array.from(productAgg.values())
      .map((p) => ({
        productId: p.productId,
        name: p.name,
        sku: p.sku,
        total: p.total,
        submitted: p.submitted,
        reviews: p.ratedCount,
        avgRating: p.ratedCount > 0 ? p.ratingSum / p.ratedCount : null,
        responseRate: p.total > 0 ? Math.round((p.submitted / p.total) * 100) : 0,
      }))
      .sort((a, b) => {
        // Products WITH ratings first (avg desc), then unrated by volume desc.
        if (a.avgRating != null && b.avgRating != null && a.avgRating !== b.avgRating) {
          return b.avgRating - a.avgRating
        }
        if (a.avgRating != null && b.avgRating == null) return -1
        if (a.avgRating == null && b.avgRating != null) return 1
        return b.submitted - a.submitted || b.total - a.total
      })

    // §RECENT-REVIEWS: latest submitted reviews (max 8) — newest first.
    const recentReviews = rows
      .filter((r) => r.status === 'submitted')
      .sort(
        (a, b) =>
          new Date(b.submittedAt ?? b.createdAt).getTime() -
          new Date(a.submittedAt ?? a.createdAt).getTime(),
      )
      .slice(0, 8)
      .map((r) => ({
        id: r.id,
        rating: r.rating,
        comment: r.comment,
        partyName: r.party?.name ?? null,
        productName: r.product?.name ?? null,
        submittedAt: r.submittedAt ?? r.createdAt,
      }))

    return NextResponse.json(
      serializeDecimals({
        total,
        byStatus,
        submitted,
        rated,
        withComment,
        avgRating,
        responseRate,
        distribution,
        products,
        recentReviews,
        truncated: rows.length === MAX_ROWS,
      }),
    )
  } catch (e) {
    return apiError(e, 'Failed to fetch feedback analytics')
  }
}
