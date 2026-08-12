import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/customer-orders — owner: list customer orders for the current business.
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200).
// Returns { items, total, hasMore } — useFetch auto-extracts `.items` for
// backward compatibility with existing array-typed consumers.
// Query: ?status=pending|confirmed|delivered|cancelled to filter.
// Items JSON is parsed before returning.

export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
    const skip = (page - 1) * limit
    const where: { businessId: string; status?: string } = { businessId: business.id }
    if (status) where.status = status

    const [orders, total] = await Promise.all([
      db.customerOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      db.customerOrder.count({ where }),
    ])

    const items = orders.map((o) => ({
      ...o,
      items: o.items ? JSON.parse(o.items) : [],
    }))
    return NextResponse.json({ items, total, hasMore: skip + limit < total })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
