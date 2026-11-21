import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { requireRole } from '@/lib/auth/session'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// Single defaulter record (PRD Part 32 §3).
// PATCH  — update status (active → resolved | disputed) + optional notes.
//          Requires OWNER or ADMIN role (defaulter resolution is a sensitive action).
// DELETE — remove a defaulter entry. Requires OWNER or ADMIN.
//
// §SECURITY: Both routes now require authentication + OWNER/ADMIN role.
// The DefaulterRegistry is a shared cross-tenant registry (no businessId on
// the model itself — entries are keyed by phone), so only OWNER/ADMIN users
// can modify entries. This prevents a STAFF user from resolving their own
// default or removing legitimate default entries.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()
    const status = body.status as 'active' | 'resolved' | 'disputed' | undefined

    if (!status) {
      return NextResponse.json(
        { error: 'status is required (active | resolved | disputed)' },
        { status: 400 }
      )
    }

    const existing = await db.defaulterRegistry.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Defaulter not found' }, { status: 404 })
    }

    const updated = await db.defaulterRegistry.update({
      where: { id },
      data: {
        status,
        notes: body.notes ? `${existing.notes ?? ''}\n[Update: ${status}] ${body.notes}`.trim() : existing.notes,
      },
    })
    // §DECIMAL-FIX-C: updated is a DefaulterRegistry with defaultAmount Decimal.
    return NextResponse.json(serializeDecimals({ ok: true, defaulter: updated }))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const existing = await db.defaulterRegistry.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Defaulter not found' }, { status: 404 })
    }
    await db.defaulterRegistry.delete({ where: { id } })
    return NextResponse.json({ ok: true, message: 'Defaulter entry removed' })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
