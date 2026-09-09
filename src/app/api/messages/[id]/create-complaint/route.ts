import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §CREATE-COMPLAINT-FROM-MESSAGE: Creates a Complaint with sourceType=MESSAGE
// and sourceId=message.id. This links the complaint to the originating message.
//
// §FLOW:
//   Message (inbound customer message)
//     ↓ Create Complaint
//     ↓ Complaint.sourceType = MESSAGE
//     ↓ Complaint.sourceId = message.id
//     ↓ Complaint.partyId = message.partyId
//
// §TENANT-ISOLATION: message must belong to current business. The created
// complaint is business-scoped via the session.

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP: message must belong to current business
    const message = await db.message.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, body: true, partyId: true, conversationId: true, channel: true, direction: true },
    })
    if (!message) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    const body = await req.json()

    // §VALIDATE-TITLE (optional — defaults to message body preview)
    let title = body.title
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      title = message.body ? message.body.slice(0, 100) : 'Complaint from message'
    }
    title = title.trim().slice(0, 500)

    // §VALIDATE-PRIORITY (optional, defaults MEDIUM)
    const VALID_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
    let priority = 'MEDIUM'
    if (body.priority && typeof body.priority === 'string' && VALID_PRIORITIES.includes(body.priority)) {
      priority = body.priority
    }

    // §VALIDATE-DESCRIPTION (optional — defaults to message body)
    let description = body.description
    if (!description && message.body) {
      description = message.body
    }

    // §ATOMIC-CREATE: generate complaint number + create complaint + CREATED event
    const result = await db.$transaction(async (tx) => {
      // §GENERATE-NUMBER
      const seq = await tx.complaintSequence.upsert({
        where: { businessId: business.id },
        update: { nextNumber: { increment: 1 } },
        create: { businessId: business.id, nextNumber: 1 },
      })
      const complaintNumber = `CMP-${String(seq.nextNumber).padStart(4, '0')}`

      const complaint = await tx.complaint.create({
        data: {
          businessId: business.id,
          complaintNumber,
          partyId: message.partyId,
          sourceType: 'MESSAGE',
          sourceId: message.id,
          title,
          description,
          priority,
          status: 'NEW',
        },
      })

      await tx.complaintEvent.create({
        data: {
          businessId: business.id,
          complaintId: complaint.id,
          eventType: 'CREATED',
          toValue: 'NEW',
          note: `Complaint ${complaintNumber} created from message (channel: ${message.channel})`,
        },
      })

      return complaint
    })

    // §AUDIT
    await logAudit({
      businessId: business.id,
      action: 'complaint_create',
      entityType: 'complaint',
      entityId: result.id,
      description: `Complaint ${result.complaintNumber} created from message ${message.id}`,
      metadata: JSON.stringify({
        complaintId: result.id,
        complaintNumber: result.complaintNumber,
        messageId: message.id,
        sourceType: 'MESSAGE',
      }),
    })

    return NextResponse.json({ complaint: serializeDecimals(result) }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create complaint from message')
  }
}
