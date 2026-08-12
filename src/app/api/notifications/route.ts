import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/notifications — list DB-backed notifications for the current business
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200) + ?unread=1.
// Returns { items, total, hasMore } — useFetch auto-extracts `.items` for
// backward compatibility with existing array-typed consumers.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const onlyUnread = searchParams.get('unread') === '1'
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
  const skip = (page - 1) * limit
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ items: [], total: 0, hasMore: false })
  const where = { businessId: business.id, ...(onlyUnread ? { isRead: false } : {}) }
  const [items, total] = await Promise.all([
    db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.notification.count({ where }),
  ])
  return NextResponse.json({ items, total, hasMore: skip + limit < total })
}

// POST /api/notifications — mark a notification read (body: { id?, all?: true })
export async function POST(req: NextRequest) {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  const body = await req.json()
  if (body.all) {
    await db.notification.updateMany({ where: { businessId: business.id, isRead: false }, data: { isRead: true } })
    return NextResponse.json({ ok: true })
  }
  if (body.id) {
    await db.notification.updateMany({ where: { id: body.id, businessId: business.id }, data: { isRead: true } })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ error: 'Need id or all' }, { status: 400 })
}
