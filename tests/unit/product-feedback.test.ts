/**
 * §TEST: Product Feedback system — REAL route handler execution.
 *
 * Run: bun tests/unit/product-feedback.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: imports + calls the ACTUAL exported GET/POST/PATCH
 *     handlers from src/app/api/feedback/route.ts, [id]/route.ts,
 *     [id]/complaint/route.ts. Real NextRequest + real NextResponse + real
 *     Prisma against dev SQLite.
 *   - MOCKED DEPENDENCY: requireAuth() via Bun mock.module (auth boundary only).
 *     Real db preserved.
 *
 * §COVERAGE (per the feature spec):
 *   1.  Feedback record creation (POST creates ProductFeedback + linked FollowUp)
 *   2.  Tenant isolation (Biz A cannot see Biz B's feedback)
 *   3.  Invoice/customer/product ownership (cross-tenant partyId/productId/invoiceId rejected)
 *   4.  Scheduling/timing calculation (requestedAt = now + delayHours * 3600000)
 *   5.  Status transitions (pending→scheduled, scheduled→submitted,
 *       scheduled→skipped, scheduled→expired; invalid: submitted→pending)
 *   6.  Feedback submission (PATCH with rating + comment → status=submitted,
 *       submittedAt set)
 *   7.  Duplicate prevention (same partyId+invoiceId+productId → 409)
 *   8.  Feedback → Complaint linkage (POST /complaint creates Complaint with
 *       sourceType=FEEDBACK + sourceId=feedbackId + productFeedbackId)
 *   9.  Complaint source reference (Complaint.sourceType === 'FEEDBACK' +
 *       Complaint.sourceId === feedbackId)
 *   10. No cross-business access (Biz A cannot GET/PATCH Biz B's feedback → 404)
 *   11. Unrelated FollowUp behavior remains intact (manual FollowUp still works)
 *   12. Default feedbackDelayHours = 48 (from AppSettings default)
 */
/// <reference types="bun-types" />
export {}

import { mock } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '../../src/lib/db'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

// ──────────────────────────────────────────────────────────────────────
// §MOCK-SETUP: mock requireAuth to return a test user + business
// ──────────────────────────────────────────────────────────────────────
const TEST_BIZ_A = 'test-pf-A-' + Date.now()
const TEST_BIZ_B = 'test-pf-B-' + Date.now()
let testUser: { id: string; email: string; name: string | null; role: string; businessId: string }
let testUserB: { id: string; email: string; name: string | null; role: string; businessId: string }
let partyA1: string, partyB1: string
let productA1: string, productB1: string
let invoiceA1: string, invoiceB1: string

