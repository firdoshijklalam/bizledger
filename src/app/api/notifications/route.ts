import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/notifications — list DB-backed notifications for the current business
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200) + ?unread=1.
// Returns { items, total, hasMore, unreadTotal } — useFetch auto-extracts `.items`
// for backward compatibility, but the full response (incl. unreadTotal) is
// available via direct fetch.
//
// §NOTIFICATION-FOUNDATION: The API is the single source of truth for
// notifications. The frontend reads from this endpoint and POSTs markRead
// mutations back. The unreadTotal field is server-authoritative — the badge
// uses it directly instead of counting locally loaded items (which could be
// wrong if pagination hasn't loaded all items).
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const onlyUnread = searchParams.get('unread') === '1'
    const page = Math.max(1, Number(searchParams.get('page')) || 1)
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
    const skip = (page - 1) * limit
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    const where = { businessId: business.id, ...(onlyUnread ? { isRead: false } : {}) }
    // §UNREAD-TOTAL: Count ALL unread for this business (NOT just the current page).
    const unreadWhere = { businessId: business.id, isRead: false }
    const [items, total, unreadTotal] = await Promise.all([
      db.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
      db.notification.count({ where }),
      db.notification.count({ where: unreadWhere }),
    ])
    return NextResponse.json(serializeDecimals({ items, total, hasMore: skip + limit < total, unreadTotal }))
  } catch (e) {
    return apiError(e, 'Failed to fetch notifications')
  }
}

// POST /api/notifications — mark a notification read (body: { id?, all?: true })
// Returns the updated unreadTotal so the frontend can update the badge.
export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
    const body = await req.json()
    if (body.all) {
      await db.notification.updateMany({ where: { businessId: business.id, isRead: false }, data: { isRead: true } })
      const unreadTotal = await db.notification.count({ where: { businessId: business.id, isRead: false } })
      return NextResponse.json({ ok: true, unreadTotal })
    }
    if (body.id) {
      await db.notification.updateMany({ where: { id: body.id, businessId: business.id }, data: { isRead: true } })
      const unreadTotal = await db.notification.count({ where: { businessId: business.id, isRead: false } })
      return NextResponse.json({ ok: true, unreadTotal })
    }
    return NextResponse.json({ error: 'Need id or all' }, { status: 400 })
  } catch (e) {
    return apiError(e, 'Failed to update notification')
  }
}

// DELETE /api/notifications — dismiss/delete a notification
// §SWIPE-TO-DISMISS: Permanently removes a notification from the DB.
// Body: { id: string } — the notification ID to delete.
// §TENANT-ISOLATION: The notification MUST belong to the current business.
// The query filters by both id AND businessId — a crafted request from
// business A cannot delete business B's notification.
// Returns { ok: true, unreadTotal } so the badge updates immediately.
export async function DELETE(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
    const body = await req.json()
    if (!body.id) return NextResponse.json({ error: 'Need id' }, { status: 400 })

    // §TENANT-ISOLATION: Delete only if BOTH id AND businessId match.
    // This prevents cross-tenant deletion — a request from business A with
    // business B's notification ID will affect 0 rows.
    await db.notification.deleteMany({
      where: { id: body.id, businessId: business.id },
    })

    const unreadTotal = await db.notification.count({ where: { businessId: business.id, isRead: false } })
    return NextResponse.json({ ok: true, unreadTotal })
  } catch (e) {
    return apiError(e, 'Failed to delete notification')
  }
}
