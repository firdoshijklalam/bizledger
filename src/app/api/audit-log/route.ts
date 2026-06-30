import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json([])
  const logs = await db.auditLog.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'desc' }, take: 50 })
  return NextResponse.json(logs)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const business = await db.business.findFirst()
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
