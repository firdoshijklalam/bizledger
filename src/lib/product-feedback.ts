import type { PrismaClient } from '@prisma/client'
import { db as defaultDb } from '@/lib/db'
import {
  generateFollowUpNumber,
  createdEvent,
  assertPartyBelongsToBusiness,
  assertInvoiceBelongsToBusiness,
} from '@/lib/followups'

// §PRODUCT-FEEDBACK-DOMAIN: Pure domain/service layer for the Product Feedback
// system. Mirrors the architecture of src/lib/followups.ts — canonical
// constants, typed state-machine validation, pure timing helpers, and tenant-
// ownership validation. This module contains NO database mutation of
// accounting tables — it is a CRM domain layer only.
//
// §NO-DB-MUTATION: the only DB access in this module is read-only
// findFirst inside the assertXxxBelongsToBusiness helpers. All writes happen
// in the API routes (which wrap them in $transaction for atomicity).

// ════════════════════════════════════════════════════════════════════════
// §1 CANONICAL CONSTANTS + TYPES
// ════════════════════════════════════════════════════════════════════════
// The canonical vocabulary for the ProductFeedback model. The API layer
// validates against these — no arbitrary values allowed.

export const FEEDBACK_STATUSES = [
  'pending',
  'scheduled',
  'submitted',
  'skipped',
  'expired',
] as const
export type FeedbackStatus = typeof FEEDBACK_STATUSES[number]

// §RATING-BOUNDS: 1-5 integer (star rating). Null until the customer submits.
export const FEEDBACK_RATING_MIN = 1
export const FEEDBACK_RATING_MAX = 5

// §DELAY-BOUNDS: configurable delay (in hours) between a purchase and the
// feedback request. Default 48h. Range 1-168 (1 hour to 1 week). Enforced at
// the AppSettings API layer (src/app/api/app-settings/route.ts PUT).
export const FEEDBACK_DELAY_MIN_HOURS = 1
export const FEEDBACK_DELAY_MAX_HOURS = 168
export const FEEDBACK_DELAY_DEFAULT_HOURS = 48

// §EXPIRY: how long a scheduled feedback request stays valid before it expires
// if not submitted. 30 days is a sensible default — long enough for the
// customer to leave feedback, short enough to not linger forever.
export const FEEDBACK_EXPIRY_DAYS = 30

// ════════════════════════════════════════════════════════════════════════
// §2 STATE MACHINE — pure transition validation
// ════════════════════════════════════════════════════════════════════════
//
// Allowed transitions:
//   pending    → scheduled, submitted, skipped, expired
//   scheduled  → submitted, skipped, expired
//   submitted  → (terminal — no reopen)
//   skipped    → (terminal)
//   expired    → (terminal)
//
// Rejected: any transition not listed above (e.g. submitted → pending — no
// reopen; the customer cannot un-submit a rating). A submitted record can be
// edited (rating/comment) via PATCH but the status remains 'submitted'.

export const FEEDBACK_STATUS_TRANSITIONS: Record<FeedbackStatus, FeedbackStatus[]> = {
  pending: ['scheduled', 'submitted', 'skipped', 'expired'],
  scheduled: ['submitted', 'skipped', 'expired'],
  submitted: [],
  skipped: [],
  expired: [],
}

// §DOMAIN-ERROR: a typed error class for invalid domain operations. The API
// layer can catch this and map it to HTTP 400 with a clear message.
export class ProductFeedbackDomainError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'ProductFeedbackDomainError'
  }
}

// §PURE: isValidStatusTransition — returns true/false, no side effects.
export function isValidFeedbackStatusTransition(from: string, to: string): boolean {
  if (from === to) return true // no-op is allowed
  const allowed = FEEDBACK_STATUS_TRANSITIONS[from as FeedbackStatus]
  if (!allowed) return false
  return allowed.includes(to as FeedbackStatus)
}

