import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  completeEvent,
  FollowUpDomainError,
} from '@/lib/followups'
import {
  FEEDBACK_STATUSES,
  validateFeedbackStatusTransition,
  isValidRating,
  ProductFeedbackDomainError,
} from '@/lib/product-feedback'

// §FEEDBACK-ITEM: GET / PATCH for a single ProductFeedback record.
//
// §TENANT-ISOLATION: every query uses findFirst({ where: { id, businessId } })
// — both id AND businessId must match. Cross-tenant → 404.
//
// §STATUS-MUTATION-VIA-PATCH: PATCH is the canonical endpoint for submitting
// feedback (rating + comment). Unlike the FollowUp PATCH (which forbids
// status mutation and requires /transition), the feedback PATCH DOES allow
// status transitions because the only legal transitions are
// pending→submitted / scheduled→submitted / pending→skipped / scheduled→skipped,
// all of which require the rating/comment payload that the body provides.

// GET /api/feedback/[id] — return one ProductFeedback with relations
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params

    const feedback = await db.productFeedback.findFirst({
      where: { id, businessId: user.businessId },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        product: { select: { id: true, name: true, sku: true } },
        invoice: { select: { id: true, invoiceNumber: true, grandTotal: true } },
        followUp: { select: { id: true, followUpNumber: true, status: true, dueAt: true } },
      },
    })

    if (!feedback) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    return NextResponse.json(serializeDecimals({ feedback }))
  } catch (e) {
    return apiError(e, 'Failed to fetch product feedback')
  }
}

// PATCH /api/feedback/[id] — submit or update feedback
// Body: { rating?, comment?, status? }
//
// §SUBMIT-FLOW: when status transitions to 'submitted':
//   - rating is REQUIRED (1-5 integer; cannot submit without a rating)
//   - comment is optional (max 1000 chars)
//   - submittedAt = now (server-derived)
//
// §SKIP-FLOW: when status transitions to 'skipped':
//   - rating is NOT required (the customer declined to leave feedback)
//   - comment optional (reason for skipping)
//
// §LINKED-FOLLOWUP: if a FollowUp is linked, transition it to COMPLETED with
// outcome = `rating=N; comment=...` (or 'skipped'). The FollowUp is the
// reminder that prompted the feedback — completing it closes the loop.
//
// §NO-REOPEN: a 'submitted' record cannot transition back to 'pending' or
// 'scheduled'. The rating can be edited (PATCH rating/comment on a submitted
// record), but the status stays 'submitted'.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()

    // §FETCH-CURRENT: tenant-scoped read for the current state.
    const current = await db.productFeedback.findFirst({
      where: { id, businessId: user.businessId },
      select: {
        id: true, status: true, rating: true, comment: true,
        followUpId: true,
      },
    })

    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §REJECT-CONTROLLED-FIELDS: client cannot set businessId, partyId,
    // invoiceId, productId, followUpId, requestedAt, submittedAt, expiresAt,
    // createdAt, updatedAt directly.
    if (
      body.businessId !== undefined ||
      body.partyId !== undefined ||
      body.invoiceId !== undefined ||
      body.productId !== undefined ||
      body.followUpId !== undefined ||
      body.requestedAt !== undefined ||
      body.submittedAt !== undefined ||
      body.expiresAt !== undefined
    ) {
      return NextResponse.json({ error: 'This field cannot be set via PATCH' }, { status: 400 })
    }

    const updates: any = {}
    const now = new Date()

    // §STATUS-TRANSITION: optional. If provided, validate via the state machine.
    let targetStatus: string | undefined
    if (body.status !== undefined) {
      if (typeof body.status !== 'string' || !FEEDBACK_STATUSES.includes(body.status as any)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${FEEDBACK_STATUSES.join(', ')}` },
          { status: 400 },
        )
      }
      const transition = validateFeedbackStatusTransition(current.status, body.status)
      if (!transition.ok) {
        return NextResponse.json({ error: transition.error }, { status: 400 })
      }
      targetStatus = body.status
      updates.status = targetStatus
    }

    // §RATING: validate if provided. Required when transitioning to 'submitted'.
    let rating: number | undefined
    if (body.rating !== undefined && body.rating !== null) {
      if (!isValidRating(body.rating)) {
        return NextResponse.json(
          { error: `rating must be an integer between 1 and 5` },
          { status: 400 },
        )
      }
      rating = Number(body.rating)
      updates.rating = rating
    }

    // §COMMENT: optional, max 1000 chars.
    if (body.comment !== undefined && body.comment !== null) {
      if (typeof body.comment !== 'string') {
        return NextResponse.json({ error: 'comment must be a string' }, { status: 400 })
      }
      const trimmed = body.comment.trim().slice(0, 1000)
      updates.comment = trimmed || null
    }

    // §SUBMIT-REQUIRES-RATING: transitioning to 'submitted' REQUIRES a rating.
    // If the caller didn't provide one AND the current record doesn't already
    // have one, reject. (Re-submitting an already-submitted record with a
    // rating edit is allowed — the rating is already set.)
    if (targetStatus === 'submitted' && !rating && current.rating == null) {
      return NextResponse.json(
        { error: 'rating is required when transitioning to submitted' },
        { status: 400 },
      )
    }

    // §SUBMITTED-AT: server-derived when transitioning to 'submitted'.
    if (targetStatus === 'submitted') {
      updates.submittedAt = now
    }

    // §ATOMIC-UPDATE: ProductFeedback update + linked FollowUp transition
    // (if a followUp exists) + COMPLETE event on the followUp — all in ONE
    // transaction. If any step fails, all roll back.
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.productFeedback.update({
        where: { id },
        data: updates,
        include: {
          party: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, sku: true } },
          invoice: { select: { id: true, invoiceNumber: true, grandTotal: true } },
          followUp: { select: { id: true, followUpNumber: true, status: true, dueAt: true } },
        },
      })

      // §LINKED-FOLLOWUP: if a FollowUp is linked AND we transitioned the
      // feedback to a terminal state (submitted or skipped), mark the
      // follow-up COMPLETED with an outcome note. This closes the reminder.
      if (current.followUpId && (targetStatus === 'submitted' || targetStatus === 'skipped')) {
        const outcome = targetStatus === 'submitted'
          ? `rating=${updated.rating ?? 'n/a'}; comment=${updated.comment ?? ''}`
          : 'skipped'
        await tx.followUp.update({
          where: { id: current.followUpId },
          data: {
            status: 'COMPLETED',
            completedAt: now,
            completedById: user.id, // §SERVER-DERIVED
            snoozedUntil: null,
            outcome,
          },
        })
        await tx.followUpEvent.create({
          data: completeEvent({
            businessId: user.businessId,
            followUpId: current.followUpId,
            actor: user.id,
            outcome,
          }),
        })
      }

      return updated
    })

    return NextResponse.json(serializeDecimals(result))
  } catch (e) {
    if (e instanceof FollowUpDomainError || e instanceof ProductFeedbackDomainError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    return apiError(e, 'Failed to update product feedback')
  }
}
