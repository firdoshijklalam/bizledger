import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { serializeDecimals } from '@/lib/decimal-serializer'
import {
  COMPLAINT_STATUSES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_SOURCE_TYPES,
  isValidStatusTransition,
} from '@/lib/complaints'

// §COMPLAINT-ITEM: GET / PUT / DELETE for a single complaint.
//
// §TENANT-ISOLATION: every query uses findFirst({ where: { id, businessId } })
// — both id AND businessId must match. Cross-tenant → 404.
//
// §DELETE-ARCHIVE: hard delete is intentionally NOT exposed. DELETE instead
// archives the complaint by setting status=CLOSED (if not already). This
// preserves the complaint + its event history for audit. If a true hard-delete
// is needed in the future, it should require OWNER role + a confirmation flow.

// GET /api/complaints/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const complaint = await db.complaint.findFirst({
      where: { id, businessId: business.id },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        relatedInvoice: { select: { id: true, invoiceNumber: true } },
        relatedProduct: { select: { id: true, name: true } },
      },
    })

    if (!complaint) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json({ complaint: serializeDecimals(complaint) })
  } catch (e) {
    return apiError(e, 'Failed to fetch complaint')
  }
}

// PUT /api/complaints/[id] — update mutable fields
// Body (all optional): { title?, description?, status?, priority?, assignedTo?,
//   relatedInvoiceId?, relatedProductId?, resolution?, internalNotes? }
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const existing = await db.complaint.findFirst({
      where: { id, businessId: business.id },
      select: {
        id: true,
        complaintNumber: true,
        status: true,
        priority: true,
        assignedTo: true,
        partyId: true,
        title: true,
      },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const body = await req.json()
    const events: Array<{ eventType: string; fromValue?: string | null; toValue?: string | null; note?: string | null }> = []
    const data: any = {}

    // §TITLE (optional)
    if (body.title !== undefined) {
      if (typeof body.title !== 'string' || body.title.trim().length === 0) {
        return NextResponse.json({ error: 'Title cannot be empty' }, { status: 400 })
      }
      data.title = body.title.trim().slice(0, 500)
    }

    // §DESCRIPTION (optional)
    if (body.description !== undefined) {
      if (typeof body.description !== 'string') {
        return NextResponse.json({ error: 'Description must be a string' }, { status: 400 })
      }
      data.description = body.description.trim().slice(0, 10000) || null
    }

    // §STATUS (optional — validate transition)
    if (body.status !== undefined && body.status !== null) {
      if (typeof body.status !== 'string' || !COMPLAINT_STATUSES.includes(body.status as any)) {
        return NextResponse.json({ error: `Invalid status. Must be one of: ${COMPLAINT_STATUSES.join(', ')}` }, { status: 400 })
      }
      if (body.status !== existing.status) {
        if (!isValidStatusTransition(existing.status, body.status)) {
          return NextResponse.json({ error: `Invalid status transition: ${existing.status} → ${body.status}` }, { status: 400 })
        }
        data.status = body.status
        events.push({
          eventType: 'STATUS_CHANGE',
          fromValue: existing.status,
          toValue: body.status,
        })
        // §RESOLVED-AT: set when transitioning TO RESOLVED; clear when reopening
        if (body.status === 'RESOLVED') {
          data.resolvedAt = new Date()
          events.push({ eventType: 'RESOLVE', toValue: body.status, note: 'Complaint resolved' })
        } else if (existing.status === 'RESOLVED' && body.status !== 'CLOSED') {
          // Reopening from RESOLVED — clear resolvedAt
          data.resolvedAt = null
        }
        // §CLOSE event
        if (body.status === 'CLOSED') {
          events.push({ eventType: 'CLOSE', toValue: body.status, note: 'Complaint closed' })
        }
      }
    }

    // §PRIORITY (optional)
    if (body.priority !== undefined && body.priority !== null) {
      if (typeof body.priority !== 'string' || !COMPLAINT_PRIORITIES.includes(body.priority as any)) {
        return NextResponse.json({ error: `Invalid priority. Must be one of: ${COMPLAINT_PRIORITIES.join(', ')}` }, { status: 400 })
      }
      if (body.priority !== existing.priority) {
        data.priority = body.priority
        events.push({
          eventType: 'PRIORITY_CHANGE',
          fromValue: existing.priority,
          toValue: body.priority,
        })
      }
    }

    // §ASSIGNED-TO (optional)
    if (body.assignedTo !== undefined) {
      const newAssigned = body.assignedTo === null ? null
        : (typeof body.assignedTo === 'string' ? body.assignedTo.trim().slice(0, 200) || null : null)
      if (newAssigned !== existing.assignedTo) {
        data.assignedTo = newAssigned
        events.push({
          eventType: 'ASSIGN',
          fromValue: existing.assignedTo,
          toValue: newAssigned,
        })
      }
    }

    // §RELATED-INVOICE (optional — must belong to current business if provided)
    if (body.relatedInvoiceId !== undefined) {
      if (body.relatedInvoiceId === null) {
        data.relatedInvoiceId = null
      } else if (typeof body.relatedInvoiceId === 'string') {
        const invoice = await db.invoice.findFirst({
          where: { id: body.relatedInvoiceId, businessId: business.id },
          select: { id: true },
        })
        if (!invoice) {
          return NextResponse.json({ error: 'Invoice not found in your business' }, { status: 404 })
        }
        data.relatedInvoiceId = body.relatedInvoiceId
      }
    }

    // §RELATED-PRODUCT (optional — must belong to current business if provided)
    if (body.relatedProductId !== undefined) {
      if (body.relatedProductId === null) {
        data.relatedProductId = null
      } else if (typeof body.relatedProductId === 'string') {
        const product = await db.product.findFirst({
          where: { id: body.relatedProductId, businessId: business.id },
          select: { id: true },
        })
        if (!product) {
          return NextResponse.json({ error: 'Product not found in your business' }, { status: 404 })
        }
        data.relatedProductId = body.relatedProductId
      }
    }

    // §RESOLUTION (optional)
    if (body.resolution !== undefined) {
      if (typeof body.resolution !== 'string') {
        return NextResponse.json({ error: 'Resolution must be a string' }, { status: 400 })
      }
      data.resolution = body.resolution.trim().slice(0, 10000) || null
    }

    // §INTERNAL-NOTES (optional — append mode for new notes handled separately via events)
    if (body.internalNotes !== undefined) {
      if (typeof body.internalNotes !== 'string') {
        return NextResponse.json({ error: 'internalNotes must be a string' }, { status: 400 })
      }
      data.internalNotes = body.internalNotes.trim().slice(0, 5000) || null
    }

    // §SOURCE-TYPE (optional — rarely changed, but allowed for correction)
    if (body.sourceType !== undefined && body.sourceType !== null) {
      if (typeof body.sourceType !== 'string' || !COMPLAINT_SOURCE_TYPES.includes(body.sourceType as any)) {
        return NextResponse.json({ error: `Invalid sourceType. Must be one of: ${COMPLAINT_SOURCE_TYPES.join(', ')}` }, { status: 400 })
      }
      data.sourceType = body.sourceType
    }

    // §SOURCE-ID (optional)
    if (body.sourceId !== undefined) {
      if (body.sourceId === null) {
        data.sourceId = null
      } else if (typeof body.sourceId === 'string') {
        data.sourceId = body.sourceId.trim().slice(0, 200) || null
      }
    }

    // §ATOMIC-UPDATE: update complaint + append all events in one transaction
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id },
        data,
      })

      // §APPEND-EVENTS: create a ComplaintEvent for each state change
      for (const ev of events) {
        await tx.complaintEvent.create({
          data: {
            businessId: business.id,
            complaintId: id,
            eventType: ev.eventType,
            fromValue: ev.fromValue ?? null,
            toValue: ev.toValue ?? null,
            note: ev.note ?? null,
          },
        })
      }

      return updated
    })

    // §AUDIT: fire-and-forget. One audit entry per PUT (summarizing changes).
    if (events.length > 0) {
      await logAudit({
        businessId: business.id,
        action: 'complaint_update',
        entityType: 'complaint',
        entityId: id,
        description: `Complaint ${existing.complaintNumber} updated: ${events.map(e => e.eventType).join(', ')}`,
        metadata: JSON.stringify({
          complaintId: id,
          complaintNumber: existing.complaintNumber,
          events: events.map(e => ({ type: e.eventType, from: e.fromValue, to: e.toValue })),
        }),
      })
    }

    return NextResponse.json({ complaint: serializeDecimals(result) })
  } catch (e) {
    return apiError(e, 'Failed to update complaint')
  }
}

