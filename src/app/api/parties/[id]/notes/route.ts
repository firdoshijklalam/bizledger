import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §PARTY-NOTES: CRUD for the existing PartyNote model.
//
// §TENANT-ISOLATION:
//   1. businessId is derived from the authenticated session via
//      getCurrentBusiness(). It is NEVER read from the request body or URL.
//   2. The party is loaded with `findFirst({ where: { id, businessId } })` —
//      this simultaneously verifies existence AND ownership. A party from
//      another business returns 404 (not 403, to avoid leaking existence).
//   3. Notes are created with the partyId from the URL (after ownership
//      check), never from the body.
//   4. GET only returns notes whose partyId belongs to the current business
//      (the ownership check on the party guarantees this).
//
// §DORMANT-MODEL-ACTIVATION: PartyNote already exists in the Prisma schema,
// is wired into Party.partyNotes[], and is already included by GET
// /api/parties/[id]. This route adds the missing CRUD endpoints so the UI
// can render + edit notes. No schema change.

const VALID_NOTE_TYPES = ['call', 'meeting', 'payment_promise', 'general'] as const
type NoteType = typeof VALID_NOTE_TYPES[number]

// GET /api/parties/[id]/notes — list notes for the authenticated party
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK: findFirst with both id AND businessId. If the party
    // doesn't exist OR belongs to another business, return 404.
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Notes are scoped by partyId (FK-cascade-deleted with the party, so any
    // note here necessarily belongs to a party in this business).
    const notes = await db.partyNote.findMany({
      where: { partyId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ notes })
  } catch (e) {
    return apiError(e, 'Failed to fetch notes')
  }
}

// POST /api/parties/[id]/notes — create a note for the authenticated party
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK: verify the party belongs to this business BEFORE
    // creating a note. Prevents creating notes on another tenant's party.
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()

    // §INPUT-VALIDATION: content is required and must be a non-empty string.
    // type is optional (defaults to 'general'); if provided must be a known type.
    if (body.content === undefined || body.content === null || typeof body.content !== 'string' || body.content.trim().length === 0) {
      return NextResponse.json({ error: 'Note content is required' }, { status: 400 })
    }
    const content = body.content.trim()
    if (content.length > 5000) {
      return NextResponse.json({ error: 'Note content too long (max 5000 chars)' }, { status: 400 })
    }

    let noteType: string = 'general'
    if (body.type !== undefined && body.type !== null) {
      if (typeof body.type !== 'string' || !VALID_NOTE_TYPES.includes(body.type as NoteType)) {
        return NextResponse.json({ error: `Invalid note type. Must be one of: ${VALID_NOTE_TYPES.join(', ')}` }, { status: 400 })
      }
      noteType = body.type
    }

    // §AUTHOR: optional string. No auth-user binding in this step (the existing
    // PartyNote.author is a free-form String?). We accept any string the
    // client sends (or null).
    const author = (body.author !== undefined && body.author !== null && typeof body.author === 'string')
      ? body.author.trim().slice(0, 200) || null
      : null

    // §CREATE: partyId comes from the URL (post-ownership-check), never body.
    const note = await db.partyNote.create({
      data: {
        partyId,
        type: noteType,
        content,
        author,
      },
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create note')
  }
}