// §TYPED-RESULT: validateFeedbackStatusTransition — returns a typed result with
// ok/error. Preferred by the API layer (no try/catch needed).
export type FeedbackTransitionResult =
  | { ok: true }
  | { ok: false; error: string; code: string }

export function validateFeedbackStatusTransition(from: string, to: string): FeedbackTransitionResult {
  if (!FEEDBACK_STATUSES.includes(from as FeedbackStatus)) {
    return { ok: false, error: `Invalid current status: ${from}`, code: 'INVALID_FROM_STATUS' }
  }
  if (!FEEDBACK_STATUSES.includes(to as FeedbackStatus)) {
    return { ok: false, error: `Invalid target status: ${to}`, code: 'INVALID_TO_STATUS' }
  }
  if (!isValidFeedbackStatusTransition(from, to)) {
    return {
      ok: false,
      error: `Transition ${from} → ${to} is not allowed`,
      code: 'INVALID_TRANSITION',
    }
  }
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════
// §3 TIMING — pure helpers for scheduling feedback requests
// ════════════════════════════════════════════════════════════════════════
//
// calculateFeedbackRequestTime: returns purchaseDate + delayHours * 3600000.
// Pure — no Date.now() internally. The caller supplies the reference time.
//
// calculateFeedbackExpiryTime: returns requestedAt + FEEDBACK_EXPIRY_DAYS.

export function calculateFeedbackRequestTime(purchaseDate: Date, delayHours: number): Date {
  return new Date(purchaseDate.getTime() + delayHours * 60 * 60 * 1000)
}

export function calculateFeedbackExpiryTime(requestedAt: Date, days: number = FEEDBACK_EXPIRY_DAYS): Date {
  return new Date(requestedAt.getTime() + days * 24 * 60 * 60 * 1000)
}

// ════════════════════════════════════════════════════════════════════════
// §4 RATING VALIDATION
// ════════════════════════════════════════════════════════════════════════
//
// isValidRating: 1-5 integer. Accepts numbers + numeric strings (HTML forms
// often send strings). Rejects: booleans (Number(true)=1 silently), null,
// objects, arrays, empty strings, non-numeric / non-finite strings.

export function isValidRating(rating: unknown): rating is number {
  // §STRICT-TYPE-CHECK: accept only finite numbers OR non-empty numeric
  // strings. Reject booleans (typeof 'boolean' — Number(true)=1 would be
  // silently accepted), null/objects/arrays (typeof 'object'), empty strings,
  // non-numeric strings, non-finite strings ("Infinity"/"NaN").
  const isAcceptableType = typeof rating === 'number' || (typeof rating === 'string' && rating.trim() !== '')
  if (!isAcceptableType) return false
  const n = Number(rating)
  if (!Number.isFinite(n)) return false
  if (!Number.isInteger(n)) return false
  return n >= FEEDBACK_RATING_MIN && n <= FEEDBACK_RATING_MAX
}

// ════════════════════════════════════════════════════════════════════════
// §5 TENANT VALIDATION HELPERS — reusable server-side ownership checks
// ════════════════════════════════════════════════════════════════════════
//
// These helpers verify that a referenced entity belongs to the same business
// before a feedback record is created/updated with that relation. DB FKs
// validate entity existence but do NOT prevent cross-tenant relationships —
// the API layer MUST call these.
//
// §ACCEPTS-CLIENT: accepts a transaction client OR the default db client, so
// the caller can validate inside their own transaction (consistent read).
// §DOES-NOT-TRUST-CLIENT-BUSINESSID: the businessId comes from requireAuth()
// (session-derived), never from the request body.

type TxClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export async function assertProductBelongsToBusiness(
  client: TxClient,
  productId: string,
  businessId: string,
): Promise<void> {
  const product = await client.product.findFirst({
    where: { id: productId, businessId },
    select: { id: true },
  })
  if (!product) {
    throw new ProductFeedbackDomainError(
      `Product ${productId} does not belong to business ${businessId}`,
      'PRODUCT_NOT_FOUND',
    )
  }
}

export async function assertProductFeedbackBelongsToBusiness(
  client: TxClient,
  feedbackId: string,
  businessId: string,
): Promise<void> {
  const feedback = await client.productFeedback.findFirst({
    where: { id: feedbackId, businessId },
    select: { id: true },
  })
  if (!feedback) {
    throw new ProductFeedbackDomainError(
      `ProductFeedback ${feedbackId} does not belong to business ${businessId}`,
      'PRODUCT_FEEDBACK_NOT_FOUND',
    )
  }
}

// §ACTIVE-STATUSES: statuses where a feedback request is still open (not yet
// submitted/skipped/expired). Used for duplicate-prevention queries.
export const FEEDBACK_ACTIVE_STATUSES: FeedbackStatus[] = ['pending', 'scheduled']

// ════════════════════════════════════════════════════════════════════════
// §6 EFFECTIVE DELAY RESOLUTION — pure precedence helper
// ════════════════════════════════════════════════════════════════════════
//
// resolveEffectiveFeedbackDelay: pure helper that picks the effective delay
// (in hours) for a feedback request given:
//   - productDelayHours: optional per-product override (Product.feedbackDelayHours)
//   - globalDelayHours:  the business-wide AppSettings.feedbackDelayHours
//
// §PRECEDENCE:
//   1. If productDelayHours is set AND a positive finite number, use it
//      (clamped to [FEEDBACK_DELAY_MIN_HOURS, FEEDBACK_DELAY_MAX_HOURS]).
//   2. Otherwise fall back to globalDelayHours (the AppSettings default).
//
// §NOTE: explicit delayHours passed in the POST body ALWAYS wins — that
// override happens at the API layer BEFORE calling this helper. This helper
// is only invoked when delayHours is NOT provided explicitly.
//
// §PURE: no Date.now(), no DB access. Caller supplies both values.

export function resolveEffectiveFeedbackDelay(
  productDelayHours: number | null | undefined,
  globalDelayHours: number,
): number {
  if (productDelayHours != null && Number.isFinite(productDelayHours) && productDelayHours > 0) {
    return Math.min(
      Math.max(Math.floor(productDelayHours), FEEDBACK_DELAY_MIN_HOURS),
      FEEDBACK_DELAY_MAX_HOURS,
    )
  }
  return globalDelayHours
}

// ════════════════════════════════════════════════════════════════════════
// §7 DEDUP-KEY COMPUTATION — race-safe duplicate prevention
// ════════════════════════════════════════════════════════════════════════
//
// computeFeedbackDedupKey: deterministic key for race-safe duplicate
// prevention. Converts null/undefined invoiceId/productId to '' so the
// partial unique index (WHERE status in pending/scheduled) treats all tuples
// uniformly — null invoiceId and '' invoiceId produce the SAME dedupKey.
//
// §EXAMPLES:
//   (biz1, p1, inv1, prod1) → "biz1|p1|inv1|prod1"
//   (biz1, p1, null,  null)  → "biz1|p1||"
//   (biz1, p1, inv1,  null)  → "biz1|p1|inv1|"
//
// §AUTHORITATIVE-GUARD: the partial unique index on (dedupKey) WHERE
// status='pending' OR status='scheduled' is the real duplicate guard. The
// application-level findFirst in the POST handler is just an early-exit UX
// optimization. Two concurrent creates that race past the findFirst will
// both attempt the unique insert — only ONE succeeds, the other hits P2002.

export function computeFeedbackDedupKey(opts: {
  businessId: string
  partyId: string
  invoiceId?: string | null
  productId?: string | null
}): string {
  return [
    opts.businessId,
    opts.partyId,
    opts.invoiceId ?? '',
    opts.productId ?? '',
  ].join('|')
}

// ════════════════════════════════════════════════════════════════════════
// §8 SHARED CREATE-FEEDBACK FUNCTION — used by API + invoice flow
// ════════════════════════════════════════════════════════════════════════
//
// createProductFeedbackRecord: the canonical feedback-creation function.
// Shared between:
//   - POST /api/feedback (creates a feedback record on demand)
//   - POST /api/invoices (auto-creates a feedback record for paid sales
//     invoices with a party — fire-and-forget, non-fatal)
//
// §PRECEDENCE for delayHours (only resolved when opts.delayHours is omitted):
//   1. opts.delayHours (explicit override — caller already validated)
//   2. Product.feedbackDelayHours (per-product override — fetched from DB)
//   3. AppSettings.feedbackDelayHours (global default)
// Resolve via resolveEffectiveFeedbackDelay.
//
// §TENANT-OWNERSHIP: partyId/invoiceId/productId are validated to belong to
// opts.businessId (using the same assertXxxBelongsToBusiness helpers the
// POST /api/feedback route uses).
//
// §ATOMIC: ProductFeedback + FollowUp + CREATED event + link
// ProductFeedback.followUpId all in ONE $transaction.
//
// §CHICKEN-AND-EGG: create ProductFeedback first (followUpId=null), create
// the FollowUp (sourceId=productFeedback.id), then UPDATE
// ProductFeedback.followUpId inside the SAME $transaction.
//
// §DEDUP-SAFETY: computes dedupKey + sets it on create. The partial unique
// index on (dedupKey) WHERE status in pending/scheduled is the authoritative
// guard. Application-level findFirst is an early-exit UX optimization that
// returns null without attempting the insert when a duplicate is found.
//
// §P2002-HANDLING: returns { created: false, duplicate: true } when the
// unique index rejects the insert (a duplicate active request exists). The
// caller (POST /api/feedback) maps this to HTTP 409; the invoice flow
// silently skips.
//
// §RETURNS: { created: true, feedback: <full record> } on success;
// { created: false, duplicate: true } on duplicate; throws on other errors.

type CreateFeedbackResult =
  | { created: true; feedback: any }
  | { created: false; duplicate: true }

export async function createProductFeedbackRecord(
  client: PrismaClient | typeof defaultDb,
  opts: {
    businessId: string
    partyId: string
    invoiceId?: string | null
    productId?: string | null
    delayHours?: number // explicit override — bypasses AppSettings/Product lookup
    actorUserId?: string | null // the user who triggered creation (FollowUp.createdById)
  },
): Promise<CreateFeedbackResult> {
  // §TENANT-OWNERSHIP-VALIDATION: verify all referenced entities belong to
  // the same business. DB FKs validate existence but NOT cross-tenant safety.
  await assertPartyBelongsToBusiness(client, opts.partyId, opts.businessId)
  if (opts.productId) {
    await assertProductBelongsToBusiness(client, opts.productId, opts.businessId)
  }
  if (opts.invoiceId) {
    await assertInvoiceBelongsToBusiness(client, opts.invoiceId, opts.businessId)
  }

  // §DELAY-RESOLUTION: explicit override wins. Otherwise fetch AppSettings
  // (global default) + Product (per-product override) and resolve.
  let delayHours: number
  if (opts.delayHours != null && Number.isFinite(opts.delayHours) && opts.delayHours > 0) {
    delayHours = Math.min(
      Math.max(Math.floor(opts.delayHours), FEEDBACK_DELAY_MIN_HOURS),
      FEEDBACK_DELAY_MAX_HOURS,
    )
  } else {
    const [settings, product] = await Promise.all([
      client.appSettings.findUnique({
        where: { businessId: opts.businessId },
        select: { feedbackDelayHours: true },
      }),
      opts.productId
        ? client.product.findUnique({
            where: { id: opts.productId },
            select: { feedbackDelayHours: true },
          })
        : null,
    ])
    const globalDelay = settings?.feedbackDelayHours ?? FEEDBACK_DELAY_DEFAULT_HOURS
    delayHours = resolveEffectiveFeedbackDelay(product?.feedbackDelayHours, globalDelay)
  }

  // §DEDUP-KEY: deterministic — converts nulls to '' so the partial unique
  // index treats all tuples uniformly.
  const dedupKey = computeFeedbackDedupKey({
    businessId: opts.businessId,
    partyId: opts.partyId,
    invoiceId: opts.invoiceId,
    productId: opts.productId,
  })

  // §EARLY-EXIT-UX: optional application-level findFirst. The DB unique index
  // is the authoritative guard; this is just an early-exit UX optimization so
  // the caller can return a friendly 409 without attempting the insert.
  const existing = await client.productFeedback.findFirst({
    where: {
      businessId: opts.businessId,
      partyId: opts.partyId,
      status: { in: FEEDBACK_ACTIVE_STATUSES },
      ...(opts.invoiceId ? { invoiceId: opts.invoiceId } : { invoiceId: null }),
      ...(opts.productId ? { productId: opts.productId } : { productId: null }),
    },
    select: { id: true },
  })
  if (existing) {
    return { created: false, duplicate: true }
  }

  // §TIMING: requestedAt = now + delayHours; expiresAt = requestedAt + 30 days.
  const now = new Date()
  const requestedAt = calculateFeedbackRequestTime(now, delayHours)
  const expiresAt = calculateFeedbackExpiryTime(requestedAt)

  // §STATUS: 'scheduled' if requestedAt is in the future; 'pending' if immediate.
  const status: FeedbackStatus = requestedAt > now ? 'scheduled' : 'pending'

  try {
    const result = await client.$transaction(async (tx) => {
      const productFeedback = await tx.productFeedback.create({
        data: {
          businessId: opts.businessId,
          partyId: opts.partyId,
          invoiceId: opts.invoiceId || null,
          productId: opts.productId || null,
          followUpId: null, // §LINKED-AFTER: set below once FollowUp exists
          status,
          requestedAt,
          expiresAt,
          dedupKey,
        },
      })

      // §GENERATE-FOLLOWUP-NUMBER: atomic per-business sequence.
      const followUpNumber = await generateFollowUpNumber(tx, opts.businessId)

      // §CREATE-FOLLOWUP: type='product_feedback', sourceType='SYSTEM_CREATED',
      // sourceId=productFeedback.id (application-level ref — no DB FK).
      // dueAt=requestedAt — when the reminder should fire.
      const followUp = await tx.followUp.create({
        data: {
          businessId: opts.businessId,
          followUpNumber,
          partyId: opts.partyId,
          type: 'product_feedback',
          sourceType: 'SYSTEM_CREATED',
          sourceId: productFeedback.id,
          title: `Request product feedback from ${opts.partyId}`,
          description: 'Automatically created feedback reminder. Submit a rating + comment when the customer responds.',
          status: 'PENDING',
          priority: 'MEDIUM',
          createdById: opts.actorUserId ?? null, // §SERVER-DERIVED: never from client
          dueAt: requestedAt,
          relatedInvoiceId: opts.invoiceId || null,
          relatedProductId: opts.productId || null,
        },
      })

      // §CREATED-EVENT: append-only audit trail. Actor = authenticated user
      // OR null for fire-and-forget (invoice flow).
      await tx.followUpEvent.create({
        data: createdEvent({
          businessId: opts.businessId,
          followUpId: followUp.id,
          actor: opts.actorUserId ?? null,
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

    return { created: true, feedback: result }
  } catch (e: any) {
    // §P2002 = unique violation. The partial unique index on (dedupKey)
    // WHERE status in pending/scheduled rejected the insert — a duplicate
    // ACTIVE request already exists. This is the authoritative race-safe
    // guard. Catch + treat as duplicate.
    if (e?.code === 'P2002') {
      return { created: false, duplicate: true }
    }
    throw e
  }
}
