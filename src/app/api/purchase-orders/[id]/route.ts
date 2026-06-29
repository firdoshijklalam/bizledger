import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const po = await db.purchaseOrder.findUnique({ where: { id }, include: { items: true, supplier: true } })
  if (!po) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(po)
}
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const body = await req.json()
  const data: any = { status: body.status }
  if (body.status === 'dispatched') data.dispatchedAt = new Date()
  if (body.notes !== undefined) data.notes = body.notes
  const po = await db.purchaseOrder.update({ where: { id }, data, include: { items: true, supplier: true } })
  return NextResponse.json(po)
}
