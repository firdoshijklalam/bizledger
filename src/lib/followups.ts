import { db } from '@/lib/db'
import type { PrismaClient } from '@prisma/client'

// §STEP8B-FOLLOWUP-DOMAIN: Pure domain/service layer for the FollowUp system.
//
// §PURPOSE: canonical constants, typed state-machine validation, pure helpers
// for overdue/due-soon/wakeable logic, transaction-safe number generation,
// event payload builders, and tenant-ownership validation. This module
// contains NO database mutation of accounting tables (Invoice, Transaction,
// Party.balance, RewardCycle, Notification) — it is a CRM domain layer only.
//
// §NO-DB-MUTATION: the only DB access in this module is:
//   - generateFollowUpNumber (uses FollowUpSequence — a CRM-only table)
//   - assertXxxBelongsToBusiness helpers (read-only findFirst)
// The module NEVER writes to Invoice/Transaction/Party.balance/RewardCycle/
// Notification.

// ════════════════════════════════════════════════════════════════════════
// §1 CANONICAL CONSTANTS + TYPES
// ════════════════════════════════════════════════════════════════════════
// The canonical vocabulary for the FollowUp model. The API layer (Step 8C)
// will validate against these — no arbitrary values allowed.

export const FOLLOW_UP_TYPES = [
  'payment_reminder',
  'product_feedback',
  'complaint_followup',
  'reorder_reminder',
  'warranty_expiry',
  'callback',
  'offer',
  'birthday',
  'manual',
  'generic_custom',
] as const
export type FollowUpType = typeof FOLLOW_UP_TYPES[number]

export const FOLLOW_UP_SOURCE_TYPES = ['MANUAL', 'SYSTEM_CREATED', 'AUTOMATED_RULE'] as const
export type FollowUpSourceType = typeof FOLLOW_UP_SOURCE_TYPES[number]

export const FOLLOW_UP_STATUSES = [
  'PENDING',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
  'SNOOZED',
] as const
export type FollowUpStatus = typeof FOLLOW_UP_STATUSES[number]

export const FOLLOW_UP_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type FollowUpPriority = typeof FOLLOW_UP_PRIORITIES[number]

export const FOLLOW_UP_EVENT_TYPES = [
  'CREATED',
  'STATUS_CHANGE',
  'PRIORITY_CHANGE',
  'ASSIGN',
  'SNOOZE',
  'COMMENT',
  'COMPLETE',
  'CANCEL',
] as const
export type FollowUpEventType = typeof FOLLOW_UP_EVENT_TYPES[number]

// ════════════════════════════════════════════════════════════════════════
// §2 STATE MACHINE — pure transition validation
// ════════════════════════════════════════════════════════════════════════
//
// Allowed transitions:
//   PENDING     → IN_PROGRESS, SNOOZED, COMPLETED, CANCELLED
//   IN_PROGRESS → PENDING, SNOOZED, COMPLETED, CANCELLED
//   SNOOZED     → PENDING, CANCELLED
//   COMPLETED   → IN_PROGRESS (reopen)
//   CANCELLED   → IN_PROGRESS (reopen)
//
// Rejected: any transition not listed above (e.g. COMPLETED → PENDING,
// COMPLETED → CANCELLED, SNOOZED → COMPLETED). The caller must first
// transition SNOOZED → PENDING, then PENDING → COMPLETED.

export const FOLLOW_UP_STATUS_TRANSITIONS: Record<FollowUpStatus, FollowUpStatus[]> = {
  PENDING: ['IN_PROGRESS', 'SNOOZED', 'COMPLETED', 'CANCELLED'],
  IN_PROGRESS: ['PENDING', 'SNOOZED', 'COMPLETED', 'CANCELLED'],
  SNOOZED: ['PENDING', 'CANCELLED'],
  COMPLETED: ['IN_PROGRESS'],
  CANCELLED: ['IN_PROGRESS'],
}

