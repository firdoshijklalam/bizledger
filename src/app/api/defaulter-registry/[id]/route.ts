import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// Single defaulter record (PRD Part 32 §3).
// PATCH  — update status (active → resolved | disputed) + optional notes.
// DELETE — remove a defaulter entry (owner only; no real auth in MVP).

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
    return NextResponse.json({ ok: true, defaulter: updated })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