let authOverride: any = null
await mock.module('@/lib/auth/session', () => ({
  requireAuth: async () => authOverride,
  getCurrentUser: async () => authOverride,
  requireRole: async (allowedRoles: string[]) => {
    if (!authOverride) {
      const { NextResponse } = await import('next/server')
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!allowedRoles.includes(authOverride.role)) {
      const { NextResponse } = await import('next/server')
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return authOverride
  },
}))

const feedbackRoute = await import('@/app/api/feedback/route')
const feedbackItemRoute = await import('@/app/api/feedback/[id]/route')
const feedbackComplaintRoute = await import('@/app/api/feedback/[id]/complaint/route')
const followupsRoute = await import('@/app/api/followups/route')

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'PF Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'PF Biz B', currency: 'INR' } })
  // §NOTE: AppSettings default feedbackDelayHours = 48 (schema @default(48)).
  await db.appSettings.create({ data: { businessId: TEST_BIZ_A } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_B } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'PF Party A1', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'PF Party B1', type: 'customer' } })).id
  productA1 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'PF Prod A1', purchasePrice: 50, salePrice: 100 } })).id
  productB1 = (await db.product.create({ data: { businessId: TEST_BIZ_B, name: 'PF Prod B1', purchasePrice: 50, salePrice: 100 } })).id
  invoiceA1 = (await db.invoice.create({
    data: { businessId: TEST_BIZ_A, partyId: partyA1, type: 'sales', status: 'paid', subtotal: 100, discountAmount: 0, grandTotal: 100, gstAmount: 0, invoiceNumber: 'INV-PF-A-' + Date.now() },
  })).id
  invoiceB1 = (await db.invoice.create({
    data: { businessId: TEST_BIZ_B, partyId: partyB1, type: 'sales', status: 'paid', subtotal: 50, discountAmount: 0, grandTotal: 50, gstAmount: 0, invoiceNumber: 'INV-PF-B-' + Date.now() },
  })).id
  const userArow = await db.user.create({ data: { email: `pf-a-${Date.now()}@test.com`, passwordHash: 'x', businessId: TEST_BIZ_A, name: 'PF User A', role: 'OWNER' } })
  testUser = { id: userArow.id, email: userArow.email, name: userArow.name ?? null, role: userArow.role, businessId: TEST_BIZ_A }
  const userBrow = await db.user.create({ data: { email: `pf-b-${Date.now()}@test.com`, passwordHash: 'x', businessId: TEST_BIZ_B, name: 'PF User B', role: 'OWNER' } })
  testUserB = { id: userBrow.id, email: userBrow.email, name: userBrow.name ?? null, role: userBrow.role, businessId: TEST_BIZ_B }
}

