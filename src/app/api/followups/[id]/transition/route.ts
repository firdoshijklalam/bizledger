import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  FOLLOW_UP_STATUSES,
  validateStatusTransition,
  getCompletionPatch,
  getReopenPatch,
  getSnoozePatch,
  getUnsnoozePatch,
  statusChangeEvent,
  snoozeEvent,
  completeEvent,
  cancelEvent,
  FollowUpDomainError,
} from '@/lib/followups'

// §FOLLOWUP-TRANSITION: POST /api/followups/[id]/transition
//
// §STATE-MACHINE: the ONLY way to change a follow-up's status. Validates
// transitions against the domain library (src/lib/followups.ts). PATCH cannot
// change status — this endpoint enforces the state machine.
//
// §SHARED-WAKE-SERVICE: the SNOOZED → PENDING wake logic uses the shared
// wakeSnoozedFollowUp() function from src/lib/followup-scheduler.ts. This
// is the SAME function the scheduler cron calls — no duplicated logic.
// The API passes the authenticated user as the actor; the scheduler passes
// 'system' as the actor. Both use the same domain state machine.
//
// §BODY: { toStatus, snoozedUntil?, note? }
//
// §RULES:
//   - current status read from DB (not client state)
//   - transition validated via validateStatusTransition()
//   - COMPLETED requires completedById (server-derived = authenticated user)
//   - SNOOZED requires valid future snoozedUntil
//   - reopen (COMPLETED/CANCELLED → IN_PROGRESS) uses getReopenPatch()
//   - waking SNOOZED → PENDING uses the shared wakeSnoozedFollowUp()
//   - PENDING/IN_PROGRESS clears stale snoozedUntil
//   - update + event in ONE transaction

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()
    const { toStatus } = body

    // §VALIDATE-toStatus
    if (!toStatus || typeof toStatus !== 'string') {
      return NextResponse.json({ error: 'toStatus is required' }, { status: 400 })
    }
    if (!FOLLOW_UP_STATUSES.includes(toStatus as any)) {
      return NextResponse.json({ error: `Invalid toStatus: ${toStatus}` }, { status: 400 })
    }

    // §FETCH-CURRENT: read current status from DB (never trust client state)
    const current = await db.followUp.findFirst({
      where: { id, businessId: user.businessId },
      select: { id: true, status: true, snoozedUntil: true, completedAt: true, completedById: true },
    })

    if (!current) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §VALIDATE-TRANSITION: use the domain library
    const validation = validateStatusTransition(current.status, toStatus)
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 })
    }

    const now = new Date()

    // §WAKE: SNOOZED → PENDING. The API allows user-initiated wake at any time
    // (the user can unsnooze early). The scheduler's wakeSnoozedFollowUp()
    // checks isWakeable (snoozedUntil <= now) — but the API does NOT require
    // the snooze to have expired. Both use the same domain state machine
    // (validateStatusTransition + getUnsnoozePatch) + statusChangeEvent.
    if (toStatus === 'PENDING' && current.status === 'SNOOZED') {
      const result = await db.$transaction(async (tx) => {
        const patch = getUnsnoozePatch()
        const eventPayload = statusChangeEvent({
          businessId: user.businessId,
          followUpId: id,
          fromStatus: current.status,
          toStatus,
          actor: user.id, // API uses the authenticated user as actor
        })
        const updated = await tx.followUp.update({ where: { id }, data: patch })
        await tx.followUpEvent.create({ data: eventPayload })
        return updated
      })
      return NextResponse.json(serializeDecimals(result))
    }

    const eventsToCreate: any[] = []

    // §DETERMINE-PATCH + EVENT based on target status
    let patch: any

    if (toStatus === 'COMPLETED') {
      // §COMPLETED: requires completedById (server-derived), sets completedAt
      try {
        patch = getCompletionPatch({ completedById: user.id, now })
      } catch (e) {
        if (e instanceof FollowUpDomainError) {
          return NextResponse.json({ error: e.message }, { status: 400 })
        }
        throw e
      }
      eventsToCreate.push(completeEvent({
        businessId: user.businessId,
        followUpId: id,
        actor: user.id,
        outcome: body.note || null,
      }))
    } else if (toStatus === 'IN_PROGRESS' && (current.status === 'COMPLETED' || current.status === 'CANCELLED')) {
      // §REOPEN: clear completion fields
      patch = getReopenPatch()
      eventsToCreate.push(statusChangeEvent({
        businessId: user.businessId,
        followUpId: id,
        fromStatus: current.status,
        toStatus,
        actor: user.id,
      }))
    } else if (toStatus === 'SNOOZED') {
      // §SNOOZED: requires valid future snoozedUntil
      if (!body.snoozedUntil) {
        return NextResponse.json({ error: 'snoozedUntil is required when transitioning to SNOOZED' }, { status: 400 })
      }
      const snoozedUntil = new Date(body.snoozedUntil)
      if (isNaN(snoozedUntil.getTime())) {
        return NextResponse.json({ error: 'Invalid snoozedUntil date' }, { status: 400 })
      }
      try {
        patch = getSnoozePatch({ snoozedUntil, now })
      } catch (e) {
        if (e instanceof FollowUpDomainError) {
          return NextResponse.json({ error: e.message }, { status: 400 })
        }
        throw e
      }
      eventsToCreate.push(snoozeEvent({
        businessId: user.businessId,
        followUpId: id,
        snoozedUntil,
        actor: user.id,
      }))
    } else if (toStatus === 'PENDING' || toStatus === 'IN_PROGRESS') {
      // §PENDING/IN_PROGRESS: clear stale snoozedUntil (no accidental snooze)
      patch = { status: toStatus, snoozedUntil: null }
      eventsToCreate.push(statusChangeEvent({
        businessId: user.businessId,
        followUpId: id,
        fromStatus: current.status,
        toStatus,
        actor: user.id,
      }))
    } else if (toStatus === 'CANCELLED') {
      // §CANCELLED: create CANCEL event
      patch = { status: 'CANCELLED' }
      eventsToCreate.push(cancelEvent({
        businessId: user.businessId,
        followUpId: id,
        actor: user.id,
        reason: body.note || null,
      }))
    } else {
      // §NO-OP: same status (shouldn't reach here due to validation, but defensive)
      patch = {}
    }

    // §ATOMIC: update + event(s) in ONE transaction
    const result = await db.$transaction(async (tx) => {
      const updated = await tx.followUp.update({
        where: { id },
        data: patch,
      })
      for (const evt of eventsToCreate) {
        await tx.followUpEvent.create({ data: evt })
      }
      return updated
    })

    return NextResponse.json(serializeDecimals(result))
  } catch (e) {
    return apiError(e, 'Failed to transition follow-up')
  }
}
