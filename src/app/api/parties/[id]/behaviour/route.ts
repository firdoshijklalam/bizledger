import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'

// §CUSTOMER-BEHAVIOUR: Manually-rated interaction/service behaviour.
//
// §SEPARATION-FROM-TRUST-SCORE: This is NOT the financial creditTrustScore.
//   - creditTrustScore: Float 1.0-5.0, auto-computed from payment history,
//     lives on Party.creditTrustScore, recomputed by /api/trust-score/[id].
//   - CustomerBehaviour: staff-rated enum (VERY_BAD..BEST), lives in a
//     separate table, captures interaction/service qualities. The two are
//     intentionally independent — a customer can have a high financial
//     trust score but a poor behaviour rating, or vice versa.
//
// §TENANT-ISOLATION (same pattern as /api/parties/[id]/notes):
//   1. businessId from getCurrentBusiness() — never from body/URL.
//   2. findFirst({ where: { id: partyId, businessId } }) — verifies
//      existence AND ownership in one query. 404 if not found (no leak).
//   3. behaviourId/partyId from URL only.
//
// §ATOMIC-TRANSACTION: PUT updates/creates the current CustomerBehaviour
// row AND appends a CustomerBehaviourHistory snapshot inside ONE
// db.$transaction. If either write fails, both roll back. This guarantees
// history is always consistent with the current state.
//
// §AUDIT: Every create/update is logged via logAudit() (existing infra,
// no AuditLog schema change). action='behaviour_change', entityType='party'.

const VALID_RATINGS = ['VERY_BAD', 'BAD', 'GOOD', 'BETTER', 'BEST'] as const
type Rating = typeof VALID_RATINGS[number]

const MAX_TAGS = 20
const MAX_TAG_LENGTH = 50
const MAX_NOTES_LENGTH = 5000
const MAX_RATED_BY_LENGTH = 200

// §TAG-WHITELIST: lightweight, curated set of behaviour tags. Users can
// pick from these; we do NOT build a full Tag/M2M subsystem in this step.
// The list is intentionally short and reviewable.
export const BEHAVIOUR_TAG_PRESETS = [
  'Respectful',
  'Regular customer',
  'Pays on time',
  'Easy to communicate',
  'Frequently delays payment',
  'Aggressive',
  'Frequently complains',
  'Price sensitive',
  'Needs follow-up',
] as const

// Parse + validate the tags JSON array string. Accepts either:
//   - an array of strings (from API body)
//   - a JSON string (from stored DB column)
// Returns { ok: true, tags: string[] } or { ok: false, error: string }.
function validateTags(input: unknown): { ok: true; tags: string[] } | { ok: false; error: string } {
  if (input === undefined || input === null) return { ok: true, tags: [] }
  let arr: unknown[]
  if (Array.isArray(input)) {
    arr = input
  } else if (typeof input === 'string') {
    const trimmed = input.trim()
    if (trimmed === '') return { ok: true, tags: [] }
    try {
      const parsed = JSON.parse(trimmed)
      if (!Array.isArray(parsed)) return { ok: false, error: 'tags must be a JSON array' }
      arr = parsed
    } catch {
      return { ok: false, error: 'tags must be valid JSON' }
    }
  } else {
    return { ok: false, error: 'tags must be an array or JSON array string' }
  }
  if (arr.length > MAX_TAGS) {
    return { ok: false, error: `Too many tags (max ${MAX_TAGS})` }
  }
  const out: string[] = []
  for (const t of arr) {
    if (typeof t !== 'string') {
      return { ok: false, error: 'Each tag must be a string' }
    }
    const trimmed = t.trim()
    if (trimmed.length === 0) continue // skip empty
    if (trimmed.length > MAX_TAG_LENGTH) {
      return { ok: false, error: `Tag too long (max ${MAX_TAG_LENGTH} chars): "${trimmed.slice(0, 20)}…"` }
    }
    out.push(trimmed)
  }
  return { ok: true, tags: out }
}

// GET /api/parties/[id]/behaviour — current behaviour for the party
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // Fetch current behaviour (unique on businessId+partyId, so findFirst is safe)
    const behaviour = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: business.id, partyId } },
    })

    if (!behaviour) {
      // §NO-BEHAVIOUR: return 200 with null — the UI shows an empty state.
      // This is NOT an error; "no behaviour set yet" is a valid state.
      return NextResponse.json({ behaviour: null })
    }

    return NextResponse.json({ behaviour })
  } catch (e) {
    return apiError(e, 'Failed to fetch behaviour')
  }
}

