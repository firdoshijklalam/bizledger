import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { requireAuth } from '@/lib/auth/session'
import {
  assertPartyBelongsToBusiness,
  assertInvoiceBelongsToBusiness,
  FollowUpDomainError,
} from '@/lib/followups'
import {
  FEEDBACK_STATUSES,
  FEEDBACK_DELAY_DEFAULT_HOURS,
  FEEDBACK_DELAY_MIN_HOURS,
  FEEDBACK_DELAY_MAX_HOURS,
  assertProductBelongsToBusiness,
  createProductFeedbackRecord,
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
//
// §SHARED-CORE: the actual create logic lives in
// src/lib/product-feedback.ts:createProductFeedbackRecord so the same logic
// is invoked by both this route AND the invoice flow (fire-and-forget). This
// avoids an HTTP self-call from the invoice route to the feedback route.

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
// value (default 48h on schema). If a productId is provided AND that Product
// has a non-null feedbackDelayHours, that product-specific value wins over
// the global default. Precedence:
//   explicit delayHours > Product.feedbackDelayHours > AppSettings.feedbackDelayHours
//
// §DUPLICATE-PREVENTION: at most one ProductFeedback with status in
// (pending, scheduled) for the same (businessId, partyId, invoiceId, productId)
// tuple. The application-level findFirst is an early-exit UX optimization; the
// real guard is the partial unique index on (dedupKey) WHERE status in
// (pending, scheduled). Two concurrent creates race past the findFirst; only
// one insert succeeds, the other hits P2002 (caught + returned as 409).
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
    let explicitDelayHours: number | undefined
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
      explicitDelayHours = n
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

    // §SHARED-CORE: delegate to the canonical creation function (also used by
    // the invoice flow). It resolves the effective delay (explicit > product >
    // global), computes dedupKey, does the atomic transaction, catches P2002.
    const result = await createProductFeedbackRecord(db, {
      businessId: user.businessId,
      partyId: body.partyId,
      invoiceId: body.invoiceId || null,
      productId: body.productId || null,
      delayHours: explicitDelayHours,
      actorUserId: user.id,
    })

    if (result.created) {
      return NextResponse.json(serializeDecimals(result.feedback), { status: 201 })
    }

    // §DUPLICATE: an active feedback request already exists for this tuple.
    return NextResponse.json(
      { error: 'An active feedback request already exists for this party/invoice/product tuple' },
      { status: 409 },
    )
  } catch (e) {
    return apiError(e, 'Failed to create product feedback')
  }
}
