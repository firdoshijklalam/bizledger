import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/customer-orders — owner: list last 100 customer orders for the current business.
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
    const where: { businessId: string; status?: string } = { businessId: business.id }
    if (status) where.status = status

    const orders = await db.customerOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    })

    const parsed = orders.map((o) => ({
      ...o,
      items: o.items ? JSON.parse(o.items) : [],
    }))
    return NextResponse.json(parsed)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