// §DOMAIN-ERROR: a typed error class for invalid domain operations. The API
// layer can catch this and map it to HTTP 400 with a clear message.
export class FollowUpDomainError extends Error {
  constructor(message: string, public code: string) {
    super(message)
    this.name = 'FollowUpDomainError'
  }
}

// §PURE: isValidStatusTransition — returns true/false, no side effects.
export function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true // no-op is allowed
  const allowed = FOLLOW_UP_STATUS_TRANSITIONS[from as FollowUpStatus]
  if (!allowed) return false
  return allowed.includes(to as FollowUpStatus)
}

// §TYPED-RESULT: validateStatusTransition — returns a typed result with
// ok/error. Preferred by the API layer (no try/catch needed).
export type TransitionResult =
  | { ok: true }
  | { ok: false; error: string; code: string }

export function validateStatusTransition(from: string, to: string): TransitionResult {
  if (!FOLLOW_UP_STATUSES.includes(from as FollowUpStatus)) {
    return { ok: false, error: `Invalid current status: ${from}`, code: 'INVALID_FROM_STATUS' }
  }
  if (!FOLLOW_UP_STATUSES.includes(to as FollowUpStatus)) {
    return { ok: false, error: `Invalid target status: ${to}`, code: 'INVALID_TO_STATUS' }
  }
  if (!isValidStatusTransition(from, to)) {
    return {
      ok: false,
      error: `Transition ${from} → ${to} is not allowed`,
      code: 'INVALID_TRANSITION',
    }
  }
  return { ok: true }
}

// ════════════════════════════════════════════════════════════════════════
// §3 COMPLETION RULES — pure helpers for field mutations
// ════════════════════════════════════════════════════════════════════════
//
// When transitioning to COMPLETED:
//   - completedAt must be set (to `now`)
//   - completedById must be supplied by caller
//
// When reopening (COMPLETED/CANCELLED → IN_PROGRESS):
//   - completedAt must be cleared (null)
//   - completedById must be cleared (null)
//
// These helpers return field patches (NOT DB mutations). The API layer
// applies them in the actual db.followUp.update call.

export type FollowUpPatch = {
  completedAt?: Date | null
  completedById?: string | null
  snoozedUntil?: Date | null
  status?: FollowUpStatus
}

// §COMPLETE: returns the patch to apply when transitioning to COMPLETED.
// Throws FollowUpDomainError if completedById is missing.
export function getCompletionPatch(opts: {
  completedById: string | null | undefined
  now: Date
}): FollowUpPatch {
  if (!opts.completedById) {
    throw new FollowUpDomainError(
      'completedById is required when transitioning to COMPLETED',
      'MISSING_COMPLETED_BY',
    )
  }
  return {
    status: 'COMPLETED',
    completedAt: opts.now,
    completedById: opts.completedById,
    snoozedUntil: null, // clear any stale snooze
  }
}

// §REOPEN: returns the patch to apply when reopening (COMPLETED/CANCELLED → IN_PROGRESS).
export function getReopenPatch(): FollowUpPatch {
  return {
    status: 'IN_PROGRESS',
    completedAt: null,
    completedById: null,
  }
}

// ════════════════════════════════════════════════════════════════════════
// §4 SNOOZE RULES
// ════════════════════════════════════════════════════════════════════════
//
// SNOOZED requires: snoozedUntil != null
// PENDING/IN_PROGRESS must clear stale snoozedUntil.
// A snoozed follow-up must NOT be considered due (see isOverdue / isDueSoon).

// §SNOOZE: returns the patch to apply when transitioning to SNOOZED.
// Throws FollowUpDomainError if snoozedUntil is missing or in the past.
export function getSnoozePatch(opts: {
  snoozedUntil: Date | null | undefined
  now: Date
}): FollowUpPatch {
  if (!opts.snoozedUntil) {
    throw new FollowUpDomainError(
      'snoozedUntil is required when transitioning to SNOOZED',
      'MISSING_SNOOZE_UNTIL',
    )
  }
  if (opts.snoozedUntil <= opts.now) {
    throw new FollowUpDomainError(
      'snoozedUntil must be in the future',
      'INVALID_SNOOZE_UNTIL',
    )
  }
  return {
    status: 'SNOOZED',
    snoozedUntil: opts.snoozedUntil,
  }
}

