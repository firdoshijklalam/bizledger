import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { serializeDecimals } from '@/lib/decimal-serializer'
import {
  COMPLAINT_STATUSES,
  COMPLAINT_PRIORITIES,
  COMPLAINT_SOURCE_TYPES,
  generateComplaintNumber,
} from '@/lib/complaints'

// §COMPLAINTS-API: CRUD for complaints + event history.
//
// §TENANT-ISOLATION: businessId always from getCurrentBusiness() — never from
// body/URL. Every query scoped by businessId. Cross-tenant access → 404.
//
// §COMPLAINT-NUMBER: generated server-side via generateComplaintNumber()
// (atomic per-business sequence). Never trusted from client.

// GET /api/complaints — list complaints with optional filters
// Query params: ?status=NEW&priority=HIGH&assignedTo=X&partyId=Y&limit=50
export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const assignedTo = searchParams.get('assignedTo')
    const partyId = searchParams.get('partyId')
    const limitParam = searchParams.get('limit')
    const limit = limitParam ? Math.min(Number(limitParam) || 50, 200) : 50

    // §VALIDATE-FILTERS: only allow known enum values
    const where: any = { businessId: business.id }
    if (status && COMPLAINT_STATUSES.includes(status as any)) where.status = status
    if (priority && COMPLAINT_PRIORITIES.includes(priority as any)) where.priority = priority
    if (assignedTo) where.assignedTo = assignedTo
    if (partyId) where.partyId = partyId

    const complaints = await db.complaint.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        party: { select: { id: true, name: true, phone: true } },
      },
    })

    return NextResponse.json({ items: serializeDecimals(complaints) })
  } catch (e) {
    return apiError(e, 'Failed to fetch complaints')
  }
}

