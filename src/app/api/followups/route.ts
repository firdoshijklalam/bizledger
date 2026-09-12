import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  FOLLOW_UP_TYPES,
  FOLLOW_UP_STATUSES,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_SOURCE_TYPES,
  generateFollowUpNumber,
  createdEvent,
  assertPartyBelongsToBusiness,
  assertUserBelongsToBusiness,
  assertInvoiceBelongsToBusiness,
  assertComplaintBelongsToBusiness,
  validateSourceType,
  isValidType,
  isValidPriority,
  FollowUpDomainError,
} from '@/lib/followups'

// §FOLLOWUPS-API: CRUD for customer follow-ups.
//
// §TENANT-ISOLATION: businessId always from requireAuth() (session-derived) —
// never from body/URL. Every query scoped by businessId. Cross-tenant → 404.
//
// §AUTH: requireAuth() returns the authenticated user (with businessId from
// the session). The user.id is used as createdById / actor / completedById.
//
// §NUMBERING: followUpNumber generated server-side via generateFollowUpNumber()
// (atomic per-business sequence). Never trusted from client.

// GET /api/followups — list follow-ups with optional filters
// Query params: ?partyId&status&priority&type&assignedToId&sourceType
//                &dueFrom&dueTo&overdue&limit&offset
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    const status = searchParams.get('status')
    const priority = searchParams.get('priority')
    const type = searchParams.get('type')
    const assignedToId = searchParams.get('assignedToId')
    const sourceType = searchParams.get('sourceType')
    const dueFrom = searchParams.get('dueFrom')
    const dueTo = searchParams.get('dueTo')
    const overdue = searchParams.get('overdue')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // §VALIDATE-FILTERS: only allow known enum values (reject invalid silently)
    const where: any = { businessId: user.businessId }
    if (partyId) where.partyId = partyId
    if (status && FOLLOW_UP_STATUSES.includes(status as any)) where.status = status
    if (priority && FOLLOW_UP_PRIORITIES.includes(priority as any)) where.priority = priority
    if (type && FOLLOW_UP_TYPES.includes(type as any)) where.type = type
    if (assignedToId) where.assignedToId = assignedToId
    if (sourceType && FOLLOW_UP_SOURCE_TYPES.includes(sourceType as any)) where.sourceType = sourceType

    // §DATE-RANGE: dueFrom/dueTo filter on dueAt
    if (dueFrom || dueTo) {
      where.dueAt = {}
      if (dueFrom) {
        const d = new Date(dueFrom)
        if (!isNaN(d.getTime())) where.dueAt.gte = d
      }
      if (dueTo) {
        const d = new Date(dueTo)
        if (!isNaN(d.getTime())) where.dueAt.lte = d
      }
    }

    // §OVERDUE: derived filter — PENDING + dueAt < now + NOT snoozed
    if (overdue === 'true' || overdue === '1') {
      const now = new Date()
      where.status = 'PENDING'
      where.dueAt = { ...where.dueAt, lt: now }
      where.snoozedUntil = null
    }

    // §PAGINATION: validate numeric, cap at 200
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 50, 1), 200) : 50
    const offset = offsetParam ? Math.max(Number(offsetParam) || 0, 0) : 0

    // §ORDERING: deterministic — dueAt ASC NULLS LAST (via nullsLast), then
    // createdAt DESC, then id DESC. Prisma supports `nullsLast` on PostgreSQL;
    // on SQLite it's emulated. The composite ordering ensures stable pagination.
    const [items, total] = await Promise.all([
      db.followUp.findMany({
        where,
        orderBy: [
          { dueAt: { sort: 'asc', nulls: 'last' } },
          { createdAt: 'desc' },
          { id: 'desc' },
        ],
        take: limit,
        skip: offset,
        select: {
          id: true, followUpNumber: true, businessId: true,
          partyId: true, type: true, sourceType: true, sourceId: true,
          title: true, description: true, status: true, priority: true,
          assignedToId: true, createdById: true,
          dueAt: true, snoozedUntil: true, completedAt: true, completedById: true,
          outcome: true, relatedInvoiceId: true, relatedComplaintId: true,
          createdAt: true, updatedAt: true,
          party: { select: { id: true, name: true, phone: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      db.followUp.count({ where }),
    ])

    return NextResponse.json(serializeDecimals({
      items,
      total,
      hasMore: offset + limit < total,
    }))
  } catch (e) {
    return apiError(e, 'Failed to fetch follow-ups')
  }
}

// POST /api/followups — create a new follow-up
// Body: { partyId, type, title, dueAt, description?, priority?, assignedToId?,
//         sourceType?, sourceId?, relatedInvoiceId?, relatedComplaintId? }
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const body = await req.json()

    // §REQUIRED-FIELDS: partyId, type, title, dueAt
    if (!body.partyId || typeof body.partyId !== 'string') {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }
    if (!body.title || typeof body.title !== 'string' || !body.title.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 })
    }
    if (!body.dueAt) {
      return NextResponse.json({ error: 'dueAt is required' }, { status: 400 })
    }
    const dueAt = new Date(body.dueAt)
    if (isNaN(dueAt.getTime())) {
      return NextResponse.json({ error: 'Invalid dueAt date' }, { status: 400 })
    }

    // §TYPE-VALIDATION: canonical enums only
    const type = body.type || 'manual'
    if (!isValidType(type)) {
      return NextResponse.json({ error: `Invalid type: ${type}` }, { status: 400 })
    }

    const priority = body.priority || 'MEDIUM'
    if (!isValidPriority(priority)) {
      return NextResponse.json({ error: `Invalid priority: ${priority}` }, { status: 400 })
    }

    const sourceType = body.sourceType || 'MANUAL'
    const sourceId = body.sourceId ?? null
    const sourceValidation = validateSourceType(sourceType, sourceId)
    if (!sourceValidation.ok) {
      return NextResponse.json({ error: sourceValidation.error }, { status: 400 })
    }

    // §TENANT-OWNERSHIP-VALIDATION: verify all referenced entities belong to
    // the authenticated user's business. DB FKs validate existence but NOT
    // cross-tenant safety — these helpers close that gap.
    try {
      await assertPartyBelongsToBusiness(db, body.partyId, user.businessId)
      if (body.assignedToId) {
        await assertUserBelongsToBusiness(db, body.assignedToId, user.businessId)
      }
      if (body.relatedInvoiceId) {
        await assertInvoiceBelongsToBusiness(db, body.relatedInvoiceId, user.businessId)
      }
      if (body.relatedComplaintId) {
        await assertComplaintBelongsToBusiness(db, body.relatedComplaintId, user.businessId)
      }
    } catch (e) {
      if (e instanceof FollowUpDomainError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      throw e
    }

    // §ATOMIC-CREATE: followUpNumber generation + followUp create + CREATED event
    // all in ONE transaction. If any step fails, all roll back.
    const result = await db.$transaction(async (tx) => {
      const followUpNumber = await generateFollowUpNumber(tx, user.businessId)

      const followUp = await tx.followUp.create({
        data: {
          businessId: user.businessId,
          followUpNumber,
          partyId: body.partyId,
          type,
          sourceType,
          sourceId,
          title: body.title.trim(),
          description: body.description?.trim() || null,
          status: 'PENDING',
          priority,
          assignedToId: body.assignedToId || null,
          createdById: user.id, // §SERVER-DERIVED: never from client
          dueAt,
          relatedInvoiceId: body.relatedInvoiceId || null,
          relatedComplaintId: body.relatedComplaintId || null,
        },
      })

      // §CREATED-EVENT: append-only audit trail. Actor = authenticated user.
      await tx.followUpEvent.create({
        data: createdEvent({
          businessId: user.businessId,
          followUpId: followUp.id,
          actor: user.id,
        }),
      })

      return followUp
    })

    return NextResponse.json(serializeDecimals(result), { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create follow-up')
  }
}