// §UNSNOOZE: returns the patch to apply when waking SNOOZED → PENDING.
export function getUnsnoozePatch(): FollowUpPatch {
  return {
    status: 'PENDING',
    snoozedUntil: null,
  }
}

// §IS-WAKEABLE: pure helper — a SNOOZED follow-up is wakeable when
// snoozedUntil <= now. Uses the supplied `now` for deterministic tests.
export function isWakeable(
  followUp: { status: string; snoozedUntil: Date | null },
  now: Date,
): boolean {
  if (followUp.status !== 'SNOOZED') return false
  if (!followUp.snoozedUntil) return false
  return followUp.snoozedUntil <= now
}

// ════════════════════════════════════════════════════════════════════════
// §5 OVERDUE SEMANTICS — pure helpers, no Date.now() internally
// ════════════════════════════════════════════════════════════════════════
//
// isOverdue: PENDING + has dueAt + dueAt < now + NOT snoozed.
// A SNOOZED follow-up is never overdue (it's deferred).
// A COMPLETED/CANCELLED follow-up is never overdue.
//
// "Missed" is NOT a persisted status — it is derived dynamically via
// isOverdue. This avoids incorrect state transitions caused by client-side
// time.

export function isOverdue(
  followUp: { status: string; dueAt: Date | null; snoozedUntil: Date | null },
  now: Date,
): boolean {
  if (followUp.status !== 'PENDING') return false
  if (!followUp.dueAt) return false
  if (followUp.dueAt >= now) return false
  if (followUp.snoozedUntil) return false // snoozed → not overdue
  return true
}

// §IS-DUE-SOON: PENDING + has dueAt + dueAt is within [now, now + windowMs] +
// NOT snoozed. Used by the scheduler to find follow-ups due within the next
// window (e.g. next 1 hour).
export function isDueSoon(
  followUp: { status: string; dueAt: Date | null; snoozedUntil: Date | null },
  now: Date,
  windowMs: number,
): boolean {
  if (followUp.status !== 'PENDING') return false
  if (!followUp.dueAt) return false
  if (followUp.snoozedUntil) return false // snoozed → not due-soon
  const horizon = new Date(now.getTime() + windowMs)
  return followUp.dueAt >= now && followUp.dueAt <= horizon
}

// ════════════════════════════════════════════════════════════════════════
// §6 FOLLOW-UP NUMBER GENERATION — transaction-safe
// ════════════════════════════════════════════════════════════════════════
//
// Mirrors ComplaintSequence. Uses FollowUpSequence table with upsert +
// { increment: 1 } inside a transaction — atomic, concurrency-safe.
// Format: FU-0001, FU-0002, ... (zero-padded to 4 digits, expands to 5+).
//
// §GUARANTEE: two concurrent createFollowUp calls in the same business will
// NEVER get the same number. The upsert + increment is a single atomic SQL
// statement (INSERT ... ON CONFLICT UPDATE nextNumber = nextNumber + 1).
//
// §ACCEPTS-TX: accepts a transaction client OR the default db client, so the
// caller can use it inside their own db.$transaction (atomic with the
// FollowUp.create) OR standalone.

type TxClient = PrismaClient | Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]

