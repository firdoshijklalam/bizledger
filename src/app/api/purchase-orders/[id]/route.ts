import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// /api/purchase-orders/[id] — CRUD for a single purchase order.
// Security: verifies the PO belongs to the current business.

async function getBusinessId() {
  const business = await getCurrentBusiness()
  return business?.id ?? null
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const businessId = await getBusinessId()
  if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const po = await db.purchaseOrder.findFirst({
    where: { id, businessId },
    include: { items: true, supplier: true },
  })
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.purchaseOrder.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    const body = await req.json()
    const data: any = { status: body.status }
    if (body.status === 'dispatched') data.dispatchedAt = new Date()
    if (body.notes !== undefined) data.notes = body.notes
    const po = await db.purchaseOrder.update({ where: { id }, data, include: { items: true, supplier: true } })
    return NextResponse.json(po)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
