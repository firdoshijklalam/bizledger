import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// /api/parties/[id] — CRUD for a single party.
// Security: all operations verify the party belongs to the current business.

async function getBusinessId() {
  const business = await getCurrentBusiness()
  return business?.id ?? null
}

// GET /api/parties/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const businessId = await getBusinessId()
  if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const party = await db.party.findFirst({
      where: { id, businessId },
      include: {
        transactions: { orderBy: { createdAt: 'desc' }, take: 100 },
        invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        partyNotes: { orderBy: { createdAt: 'desc' } },
      },
    })
    if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(party)
  } catch (e: any) {
    // Fallback: try without partyNotes (may not exist in Neon yet)
    try {
      const party = await db.party.findFirst({
        where: { id, businessId },
        include: {
          transactions: { orderBy: { createdAt: 'desc' }, take: 100 },
          invoices: { orderBy: { createdAt: 'desc' }, take: 20 },
        },
      })
      if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ ...party, partyNotes: [] })
    } catch (e2: any) {
      // Last resort: return party without any relations
      try {
        const party = await db.party.findFirst({ where: { id, businessId } })
        if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ ...party, transactions: [], invoices: [], partyNotes: [] })
      } catch (e3: any) {
        return NextResponse.json({ error: 'DB error', detail: String(e3?.message || e3) }, { status: 500 })
      }
    }
  }
}

// PUT /api/parties/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

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
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// DELETE /api/parties/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.party.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    await db.party.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