// POST /api/complaints — create a new complaint
// Body: { partyId?, title, description?, priority?, sourceType?, sourceId?,
//         assignedTo?, relatedInvoiceId?, relatedProductId?, internalNotes? }
export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()

    // §VALIDATE-TITLE (required)
    if (!body.title || typeof body.title !== 'string' || body.title.trim().length === 0) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 })
    }
    const title = body.title.trim()
    if (title.length > 500) {
      return NextResponse.json({ error: 'Title too long (max 500 chars)' }, { status: 400 })
    }

    // §VALIDATE-DESCRIPTION (optional)
    let description: string | null = null
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== 'string') {
        return NextResponse.json({ error: 'Description must be a string' }, { status: 400 })
      }
      const trimmedDesc = body.description.trim()
      if (trimmedDesc.length > 10000) {
        return NextResponse.json({ error: 'Description too long (max 10000 chars)' }, { status: 400 })
      }
      description = trimmedDesc || null
    }

    // §VALIDATE-PRIORITY (optional, defaults MEDIUM)
    let priority = 'MEDIUM'
    if (body.priority !== undefined && body.priority !== null) {
      if (typeof body.priority !== 'string' || !COMPLAINT_PRIORITIES.includes(body.priority as any)) {
        return NextResponse.json({ error: `Invalid priority. Must be one of: ${COMPLAINT_PRIORITIES.join(', ')}` }, { status: 400 })
      }
      priority = body.priority
    }

    // §VALIDATE-SOURCE-TYPE (optional, defaults MANUAL)
    let sourceType = 'MANUAL'
    if (body.sourceType !== undefined && body.sourceType !== null) {
      if (typeof body.sourceType !== 'string' || !COMPLAINT_SOURCE_TYPES.includes(body.sourceType as any)) {
        return NextResponse.json({ error: `Invalid sourceType. Must be one of: ${COMPLAINT_SOURCE_TYPES.join(', ')}` }, { status: 400 })
      }
      sourceType = body.sourceType
    }

    // §VALIDATE-SOURCE-ID (optional, free-form string — application-level ref)
    let sourceId: string | null = null
    if (body.sourceId !== undefined && body.sourceId !== null) {
      if (typeof body.sourceId !== 'string') {
        return NextResponse.json({ error: 'sourceId must be a string' }, { status: 400 })
      }
      sourceId = body.sourceId.trim().slice(0, 200) || null
    }

    // §VALIDATE-PARTY-ID (optional — verify ownership if provided)
    let partyId: string | null = null
    if (body.partyId !== undefined && body.partyId !== null) {
      if (typeof body.partyId !== 'string') {
        return NextResponse.json({ error: 'partyId must be a string' }, { status: 400 })
      }
      const party = await db.party.findFirst({
        where: { id: body.partyId, businessId: business.id },
        select: { id: true, name: true },
      })
      if (!party) {
        return NextResponse.json({ error: 'Party not found in your business' }, { status: 404 })
      }
      partyId = body.partyId
    }

    // §VALIDATE-ASSIGNED-TO (optional, free-form string like PartyNote.author)
    let assignedTo: string | null = null
    if (body.assignedTo !== undefined && body.assignedTo !== null) {
      if (typeof body.assignedTo !== 'string') {
        return NextResponse.json({ error: 'assignedTo must be a string' }, { status: 400 })
      }
      assignedTo = body.assignedTo.trim().slice(0, 200) || null
    }

    // §VALIDATE-RELATED-INVOICE (optional — must belong to current business)
    let relatedInvoiceId: string | null = null
    if (body.relatedInvoiceId !== undefined && body.relatedInvoiceId !== null) {
      if (typeof body.relatedInvoiceId !== 'string') {
        return NextResponse.json({ error: 'relatedInvoiceId must be a string' }, { status: 400 })
      }
      const invoice = await db.invoice.findFirst({
        where: { id: body.relatedInvoiceId, businessId: business.id },
        select: { id: true },
      })
      if (!invoice) {
        return NextResponse.json({ error: 'Invoice not found in your business' }, { status: 404 })
      }
      relatedInvoiceId = body.relatedInvoiceId
    }

    // §VALIDATE-RELATED-PRODUCT (optional — must belong to current business)
    let relatedProductId: string | null = null
    if (body.relatedProductId !== undefined && body.relatedProductId !== null) {
      if (typeof body.relatedProductId !== 'string') {
        return NextResponse.json({ error: 'relatedProductId must be a string' }, { status: 400 })
      }
      const product = await db.product.findFirst({
        where: { id: body.relatedProductId, businessId: business.id },
        select: { id: true, name: true },
      })
      if (!product) {
        return NextResponse.json({ error: 'Product not found in your business' }, { status: 404 })
      }
      relatedProductId = body.relatedProductId
    }

    // §VALIDATE-INTERNAL-NOTES (optional — stored as JSON array)
    let internalNotes: string | null = null
    if (body.internalNotes !== undefined && body.internalNotes !== null) {
      if (typeof body.internalNotes !== 'string') {
        return NextResponse.json({ error: 'internalNotes must be a string' }, { status: 400 })
      }
      internalNotes = body.internalNotes.trim().slice(0, 5000) || null
    }

    // §ATOMIC-CREATE: generate complaint number + create complaint + create
    // CREATED event in a single transaction. If any step fails, all roll back.
    // §TIMEOUT: 30s timeout (SQLite default is 5s which is too short for
    // concurrent complaint creation under the single-writer lock).
    const result = await db.$transaction(async (tx) => {
      // §GENERATE-NUMBER: atomic per-business sequence.
      // upsert creates with nextNumber=1 on first call, then increments.
      // seq.nextNumber is the AFTER-increment value, so use it directly.
      // First call: create nextNumber=1 → seq.nextNumber=1 → CMP-0001.
      // Second call: increment → seq.nextNumber=2 → CMP-0002.
      const seq = await tx.complaintSequence.upsert({
        where: { businessId: business.id },
        update: { nextNumber: { increment: 1 } },
        create: { businessId: business.id, nextNumber: 1 },
      })
      const complaintNumber = `CMP-${String(seq.nextNumber).padStart(4, '0')}`

      // §CREATE-COMPLAINT
      const complaint = await tx.complaint.create({
        data: {
          businessId: business.id,
          complaintNumber,
          partyId,
          sourceType,
          sourceId,
          title,
          description,
          priority,
          assignedTo,
          relatedInvoiceId,
          relatedProductId,
          internalNotes,
        },
      })

      // §CREATED-EVENT: append the first event
      const event = await tx.complaintEvent.create({
        data: {
          businessId: business.id,
          complaintId: complaint.id,
          eventType: 'CREATED',
          toValue: complaint.status,
          note: `Complaint ${complaintNumber} created with priority ${complaint.priority}`,
        },
      })

      return { complaint, event }
    }, { timeout: 30000 })

    // §AUDIT: fire-and-forget (non-fatal)
    await logAudit({
      businessId: business.id,
      action: 'complaint_create',
      entityType: 'complaint',
      entityId: result.complaint.id,
      description: `Complaint ${result.complaint.complaintNumber} created: ${title}`,
      metadata: JSON.stringify({
        complaintId: result.complaint.id,
        complaintNumber: result.complaint.complaintNumber,
        partyId,
        priority,
        sourceType,
      }),
    })

    return NextResponse.json(
      { complaint: serializeDecimals(result.complaint) },
      { status: 201 }
    )
  } catch (e) {
    return apiError(e, 'Failed to create complaint')
  }
}
