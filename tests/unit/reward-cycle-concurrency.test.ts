/**
 * §STEP4A-TEST: Reward Accrual Concurrency Hardening — REAL DB tests.
 *
 * Run: bun run tests/unit/reward-cycle-concurrency.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: fires GENUINELY CONCURRENT accrual calls via Promise.all
 *     against the dev SQLite database (Prisma client). No mocking.
 *   - REAL CODE PATH: calls the production accrueCustomerRewardFromInvoice()
 *     directly — the same function the (future) post-commit hook will call.
 *
 * §WHAT-IT-VERIFIES (per STEP4A task matrix A–F + lost-update + 3+ invoice +
 *   tenant isolation + accounting invariants):
 *   A. same invoice × 2 concurrent              → 1 accrual
 *   B. invoice A + invoice B concurrent         → 2 accruals
 *   C. same invoice × 3 concurrent              → 1 accrual
 *   D. invoice A + B + C concurrent             → 3 accruals
 *   E. concurrent different invoices crossing threshold → 1 unlock only
 *   F. already-existing ACTIVE cycle + concurrent A/B → both accrue correctly
 *   + lost-update protection (exact combined profit)
 *   + exactly one REWARD_UNLOCKED event under threshold-crossing concurrency
 *   + tenant isolation regression (cross-business accrual is a no-op)
 *   + Party.balance unchanged
 *   + Invoice totals unchanged
 *   + Transaction table unchanged
 *
 * §SQLITE-LIMITATION: SQLite serializes ALL writes via a single-writer lock.
 *   Promise.all still starts all calls "concurrently" but SQLite serializes
 *   the actual DB writes — so the P2002 race windows are narrower than on
 *   PostgreSQL. The unique constraints still fire for the cases where two
 *   transactions both pass the findFirst pre-check and both attempt the
 *   conflicting INSERT. The PostgreSQL-specific partial-ACTIVE unique index
 *   is NOT enforced on SQLite (documented in the migration); the
 *   application-level retry loop in accrueCustomerRewardFromInvoice handles
 *   the cycle-creation race for both databases. The dedicated PostgreSQL
 *   concurrency test (tests/integration/reward-cycle-pg-concurrency.test.ts)
 *   verifies the partial-index path against real PostgreSQL when available.
 */
/// <reference types="bun-types" />
export {}

import { db } from '../../src/lib/db'
import { accrueCustomerRewardFromInvoice } from '../../src/lib/rewards'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const TEST_BIZ = 'test-rew-conc-' + Date.now()
const TEST_BIZ_X = 'test-rew-conc-X-' + Date.now()
let party1: string, party2: string, partyX: string
let product1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Rew Conc Biz', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_X, name: 'Rew Conc Biz X', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_X } })
  party1 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc P1', type: 'customer' } })).id
  party2 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc P2', type: 'customer' } })).id
  partyX = (await db.party.create({ data: { businessId: TEST_BIZ_X, name: 'Conc PX', type: 'customer' } })).id
  product1 = (await db.product.create({
    data: { businessId: TEST_BIZ, name: 'Conc Prod', purchasePrice: 50, salePrice: 100 },
  })).id
  // §PRODUCT-X: product + party in the OTHER business for tenant-isolation tests.
  await db.product.create({
    data: { businessId: TEST_BIZ_X, id: 'prod-X-' + Date.now(), name: 'Conc Prod X', purchasePrice: 50, salePrice: 100 },
  })
}

async function cleanup() {
  try {
    await db.customerRewardEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } } })
    await db.invoice.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.product.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.appSettings.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.auditLog.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_X] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ, TEST_BIZ_X] } } })
  } catch {}
}

async function makeInvoice(
  businessId: string,
  partyId: string,
  profit: number,
  opts: { status?: string; type?: string; productId?: string; quantity?: number } = {},
) {
  // §PROFIT-CONTROLLED: builds an invoice whose profit (subtotal - cogs) is
  // exactly `profit`. cogs = quantity × purchasePriceSnapshot. We fix the
  // snapshot at 50 and choose subtotal = profit + (quantity × 50) so that
  //   netRevenue - cogs = (subtotal - 0 discount) - (quantity × 50) = profit.
  const qty = opts.quantity ?? 1
  const snapshot = 50
  const subtotal = profit + qty * snapshot
  const inv = await db.invoice.create({
    data: {
      businessId, partyId,
      type: opts.type || 'sales',
      status: opts.status || 'paid',
      subtotal, discountAmount: 0,
      grandTotal: subtotal, gstAmount: 0,
      invoiceNumber: 'INV-' + Date.now() + '-' + Math.random().toString(36).substring(7),
    },
  })
  await db.invoiceItem.create({
    data: {
      invoiceId: inv.id,
      productId: opts.productId ?? product1,
      name: 'Test',
      quantity: qty,
      unitPrice: subtotal / qty,
      total: subtotal,
      purchasePriceSnapshot: snapshot,
    },
  })
  return inv
}

