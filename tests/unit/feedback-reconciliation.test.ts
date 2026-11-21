/**
 * §TEST: FeedbackOutbox reconciliation cursor — REAL route handler + lib execution.
 *
 * Run: bun tests/unit/feedback-reconciliation.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: imports + calls the ACTUAL exported POST handlers from
 *     src/app/api/cron/feedback-outbox/route.ts + the real lib functions
 *     from src/lib/feedback-reconciliation.ts + src/lib/feedback-outbox.ts.
 *     Real NextRequest + real NextResponse + real Prisma against dev SQLite.
 *   - NO AUTH MOCK NEEDED: the cron route authenticates via CRON_SECRET
 *     (Authorization header), not requireAuth. The lib layer has no auth.
 *
 * §COVERAGE:
 *   A. Eligible paid sales invoice missing a FeedbackOutbox row (the gap
 *      this feature heals: historical bug / import / restore) →
 *      reconcileFeedbackOutboxForBusiness creates ONE PENDING row with the
 *      correct partyId + productIds JSON payload.
 *   B. Idempotency: re-running reconciliation never duplicates the outbox
 *      row (cursor advanced past it; P2002 backstop).
 *   C. Ineligible invoices are NOT healed: unpaid, purchase-type, walk-in
 *      (no party) — the eligibility gate mirrors invoice-service.ts exactly.
 *   D. §LOOKBACK-WINDOW: an eligible invoice older than 60 days is scanned
 *      but deliberately NOT healed (feedback requests are perishable —
 *      see feedback-reconciliation.ts header).
 *   E. Multi-business isolation: one cursor per business; Biz A's cursor
 *      never heals Biz B's invoices; reconcileFeedbackOutbox(null) covers both.
 *   F. Legacy path safety: an invoice that ALREADY has ProductFeedback
 *      (pre-outbox fire-and-forget path) but no outbox row → healed row
 *      processes to COMPLETED with NO duplicate feedback records.
 *   G. End-to-end heal + process: reconciliation → drain creates the
 *      ProductFeedback records (one per unique product, multi-product invoice).
 *   H. Cron route integration: fail-closed 401 (no secret / wrong secret),
 *      200 with correct secret; the route runs RECONCILE-FIRST so the healed
 *      row is processed in the SAME invocation (deliberate deviation from
 *      the reward route's order — daily cron would otherwise add a day of
 *      latency).
 *   I. Cursor walk + cyclic wrap: with a small limit the cursor advances one
 *      batch per call; when the batch runs dry the NEXT call wraps to the
 *      start and increments cycleCount.
 *   J. getFeedbackReconciliationCursor observability helper.
 */
/// <reference types="bun-types" />
export {}

import { NextRequest } from 'next/server'
import { db } from '../../src/lib/db'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const TEST_BIZ_A = 'test-fr-A-' + Date.now()
const TEST_BIZ_B = 'test-fr-B-' + Date.now()

const feedbackReconciliationLib = await import('@/lib/feedback-reconciliation')
const feedbackOutboxLib = await import('@/lib/feedback-outbox')
const productFeedbackLib = await import('@/lib/product-feedback')
const cronRoute = await import('@/app/api/cron/feedback-outbox/route')

let partyA1: string, partyB1: string
let productA1: string, productA2: string
let userA: { id: string; email: string; name: string | null; role: string; businessId: string }

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'FR Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'FR Biz B', currency: 'INR' } })
  // AppSettings with default feedbackDelayHours (48h) — the processor needs
  // it to resolve the schedule for healed feedback requests.
  await db.appSettings.create({ data: { businessId: TEST_BIZ_A } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_B } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'FR Party A1', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'FR Party B1', type: 'customer' } })).id
  productA1 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'FR Prod A1', purchasePrice: 50, salePrice: 100, stock: 1000 } })).id
  productA2 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'FR Prod A2', purchasePrice: 25, salePrice: 50, stock: 1000 } })).id
  const userRow = await db.user.create({ data: { email: `fr-a-${Date.now()}@test.com`, passwordHash: 'x', businessId: TEST_BIZ_A, name: 'FR User A', role: 'OWNER' } })
  userA = { id: userRow.id, email: userRow.email, name: userRow.name ?? null, role: userRow.role, businessId: TEST_BIZ_A }
}

