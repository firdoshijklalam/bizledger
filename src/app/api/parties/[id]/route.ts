import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateSearchTags } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'
import { serializeDecimals } from '@/lib/decimal-serializer'

// /api/parties/[id] — CRUD for a single party.
// Security: all operations verify the party belongs to the current business.
// §RBAC: PUT (modify party — name, credit limit, grade override) and DELETE
// (remove party ledger) require OWNER/ADMIN. STAFF must not be able to alter
// credit limits (would allow self-approving credit) or wipe a customer ledger.

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
    return NextResponse.json(serializeDecimals(party))
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
      return NextResponse.json(serializeDecimals({ ...party, partyNotes: [] }))
    } catch (e2: any) {
      // Last resort: return party without any relations
      try {
        const party = await db.party.findFirst({ where: { id, businessId } })
        if (!party) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json(serializeDecimals({ ...party, transactions: [], invoices: [], partyNotes: [] }))
      } catch (e3: any) {
        return apiError(e3, "Database error")
      }
    }
  }
}

// PUT /api/parties/[id]
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §RBAC: Require OWNER or ADMIN — STAFF must not modify credit limits or grades.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Verify ownership
    const existing = await db.party.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    const body = await req.json()

    // §INPUT-VALIDATION: Validate fields
    if (body.name !== undefined && (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0)) {
      return NextResponse.json({ error: 'Party name cannot be empty' }, { status: 400 })
    }
    if (body.creditLimit !== undefined && body.creditLimit !== null) {
      const cl = Number(body.creditLimit)
      if (isNaN(cl) || cl < 0) return NextResponse.json({ error: 'Credit limit cannot be negative' }, { status: 400 })
    }

    // §3: Regenerate search tags if name changed
    const searchTags = body.name !== existing.name
      ? JSON.stringify(generateSearchTags(body.name || ''))
      : undefined
    const updated = await db.party.update({
      where: { id },
      data: {
        name: body.name !== undefined ? body.name.trim() : undefined,
        phone: body.phone,
        type: body.type,
        creditLimit: body.creditLimit ? Number(body.creditLimit) : null,
        address: body.address,
        gstin: body.gstin,
        notes: body.notes,
        qualityGrade: body.qualityGrade,
        gradeOverrideReason: body.gradeOverrideReason || null,
        // §GROUP-MEMBERS: Allow updating buyerGroup for tiered pricing
        buyerGroup: body.buyerGroup !== undefined ? body.buyerGroup : undefined,
        ...(searchTags ? { searchTags } : {}),
      },
    })
    return NextResponse.json(serializeDecimals(updated))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// DELETE /api/parties/[id]
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §RBAC: Require OWNER or ADMIN — destructive operation.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const businessId = await getBusinessId()
    if (!businessId) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const existing = await db.party.findFirst({ where: { id, businessId } })
    if (!existing) return NextResponse.json({ error: 'Not found in your business' }, { status: 404 })

    await db.party.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