// DELETE /api/complaints/[id] — ARCHIVE (soft-delete) instead of hard-delete.
// Sets status=CLOSED if not already closed. Preserves the complaint + all
// event history. Returns 200 with the archived complaint.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const existing = await db.complaint.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, complaintNumber: true, status: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §ARCHIVE: if already CLOSED, just return (idempotent). Otherwise close.
    if (existing.status === 'CLOSED') {
      return NextResponse.json({ ok: true, archived: false, complaintId: id })
    }

    // §ATOMIC-ARCHIVE: set status=CLOSED + append CLOSE event
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.complaint.update({
        where: { id },
        data: { status: 'CLOSED' },
      })

      await tx.complaintEvent.create({
        data: {
          businessId: business.id,
          complaintId: id,
          eventType: 'CLOSE',
          fromValue: existing.status,
          toValue: 'CLOSED',
          note: 'Complaint archived via DELETE',
        },
      })

      return updated
    })

    // §AUDIT
    await logAudit({
      businessId: business.id,
      action: 'complaint_archive',
      entityType: 'complaint',
      entityId: id,
      description: `Complaint ${existing.complaintNumber} archived (closed)`,
      metadata: JSON.stringify({ complaintId: id, complaintNumber: existing.complaintNumber }),
    })

    return NextResponse.json({ ok: true, archived: true, complaint: serializeDecimals(result) })
  } catch (e) {
    return apiError(e, 'Failed to archive complaint')
  }
}
