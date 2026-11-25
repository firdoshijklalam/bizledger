import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  COMPLAINT_PRIORITIES,
} from '@/lib/complaints'

// §FEEDBACK-COMPLAINT: POST /api/feedback/[id]/complaint — escalate a
// ProductFeedback record into a first-class Complaint.
//
// §TENANT-ISOLATION: businessId always from requireAuth() (session-derived).
// The feedback record is fetched by id + businessId — cross-tenant → 404.
//
// §SOURCE-LINKAGE: the resulting Complaint has:
//   - sourceType = 'FEEDBACK' (canonical ComplaintSourceType)
//   - sourceId   = <productFeedbackId> (application-level ref — no DB FK)
//   - productFeedbackId = <productFeedbackId> (explicit FK, onDelete: SetNull)
//   - partyId / relatedInvoiceId / relatedProductId copied from the feedback
//
// §NUMBERING: complaintNumber generated server-side via ComplaintSequence
// upsert + { increment: 1 } inside the same $transaction. Mirrors
// src/app/api/complaints/route.ts POST.

// POST /api/feedback/[id]/complaint — create a Complaint from this feedback
// Body (all optional): { title?, description?, priority? }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json().catch(() => ({}))

    // §FETCH-FEEDBACK: tenant-scoped read.
    const feedback = await db.productFeedback.findFirst({
      where: { id, businessId: user.businessId },
      select: {
        id: true, partyId: true, invoiceId: true, productId: true,
        rating: true, comment: true, status: true,
      },
    })

    if (!feedback) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §TITLE: default to a sensible message derived from the feedback.
    // The caller can override with their own title (e.g. "Damaged packaging").
    let title: string
    if (body.title && typeof body.title === 'string' && body.title.trim().length > 0) {
      title = body.title.trim().slice(0, 500)
    } else {
      const rating = feedback.rating ?? 'n/a'
      title = `Feedback escalated to complaint (rating=${rating})`
    }

    // §DESCRIPTION: default to the feedback comment (if any).
    let description: string | null = null
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== 'string') {
        return NextResponse.json({ error: 'Description must be a string' }, { status: 400 })
      }
      const trimmed = body.description.trim().slice(0, 10000)
      description = trimmed || null
    } else if (feedback.comment) {
      description = feedback.comment.slice(0, 10000)
    }

    // §PRIORITY: optional, defaults MEDIUM.
    let priority = 'MEDIUM'
    if (body.priority !== undefined && body.priority !== null) {
      if (typeof body.priority !== 'string' || !COMPLAINT_PRIORITIES.includes(body.priority as any)) {
        return NextResponse.json(
          { error: `Invalid priority. Must be one of: ${COMPLAINT_PRIORITIES.join(', ')}` },
          { status: 400 },
        )
      }
      priority = body.priority
    }

    // §ATOMIC-CREATE: complaintNumber + complaint + CREATED event in ONE
    // transaction. Mirrors src/app/api/complaints/route.ts POST.
    const result = await db.$transaction(async (tx) => {
      // §GENERATE-NUMBER: atomic per-business sequence. upsert creates with
      // nextNumber=1 on first call, then increments. seq.nextNumber is the
      // AFTER-increment value, so use it directly (CMP-0001 on first call).
      const seq = await tx.complaintSequence.upsert({
        where: { businessId: user.businessId },
        update: { nextNumber: { increment: 1 } },
        create: { businessId: user.businessId, nextNumber: 1 },
      })
      const complaintNumber = `CMP-${String(seq.nextNumber).padStart(4, '0')}`

      // §CREATE-COMPLAINT: sourceType='FEEDBACK', sourceId=feedback.id,
      // productFeedbackId=feedback.id (explicit FK), and copy the related
      // partyId/invoiceId/productId from the feedback record.
      const complaint = await tx.complaint.create({
        data: {
          businessId: user.businessId,
          complaintNumber,
          partyId: feedback.partyId,
          sourceType: 'FEEDBACK',
          sourceId: feedback.id,
          title,
          description,
          priority,
          relatedInvoiceId: feedback.invoiceId,
          relatedProductId: feedback.productId,
          productFeedbackId: feedback.id,
        },
      })

      // §CREATED-EVENT: append the first event on the complaint.
      await tx.complaintEvent.create({
        data: {
          businessId: user.businessId,
          complaintId: complaint.id,
          eventType: 'CREATED',
          toValue: complaint.status,
          note: `Complaint ${complaintNumber} created from feedback ${feedback.id} with priority ${complaint.priority}`,
        },
      })

      return complaint
    }, { timeout: 30000 })

    return NextResponse.json(
      { complaint: serializeDecimals(result) },
      { status: 201 },
    )
  } catch (e) {
    return apiError(e, 'Failed to create complaint from feedback')
  }
}
