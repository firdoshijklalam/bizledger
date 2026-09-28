import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  assertPartyBelongsToBusiness,
  assertInvoiceBelongsToBusiness,
  generateFollowUpNumber,
  createdEvent,
  FollowUpDomainError,
} from '@/lib/followups'
import {
  FEEDBACK_STATUSES,
  FEEDBACK_ACTIVE_STATUSES,
  FEEDBACK_DELAY_DEFAULT_HOURS,
  FEEDBACK_DELAY_MIN_HOURS,
  FEEDBACK_DELAY_MAX_HOURS,
  calculateFeedbackRequestTime,
  calculateFeedbackExpiryTime,
  assertProductBelongsToBusiness,
  ProductFeedbackDomainError,
} from '@/lib/product-feedback'

// §FEEDBACK-API: CRUD for first-class product feedback requests.
//
// §TENANT-ISOLATION: businessId always from requireAuth() (session-derived) —
// never from body/URL. Every query scoped by businessId. Cross-tenant → 404.
//
// §LINKED-FOLLOWUP: POST creates a ProductFeedback + a system FollowUp
// (type='product_feedback', sourceType='SYSTEM_CREATED', sourceId=feedback.id)
// atomically inside one $transaction. The FollowUp is the reminder that will
// be due at the requestedAt time. The link ProductFeedback.followUpId is set
// AFTER both records are created (chicken-and-egg).

// GET /api/feedback — list feedback for the authenticated business
// Query params: ?partyId&productId&invoiceId&status&limit&offset
export async function GET(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    const productId = searchParams.get('productId')
    const invoiceId = searchParams.get('invoiceId')
    const status = searchParams.get('status')
    const limitParam = searchParams.get('limit')
    const offsetParam = searchParams.get('offset')

    // §VALIDATE-FILTERS: only allow known enum values (reject invalid silently)
    const where: any = { businessId: user.businessId }
    if (partyId) where.partyId = partyId
    if (productId) where.productId = productId
    if (invoiceId) where.invoiceId = invoiceId
    if (status && FEEDBACK_STATUSES.includes(status as any)) where.status = status

    // §PAGINATION: validate numeric, cap at 200
    const limit = limitParam ? Math.min(Math.max(Number(limitParam) || 50, 1), 200) : 50
    const offset = offsetParam ? Math.max(Number(offsetParam) || 0, 0) : 0

    const [items, total] = await Promise.all([
      db.productFeedback.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit,
        skip: offset,
        select: {
          id: true, businessId: true, partyId: true, invoiceId: true,
          productId: true, followUpId: true, status: true, rating: true,
          comment: true, metadata: true, requestedAt: true, submittedAt: true,
          expiresAt: true, createdAt: true, updatedAt: true,
          party: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, sku: true } },
          invoice: { select: { id: true, invoiceNumber: true, grandTotal: true } },
          followUp: { select: { id: true, followUpNumber: true, status: true, dueAt: true } },
        },
      }),
      db.productFeedback.count({ where }),
    ])

    return NextResponse.json(serializeDecimals({
      items,
      total,
      hasMore: offset + limit < total,
    }))
  } catch (e) {
    return apiError(e, 'Failed to fetch product feedback')
  }
}

