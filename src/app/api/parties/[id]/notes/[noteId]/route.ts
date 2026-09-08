import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §PARTY-NOTES-ITEM: PUT + DELETE for a single PartyNote.
//
// §TENANT-ISOLATION (defense in depth — two checks):
//   1. businessId from session via getCurrentBusiness().
//   2. The NOTE is loaded with a join-through to its Party's businessId:
//        PartyNote.findFirst({ where: { id: noteId, party: { businessId } } })
//      This guarantees the note belongs to a party owned by the current
//      business in a single query.
//   3. The URL also contains a partyId ([id]) — we verify it matches the
//      note's actual partyId. This prevents a request that uses party A's
//      URL to touch a note that actually belongs to party B (even within
//      the same business). Both the URL partyId AND the note's partyId must
//      match AND the party must belong to the current business.
//
// §NO-BODY-PARTYID: partyId is NEVER read from the body. It comes from the
// URL and is cross-checked against the note's stored partyId.

const VALID_NOTE_TYPES = ['call', 'meeting', 'payment_promise', 'general'] as const
type NoteType = typeof VALID_NOTE_TYPES[number]

// PUT /api/parties/[id]/notes/[noteId] — edit an existing note
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const { id: partyId, noteId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK (note + party + business in one query):
    // The note must exist, belong to the party in the URL, and that party
    // must belong to the current business.
    const note = await db.partyNote.findFirst({
      where: {
        id: noteId,
        partyId,                    // URL partyId — prevents cross-party access within same business
        party: { businessId: business.id },  // tenant isolation
      },
      select: { id: true, content: true, type: true, author: true },
    })
    if (!note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()

    // §PARTIAL-UPDATE: only update fields that are provided. content + type
    // are validated if present. author is optional.
    const data: { content?: string; type?: string; author?: string | null } = {}

    if (body.content !== undefined) {
      if (typeof body.content !== 'string' || body.content.trim().length === 0) {
        return NextResponse.json({ error: 'Note content cannot be empty' }, { status: 400 })
      }
      const trimmed = body.content.trim()
      if (trimmed.length > 5000) {
        return NextResponse.json({ error: 'Note content too long (max 5000 chars)' }, { status: 400 })
      }
      data.content = trimmed
    }

    if (body.type !== undefined && body.type !== null) {
      if (typeof body.type !== 'string' || !VALID_NOTE_TYPES.includes(body.type as NoteType)) {
        return NextResponse.json({ error: `Invalid note type. Must be one of: ${VALID_NOTE_TYPES.join(', ')}` }, { status: 400 })
      }
      data.type = body.type
    }

    if (body.author !== undefined && body.author !== null) {
      if (typeof body.author !== 'string') {
        return NextResponse.json({ error: 'Author must be a string' }, { status: 400 })
      }
      const trimmed = body.author.trim().slice(0, 200)
      data.author = trimmed || null
    } else if (body.author === null) {
      data.author = null
    }

    // §NO-CHANGES: if nothing to update, return the existing note.
    if (Object.keys(data).length === 0) {
      return NextResponse.json({ note })
    }

    const updated = await db.partyNote.update({
      where: { id: noteId },
      data,
    })

    return NextResponse.json({ note: updated })
  } catch (e) {
    return apiError(e, 'Failed to update note')
  }
}

// DELETE /api/parties/[id]/notes/[noteId] — delete a note
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; noteId: string }> }) {
  try {
    const { id: partyId, noteId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK (same triple-condition as PUT): note + URL partyId +
    // business. findFirst returns null if ANY condition fails, so we 404
    // without leaking which condition failed.
    const note = await db.partyNote.findFirst({
      where: {
        id: noteId,
        partyId,
        party: { businessId: business.id },
      },
      select: { id: true },
    })
    if (!note) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    await db.partyNote.delete({ where: { id: noteId } })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, 'Failed to delete note')
  }
}
