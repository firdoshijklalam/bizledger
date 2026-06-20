import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/parties/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const party = await db.party.findUnique({
    where: { id },
    include: {
      transactions: { orderBy: { createdAt: 'desc' }, take: 100 },
      invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
      partyNotes: { orderBy: { createdAt: 'desc' } },
    },
  })
  if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(party)
}

// PUT /api/parties/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const updated = await db.party.update({
    where: { id },
    data: {
      name: body.name,
      phone: body.phone,
      type: body.type,
      creditLimit: body.creditLimit ? Number(body.creditLimit) : null,
      address: body.address,
      gstin: body.gstin,
      notes: body.notes,
      qualityGrade: body.qualityGrade,
      gradeOverrideReason: body.gradeOverrideReason || null,
    },
  })
  return NextResponse.json(updated)
}

// DELETE /api/parties/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await db.party.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
