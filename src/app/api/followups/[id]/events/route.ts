import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import { commentEvent } from '@/lib/followups'

// §FOLLOWUP-EVENTS: POST /api/followups/[id]/events
//
// §COMMENT-ONLY: this endpoint ONLY allows adding COMMENT events. Clients
// cannot create CREATED, COMPLETE, CANCEL, ASSIGN, PRIORITY_CHANGE, or
// STATUS_CHANGE events through this route — those are auto-created by the
// POST (create), PATCH (update), and /transition (status change) endpoints
// as side-effects of their domain operations.
//
// §BODY: { note: string }
//
// §RULES:
//   - note required + non-empty after trimming
//   - actor = authenticated user
//   - business-scoped (findFirst with businessId)
//   - returns the created event

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()

    // §REJECT-ARBITRARY-EVENT-TYPE: clients cannot specify eventType
    if (body.eventType !== undefined) {
      return NextResponse.json(
        { error: 'Cannot specify eventType. This endpoint only accepts COMMENT notes.' },
        { status: 400 },
      )
    }

    // §NOTE-REQUIRED: non-empty after trim
    if (!body.note || typeof body.note !== 'string' || !body.note.trim()) {
      return NextResponse.json({ error: 'note is required and must be non-empty' }, { status: 400 })
    }

    // §FETCH-FOLLOWUP: verify it exists + belongs to the business
    const followUp = await db.followUp.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    })

    if (!followUp) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §CREATE-COMMENT-EVENT: append-only. Actor = authenticated user.
    const event = await db.followUpEvent.create({
      data: commentEvent({
        businessId: user.businessId,
        followUpId: id,
        note: body.note.trim(),
        actor: user.id,
      }),
    })

    return NextResponse.json(serializeDecimals({ event }), { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to add comment')
  }
}

// GET /api/followups/[id]/events — list events (newest-first)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params

    // §FETCH-FOLLOWUP: verify ownership first
    const followUp = await db.followUp.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true },
    })

    if (!followUp) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const events = await db.followUpEvent.findMany({
      where: { followUpId: id, businessId: user.businessId },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json(serializeDecimals({ items: events }))
  } catch (e) {
    return apiError(e, 'Failed to fetch events')
  }
}
