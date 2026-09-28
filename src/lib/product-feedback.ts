import type { PrismaClient } from '@prisma/client'

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