export async function generateFollowUpNumber(
  tx: TxClient,
  businessId: string,
): Promise<string> {
  // §UPSERT-SEMANTICS: on first call (row doesn't exist), `create` sets
  // nextNumber=1 and returns 1 → FU-0001. On subsequent calls, `update`
  // increments nextNumber by 1 and returns the new value → FU-0002, etc.
  // We use seq.nextNumber DIRECTLY (not seq.nextNumber - 1) — the create
  // path does NOT increment, it just sets the value.
  const seq = await tx.followUpSequence.upsert({
    where: { businessId },
    update: { nextNumber: { increment: 1 } },
    create: { businessId, nextNumber: 1 },
  })
  return `FU-${String(seq.nextNumber).padStart(4, '0')}`
}

// ════════════════════════════════════════════════════════════════════════
// §7 EVENT CREATION HELPERS — validated event payload builders
// ════════════════════════════════════════════════════════════════════════
//
// These prepare validated event data (the shape db.followUpEvent.create
// expects in its `data` field). They do NOT write to the DB — the caller
// applies the payload inside their own transaction.
//
// §ACTOR-SEMANTICS: actor is a free-form String? (not FK to User.id) because
// it must support BOTH "staff user id" AND "system" (for cron-triggered
// transitions like SNOOZED → PENDING wake-up).

export type FollowUpEventPayload = {
  businessId: string
  followUpId: string
  eventType: FollowUpEventType
  fromValue?: string | null
  toValue?: string | null
  note?: string | null
  actor?: string | null
}

function validateEventType(eventType: string): FollowUpEventType {
  if (!FOLLOW_UP_EVENT_TYPES.includes(eventType as FollowUpEventType)) {
    throw new FollowUpDomainError(
      `Invalid event type: ${eventType}`,
      'INVALID_EVENT_TYPE',
    )
  }
  return eventType as FollowUpEventType
}

export function createdEvent(opts: {
  businessId: string
  followUpId: string
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('CREATED'),
    actor: opts.actor ?? null,
  }
}

export function statusChangeEvent(opts: {
  businessId: string
  followUpId: string
  fromStatus: string
  toStatus: string
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('STATUS_CHANGE'),
    fromValue: opts.fromStatus,
    toValue: opts.toStatus,
    actor: opts.actor ?? null,
  }
}

export function priorityChangeEvent(opts: {
  businessId: string
  followUpId: string
  fromPriority: string
  toPriority: string
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('PRIORITY_CHANGE'),
    fromValue: opts.fromPriority,
    toValue: opts.toPriority,
    actor: opts.actor ?? null,
  }
}

export function assignEvent(opts: {
  businessId: string
  followUpId: string
  fromUserId?: string | null
  toUserId: string | null
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('ASSIGN'),
    fromValue: opts.fromUserId ?? null,
    toValue: opts.toUserId,
    actor: opts.actor ?? null,
  }
}

export function snoozeEvent(opts: {
  businessId: string
  followUpId: string
  snoozedUntil: Date
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('SNOOZE'),
    toValue: opts.snoozedUntil.toISOString(),
    actor: opts.actor ?? null,
  }
}

export function commentEvent(opts: {
  businessId: string
  followUpId: string
  note: string
  actor?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('COMMENT'),
    note: opts.note,
    actor: opts.actor ?? null,
  }
}

export function completeEvent(opts: {
  businessId: string
  followUpId: string
  actor?: string | null
  outcome?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('COMPLETE'),
    note: opts.outcome ?? null,
    actor: opts.actor ?? null,
  }
}

export function cancelEvent(opts: {
  businessId: string
  followUpId: string
  actor?: string | null
  reason?: string | null
}): FollowUpEventPayload {
  return {
    businessId: opts.businessId,
    followUpId: opts.followUpId,
    eventType: validateEventType('CANCEL'),
    note: opts.reason ?? null,
    actor: opts.actor ?? null,
  }
}

