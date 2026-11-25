/**
 * §STEP4B-TEST: Reward Accrual Wiring — REAL post-commit hook verification.
 *
 * Run: bun run tests/integration/reward-accrual-wiring.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: imports the REAL exported POST handler from
 *     src/app/api/invoices/route.ts and calls it with a real NextRequest.
 *   - MOCKED BOUNDARY: `createInvoice` from @/lib/invoice-service is replaced
 *     with a stub that inserts a REAL invoice row into the dev SQLite DB
 *     (so the reward accrual function's eligibility query finds it) and
 *     returns it. This bypasses the full invoice-creation accounting path
 *     (stock, party balance, transactions) which is already tested elsewhere,
 *     and isolates the post-commit wiring under test.
 *   - MOCKED AUTH: `getCurrentBusiness` is replaced to return the test business.
 *   - REAL REWARD LOGIC: `accrueCustomerRewardFromInvoice` is the REAL
 *     production function (NOT mocked). The fire-and-forget call in the POST
 *     handler invokes it for real.
 *
 * §WHAT-IT-VERIFIES (Step 4 task §8 subset):
 *   A. successful eligible sale → reward accrual invoked (PROFIT_ACCRUAL event exists)
 *   B. void invoice → no accrual (eligibility filter rejects)
 *   C. unsupported invoice type (purchase) → no accrual
 *   D. walk-in sale (no partyId) → no accrual
 *   E. idempotency: second POST for the same saleOperationId → no duplicate event
 *   F. reward state never mutates Party.balance
 *   G. reward state never mutates Invoice totals
 *   H. reward state never mutates Transaction table
 *
 * §POST-COMMIT-SAFETY: the accrual call is fire-and-forget (.catch). The test
 * polls for the PROFIT_ACCRUAL event to appear (with a timeout) because the
 * accrual runs asynchronously after createSaleNotification returns.
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

const TEST_BIZ = 'test-rew-wire-' + Date.now()
let party1: string, party2: string
let product1: string

// §MOCK-STATE: the stubbed createInvoice writes the invoice row + returns it.
// We capture the last-created invoice so the test can assert on it.
let lastCreatedInvoiceId: string | null = null

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Rew Wire Biz', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ } })
  party1 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Wire P1', type: 'customer' } })).id
  party2 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Wire P2', type: 'customer' } })).id
  product1 = (await db.product.create({
    data: { businessId: TEST_BIZ, name: 'Wire Prod', purchasePrice: 50, salePrice: 100, stock: 1000 },
  })).id
}

async function cleanup() {
  try {
    await db.rewardAccrualOutbox.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: TEST_BIZ } } })
    await db.invoice.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.notification.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.notificationChannelPreference.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.transaction.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.product.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.party.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.appSettings.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.auditLog.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.business.deleteMany({ where: { id: TEST_BIZ } })
  } catch {}
}

// §MOCK-CREATEINVOICE: write a real invoice row (so the reward eligibility
// query finds it) + return it. This bypasses the full accounting path
// (stock, party balance, transactions) which is already tested in the
// invoice-service test suite. The post-commit reward hook is what we test.
//
// §P2002-RECOVERY: mirrors the real createInvoice's idempotency recovery —
// if saleOperationId is provided AND an invoice with that key already exists,
// return the existing invoice instead of creating a duplicate. This lets the
// duplicate-POST test (E) exercise the idempotent path the way production does.
async function stubCreateInvoice(body: any, _business: { id: string }) {
  const saleOperationId = typeof body.saleOperationId === 'string' && body.saleOperationId.length > 0
    ? body.saleOperationId
    : null

  if (saleOperationId) {
    const existing = await db.invoice.findFirst({
      where: { businessId: _business.id, saleOperationId },
      include: { items: true },
    })
    if (existing) {
      lastCreatedInvoiceId = existing.id
      return existing
    }
  }

  const type = body.type || 'sales'
  const status = body.status || 'paid'
  const partyId = body.partyId || null
  // §PROFIT-CONTROLLED: subtotal = profit + (qty × 50 snapshot). cogs = qty × 50.
  // We let the test body specify the desired profit via `body._testProfit`
  // (default 100).
  const profit = body._testProfit ?? 100
  const qty = 1
  const snapshot = 50
  const subtotal = profit + qty * snapshot
  const inv = await db.invoice.create({
    data: {
      businessId: _business.id,
      partyId,
      type,
      status,
      subtotal,
      discountAmount: 0,
      grandTotal: subtotal,
      gstAmount: 0,
      saleOperationId,
      invoiceNumber: 'INV-' + Date.now() + '-' + Math.random().toString(36).substring(7),
      amountPaid: subtotal,
      amountDue: 0,
      paymentMode: body.paymentMode || null,
    },
  })
  if (body._testItems !== false) {
    await db.invoiceItem.create({
      data: {
        invoiceId: inv.id,
        productId: product1,
        name: 'Test item',
        quantity: qty,
        unitPrice: subtotal,
        total: subtotal,
        purchasePriceSnapshot: snapshot,
      },
    })
  }
  // §STEP7-OUTBOX-MIRROR: the stub must mirror the production createInvoice's
  // outbox row creation (src/lib/invoice-service.ts). Only eligible invoices
  // (sales/retail, non-void, with partyId) get an outbox row — matches the
  // production eligibility filter. Without this, processOutboxRowForInvoice
  // finds no outbox row and the reward accrual is not triggered.
  const isPurchase = type === 'purchase'
  const isEligibleForReward = !isPurchase && partyId && status !== 'void'
  if (isEligibleForReward) {
    try {
      await db.rewardAccrualOutbox.create({
        data: {
          businessId: _business.id,
          invoiceId: inv.id,
          status: 'PENDING',
          attempts: 0,
        },
      })
    } catch (e: any) {
      // §P2002: outbox row already exists (e.g., reconciliation created it).
      // Safe to ignore — the row exists, which is all we need.
      if (e?.code !== 'P2002') throw e
    }
  }
  lastCreatedInvoiceId = inv.id
  return { ...inv, items: [] }
}

// §MOCK-AUTH: getCurrentBusiness returns the test business.
let currentBusinessOverride: { id: string; name: string; currency: string } | null = null
await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

// §MOCK-INVOICE-SERVICE: replace createInvoice with the stub. The
// InvoiceValidationError class is preserved (the route's instanceof check).
const realInvoiceService = await import('@/lib/invoice-service')
await mock.module('@/lib/invoice-service', () => ({
  ...realInvoiceService,
  createInvoice: stubCreateInvoice,
}))

// §IMPORT-ROUTE-AFTER-MOCKS: the route handler now uses the mocked
// getCurrentBusiness + mocked createInvoice. The REAL accrueCustomerRewardFromInvoice
// (imported by the route via @/lib/rewards) is NOT mocked — we test it for real.
const invoiceRoute = await import('@/app/api/invoices/route')

// §POLL: the accrual is fire-and-forget (.catch). Poll for the event.
async function waitForRewardEvent(invoiceId: string, timeoutMs = 3000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const ev = await db.customerRewardEvent.findFirst({
      where: { businessId: TEST_BIZ, sourceInvoiceId: invoiceId, eventType: 'PROFIT_ACCRUAL' },
    })
    if (ev) return true
    await new Promise(r => setTimeout(r, 50))
  }
  return false
}

async function waitForNoRewardEvent(invoiceId: string, timeoutMs = 500): Promise<boolean> {
  // §NEGATIVE: wait a short window to confirm NO event appears. The accrual
  // is async; we give it 500ms to (not) fire, then assert absence.
  await new Promise(r => setTimeout(r, timeoutMs))
  const ev = await db.customerRewardEvent.findFirst({
    where: { businessId: TEST_BIZ, sourceInvoiceId: invoiceId },
  })
  return ev === null
}

async function main() {
  console.log('\n🧪 Reward Accrual Wiring Tests — REAL POST /api/invoices handler\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ, name: 'Wire Biz', currency: 'INR' }

  // ─── A. Eligible sale → reward accrual invoked ──────────────────────
  console.log('A. Eligible sale → reward accrual invoked')
  {
    const req = new NextRequest('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ type: 'sales', partyId: party1, _testProfit: 100, items: [{ productId: product1, quantity: 1, unitPrice: 150 }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await invoiceRoute.POST(req)
    assert(res.status === 200, `A1: POST returns 200 (got ${res.status})`)
    const invId = lastCreatedInvoiceId
    assert(invId !== null, 'A2: invoice was created by stubbed createInvoice')

    const fired = await waitForRewardEvent(invId!)
    assert(fired, 'A3: PROFIT_ACCRUAL event appeared (post-commit hook fired)')

    const event = await db.customerRewardEvent.findFirst({
      where: { businessId: TEST_BIZ, sourceInvoiceId: invId, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(event !== null, 'A4: event exists in DB')
    const amount = event!.amount.toNumber()
    assert(amount === 100, `A5: event.amount=100 (got ${amount}) — correct profit`)

    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: party1 },
    })
    assert(cycle !== null, 'A6: cycle created for party1')
    assert(cycle!.status === 'ACTIVE', `A7: cycle is ACTIVE (got ${cycle!.status})`)
    assert(cycle!.accumulatedProfit.toNumber() === 100, `A8: accumulated=100 (got ${cycle!.accumulatedProfit.toNumber()})`)
  }

  // ─── B. Void invoice → no accrual ───────────────────────────────────
  console.log('\nB. Void invoice → no accrual')
  {
    const req = new NextRequest('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ type: 'sales', partyId: party2, status: 'void', _testProfit: 200, items: [{ productId: product1, quantity: 1, unitPrice: 250 }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await invoiceRoute.POST(req)
    const invId = lastCreatedInvoiceId
    const noEvent = await waitForNoRewardEvent(invId!)
    assert(noEvent, 'B1: no PROFIT_ACCRUAL event for void invoice (eligibility filter)')
    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: party2 },
    })
    assert(cycle === null, 'B2: no cycle created for void invoice')
  }

  // ─── C. Purchase invoice → no accrual ──────────────────────────────
  console.log('\nC. Purchase invoice → no accrual')
  {
    const req = new NextRequest('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ type: 'purchase', partyId: party2, _testProfit: 300, items: [{ productId: product1, quantity: 1, unitPrice: 350 }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await invoiceRoute.POST(req)
    const invId = lastCreatedInvoiceId
    const noEvent = await waitForNoRewardEvent(invId!)
    assert(noEvent, 'C1: no PROFIT_ACCRUAL event for purchase invoice')
  }

  // ─── D. Walk-in sale (no partyId) → no accrual ─────────────────────
  console.log('\nD. Walk-in sale (no partyId) → no accrual')
  {
    const req = new NextRequest('http://localhost/api/invoices', {
      method: 'POST',
      body: JSON.stringify({ type: 'sales', _testProfit: 150, items: [{ productId: product1, quantity: 1, unitPrice: 200 }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await invoiceRoute.POST(req)
    const invId = lastCreatedInvoiceId
    const noEvent = await waitForNoRewardEvent(invId!)
    assert(noEvent, 'D1: no PROFIT_ACCRUAL event for walk-in sale (no partyId)')
  }

  // ─── E. Idempotency: duplicate POST (same saleOperationId) ──────────
  console.log('\nE. Idempotency: duplicate POST → no duplicate event')
  {
    const saleOpId = 'sale-op-' + Date.now()
    const body = JSON.stringify({ type: 'sales', partyId: party2, saleOperationId: saleOpId, _testProfit: 80, items: [{ productId: product1, quantity: 1, unitPrice: 130 }] })
    const req1 = new NextRequest('http://localhost/api/invoices', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
    const res1 = await invoiceRoute.POST(req1)
    assert(res1.status === 200, `E1a: first POST → 200 (got ${res1.status})`)
    const invId1 = lastCreatedInvoiceId
    const fired1 = await waitForRewardEvent(invId1!)
    assert(fired1, 'E1b: first POST → PROFIT_ACCRUAL event')

    // §DUPLICATE-POST: same saleOperationId. The stub's P2002-recovery returns
    // the SAME invoice (mirroring production createInvoice). The route then
    // calls accrueCustomerRewardFromInvoice(invoice.id) AGAIN — the second call
    // is idempotent (sourceInvoiceId unique constraint) and returns the
    // existing event without creating a duplicate.
    const req2 = new NextRequest('http://localhost/api/invoices', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
    const res2 = await invoiceRoute.POST(req2)
    assert(res2.status === 200, `E2a: duplicate POST → 200 (got ${res2.status}) — idempotent recovery`)
    assert(lastCreatedInvoiceId === invId1, 'E2b: duplicate POST returned the SAME invoice id (no new invoice)')

    // Wait briefly for the second (idempotent) accrual to settle.
    await new Promise(r => setTimeout(r, 200))
    const eventsForInv1 = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, sourceInvoiceId: invId1, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(eventsForInv1.length === 1, `E3: still exactly 1 PROFIT_ACCRUAL event after duplicate POST (got ${eventsForInv1.length}) — idempotent`)
    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: party2, status: 'ACTIVE' },
    })
    if (cycle) {
      const acc = cycle.accumulatedProfit.toNumber()
      assert(acc === 80, `E4: party2 accumulated=80 (single accrual, no duplicate) — got ${acc}`)
    } else {
      assert(false, 'E4: party2 ACTIVE cycle exists')
    }
  }

  // ─── F. Party.balance unchanged ─────────────────────────────────────
  console.log('\nF. Party.balance unchanged by reward accrual')
  {
    // party1 had one sale (test A) with amountDue=0 (paid). The stub did NOT
    // update party balance (it bypasses the real accounting path). So
    // balance must still be 0. The reward accrual must also not touch it.
    const party = await db.party.findUnique({ where: { id: party1 }, select: { balance: true } })
    const bal = party?.balance.toNumber?.() ?? Number(party?.balance ?? 0)
    assert(bal === 0, `F1: party1 balance=0 (reward system never mutates Party.balance) — got ${bal}`)
  }

  // ─── G. Invoice totals unchanged ────────────────────────────────────
  console.log('\nG. Invoice totals unchanged by reward accrual')
  {
    const invoices = await db.invoice.findMany({
      where: { businessId: TEST_BIZ },
      select: { id: true, subtotal: true, status: true, type: true },
    })
    assert(invoices.length > 0, 'G1: invoices exist')
    // §STATUS-PRESERVED: the stub set status; reward accrual must not change it.
    const allOriginal = invoices.every(i => i.status === 'paid' || i.status === 'void')
    assert(allOriginal, 'G2: every invoice retains its original status (no reward mutation)')
    // §SUBTOTAL-PRESERVED: no invoice subtotal was zeroed/changed.
    const anyZero = invoices.some(i => i.subtotal.toNumber() === 0)
    assert(!anyZero, 'G3: no invoice subtotal was zeroed out')
  }

  // ─── H. Transaction table unchanged ───────────────────────────────
  console.log('\nH. Transaction table unchanged by reward accrual')
  {
    // The stubbed createInvoice does NOT create Transaction rows. The reward
    // accrual also must NOT create any. So count must be 0.
    const txCount = await db.transaction.count({ where: { businessId: TEST_BIZ } })
    assert(txCount === 0, `H1: 0 transactions created by reward system (got ${txCount})`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Reward Accrual Wiring Tests: ${passed} passed, ${failed} failed`)
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
