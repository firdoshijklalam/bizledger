import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  isValidType,
  isValidPriority,
  priorityChangeEvent,
  assignEvent,
  assertUserBelongsToBusiness,
  assertInvoiceBelongsToBusiness,
  assertComplaintBelongsToBusiness,
  FollowUpDomainError,
} from '@/lib/followups'

// §FOLLOWUP-ITEM: GET / PATCH for a single follow-up.
//
// §TENANT-ISOLATION: every query uses findFirst({ where: { id, businessId } })
// — both id AND businessId must match. Cross-tenant → 404.
//
// §NO-STATUS-MUTATION-VIA-PATCH: the PATCH endpoint does NOT allow status
// changes. Status transitions MUST use the dedicated /transition endpoint.
// This prevents accidental/arbitrary status jumps that bypass the state machine.

// GET /api/followups/[id] — return one follow-up with relations + events
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params

    const followUp = await db.followUp.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        completedBy: { select: { id: true, name: true } },
        relatedInvoice: { select: { id: true, invoiceNumber: true, grandTotal: true } },
        relatedComplaint: { select: { id: true, complaintNumber: true, title: true } },
        events: {
          orderBy: { createdAt: 'desc' },
          select: { id: true, eventType: true, fromValue: true, toValue: true, note: true, actor: true, createdAt: true },
        },
      },
    })

    if (!followUp) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(serializeDecimals({ followUp }))
  } catch (e) {
    return apiError(e, 'Failed to fetch follow-up')
  }
}

// PATCH /api/followups/[id] — update mutable fields (NO status mutation)
// Body (all optional): { title?, description?, type?, priority?, dueAt?,
//                         assignedToId?, relatedInvoiceId?, relatedComplaintId? }
//
// §EVENT-EMISSION: only PRIORITY_CHANGE + ASSIGN events are emitted here.
// Normal field edits (title/description/dueAt/type) do NOT create events.
// Status changes MUST use /transition.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()

    // §FETCH-CURRENT: get the current state (for event fromValue + ownership)
    const current = await db.followUp.findFirst({
      where: { id, businessId: user.businessId },
      select: {
        id: true, priority: true, assignedToId: true,
        title: true, description: true, type: true, dueAt: true,
        relatedInvoiceId: true, relatedComplaintId: true,
      },
    })

    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §REJECT-STATUS-IN-PATCH: status mutation is NOT allowed via PATCH
    if (body.status !== undefined) {
      return NextResponse.json({ error: 'Status cannot be changed via PATCH. Use POST /api/followups/[id]/transition.' }, { status: 400 })
    }
    // §REJECT-CONTROLLED-FIELDS: client cannot set businessId, createdById, completedById, completedAt, followUpNumber
    if (body.businessId !== undefined || body.createdById !== undefined || body.completedById !== undefined || body.completedAt !== undefined || body.followUpNumber !== undefined) {
      return NextResponse.json({ error: 'This field cannot be set via PATCH' }, { status: 400 })
    }

    // §VALIDATE-INPUT
    const updates: any = {}
    const eventsToCreate: any[] = []

    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || !body.title.trim()) {
        return NextResponse.json({ error: 'title must be a non-empty string' }, { status: 400 })
      }
      updates.title = body.title.trim()
    }
    if (body.description !== undefined) {
      updates.description = typeof body.description === 'string' ? body.description.trim() || null : null
    }
    if (body.type !== undefined) {
      if (!isValidType(body.type)) {
        return NextResponse.json({ error: `Invalid type: ${body.type}` }, { status: 400 })
      }
      updates.type = body.type
    }
    if (body.dueAt !== undefined) {
      if (body.dueAt === null) {
        updates.dueAt = null
      } else {
        const d = new Date(body.dueAt)
        if (isNaN(d.getTime())) {
          return NextResponse.json({ error: 'Invalid dueAt date' }, { status: 400 })
        }
        updates.dueAt = d
      }
    }
    if (body.relatedInvoiceId !== undefined) {
      if (body.relatedInvoiceId === null) {
        updates.relatedInvoiceId = null
      } else {
        try {
          await assertInvoiceBelongsToBusiness(db, body.relatedInvoiceId, user.businessId)
        } catch (e) {
          if (e instanceof FollowUpDomainError) {
            return NextResponse.json({ error: e.message }, { status: 400 })
          }
          throw e
        }
        updates.relatedInvoiceId = body.relatedInvoiceId
      }
    }
    if (body.relatedComplaintId !== undefined) {
      if (body.relatedComplaintId === null) {
        updates.relatedComplaintId = null
      } else {
        try {
          await assertComplaintBelongsToBusiness(db, body.relatedComplaintId, user.businessId)
        } catch (e) {
          if (e instanceof FollowUpDomainError) {
            return NextResponse.json({ error: e.message }, { status: 400 })
          }
          throw e
        }
        updates.relatedComplaintId = body.relatedComplaintId
      }
    }

    // §PRIORITY-CHANGE: validate + emit PRIORITY_CHANGE event
    if (body.priority !== undefined) {
      if (!isValidPriority(body.priority)) {
        return NextResponse.json({ error: `Invalid priority: ${body.priority}` }, { status: 400 })
      }
      if (current.priority !== body.priority) {
        updates.priority = body.priority
        eventsToCreate.push(priorityChangeEvent({
          businessId: user.businessId,
          followUpId: id,
          fromPriority: current.priority,
          toPriority: body.priority,
          actor: user.id,
        }))
      }
    }

    // §ASSIGN: validate + emit ASSIGN event
    if (body.assignedToId !== undefined) {
      const newAssignee = body.assignedToId || null
      if (newAssignee !== null) {
        try {
          await assertUserBelongsToBusiness(db, newAssignee, user.businessId)
        } catch (e) {
          if (e instanceof FollowUpDomainError) {
            return NextResponse.json({ error: e.message }, { status: 400 })
          }
          throw e
        }
      }
      if (current.assignedToId !== newAssignee) {
        updates.assignedToId = newAssignee
        eventsToCreate.push(assignEvent({
          businessId: user.businessId,
          followUpId: id,
          fromUserId: current.assignedToId,
          toUserId: newAssignee,
          actor: user.id,
        }))
      }
    }

    // §ATOMIC-UPDATE: followUp update + events in ONE transaction
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.followUp.update({
        where: { id },
        data: updates,
      })
      for (const evt of eventsToCreate) {
        await tx.followUpEvent.create({ data: evt })
      }
      return updated
    })

    return NextResponse.json(serializeDecimals(result))
  } catch (e) {
    return apiError(e, 'Failed to update follow-up')
  }
}