// ════════════════════════════════════════════════════════════════════════
// §8 TENANT VALIDATION HELPERS — reusable server-side ownership checks
// ════════════════════════════════════════════════════════════════════════
//
// These helpers verify that a related entity belongs to the same business
// before a follow-up is created/updated with that relation. DB FKs validate
// entity existence but do NOT prevent cross-tenant relationships — the API
// layer MUST call these.
//
// §ACCEPTS-CLIENT: accepts a transaction client OR the default db client, so
// the caller can validate inside their own transaction (consistent read).
// §DOES-NOT-TRUST-CLIENT-BUSINESSID: the businessId comes from
// getCurrentBusiness() (session-derived), never from the request body.

export async function assertPartyBelongsToBusiness(
  client: TxClient,
  partyId: string,
  businessId: string,
): Promise<void> {
  const party = await client.party.findFirst({
    where: { id: partyId, businessId },
    select: { id: true },
  })
  if (!party) {
    throw new FollowUpDomainError(
      `Party ${partyId} does not belong to business ${businessId}`,
      'PARTY_NOT_FOUND',
    )
  }
}

export async function assertUserBelongsToBusiness(
  client: TxClient,
  userId: string,
  businessId: string,
): Promise<void> {
  const user = await client.user.findFirst({
    where: { id: userId, businessId },
    select: { id: true },
  })
  if (!user) {
    throw new FollowUpDomainError(
      `User ${userId} does not belong to business ${businessId}`,
      'USER_NOT_FOUND',
    )
  }
}

export async function assertInvoiceBelongsToBusiness(
  client: TxClient,
  invoiceId: string,
  businessId: string,
): Promise<void> {
  const invoice = await client.invoice.findFirst({
    where: { id: invoiceId, businessId },
    select: { id: true },
  })
  if (!invoice) {
    throw new FollowUpDomainError(
      `Invoice ${invoiceId} does not belong to business ${businessId}`,
      'INVOICE_NOT_FOUND',
    )
  }
}

export async function assertComplaintBelongsToBusiness(
  client: TxClient,
  complaintId: string,
  businessId: string,
): Promise<void> {
  const complaint = await client.complaint.findFirst({
    where: { id: complaintId, businessId },
    select: { id: true },
  })
  if (!complaint) {
    throw new FollowUpDomainError(
      `Complaint ${complaintId} does not belong to business ${businessId}`,
      'COMPLAINT_NOT_FOUND',
    )
  }
}

// ════════════════════════════════════════════════════════════════════════
// §9 SOURCE SEMANTICS — validation for sourceType/sourceId
// ════════════════════════════════════════════════════════════════════════
//
// MANUAL:          sourceId may be null (user created it)
// SYSTEM_CREATED:  sourceId may identify the generating system entity
// AUTOMATED_RULE:  sourceId may identify a future automation rule
//
// §NO-POLYMORPHIC-FK: sourceId is a free-form String? — no DB FK. It is
// application-level provenance only. When an explicit relationship exists
// (invoice, complaint), use the dedicated FK, NOT sourceId.

export function validateSourceType(
  sourceType: string,
  sourceId: string | null | undefined,
): { ok: true } | { ok: false; error: string; code: string } {
  if (!FOLLOW_UP_SOURCE_TYPES.includes(sourceType as FollowUpSourceType)) {
    return { ok: false, error: `Invalid sourceType: ${sourceType}`, code: 'INVALID_SOURCE_TYPE' }
  }
  // §MANUAL: sourceId SHOULD be null but we don't enforce it (a MANUAL
  // follow-up could reference a note id for context). We only warn.
  // §SYSTEM_CREATED / AUTOMATED_RULE: sourceId MAY be null too (a system
  // follow-up without a specific generating entity). No hard requirement.
  return { ok: true }
}

// §IS-VALID-TYPE: validates the `type` field against the canonical list.
export function isValidType(type: string): boolean {
  return FOLLOW_UP_TYPES.includes(type as FollowUpType)
}

export function isValidPriority(priority: string): boolean {
  return FOLLOW_UP_PRIORITIES.includes(priority as FollowUpPriority)
}

export function isValidStatus(status: string): boolean {
  return FOLLOW_UP_STATUSES.includes(status as FollowUpStatus)
}
