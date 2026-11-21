import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/audit-log
// §PAGINATION: Supports ?page (1-based) + ?limit (default 50, max 200).
// Returns { items, total, hasMore } — useFetch auto-extracts `.items`
// for backward compatibility with existing array-typed consumers.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const page = Math.max(1, Number(searchParams.get('page')) || 1)
  const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
  const skip = (page - 1) * limit
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  const where = { businessId: business.id }
  const [items, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take: limit }),
    db.auditLog.count({ where }),
  ])
  return NextResponse.json({ items, total, hasMore: skip + limit < total })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  const log = await db.auditLog.create({
    data: {
      businessId: business.id,
      staffId: body.staffId || null,
      staffName: body.staffName || 'Owner',
      action: body.action,
      entityType: body.entityType,
      entityId: body.entityId || null,
      description: body.description,
    },
  })
  return NextResponse.json(log)
}