// PUT /api/parties/[id]/behaviour — create or update current behaviour +
// append a history snapshot, atomically.
//
// Body: { rating: 'GOOD', tags?: string[] | string, notes?: string, ratedBy?: string }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()

    // §VALIDATE-RATING (required)
    if (body.rating === undefined || body.rating === null || typeof body.rating !== 'string') {
      return NextResponse.json({ error: 'rating is required' }, { status: 400 })
    }
    if (!VALID_RATINGS.includes(body.rating as Rating)) {
      return NextResponse.json({ error: `Invalid rating. Must be one of: ${VALID_RATINGS.join(', ')}` }, { status: 400 })
    }
    const rating = body.rating as Rating

    // §VALIDATE-TAGS (optional)
    const tagsResult = validateTags(body.tags)
    if (!tagsResult.ok) {
      return NextResponse.json({ error: tagsResult.error }, { status: 400 })
    }
    const tagsJson = tagsResult.tags.length > 0 ? JSON.stringify(tagsResult.tags) : null

    // §VALIDATE-NOTES (optional)
    let notes: string | null = null
    if (body.notes !== undefined && body.notes !== null) {
      if (typeof body.notes !== 'string') {
        return NextResponse.json({ error: 'notes must be a string' }, { status: 400 })
      }
      const trimmed = body.notes.trim()
      if (trimmed.length > MAX_NOTES_LENGTH) {
        return NextResponse.json({ error: `Notes too long (max ${MAX_NOTES_LENGTH} chars)` }, { status: 400 })
      }
      notes = trimmed || null
    }

    // §VALIDATE-RATED-BY (optional)
    let ratedBy: string | null = null
    if (body.ratedBy !== undefined && body.ratedBy !== null) {
      if (typeof body.ratedBy !== 'string') {
        return NextResponse.json({ error: 'ratedBy must be a string' }, { status: 400 })
      }
      const trimmed = body.ratedBy.trim().slice(0, MAX_RATED_BY_LENGTH)
      ratedBy = trimmed || null
    }

    // §ATOMIC-TRANSACTION: upsert current behaviour + append history snapshot.
    // If either fails, both roll back. The history row captures the NEW state
    // (rating/tags/notes/ratedBy) — so the history is a record of "what the
    // behaviour became at this time", not "what it was before".
    //
    // §HISTORY-SNAPSHOT-SEMANTICS: We snapshot the NEW state (post-update).
    // This means the first history row == the initial rating, the second
    // history row == the rating after the first change, etc. This is the
    // most useful audit trail (you can reconstruct the current state from
    // the latest history row, and see every state the behaviour has been in).
    const result = await db.$transaction(async (tx) => {
      // §UPSERT: create-or-update the single current behaviour row.
      // The @@unique([businessId, partyId]) guarantees at most one row.
      const behaviour = await tx.customerBehaviour.upsert({
        where: { businessId_partyId: { businessId: business.id, partyId } },
        update: {
          rating,
          tags: tagsJson,
          notes,
          ratedBy,
          updatedAt: new Date(),
        },
        create: {
          businessId: business.id,
          partyId,
          rating,
          tags: tagsJson,
          notes,
          ratedBy,
        },
      })

      // §APPEND-HISTORY: insert a snapshot of the new state. This row is
      // immutable (the API never edits/deletes history). behaviourId FK
      // cascade-deletes with the behaviour row.
      const history = await tx.customerBehaviourHistory.create({
        data: {
          businessId: business.id,
          partyId,
          behaviourId: behaviour.id,
          rating: behaviour.rating,
          tags: behaviour.tags,
          notes: behaviour.notes,
          ratedBy: behaviour.ratedBy,
        },
      })

      return { behaviour, history }
    })

    // §AUDIT-LOG: fire-and-forget (logAudit is non-fatal). Records who
    // changed the behaviour, what it became, and for which party.
    await logAudit({
      businessId: business.id,
      action: 'behaviour_change',
      entityType: 'party',
      entityId: partyId,
      description: `Customer behaviour set to ${rating} for ${party.name}`,
      metadata: JSON.stringify({
        partyId,
        rating,
        tags: tagsResult.tags,
        behaviourId: result.behaviour.id,
        historyId: result.history.id,
      }),
    })

    return NextResponse.json({ behaviour: result.behaviour })
  } catch (e) {
    return apiError(e, 'Failed to update behaviour')
  }
}