function countSuccess(results: Array<{ accrued: boolean }>): number {
  return results.filter(r => r.accrued === true).length
}

// §STAGGER: SQLite uses a single-writer lock; 3+ truly-simultaneous
// $transaction calls hit Prisma's hard P1008 socket timeout (5s) before
// the unique-constraint P2002 path engages. This helper fires calls with a
// small delay so the lock cycles — overlap is real (concurrency is
// exercised) but all calls do not block on the lock simultaneously.
// PostgreSQL (production) runs them truly concurrently; the partial-ACTIVE
// unique index + atomic increment handle correctness natively.
const stagger = <T>(fn: () => Promise<T>, delay: number): Promise<{ v: T | Error }> =>
  new Promise((resolve) =>
    setTimeout(() => fn().then(v => resolve({ v })).catch(e => resolve({ v: e })), delay)
  )

const staggerAll = async <T>(calls: Array<{ fn: () => Promise<T>; delay: number }>): Promise<Array<T | Error>> => {
  const results = await Promise.all(calls.map(c => stagger(c.fn, c.delay)))
  return results.map(r => r.v)
}

async function main() {
  console.log('\n🧪 Reward Accrual Concurrency Hardening Tests (SQLite dev DB)\n')
  await setup()

  // ─── A. Same invoice × 2 concurrent calls ────────────────────────────
  console.log('A. Same invoice × 2 concurrent → 1 accrual')
  {
    const inv = await makeInvoice(TEST_BIZ, party1, 100)
    const [r1, r2] = await Promise.all([
      accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id),
      accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id),
    ])
    const successCount = countSuccess([r1, r2])
    assert(successCount === 1, `A1: exactly 1 success (got ${successCount})`)
    const events = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, sourceInvoiceId: inv.id, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(events.length === 1, `A2: exactly 1 PROFIT_ACCRUAL event in DB (got ${events.length})`)
    // §IDEMPOTENT-RETURN: the loser must return the existing event (not undefined).
    const loser = [r1, r2].find(r => r.accrued === false)
    assert(loser?.event !== undefined, 'A3: idempotent loser returns existing event (not undefined)')
  }

  // ─── B. Invoice A + Invoice B concurrent (no ACTIVE cycle) ─────────
  console.log('\nB. Invoice A + Invoice B concurrent (empty customer) → 2 accruals')
  {
    const invA = await makeInvoice(TEST_BIZ, party2, 150)
    const invB = await makeInvoice(TEST_BIZ, party2, 200)
    const [rA, rB] = await Promise.all([
      accrueCustomerRewardFromInvoice(TEST_BIZ, invA.id),
      accrueCustomerRewardFromInvoice(TEST_BIZ, invB.id),
    ])
    const successCount = countSuccess([rA, rB])
    assert(successCount === 2, `B1: both succeed (got ${successCount}) — no lost invoice`)
    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: party2, status: 'ACTIVE' },
    })
    assert(cycle !== null, 'B2: exactly one ACTIVE cycle created')
    const acc = cycle?.accumulatedProfit.toNumber() ?? 0
    // §EXACT-COMBINED-PROFIT: 150 + 200 = 350 (no lost update)
    assert(acc === 350, `B3: accumulated=350 (profit A + profit B) — got ${acc}`)
    const events = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, partyId: party2, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(events.length === 2, `B4: exactly 2 PROFIT_ACCRUAL events (got ${events.length})`)
    const cycles = await db.customerRewardCycle.count({
      where: { businessId: TEST_BIZ, partyId: party2 },
    })
    assert(cycles === 1, `B5: exactly 1 cycle total (no duplicate cycle) — got ${cycles}`)
  }

  // ─── C. Same invoice × 3 concurrent ─────────────────────────────────
  // §SQLITE-LIMITATION: SQLite uses a single-writer lock. 3 truly-simultaneous
  // $transaction calls can hit Prisma's hard P1008 socket timeout (5s) before
  // the unique-constraint P2002 path engages. We stagger by 10ms so the
  // single-writer lock can cycle — the calls still overlap (concurrency is
  // real) but do not all block on the lock simultaneously. On PostgreSQL
  // (production), all 3 fire truly concurrently and the P2002 path handles
  // the losers natively. See tests/integration/reward-cycle-pg-concurrency.test.ts
  // for the true-concurrent PostgreSQL verification.
  console.log('\nC. Same invoice × 3 concurrent (staggered for SQLite) → 1 accrual')
  {
    const inv = await makeInvoice(TEST_BIZ, party1, 100)
    const raw = await staggerAll([
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id), delay: 0 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id), delay: 30 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id), delay: 60 },
    ])
    const results = raw.filter(r => !(r instanceof Error)) as Array<{ accrued: boolean; event?: any }>
    assert(results.length === 3, `C0: all 3 calls returned non-error results (got ${results.length})`)
    const successCount = countSuccess(results)
    assert(successCount === 1, `C1: exactly 1 success (got ${successCount})`)
    const events = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, sourceInvoiceId: inv.id, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(events.length === 1, `C2: exactly 1 PROFIT_ACCRUAL event (got ${events.length})`)
    const loserCount = results.filter(r => r.accrued === false && r.event !== undefined).length
    assert(loserCount === 2, `C3: 2 idempotent losers return existing event (got ${loserCount})`)
  }

  // ─── D. Invoice A + B + C concurrent (fresh party, high threshold) ───
  // §SETUP: party2 from test B had accumulated=350 with threshold=400.
  // Adding 50+60+70=180 → 530 > 400 → cycle UNLOCKs + new cycle starts at
  // ₹0 (no-carry-over). That's CORRECT semantics but confuses the lost-update
  // assertion. We use a FRESH party with a HIGH threshold so all 3 accruals
  // land in the same ACTIVE cycle, isolating the lost-update check.
  // §SQLITE-LIMITATION: staggered by 30ms (see stagger helper).
  console.log('\nD. Invoice A + B + C concurrent (fresh party, high threshold) → 3 accruals')
  {
    await db.appSettings.update({ where: { businessId: TEST_BIZ }, data: { rewardThreshold: 100000 } })
    const partyD = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc PD', type: 'customer' } })).id
    const invA = await makeInvoice(TEST_BIZ, partyD, 50)
    const invB = await makeInvoice(TEST_BIZ, partyD, 60)
    const invC = await makeInvoice(TEST_BIZ, partyD, 70)
    const raw = await staggerAll([
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invA.id), delay: 0 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invB.id), delay: 30 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invC.id), delay: 60 },
    ])
    const results = raw.filter(r => !(r instanceof Error)) as Array<{ accrued: boolean }>
    assert(results.length === 3, `D0: all 3 calls returned non-error results (got ${results.length})`)
    const successCount = countSuccess(results)
    assert(successCount === 3, `D1: all 3 succeed (got ${successCount}) — no lost invoice`)
    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: partyD },
    })
    const acc = cycle?.accumulatedProfit.toNumber() ?? 0
    assert(acc === 180, `D2: accumulated=180 (50 + 60 + 70) — got ${acc} — no lost update`)
    const events = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, partyId: partyD, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(events.length === 3, `D3: 3 PROFIT_ACCRUAL events — got ${events.length}`)
    const cycles = await db.customerRewardCycle.count({
      where: { businessId: TEST_BIZ, partyId: partyD },
    })
    assert(cycles === 1, `D4: exactly 1 cycle (no duplicate) — got ${cycles}`)
    // cleanup
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyD } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyD } })
    await db.party.delete({ where: { id: partyD } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyD } } })
    await db.invoice.deleteMany({ where: { partyId: partyD } })
  }

  // ─── E. Concurrent different invoices crossing threshold → 1 unlock ─
  console.log('\nE. Concurrent different invoices crossing threshold → exactly 1 unlock')
  {
    // §SETUP: fresh customer. Set threshold to 300 so two invoices (150 + 200 = 350) cross it.
    await db.appSettings.update({ where: { businessId: TEST_BIZ }, data: { rewardThreshold: 300 } })
    const partyE = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc PE', type: 'customer' } })).id
    const invA = await makeInvoice(TEST_BIZ, partyE, 150)
    const invB = await makeInvoice(TEST_BIZ, partyE, 200)
    const [rA, rB] = await Promise.all([
      accrueCustomerRewardFromInvoice(TEST_BIZ, invA.id),
      accrueCustomerRewardFromInvoice(TEST_BIZ, invB.id),
    ])
    const successCount = countSuccess([rA, rB])
    assert(successCount === 2, `E1: both succeed (got ${successCount})`)
    const unlockEvents = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, partyId: partyE, eventType: 'REWARD_UNLOCKED' },
    })
    assert(unlockEvents.length === 1, `E2: exactly 1 REWARD_UNLOCKED event (got ${unlockEvents.length}) — no duplicate unlock`)
    const cycles = await db.customerRewardCycle.findMany({
      where: { businessId: TEST_BIZ, partyId: partyE },
    })
    assert(cycles.length === 1, `E3: exactly 1 cycle (got ${cycles.length})`)
    assert(cycles[0].status === 'UNLOCKED', `E4: cycle status=UNLOCKED (got ${cycles[0].status})`)
    const acc = cycles[0].accumulatedProfit.toNumber()
    assert(acc === 350, `E5: accumulated=350 (150 + 200) — got ${acc} — exact combined profit`)
    const accrualEvents = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, partyId: partyE, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(accrualEvents.length === 2, `E6: 2 PROFIT_ACCRUAL events (got ${accrualEvents.length})`)
    // cleanup
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyE } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyE } })
    await db.party.delete({ where: { id: partyE } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyE } } })
    await db.invoice.deleteMany({ where: { partyId: partyE } })
  }

  // ─── F. Existing ACTIVE cycle + concurrent A/B ─────────────────────
  console.log('\nF. Pre-existing ACTIVE cycle + concurrent A/B → both accrue correctly')
  {
    // §SETUP: fresh party + pre-seed an ACTIVE cycle manually (simulating a
    // prior accrual that already created the cycle).
    await db.appSettings.update({ where: { businessId: TEST_BIZ }, data: { rewardThreshold: 1000 } })
    const partyF = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc PF', type: 'customer' } })).id
    await db.customerRewardCycle.create({
      data: {
        businessId: TEST_BIZ, partyId: partyF,
        cycleNumber: 1, threshold: 1000, accumulatedProfit: 100, status: 'ACTIVE',
      },
    })
    const invA = await makeInvoice(TEST_BIZ, partyF, 150)
    const invB = await makeInvoice(TEST_BIZ, partyF, 200)
    const [rA, rB] = await Promise.all([
      accrueCustomerRewardFromInvoice(TEST_BIZ, invA.id),
      accrueCustomerRewardFromInvoice(TEST_BIZ, invB.id),
    ])
    const successCount = countSuccess([rA, rB])
    assert(successCount === 2, `F1: both succeed (got ${successCount})`)
    const cycles = await db.customerRewardCycle.findMany({
      where: { businessId: TEST_BIZ, partyId: partyF },
    })
    assert(cycles.length === 1, `F2: still exactly 1 cycle (no duplicate) — got ${cycles.length}`)
    const acc = cycles[0].accumulatedProfit.toNumber()
    // §LOST-UPDATE: 100 (seed) + 150 + 200 = 450. NOT 250 (B-only). NOT 300 (A-only).
    assert(acc === 450, `F3: accumulated=450 (100 + 150 + 200) — got ${acc} — no lost update`)
    assert(cycles[0].status === 'ACTIVE', `F4: still ACTIVE (450 < 1000 threshold) — got ${cycles[0].status}`)
    // cleanup
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyF } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyF } })
    await db.party.delete({ where: { id: partyF } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyF } } })
    await db.invoice.deleteMany({ where: { partyId: partyF } })
  }

  // ─── G. Lost-update protection (exact combined profit, 3 invoices) ──
  // §SQLITE-LIMITATION: staggered by 30ms (see stagger helper). PostgreSQL
  // runs truly concurrent.
  console.log('\nG. Lost-update protection — 3 concurrent invoices against same cycle')
  {
    await db.appSettings.update({ where: { businessId: TEST_BIZ }, data: { rewardThreshold: 10000 } })
    const partyG = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Conc PG', type: 'customer' } })).id
    // seed cycle at 100
    await db.customerRewardCycle.create({
      data: {
        businessId: TEST_BIZ, partyId: partyG,
        cycleNumber: 1, threshold: 10000, accumulatedProfit: 100, status: 'ACTIVE',
      },
    })
    const invA = await makeInvoice(TEST_BIZ, partyG, 150)
    const invB = await makeInvoice(TEST_BIZ, partyG, 200)
    const invC = await makeInvoice(TEST_BIZ, partyG, 300)
    await staggerAll([
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invA.id), delay: 0 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invB.id), delay: 30 },
      { fn: () => accrueCustomerRewardFromInvoice(TEST_BIZ, invC.id), delay: 60 },
    ])
    const cycle = await db.customerRewardCycle.findFirst({
      where: { businessId: TEST_BIZ, partyId: partyG },
    })
    const acc = cycle?.accumulatedProfit.toNumber() ?? 0
    // 100 + 150 + 200 + 300 = 750. Any lost update would yield < 750.
    assert(acc === 750, `G1: accumulated=750 (100+150+200+300) — got ${acc} — no lost update`)
    // cleanup
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyG } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ, partyId: partyG } })
    await db.party.delete({ where: { id: partyG } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyG } } })
    await db.invoice.deleteMany({ where: { partyId: partyG } })
  }

  // ─── H. Tenant isolation regression ────────────────────────────────
  console.log('\nH. Tenant isolation — cross-business accrual is a no-op')
  {
    // §CROSS-TENANT: an invoice in BIZ_X must NOT accrue under TEST_BIZ's
    // businessId. The eligibility findFirst scopes by businessId, so this
    // returns "not eligible" and never touches TEST_BIZ's reward tables.
    const invX = await db.invoice.create({
      data: {
        businessId: TEST_BIZ_X, partyId: partyX, type: 'sales', status: 'paid',
        subtotal: 1000, discountAmount: 0, grandTotal: 1000, gstAmount: 0,
        invoiceNumber: 'INV-X-' + Date.now(),
      },
    })
    await db.invoiceItem.create({
      data: {
        invoiceId: invX.id, productId: null, name: 'X item',
        quantity: 1, unitPrice: 1000, total: 1000, purchasePriceSnapshot: 50,
      },
    })
    // Try to accrue BIZ_X's invoice under TEST_BIZ's businessId → must fail eligibility.
    const result = await accrueCustomerRewardFromInvoice(TEST_BIZ, invX.id)
    assert(result.accrued === false, 'H1: cross-tenant accrual rejected (not eligible)')
    assert(result.error?.includes('not eligible') ?? false, 'H2: error mentions not eligible')
    // Verify no reward state was created in TEST_BIZ for partyX.
    const cyclesInBizForPartyX = await db.customerRewardCycle.count({
      where: { businessId: TEST_BIZ, partyId: partyX },
    })
    assert(cyclesInBizForPartyX === 0, 'H3: no cycle created in TEST_BIZ for foreign party')
  }

  // ─── I. Party.balance unchanged ────────────────────────────────────
  console.log('\nI. Party.balance unchanged by reward accrual')
  {
    const party = await db.party.findUnique({ where: { id: party1 }, select: { balance: true } })
    // party1 was never given any balance by the reward system.
    const bal = party?.balance.toNumber?.() ?? Number(party?.balance ?? 0)
    assert(bal === 0, `I1: party1 balance=0 (got ${bal}) — reward system never mutates Party.balance`)
  }

  // ─── J. Invoice totals unchanged ───────────────────────────────────
  console.log('\nJ. Invoice totals unchanged by reward accrual')
  {
    // Pick any invoice we created and confirm its subtotal/status were not
    // mutated by the reward system.
    const invoices = await db.invoice.findMany({
      where: { businessId: TEST_BIZ },
      select: { id: true, subtotal: true, status: true, type: true },
    })
    assert(invoices.length > 0, 'J1: invoices exist')
    const allPaid = invoices.every(i => i.status === 'paid')
    assert(allPaid, 'J2: every invoice still has its original status=paid (no reward mutation)')
    // §SUBTOTAL-UNCHANGED: subtotal is a Decimal; compare toNumber() vs the
    // expected values we set in makeInvoice. We only need to confirm none
    // were mutated to 0 or any other value.
    const anyZero = invoices.some(i => i.subtotal.toNumber() === 0)
    assert(!anyZero, 'J3: no invoice subtotal was zeroed out by reward system')
  }

  // ─── K. Transaction table unchanged ───────────────────────────────
  console.log('\nK. Transaction table unchanged by reward accrual')
  {
    const txCount = await db.transaction.count({ where: { businessId: TEST_BIZ } })
    assert(txCount === 0, `K1: 0 transactions created by reward system (got ${txCount})`)
  }

  // ─── L. Same-invoice idempotency regression (sequential) ───────────
  console.log('\nL. Same-invoice idempotency regression (sequential)')
  {
    const inv = await makeInvoice(TEST_BIZ, party1, 100)
    const r1 = await accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id)
    const r2 = await accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id)
    const r3 = await accrueCustomerRewardFromInvoice(TEST_BIZ, inv.id)
    assert(r1.accrued === true, 'L1: first accrual succeeds')
    assert(r2.accrued === false, 'L2: second accrual is idempotent')
    assert(r3.accrued === false, 'L3: third accrual is idempotent')
    const events = await db.customerRewardEvent.findMany({
      where: { businessId: TEST_BIZ, sourceInvoiceId: inv.id, eventType: 'PROFIT_ACCRUAL' },
    })
    assert(events.length === 1, `L4: exactly 1 PROFIT_ACCRUAL event (got ${events.length})`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Reward Accrual Concurrency Tests: ${passed} passed, ${failed} failed`)
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
