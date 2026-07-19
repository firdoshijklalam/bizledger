import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/notifications — list DB-backed notifications for the current business
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const onlyUnread = searchParams.get('unread') === '1'
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])
  const notifs = await db.notification.findMany({
    where: { businessId: business.id, ...(onlyUnread ? { isRead: false } : {}) },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json(notifs)
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
