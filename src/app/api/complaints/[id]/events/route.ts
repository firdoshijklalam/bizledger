import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { COMPLAINT_EVENT_TYPES } from '@/lib/complaints'

// §COMPLAINT-EVENTS: Append-only event history for a complaint.
//
// §TENANT-ISOLATION: complaint ownership verified via findFirst({ where: { id, businessId } }).
// Cross-tenant → 404.
//
// §APPEND-ONLY: GET (list) + POST (create). No PUT/DELETE — event history
// rows are immutable once created.

// GET /api/complaints/[id]/events — list events (newest first)
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const complaint = await db.complaint.findFirst({
      where: { id, businessId: business.id },
      select: { id: true },
    })
    if (!complaint) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const events = await db.complaintEvent.findMany({
      where: { complaintId: id, businessId: business.id },
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ events })
  } catch (e) {
    return apiError(e, 'Failed to fetch complaint events')
  }
}

// POST /api/complaints/[id]/events — add a comment or manual event
// Body: { eventType: 'COMMENT', note: 'text', actor?: 'staff' }
// Only COMMENT is allowed via this endpoint — other event types are created
// automatically by the PUT handler when state changes occur.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const complaint = await db.complaint.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, complaintNumber: true },
    })
    if (!complaint) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()

    // §EVENT-TYPE: only COMMENT is allowed via this endpoint. Other types
    // (STATUS_CHANGE, PRIORITY_CHANGE, etc.) are created automatically by
    // the PUT handler. This prevents clients from injecting fake state-change
    // events that don't correspond to actual complaint mutations.
    const eventType = body.eventType
    if (eventType !== 'COMMENT') {
      return NextResponse.json({ error: 'Only COMMENT events can be added manually. Use PUT /api/complaints/[id] to change status/priority/assignment.' }, { status: 400 })
    }

    // §NOTE-REQUIRED for COMMENT
    if (!body.note || typeof body.note !== 'string' || body.note.trim().length === 0) {
      return NextResponse.json({ error: 'Note is required for COMMENT events' }, { status: 400 })
    }
    const note = body.note.trim().slice(0, 5000)

    // §ACTOR (optional)
    let actor: string | null = null
    if (body.actor !== undefined && body.actor !== null) {
      if (typeof body.actor !== 'string') {
        return NextResponse.json({ error: 'actor must be a string' }, { status: 400 })
      }
      actor = body.actor.trim().slice(0, 200) || null
    }

    const event = await db.complaintEvent.create({
      data: {
        businessId: business.id,
        complaintId: id,
        eventType: 'COMMENT',
        note,
        actor,
      },
    })

    return NextResponse.json({ event }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to add complaint event')
  }
}