async function cleanup() {
  try {
    // §DELETE-ORDER: children before parents (mirrors product-feedback.test.ts).
    await db.complaintEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaint.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.productFeedback.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUp.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.followUpSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.feedbackOutbox.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.rewardAccrualOutbox.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
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

/** Create a bare invoice WITHOUT a FeedbackOutbox row — simulating the gap. */
async function createGapInvoice(opts: {
  businessId: string
  partyId: string | null
  type?: string
  status?: string
  createdDaysAgo?: number
  items?: Array<{ productId: string | null; name: string }>
  number: string
}): Promise<string> {
  const createdAt = opts.createdDaysAgo
    ? new Date(Date.now() - opts.createdDaysAgo * 24 * 60 * 60 * 1000)
    : undefined
  const inv = await db.invoice.create({
    data: {
      businessId: opts.businessId,
      partyId: opts.partyId,
      type: opts.type ?? 'sales',
      status: opts.status ?? 'paid',
      subtotal: 100,
      discountAmount: 0,
      grandTotal: 100,
      gstAmount: 0,
      invoiceNumber: opts.number,
      ...(createdAt ? { createdAt } : {}),
    },
  })
  for (const item of opts.items ?? []) {
    await db.invoiceItem.create({
      data: {
        invoiceId: inv.id,
        productId: item.productId,
        name: item.name,
        quantity: 1,
        unitPrice: 100,
        total: 100,
      },
    })
  }
  return inv.id
}

async function main() {
  await setup()

  // ─── A. The core heal: eligible invoice, no outbox row ───
  console.log('\nA. Reconciliation heals an eligible invoice that has no FeedbackOutbox row')
  let invoiceA_gap1: string
  {
    invoiceA_gap1 = await createGapInvoice({
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      items: [
        { productId: productA1, name: 'FR Item 1' },
        { productId: productA1, name: 'FR Item 1 dup' }, // duplicate productId → dedup in payload
        { productId: productA2, name: 'FR Item 2' },
      ],
      number: 'INV-FR-A1-' + Date.now(),
    })

    const before = await db.feedbackOutbox.count({ where: { businessId: TEST_BIZ_A } })
    assert(before === 0, `A.1: no outbox row before reconciliation (count=${before})`)

    const summary = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    assert(summary.scanned === 1, `A.2: scanned exactly 1 eligible invoice (got ${summary.scanned})`)
    assert(summary.missingFound === 1, `A.3: missingFound=1 (got ${summary.missingFound})`)
    assert(summary.outboxCreated === 1, `A.4: outboxCreated=1 (got ${summary.outboxCreated})`)
    assert(summary.errors.length === 0, `A.5: no errors (got ${JSON.stringify(summary.errors)})`)
    assert(summary.cursorAdvanced === true, 'A.6: cursor advanced')

    const healed = await db.feedbackOutbox.findFirst({ where: { invoiceId: invoiceA_gap1 } })
    assert(healed !== null, 'A.7: healed PENDING outbox row exists in DB')
    assert(healed!.status === 'PENDING', `A.8: healed row status=PENDING (got ${healed!.status})`)
    assert(healed!.partyId === partyA1, 'A.9: healed row partyId matches the invoice party')
    assert(healed!.attempts === 0, `A.10: healed row attempts=0 (got ${healed!.attempts})`)
    const parsedIds = healed!.productIds ? JSON.parse(healed!.productIds) : null
    assert(
      Array.isArray(parsedIds) &&
        parsedIds.length === 2 &&
        parsedIds[0] === productA1 &&
        parsedIds[1] === productA2,
      `A.11: productIds payload = unique productIds in first-appearance order (got ${healed!.productIds})`,
    )
  }

  // ─── B. Idempotency: re-run never duplicates ───
  console.log('\nB. Reconciliation is idempotent — re-run does not duplicate the outbox row')
  {
    // Cursor already advanced past invoiceA_gap1 → this run finds nothing
    // after the cursor → wraps (cycle) without creating anything.
    const summary2 = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    assert(summary2.missingFound === 0, `B.1: second run missingFound=0 (got ${summary2.missingFound})`)
    assert(summary2.outboxCreated === 0, `B.2: second run outboxCreated=0 (got ${summary2.outboxCreated})`)
    assert(summary2.cycleCompleted === true, 'B.3: second run wrapped the cursor (cycleCompleted)')
    const count = await db.feedbackOutbox.count({ where: { invoiceId: invoiceA_gap1 } })
    assert(count === 1, `B.4: still exactly 1 outbox row for the healed invoice (count=${count})`)
  }

  // ─── C. Ineligible invoices are never healed ───
  console.log('\nC. Eligibility gate mirrors invoice-service: unpaid / purchase / walk-in excluded')
  {
    const unpaid = await createGapInvoice({ businessId: TEST_BIZ_A, partyId: partyA1, status: 'unpaid', number: 'INV-FR-C1-' + Date.now() })
    const purchase = await createGapInvoice({ businessId: TEST_BIZ_A, partyId: partyA1, type: 'purchase', status: 'paid', number: 'INV-FR-C2-' + Date.now() })
    const walkin = await createGapInvoice({ businessId: TEST_BIZ_A, partyId: null, status: 'paid', number: 'INV-FR-C3-' + Date.now() })

    // Fresh cursor state for a clean scan: delete the cursor so the walk
    // restarts from the oldest eligible invoice.
    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_A } })
    const summary = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    // Eligible set = invoiceA_gap1 only (already healed → alreadyHadOutbox).
    assert(summary.scanned === 1, `C.1: scanned only the 1 eligible invoice (got ${summary.scanned})`)
    assert(summary.alreadyHadOutbox >= 1, `C.2: healed invoice counted as alreadyHadOutbox (got ${summary.alreadyHadOutbox})`)

    const rows = await Promise.all([unpaid, purchase, walkin].map(id =>
      db.feedbackOutbox.findFirst({ where: { invoiceId: id } }),
    ))
    assert(rows[0] === null, 'C.3: unpaid invoice NOT healed')
    assert(rows[1] === null, 'C.4: purchase invoice NOT healed')
    assert(rows[2] === null, 'C.5: walk-in (no party) invoice NOT healed')
  }

  // ─── D. Lookback window: old invoices are scanned but not healed ───
  console.log('\nD. 60-day lookback window — old eligible invoices are skipped, cursor still advances')
  {
    const oldInvoice = await createGapInvoice({
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      createdDaysAgo: 70, // outside the 60-day window
      number: 'INV-FR-D1-' + Date.now(),
    })

    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_A } })
    const summary = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    // The 70-day-old invoice sorts FIRST (createdAt ASC) — scanned, skipped.
    assert(summary.skippedOutOfWindow >= 1, `D.1: skippedOutOfWindow ≥ 1 (got ${summary.skippedOutOfWindow})`)
    const row = await db.feedbackOutbox.findFirst({ where: { invoiceId: oldInvoice } })
    assert(row === null, 'D.2: out-of-window invoice NOT healed (no row created)')
    // §CURSOR-vs-WINDOW: the cursor must ADVANCE PAST old rows so future
    // runs don't re-scan them every cycle.
    const cursor = await db.feedbackReconciliationCursor.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(cursor !== null && cursor.scannedCount >= 2, `D.3: cursor scannedCount counts ALL scanned rows incl. old (got ${cursor?.scannedCount})`)
  }

  // ─── E. Multi-business isolation ───
  console.log('\nE. Per-business cursors — Biz A never heals Biz B and vice versa')
  {
    const invoiceB_gap = await createGapInvoice({
      businessId: TEST_BIZ_B,
      partyId: partyB1,
      items: [{ productId: null, name: 'FR ad-hoc item' }],
      number: 'INV-FR-B1-' + Date.now(),
    })

    // Biz A's reconciliation (business-scoped) must not touch Biz B.
    const summaryA = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    assert(!summaryA.errors.length, `E.1: Biz A run has no errors (${JSON.stringify(summaryA.errors)})`)
    const rowB = await db.feedbackOutbox.findFirst({ where: { invoiceId: invoiceB_gap } })
    assert(rowB === null, 'E.2: Biz A-scoped run did NOT heal Biz B invoice')

    // The all-businesss entry point covers both, with separate cursors.
    const summaryAll = await feedbackReconciliationLib.reconcileFeedbackOutbox(null)
    assert(summaryAll.outboxCreated >= 1, `E.3: all-business run healed Biz B (outboxCreated=${summaryAll.outboxCreated})`)
    const cursors = await db.feedbackReconciliationCursor.findMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    assert(cursors.length === 2, `E.4: one cursor PER business (got ${cursors.length})`)

    // Biz B's healed row: ad-hoc item (no productId) → productIds=null → generic.
    const rowB2 = await db.feedbackOutbox.findFirst({ where: { invoiceId: invoiceB_gap } })
    assert(rowB2 !== null && rowB2.productIds === null, 'E.5: Biz B healed row productIds=null (generic feedback)')
    assert(rowB2!.partyId === partyB1, 'E.6: Biz B healed row partyId correct')
  }

  // ─── F. Legacy path: existing ProductFeedback + no outbox → safe heal ───
  console.log('\nF. Legacy fire-and-forget path — healed row processes with NO duplicate feedback')
  {
    const legacyInvoice = await createGapInvoice({
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      items: [{ productId: productA2, name: 'FR legacy item' }],
      number: 'INV-FR-F1-' + Date.now(),
    })

    // §LEGACY: feedback was ALREADY created by the old fire-and-forget path.
    const created = await productFeedbackLib.createProductFeedbackRecord(db, {
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      invoiceId: legacyInvoice,
      productId: productA2,
      actorUserId: userA.id,
    })
    assert(created.created === true, 'F.1: legacy ProductFeedback pre-exists (fire-and-forget path)')

    // Heal + process the healed row.
    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_A } })
    const summary = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)
    assert(summary.outboxCreated >= 1, `F.2: reconciliation created the missing outbox row (got ${summary.outboxCreated})`)

    const healed = await db.feedbackOutbox.findFirst({ where: { invoiceId: legacyInvoice } })
    assert(healed !== null, 'F.3: legacy invoice now has an outbox row')
    await feedbackOutboxLib.processFeedbackOutboxRowForInvoice(TEST_BIZ_A, legacyInvoice)

    const after = await db.feedbackOutbox.findFirst({ where: { invoiceId: legacyInvoice } })
    assert(after!.status === 'COMPLETED', `F.4: healed row COMPLETED (got ${after!.status})`)
    const feedbackCount = await db.productFeedback.count({ where: { invoiceId: legacyInvoice } })
    assert(feedbackCount === 1, `F.5: NO duplicate ProductFeedback (count=${feedbackCount}) — processor dedup short-circuits`)
  }

  // ─── G. End-to-end: reconcile → drain creates the feedback records ───
  console.log('\nG. End-to-end heal + drain — ProductFeedback created per unique product')
  {
    const e2eInvoice = await createGapInvoice({
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      items: [
        { productId: productA1, name: 'FR e2e item 1' },
        { productId: productA2, name: 'FR e2e item 2' },
      ],
      number: 'INV-FR-G1-' + Date.now(),
    })

    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_A } })
    await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_A)

    const before = await db.productFeedback.count({ where: { invoiceId: e2eInvoice } })
    assert(before === 0, `G.1: no feedback for the e2e invoice before drain (count=${before})`)

    const drainSummary = await feedbackOutboxLib.processPendingFeedbackOutbox()
    assert(drainSummary.claimed >= 1, `G.2: drain claimed ≥ 1 row (got ${drainSummary.claimed})`)

    const feedbacks = await db.productFeedback.findMany({ where: { invoiceId: e2eInvoice } })
    assert(feedbacks.length === 2, `G.3: one ProductFeedback per unique product (got ${feedbacks.length})`)
    const productSet = new Set(feedbacks.map(f => f.productId))
    assert(
      productSet.has(productA1) && productSet.has(productA2) && productSet.size === 2,
      'G.4: both products captured (A1 + A2)',
    )
    assert(
      feedbacks.every(f => f.status === 'scheduled'),
      `G.5: created records are scheduled (48h default delay) (got ${feedbacks.map(f => f.status).join(',')})`,
    )
    const outboxAfter = await db.feedbackOutbox.findFirst({ where: { invoiceId: e2eInvoice } })
    assert(outboxAfter!.status === 'COMPLETED', `G.6: e2e outbox row COMPLETED (got ${outboxAfter!.status})`)
  }

  // ─── H. Cron route integration: auth + reconcile-first order ───
  console.log('\nH. Cron route — fail-closed auth + reconcile-then-drain in one invocation')
  {
    const hInvoice = await createGapInvoice({
      businessId: TEST_BIZ_A,
      partyId: partyA1,
      items: [{ productId: productA1, name: 'FR H item' }],
      number: 'INV-FR-H1-' + Date.now(),
    })
    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_A } })

    const oldSecret = process.env.CRON_SECRET

    // Fail-closed: no secret configured.
    delete process.env.CRON_SECRET
    const reqNoSecret = new NextRequest('http://localhost/api/cron/feedback-outbox', { method: 'POST' })
    const resNoSecret = await cronRoute.POST(reqNoSecret)
    assert(resNoSecret.status === 401, `H.1: no CRON_SECRET → 401 (got ${resNoSecret.status})`)

    // Wrong secret.
    process.env.CRON_SECRET = 'fr-correct-secret'
    const reqWrong = new NextRequest('http://localhost/api/cron/feedback-outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer fr-wrong-secret' },
    })
    const resWrong = await cronRoute.POST(reqWrong)
    assert(resWrong.status === 401, `H.2: wrong secret → 401 (got ${resWrong.status})`)

    const noRowYet = await db.feedbackOutbox.findFirst({ where: { invoiceId: hInvoice } })
    assert(noRowYet === null, 'H.3: rejected invocations healed nothing (fail-closed)')

    // Correct secret → 200. The route runs reconcile FIRST then drains, so
    // the healed row is processed in the SAME invocation.
    const reqCorrect = new NextRequest('http://localhost/api/cron/feedback-outbox', {
      method: 'POST',
      headers: { authorization: 'Bearer fr-correct-secret' },
    })
    const resCorrect = await cronRoute.POST(reqCorrect)
    assert(resCorrect.status === 200, `H.4: correct secret → 200 (got ${resCorrect.status})`)
    const body = await resCorrect.json()
    assert(body.ok === true, `H.5: response.ok=true (got ${body.ok})`)
    assert(typeof body.reconciliation === 'object' && body.reconciliation !== null, 'H.6: response.reconciliation summary present')
    assert(body.reconciliation.outboxCreated >= 1, `H.7: route's reconciliation pass healed ≥ 1 row (got ${body.reconciliation.outboxCreated})`)
    assert(typeof body.processing === 'object' && body.processing !== null, 'H.8: response.processing summary present')

    const hOutbox = await db.feedbackOutbox.findFirst({ where: { invoiceId: hInvoice } })
    assert(hOutbox !== null, 'H.9: healed row exists after the route ran')
    assert(hOutbox!.status === 'COMPLETED', `H.10: SAME-INVOCATION processing — healed row already COMPLETED (reconcile-first order; got ${hOutbox!.status})`)
    const hFeedback = await db.productFeedback.count({ where: { invoiceId: hInvoice } })
    assert(hFeedback === 1, `H.11: feedback record created in the same run (count=${hFeedback})`)

    if (oldSecret !== undefined) { process.env.CRON_SECRET = oldSecret } else { delete process.env.CRON_SECRET }
  }

  // ─── I. Cursor walk + cyclic wrap with a small limit ───
  console.log('\nI. Cursor walks bounded batches and wraps cyclically')
  {
    // Fresh slate for Biz B: clear outbox + cursor + ALL invoices (section E
    // left an eligible invoice behind — it would count as a 3rd gap and
    // break the exact walk assertions below).
    await db.feedbackOutbox.deleteMany({ where: { businessId: TEST_BIZ_B } })
    await db.feedbackReconciliationCursor.deleteMany({ where: { businessId: TEST_BIZ_B } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: TEST_BIZ_B } } })
    await db.invoice.deleteMany({ where: { businessId: TEST_BIZ_B } })
    await createGapInvoice({ businessId: TEST_BIZ_B, partyId: partyB1, items: [{ productId: null, name: 'FR I1' }], number: 'INV-FR-I1-' + Date.now() })
    await createGapInvoice({ businessId: TEST_BIZ_B, partyId: partyB1, items: [{ productId: null, name: 'FR I2' }], number: 'INV-FR-I2-' + Date.now() })

    // limit=1: each call scans exactly one row.
    const s1 = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_B, 1)
    assert(s1.scanned === 1, `I.1: limit=1 first call scans 1 (got ${s1.scanned})`)
    assert(s1.outboxCreated === 1, `I.2: first call heals 1 (got ${s1.outboxCreated})`)
    const s2 = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_B, 1)
    assert(s2.scanned === 1, `I.3: second call scans the NEXT row (cursor advanced) (got ${s2.scanned})`)
    assert(s2.outboxCreated === 1, `I.4: second call heals the second gap (got ${s2.outboxCreated})`)
    const s3 = await feedbackReconciliationLib.reconcileFeedbackOutboxForBusiness(TEST_BIZ_B, 1)
    assert(s3.scanned === 0, `I.5: third call finds nothing after cursor (got ${s3.scanned})`)
    assert(s3.cycleCompleted === true, 'I.6: third call WRAPS (cycleCompleted)')
    const cursor = await db.feedbackReconciliationCursor.findUnique({ where: { businessId: TEST_BIZ_B } })
    assert(cursor!.cycleCount === 1, `I.7: cycleCount incremented exactly once (got ${cursor!.cycleCount})`)
    const countB = await db.feedbackOutbox.count({ where: { businessId: TEST_BIZ_B } })
    assert(countB === 2, `I.8: exactly 2 healed rows for Biz B after the wrap (got ${countB})`)
  }

  // ─── J. Observability helper ───
  console.log('\nJ. getFeedbackReconciliationCursor observability')
  {
    const c = await feedbackReconciliationLib.getFeedbackReconciliationCursor(TEST_BIZ_B)
    assert(c !== null, 'J.1: cursor readable for Biz B')
    assert(typeof c!.scannedCount === 'number' && c!.scannedCount >= 2, `J.2: scannedCount accumulated (got ${c!.scannedCount})`)
    assert(typeof c!.lastInvoiceId === 'string', 'J.3: lastInvoiceId is a string ("" right after a cyclic wrap — the init position)')
    const missing = await feedbackReconciliationLib.getFeedbackReconciliationCursor('no-such-biz')
    assert(missing === null, 'J.4: unknown business → null')
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Feedback Reconciliation Tests: ${passed} passed, ${failed} failed`)
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