// POST /api/feedback — create/schedule a feedback request
// Body: { partyId (required), productId?, invoiceId?, delayHours? }
//
// §DELAY-HOURS: optional override for the AppSettings.feedbackDelayHours
// default. Range 1-168. If omitted, falls back to the business's AppSettings
// value (default 48h on schema).
//
// §DUPLICATE-PREVENTION: at most one ProductFeedback with status in
// (pending, scheduled) for the same (businessId, partyId, invoiceId, productId)
// tuple. A second POST for the same tuple returns 409 Conflict.
export async function POST(req: NextRequest) {
  try {
    const user = await requireAuth()
    if (user instanceof NextResponse) return user

    const body = await req.json()

    // §REQUIRED-FIELDS: partyId is the only required field. productId/invoiceId
    // are optional — a feedback request can be for a generic purchase, a
    // specific product, or tied to a specific invoice.
    if (!body.partyId || typeof body.partyId !== 'string') {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }

    // §DELAY-HOURS-VALIDATION: optional override. Accept finite numbers OR
    // non-empty numeric strings (HTML <input type=number> sends strings).
    // Reject booleans/null/objects/arrays/non-numeric/over-max/under-min.
    let delayHours: number = FEEDBACK_DELAY_DEFAULT_HOURS
    if (body.delayHours !== undefined && body.delayHours !== null) {
      const v = body.delayHours
      const isAcceptableType = typeof v === 'number' || (typeof v === 'string' && v.trim() !== '')
      if (!isAcceptableType) {
        return NextResponse.json(
          { error: `delayHours must be a finite integer between ${FEEDBACK_DELAY_MIN_HOURS} and ${FEEDBACK_DELAY_MAX_HOURS}` },
          { status: 400 },
        )
      }
      const n = Number(v)
      if (!Number.isFinite(n) || !Number.isInteger(n) || n < FEEDBACK_DELAY_MIN_HOURS || n > FEEDBACK_DELAY_MAX_HOURS) {
        return NextResponse.json(
          { error: `delayHours must be a finite integer between ${FEEDBACK_DELAY_MIN_HOURS} and ${FEEDBACK_DELAY_MAX_HOURS}` },
          { status: 400 },
        )
      }
      delayHours = n
    } else {
      // §FALLBACK: load the business's AppSettings.feedbackDelayHours (default
      // 48 from the schema). If settings don't exist yet, the schema default
      // applies — we still need the row to exist for the relation; if it
      // doesn't, we use FEEDBACK_DELAY_DEFAULT_HOURS.
      const settings = await db.appSettings.findUnique({
        where: { businessId: user.businessId },
        select: { feedbackDelayHours: true },
      })
      if (settings?.feedbackDelayHours) {
        delayHours = settings.feedbackDelayHours
      }
    }

    // §TENANT-OWNERSHIP-VALIDATION: verify all referenced entities belong to
    // the authenticated user's business. DB FKs validate existence but NOT
    // cross-tenant safety — these helpers close that gap.
    try {
      await assertPartyBelongsToBusiness(db, body.partyId, user.businessId)
      if (body.productId) {
        await assertProductBelongsToBusiness(db, body.productId, user.businessId)
      }
      if (body.invoiceId) {
        await assertInvoiceBelongsToBusiness(db, body.invoiceId, user.businessId)
      }
    } catch (e) {
      if (e instanceof FollowUpDomainError || e instanceof ProductFeedbackDomainError) {
        return NextResponse.json({ error: e.message }, { status: 400 })
      }
      throw e
    }

    // §DUPLICATE-PREVENTION: check if an ACTIVE feedback request already
    // exists for the same (businessId, partyId, invoiceId, productId) tuple.
    // Active = status in (pending, scheduled). Submitted/skipped/expired
    // records do NOT block a new request (the customer can be re-asked).
    const dupWhere: any = {
      businessId: user.businessId,
      partyId: body.partyId,
      status: { in: FEEDBACK_ACTIVE_STATUSES },
    }
    if (body.invoiceId) dupWhere.invoiceId = body.invoiceId
    else dupWhere.invoiceId = null
    if (body.productId) dupWhere.productId = body.productId
    else dupWhere.productId = null
    const existing = await db.productFeedback.findFirst({ where: dupWhere, select: { id: true } })
    if (existing) {
      return NextResponse.json(
        { error: 'An active feedback request already exists for this party/invoice/product tuple' },
        { status: 409 },
      )
    }

    // §TIMING: requestedAt = now + delayHours; expiresAt = requestedAt + 30 days.
    const now = new Date()
    const requestedAt = calculateFeedbackRequestTime(now, delayHours)
    const expiresAt = calculateFeedbackExpiryTime(requestedAt)

    // §STATUS: 'scheduled' if requestedAt is in the future; 'pending' if
    // immediate (delayHours = 0 would mean now — but min is 1h, so this is
    // almost always 'scheduled'). The status will transition to 'pending'
    // when the scheduler fires at requestedAt (out of scope for this PR).
    const status = requestedAt > now ? 'scheduled' : 'pending'

    // §ATOMIC-CREATE: ProductFeedback + FollowUp + CREATED event + link
    // ProductFeedback.followUpId all in ONE transaction. If any step fails,
    // all roll back.
    // §CHICKEN-AND-EGG: create ProductFeedback first (followUpId=null), then
    // create the FollowUp (sourceId=productFeedback.id), then UPDATE
    // ProductFeedback.followUpId = followUp.id inside the same $transaction.
    const result = await db.$transaction(async (tx) => {
      const productFeedback = await tx.productFeedback.create({
        data: {
          businessId: user.businessId,
          partyId: body.partyId,
          invoiceId: body.invoiceId || null,
          productId: body.productId || null,
          followUpId: null, // §LINKED-AFTER: set below once FollowUp exists
          status,
          requestedAt,
          expiresAt,
        },
      })

      // §GENERATE-FOLLOWUP-NUMBER: atomic per-business sequence.
      const followUpNumber = await generateFollowUpNumber(tx, user.businessId)

      // §CREATE-FOLLOWUP: type='product_feedback', sourceType='SYSTEM_CREATED',
      // sourceId=productFeedback.id (application-level ref — no DB FK).
      // dueAt=requestedAt — when the reminder should fire.
      const followUp = await tx.followUp.create({
        data: {
          businessId: user.businessId,
          followUpNumber,
          partyId: body.partyId,
          type: 'product_feedback',
          sourceType: 'SYSTEM_CREATED',
          sourceId: productFeedback.id,
          title: `Request product feedback from ${body.partyId}`,
          description: 'Automatically created feedback reminder. Submit a rating + comment when the customer responds.',
          status: 'PENDING',
          priority: 'MEDIUM',
          createdById: user.id, // §SERVER-DERIVED: never from client
          dueAt: requestedAt,
          relatedInvoiceId: body.invoiceId || null,
          relatedProductId: body.productId || null,
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

      // §LINK: now that the FollowUp exists, set ProductFeedback.followUpId.
      const updated = await tx.productFeedback.update({
        where: { id: productFeedback.id },
        data: { followUpId: followUp.id },
        include: {
          party: { select: { id: true, name: true, phone: true } },
          product: { select: { id: true, name: true, sku: true } },
          invoice: { select: { id: true, invoiceNumber: true, grandTotal: true } },
          followUp: { select: { id: true, followUpNumber: true, status: true, dueAt: true } },
        },
      })

      return updated
    })

    return NextResponse.json(serializeDecimals(result), { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create product feedback')
  }
}
