/**
 * §STEP7-TEST: Reward Outbox Failure Paths — mock-based tests for FAILED +
 * PERMANENTLY_FAILED transitions.
 *
 * Run: bun run tests/integration/reward-outbox-failure-paths.test.ts
 *
 * §CLASSIFICATION:
 *   - MOCKED: @/lib/rewards is mocked to throw, simulating DB failure / process
 *     crash / unexpected exception. This is the ONLY way to test the FAILED +
 *     PERMANENTLY_FAILED code paths without corrupting the DB.
 *   - SEPARATE-FILE: this test runs in its own process so the mock does NOT
 *     pollute the module cache for the main reliability suite.
 *
 * §WHAT-IT-VERIFIES (Step 7 task §13 E + G):
 *   E. immediate accrual failure → FAILED (attempts=1, lastError recorded)
 *   G. max attempts → PERMANENTLY_FAILED (attempts=MAX_ATTEMPTS, row kept)
 */
/// <reference types="bun-types" />
export {}

import { mock } from 'bun:test'
import { db } from '../../src/lib/db'
import { MAX_ATTEMPTS } from '../../src/lib/reward-outbox'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const TEST_BIZ = 'test-outbox-fail-' + Date.now()
let party1: string, product1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Outbox Fail Biz', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ } })
  party1 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Fail P1', type: 'customer' } })).id
  product1 = (await db.product.create({
    data: { businessId: TEST_BIZ, name: 'Fail Prod', purchasePrice: 50, salePrice: 100, stock: 1000 },
  })).id
}

async function cleanup() {
  try {
    await db.rewardAccrualOutbox.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerRewardEvent.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: TEST_BIZ } } })
    await db.invoice.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.transaction.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.product.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.party.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.appSettings.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.auditLog.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.business.deleteMany({ where: { id: TEST_BIZ } })
  } catch {}
}

async function makeInvoice(profit: number = 100) {
  const snapshot = 50
  const subtotal = profit + snapshot
  const inv = await db.invoice.create({
    data: {
      businessId: TEST_BIZ, partyId: party1, type: 'sales', status: 'paid',
      subtotal, discountAmount: 0, grandTotal: subtotal, gstAmount: 0,
      invoiceNumber: 'INV-' + Date.now() + '-' + Math.random().toString(36).substring(7),
      amountPaid: subtotal, amountDue: 0,
    },
  })
  await db.invoiceItem.create({
    data: {
      invoiceId: inv.id, productId: product1, name: 'Test',
      quantity: 1, unitPrice: subtotal, total: subtotal,
      purchasePriceSnapshot: snapshot,
    },
  })
  return inv
}

async function makeOutboxRow(invoiceId: string, status: string = 'PENDING', attempts: number = 0) {
  await db.rewardAccrualOutbox.deleteMany({ where: { invoiceId } }).catch(() => {})
  return db.rewardAccrualOutbox.create({
    data: { businessId: TEST_BIZ, invoiceId, status, attempts },
  })
}

// §MOCK-SETUP: mock @/lib/rewards to throw BEFORE importing reward-outbox.
// The reward-outbox module will capture the mocked rewards at import time.
const realRewards = await import('../../src/lib/rewards')
await mock.module('@/lib/rewards', () => ({
  ...realRewards,
  accrueCustomerRewardFromInvoice: async () => {
    throw new Error('SIMULATED_FAILURE')
  },
}))
// §IMPORT-AFTER-MOCK: the reward-outbox module captures the mocked rewards.
const { processRewardAccrualOutbox } = await import('../../src/lib/reward-outbox')

async function main() {
  console.log('\n🧪 Reward Outbox Failure Path Tests (mock-based)\n')
  await setup()

  // ─── E. immediate accrual failure → FAILED ──────────────────────────
  console.log('E. Accrual failure → outbox FAILED')
  {
    const inv = await makeInvoice(50)
    const outbox = await makeOutboxRow(inv.id)

    const result = await processRewardAccrualOutbox(outbox.id)
    assert(result.status === 'FAILED', `E1: status=FAILED (got ${result.status})`)
    assert(result.error?.includes('SIMULATED_FAILURE') === true, 'E2: error recorded')

    const row = await db.rewardAccrualOutbox.findUnique({ where: { id: outbox.id } })
    assert(row!.status === 'FAILED', `E3: outbox row status=FAILED`)
    assert(row!.lastError?.includes('SIMULATED_FAILURE') === true, 'E4: lastError recorded')
    assert(row!.attempts === 1, `E5: attempts=1 (got ${row!.attempts})`)
    assert(row!.completedAt === null, 'E6: completedAt NOT set (failed, not completed)')
    assert(row!.claimToken === null, 'E7: claimToken cleared after failure')
  }

  // ─── G. max attempts → PERMANENTLY_FAILED ───────────────────────────
  console.log('\nG. Max attempts → PERMANENTLY_FAILED')
  {
    const inv = await makeInvoice(30)
    // §START at attempts = MAX_ATTEMPTS - 1. The next failure pushes to MAX_ATTEMPTS.
    const outbox = await makeOutboxRow(inv.id, 'FAILED', MAX_ATTEMPTS - 1)

    const result = await processRewardAccrualOutbox(outbox.id)
    assert(result.status === 'PERMANENTLY_FAILED', `G1: status=PERMANENTLY_FAILED (got ${result.status})`)

    const row = await db.rewardAccrualOutbox.findUnique({ where: { id: outbox.id } })
    assert(row!.status === 'PERMANENTLY_FAILED', 'G2: outbox row PERMANENTLY_FAILED')
    assert(row!.attempts === MAX_ATTEMPTS, `G3: attempts=MAX_ATTEMPTS=${MAX_ATTEMPTS} (got ${row!.attempts})`)
    assert(row!.lastError?.includes('SIMULATED_FAILURE') === true, 'G4: lastError recorded')
    assert(row!.completedAt === null, 'G5: completedAt NOT set (permanently failed, not completed)')

    // §ROW-NOT-DELETED: permanently failed rows are kept for audit.
    const stillExists = await db.rewardAccrualOutbox.findUnique({ where: { id: outbox.id } })
    assert(stillExists !== null, 'G6: PERMANENTLY_FAILED row NOT deleted (kept for audit)')
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Reward Outbox Failure Path Tests: ${passed} passed, ${failed} failed`)
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