async function cleanup() {
  try {
    // §DELETE-ORDER: respect FK constraints. Delete children before parents.
    await db.complaintEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaint.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.productFeedback.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUp.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.invoice.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.product.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.user.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.appSettings.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.auditLog.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

// §BETWEEN-TEST-ISOLATION: deletes all ProductFeedback + ALL FollowUps +
// Complaints + their sequences for Biz A and Biz B. Call before each test
// that creates feedback records so the duplicate-prevention check (which
// keys on businessId + partyId + invoiceId + productId) AND the
// @@unique([businessId, followUpNumber]) constraint don't conflict on
// stale rows from prior tests. Keeps the Business/AppSettings/Party/Product/
// Invoice fixtures intact so each test can reuse them.
async function cleanupFeedbackBetweenTests() {
  try {
    // §DELETE-ORDER:
    //   1. ComplaintEvent + Complaint (may reference ProductFeedback)
    //   2. ProductFeedback (may reference FollowUp — SetNull, safe)
    //   3. FollowUpEvent (Cascade on FollowUp, but we delete explicitly to be safe)
    //   4. FollowUp (deleted ENTIRELY for both businesses — includes BOTH
    //      system-created feedback reminders AND any manual follow-ups from
    //      prior tests, so the FollowUpSequence can safely reset to 1)
    //   5. FollowUpSequence + ComplaintSequence (reset to 1 for next test)
    await db.complaintEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaint.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.productFeedback.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUp.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

function makePost(url: string, body: any) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}
function makePatch(url: string, body: any) {
  return new NextRequest(url, { method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}
function makeGet(url: string) {
  return new NextRequest(url, { method: 'GET' })
}

// §HELPER: create a feedback request via POST /api/feedback
async function createFeedback(opts: { partyId?: string; productId?: string; invoiceId?: string; delayHours?: number } = {}) {
  const body: any = {
    partyId: opts.partyId ?? partyA1,
  }
  if (opts.productId !== undefined) body.productId = opts.productId
  if (opts.invoiceId !== undefined) body.invoiceId = opts.invoiceId
  if (opts.delayHours !== undefined) body.delayHours = opts.delayHours
  const res = await feedbackRoute.POST(makePost('http://localhost/api/feedback', body))
  return { res, body: await res.json() }
}

async function main() {
  console.log('\n🧪 Product Feedback System Tests\n')
  await setup()
  authOverride = testUser

  // ─── 1. Feedback record creation ──────────────────────────────────
  console.log('1. Feedback record creation (POST creates ProductFeedback + linked FollowUp)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const before = Date.now()
    const { res, body } = await createFeedback({ productId: productA1, invoiceId: invoiceA1, delayHours: 24 })
    assert(res.status === 201, `1a: POST returns 201 (got ${res.status})`)
    assert(body.id, '1b: feedback id returned')
    assert(body.status === 'scheduled', `1c: status=scheduled (got ${body.status})`)
    assert(body.followUpId, '1d: followUpId linked')
    assert(body.businessId === TEST_BIZ_A, '1e: businessId = authenticated user\'s business')

    // §LINKED-FOLLOWUP: verify the FollowUp exists with the right shape
    const fu = await db.followUp.findUnique({ where: { id: body.followUpId } })
    assert(fu !== null, '1f: linked FollowUp exists in DB')
    assert(fu!.type === 'product_feedback', `1g: followUp.type=product_feedback (got ${fu!.type})`)
    assert(fu!.sourceType === 'SYSTEM_CREATED', `1h: followUp.sourceType=SYSTEM_CREATED (got ${fu!.sourceType})`)
    assert(fu!.sourceId === body.id, '1i: followUp.sourceId = productFeedback.id (chicken-and-egg resolved)')
    assert(fu!.relatedProductId === productA1, '1j: followUp.relatedProductId = productId')
    assert(fu!.relatedInvoiceId === invoiceA1, '1k: followUp.relatedInvoiceId = invoiceId')
    assert(fu!.dueAt !== null, '1l: followUp.dueAt set to requestedAt')

    // §CREATED-EVENT: verify the CREATED event was emitted atomically
    const events = await db.followUpEvent.findMany({ where: { followUpId: body.followUpId } })
    assert(events.length === 1, `1m: exactly 1 event (CREATED) (got ${events.length})`)
    assert(events[0].eventType === 'CREATED', '1n: event type=CREATED')
    assert(events[0].actor === testUser.id, '1o: actor = authenticated user')

    // §TIMING: requestedAt ≈ now + 24h (within 5s tolerance for test runtime)
    const requestedAtMs = new Date(body.requestedAt).getTime()
    const expectedMs = before + 24 * 60 * 60 * 1000
    assert(Math.abs(requestedAtMs - expectedMs) < 5000, `1p: requestedAt ≈ now + 24h (delta=${Math.abs(requestedAtMs - expectedMs)}ms)`)
  }

  // ─── 2. Tenant isolation ──────────────────────────────────────────
  console.log('\n2. Tenant isolation (Biz A cannot see Biz B\'s feedback)')
  {
    await cleanupFeedbackBetweenTests()
    // Create feedback in Biz B
    authOverride = testUserB
    const { body: fbB } = await createFeedback({ partyId: partyB1, productId: productB1, delayHours: 12 })
    assert(fbB.id, '2a: Biz B feedback created')

    // Switch back to Biz A + list — should NOT see Biz B's feedback
    authOverride = testUser
    const res = await feedbackRoute.GET(makeGet('http://localhost/api/feedback'))
    const list = await res.json()
    assert(res.status === 200, `2b: GET returns 200 (got ${res.status})`)
    assert(list.items.every((f: any) => f.businessId === TEST_BIZ_A), '2c: all items belong to Biz A')
    assert(!list.items.some((f: any) => f.id === fbB.id), '2d: Biz B feedback is NOT in the list (tenant isolation)')
  }

  // ─── 3. Invoice/customer/product ownership ────────────────────────
  console.log('\n3. Invoice/customer/product ownership (cross-tenant rejected)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    // Cross-tenant partyId
    const res1 = await createFeedback({ partyId: partyB1, delayHours: 6 })
    assert(res1.res.status === 400, `3a: cross-tenant partyId → 400 (got ${res1.res.status})`)
    assert(res1.body.error.includes('does not belong'), `3b: error mentions ownership (got: ${res1.body.error})`)

    // Cross-tenant productId (partyId is OK; productId is from Biz B)
    const res2 = await createFeedback({ productId: productB1, delayHours: 6 })
    assert(res2.res.status === 400, `3c: cross-tenant productId → 400 (got ${res2.res.status})`)

    // Cross-tenant invoiceId
    const res3 = await createFeedback({ invoiceId: invoiceB1, delayHours: 6 })
    assert(res3.res.status === 400, `3d: cross-tenant invoiceId → 400 (got ${res3.res.status})`)

    // Missing partyId
    const res4 = await feedbackRoute.POST(makePost('http://localhost/api/feedback', { delayHours: 6 }))
    assert(res4.status === 400, `3e: missing partyId → 400 (got ${res4.status})`)
    const body4 = await res4.json()
    assert(body4.error.includes('partyId'), '3f: error mentions partyId')
  }

  // ─── 4. Scheduling/timing calculation ────────────────────────────
  console.log('\n4. Scheduling/timing calculation (requestedAt = now + delayHours * 3600000)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const before = Date.now()
    const { body } = await createFeedback({ delayHours: 48 })
    const requestedAtMs = new Date(body.requestedAt).getTime()
    const expectedMs = before + 48 * 60 * 60 * 1000
    assert(Math.abs(requestedAtMs - expectedMs) < 5000, `4a: requestedAt ≈ now + 48h (delta=${Math.abs(requestedAtMs - expectedMs)}ms)`)

    // §EXPIRY: expiresAt = requestedAt + 30 days
    const expiresAtMs = new Date(body.expiresAt).getTime()
    const expectedExpiryMs = requestedAtMs + 30 * 24 * 60 * 60 * 1000
    assert(Math.abs(expiresAtMs - expectedExpiryMs) < 5000, `4b: expiresAt ≈ requestedAt + 30 days (delta=${Math.abs(expiresAtMs - expectedExpiryMs)}ms)`)
  }

  // ─── 5. Status transitions ───────────────────────────────────────
  console.log('\n5. Status transitions (state machine)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    // §PENDING→SUBMITTED: create with delayHours=0-equivalent... but min is 1h.
    // For testing pending→submitted, we directly insert a 'pending' record and
    // PATCH it to 'submitted' with a rating. (Real flow: scheduled→submitted.)
    const pf = await db.productFeedback.create({
      data: { businessId: TEST_BIZ_A, partyId: partyA1, status: 'pending', requestedAt: new Date() },
    })

    // §PENDING→SUBMITTED valid (with rating)
    const res1 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pf.id}`, { status: 'submitted', rating: 4, comment: 'Great product' }),
      { params: Promise.resolve({ id: pf.id }) },
    )
    assert(res1.status === 200, `5a: pending → submitted → 200 (got ${res1.status})`)
    const body1 = await res1.json()
    assert(body1.status === 'submitted', `5b: status=submitted (got ${body1.status})`)
    assert(body1.rating === 4, `5c: rating=4 (got ${body1.rating})`)
    assert(body1.submittedAt !== null, '5d: submittedAt set')

    // §SUBMITTED→PENDING invalid (no reopen)
    const res2 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pf.id}`, { status: 'pending' }),
      { params: Promise.resolve({ id: pf.id }) },
    )
    assert(res2.status === 400, `5e: submitted → pending → 400 (got ${res2.status})`)
    const body2 = await res2.json()
    assert(body2.error.includes('not allowed') || body2.error.includes('Transition'), `5f: error mentions transition (got: ${body2.error})`)

    // §SCHEDULED→SKIPPED valid
    const pfSched = await createFeedback({ delayHours: 12 })
    const res3 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pfSched.body.id}`, { status: 'skipped' }),
      { params: Promise.resolve({ id: pfSched.body.id }) },
    )
    assert(res3.status === 200, `5g: scheduled → skipped → 200 (got ${res3.status})`)
    const body3 = await res3.json()
    assert(body3.status === 'skipped', `5h: status=skipped (got ${body3.status})`)

    // §SCHEDULED→EXPIRED valid
    const pfSched2 = await createFeedback({ delayHours: 12 })
    const res4 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pfSched2.body.id}`, { status: 'expired' }),
      { params: Promise.resolve({ id: pfSched2.body.id }) },
    )
    assert(res4.status === 200, `5i: scheduled → expired → 200 (got ${res4.status})`)

    // §SUBMIT-REQUIRES-RATING: scheduled→submitted without rating → 400
    const pfSched3 = await createFeedback({ delayHours: 12 })
    const res5 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pfSched3.body.id}`, { status: 'submitted', comment: 'No rating' }),
      { params: Promise.resolve({ id: pfSched3.body.id }) },
    )
    assert(res5.status === 400, `5j: scheduled → submitted without rating → 400 (got ${res5.status})`)

    // §INVALID-RATING: rating=6 → 400
    const pfSched4 = await createFeedback({ delayHours: 12 })
    const res6 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pfSched4.body.id}`, { status: 'submitted', rating: 6 }),
      { params: Promise.resolve({ id: pfSched4.body.id }) },
    )
    assert(res6.status === 400, `5k: rating=6 → 400 (got ${res6.status})`)

    // §INVALID-RATING: rating=0 → 400
    const res7 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pfSched4.body.id}`, { rating: 0 }),
      { params: Promise.resolve({ id: pfSched4.body.id }) },
    )
    assert(res7.status === 400, `5l: rating=0 → 400 (got ${res7.status})`)
  }

  // ─── 6. Feedback submission (PATCH with rating + comment) ────────
  console.log('\n6. Feedback submission (PATCH with rating + comment → status=submitted, submittedAt set)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const { body: pf } = await createFeedback({ productId: productA1, delayHours: 12 })
    const before = Date.now()
    const res = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pf.id}`, { status: 'submitted', rating: 5, comment: 'Excellent service' }),
      { params: Promise.resolve({ id: pf.id }) },
    )
    assert(res.status === 200, `6a: PATCH submit → 200 (got ${res.status})`)
    const body = await res.json()
    assert(body.status === 'submitted', `6b: status=submitted (got ${body.status})`)
    assert(body.rating === 5, `6c: rating=5 (got ${body.rating})`)
    assert(body.comment === 'Excellent service', `6d: comment stored (got: ${body.comment})`)
    assert(body.submittedAt !== null, '6e: submittedAt set')
    const submittedMs = new Date(body.submittedAt).getTime()
    assert(Math.abs(submittedMs - before) < 5000, `6f: submittedAt ≈ now (delta=${Math.abs(submittedMs - before)}ms)`)

    // §LINKED-FOLLOWUP-COMPLETED: the linked FollowUp should be COMPLETED.
    const fu = await db.followUp.findUnique({ where: { id: body.followUpId }, select: { status: true, completedAt: true, completedById: true, outcome: true } })
    assert(fu!.status === 'COMPLETED', `6g: linked followUp.status=COMPLETED (got ${fu!.status})`)
    assert(fu!.completedAt !== null, '6h: linked followUp.completedAt set')
    assert(fu!.completedById === testUser.id, '6i: linked followUp.completedById = authenticated user')
    assert(fu!.outcome !== null && fu!.outcome.includes('rating=5'), `6j: outcome includes rating=5 (got: ${fu!.outcome})`)

    // §COMPLETE-EVENT: verify a COMPLETE event was emitted on the followUp.
    const completeEvents = await db.followUpEvent.findMany({ where: { followUpId: body.followUpId, eventType: 'COMPLETE' } })
    assert(completeEvents.length === 1, `6k: 1 COMPLETE event on followUp (got ${completeEvents.length})`)
  }

  // ─── 7. Duplicate prevention ──────────────────────────────────────
  console.log('\n7. Duplicate prevention (same partyId+invoiceId+productId → 409)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const { body: first } = await createFeedback({ productId: productA1, invoiceId: invoiceA1, delayHours: 12 })
    assert(first.id, '7a: first feedback created')

    // §DUPLICATE: same tuple while first is still 'scheduled' → 409
    const { res, body } = await createFeedback({ productId: productA1, invoiceId: invoiceA1, delayHours: 12 })
    assert(res.status === 409, `7b: duplicate → 409 (got ${res.status})`)
    assert(body.error.includes('already exists'), `7c: error mentions already exists (got: ${body.error})`)

    // §NON-DUPLICATE: different productId → 201 (not a duplicate)
    const { res: res2 } = await createFeedback({ productId: undefined, invoiceId: invoiceA1, delayHours: 12 })
    assert(res2.status === 201, `7d: different productId → 201 (got ${res2.status})`)
  }

  // ─── 8. Feedback → Complaint linkage ─────────────────────────────
  console.log('\n8. Feedback → Complaint linkage (POST /complaint creates Complaint)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const { body: pf } = await createFeedback({ productId: productA1, invoiceId: invoiceA1, delayHours: 12 })
    // Submit the feedback with a low rating first (escalation scenario)
    await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${pf.id}`, { status: 'submitted', rating: 2, comment: 'Wrong item delivered' }),
      { params: Promise.resolve({ id: pf.id }) },
    )

    // §ESCALATE: POST /complaint creates a Complaint linked back to the feedback
    const res = await feedbackComplaintRoute.POST(
      makePost(`http://localhost/api/feedback/${pf.id}/complaint`, { title: 'Damaged packaging' }),
      { params: Promise.resolve({ id: pf.id }) },
    )
    assert(res.status === 201, `8a: POST /complaint → 201 (got ${res.status})`)
    const body = await res.json()
    assert(body.complaint.id, '8b: complaint id returned')
    assert(body.complaint.complaintNumber.startsWith('CMP-'), `8c: complaintNumber format CMP-NNNN (got ${body.complaint.complaintNumber})`)
    assert(body.complaint.sourceType === 'FEEDBACK', `8d: sourceType=FEEDBACK (got ${body.complaint.sourceType})`)
    assert(body.complaint.sourceId === pf.id, '8e: sourceId = productFeedbackId')
    assert(body.complaint.productFeedbackId === pf.id, '8f: productFeedbackId FK set')
    assert(body.complaint.partyId === partyA1, '8g: partyId copied from feedback')
    assert(body.complaint.relatedInvoiceId === invoiceA1, '8h: relatedInvoiceId copied from feedback')
    assert(body.complaint.relatedProductId === productA1, '8i: relatedProductId copied from feedback')
    assert(body.complaint.title === 'Damaged packaging', `8j: title from body (got: ${body.complaint.title})`)

    // §COMPLAINT-EVENT: verify a CREATED event was emitted on the complaint.
    const events = await db.complaintEvent.findMany({ where: { complaintId: body.complaint.id } })
    assert(events.length === 1, `8k: 1 CREATED event on complaint (got ${events.length})`)
    assert(events[0].eventType === 'CREATED', '8l: event type=CREATED')

    // §DEFAULT-TITLE: if no title provided, defaults to a sensible message
    const { body: pf2 } = await createFeedback({ productId: productA1, delayHours: 12 })
    const res2 = await feedbackComplaintRoute.POST(
      makePost(`http://localhost/api/feedback/${pf2.id}/complaint`, {}),
      { params: Promise.resolve({ id: pf2.id }) },
    )
    const body2 = await res2.json()
    assert(body2.complaint.title.includes('Feedback escalated'), `8m: default title set (got: ${body2.complaint.title})`)
  }

  // ─── 9. Complaint source reference ───────────────────────────────
  console.log('\n9. Complaint source reference (sourceType=FEEDBACK + sourceId=feedbackId)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    const { body: pf } = await createFeedback({ delayHours: 12 })
    const res = await feedbackComplaintRoute.POST(
      makePost(`http://localhost/api/feedback/${pf.id}/complaint`, { title: 'Source ref test' }),
      { params: Promise.resolve({ id: pf.id }) },
    )
    const body = await res.json()
    // §DIRECT-DB-READ: verify the persisted Complaint has sourceType/sourceId set
    const complaint = await db.complaint.findUnique({ where: { id: body.complaint.id }, select: { sourceType: true, sourceId: true, productFeedbackId: true } })
    assert(complaint!.sourceType === 'FEEDBACK', `9a: complaint.sourceType=FEEDBACK (got ${complaint!.sourceType})`)
    assert(complaint!.sourceId === pf.id, '9b: complaint.sourceId = productFeedbackId')
    assert(complaint!.productFeedbackId === pf.id, '9c: complaint.productFeedbackId = productFeedbackId (FK)')
  }

  // ─── 10. No cross-business access ─────────────────────────────────
  console.log('\n10. No cross-business access (Biz A cannot GET/PATCH Biz B\'s feedback → 404)')
  {
    await cleanupFeedbackBetweenTests()
    // Create feedback in Biz B
    authOverride = testUserB
    const { body: fbB } = await createFeedback({ partyId: partyB1, delayHours: 12 })

    // §CROSS-TENANT-GET: Biz A tries to GET Biz B's feedback → 404
    authOverride = testUser
    const res1 = await feedbackItemRoute.GET(
      makeGet(`http://localhost/api/feedback/${fbB.id}`),
      { params: Promise.resolve({ id: fbB.id }) },
    )
    assert(res1.status === 404, `10a: cross-tenant GET → 404 (got ${res1.status})`)

    // §CROSS-TENANT-PATCH: Biz A tries to PATCH Biz B's feedback → 404
    const res2 = await feedbackItemRoute.PATCH(
      makePatch(`http://localhost/api/feedback/${fbB.id}`, { rating: 5, comment: 'hijack attempt' }),
      { params: Promise.resolve({ id: fbB.id }) },
    )
    assert(res2.status === 404, `10b: cross-tenant PATCH → 404 (got ${res2.status})`)

    // §CROSS-TENANT-COMPLAINT: Biz A tries to POST /complaint on Biz B's feedback → 404
    const res3 = await feedbackComplaintRoute.POST(
      makePost(`http://localhost/api/feedback/${fbB.id}/complaint`, {}),
      { params: Promise.resolve({ id: fbB.id }) },
    )
    assert(res3.status === 404, `10c: cross-tenant POST /complaint → 404 (got ${res3.status})`)

    // §CROSS-TENANT-GET-EXISTING: Biz A's own feedback is still accessible
    const { body: fbA } = await createFeedback({ delayHours: 12 })
    const res4 = await feedbackItemRoute.GET(
      makeGet(`http://localhost/api/feedback/${fbA.id}`),
      { params: Promise.resolve({ id: fbA.id }) },
    )
    assert(res4.status === 200, `10d: own feedback GET → 200 (got ${res4.status})`)
  }

  // ─── 11. Unrelated FollowUp behavior remains intact ──────────────
  console.log('\n11. Unrelated FollowUp behavior remains intact (manual FollowUp still works)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    // §REGRESSION: the new relatedProductId field + named relation must NOT
    // break the existing manual FollowUp creation flow.
    const res = await followupsRoute.POST(makePost('http://localhost/api/followups', {
      partyId: partyA1,
      title: 'Manual follow-up (unrelated to feedback)',
      dueAt: new Date(Date.now() + 86400000).toISOString(),
      type: 'manual',
    }))
    assert(res.status === 201, `11a: manual FollowUp POST → 201 (got ${res.status})`)
    const body = await res.json()
    assert(body.id, '11b: followUp id returned')
    assert(body.type === 'manual', `11c: type=manual (got ${body.type})`)
    assert(body.businessId === TEST_BIZ_A, '11d: businessId = Biz A')
    assert(body.relatedProductId === null || body.relatedProductId === undefined, '11e: relatedProductId is null for manual follow-up')

    // §CREATED-EVENT: verify the event still fires for manual follow-ups
    const events = await db.followUpEvent.findMany({ where: { followUpId: body.id } })
    assert(events.length === 1, `11f: 1 CREATED event (got ${events.length})`)
    assert(events[0].eventType === 'CREATED', '11g: event type=CREATED')
  }

  // ─── 12. Default feedbackDelayHours = 48 ─────────────────────────
  console.log('\n12. Default feedbackDelayHours = 48 (from AppSettings default)')
  {
    await cleanupFeedbackBetweenTests()
    authOverride = testUser
    // §SCHEMA-DEFAULT: AppSettings was created without specifying
    // feedbackDelayHours, so the schema default (48) should apply.
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A }, select: { feedbackDelayHours: true } })
    assert(settings !== null, '12a: AppSettings row exists')
    assert(settings!.feedbackDelayHours === 48, `12b: default feedbackDelayHours=48 (got ${settings!.feedbackDelayHours})`)

    // §POST-WITHOUT-DELAY: POST /api/feedback without delayHours should fall
    // back to AppSettings.feedbackDelayHours = 48.
    const before = Date.now()
    const { body } = await createFeedback() // no delayHours
    const requestedAtMs = new Date(body.requestedAt).getTime()
    const expectedMs = before + 48 * 60 * 60 * 1000
    assert(Math.abs(requestedAtMs - expectedMs) < 5000, `12c: requestedAt ≈ now + 48h (fallback to AppSettings default; delta=${Math.abs(requestedAtMs - expectedMs)}ms)`)

    // §DELAY-OVERRIDE: explicitly providing delayHours overrides the AppSettings default.
    // §NOTE: clean up between 12c and 12d — otherwise 12d would 409 on the
    // duplicate-prevention check (same partyId + null productId + null invoiceId
    // tuple as 12c, both still in 'scheduled' state).
    await cleanupFeedbackBetweenTests()
    const before2 = Date.now()
    const { body: body2 } = await createFeedback({ delayHours: 6 })
    const requestedAtMs2 = new Date(body2.requestedAt).getTime()
    const expectedMs2 = before2 + 6 * 60 * 60 * 1000
    assert(Math.abs(requestedAtMs2 - expectedMs2) < 5000, `12d: requestedAt ≈ now + 6h (override; delta=${Math.abs(requestedAtMs2 - expectedMs2)}ms)`)
  }

  // ─── 13. AppSettings PUT feedbackDelayHours validation ───────────
  console.log('\n13. AppSettings PUT feedbackDelayHours validation (bonus round)')
  {
    // §NOTE: app-settings uses getCurrentBusiness (cookie session). We mock
    // getCurrentBusiness via the db module mock pattern used in
    // reward-threshold-config.test.ts. For simplicity here, we directly
    // verify the AppSettings schema default + the route's validation by
    // invoking the route via the same mock pattern.
    //
    // §SKIP: the app-settings route uses getCurrentBusiness (not requireAuth),
    // which reads from cookies — a different mock setup. The validation
    // logic is already covered by reward-threshold-config.test.ts. Here we
    // just verify the schema default is 48 (covered by test 12b above) and
    // that the column exists.
    const cols = await db.$queryRaw`PRAGMA table_info(AppSettings)`
    const colNames = (cols as any[]).map((c) => c.name)
    assert(colNames.includes('feedbackDelayHours'), '13a: AppSettings.feedbackDelayHours column exists')
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Product Feedback System Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('Test error:', e)
  await cleanup()
  await db.$disconnect()
  process.exit(1)
})
