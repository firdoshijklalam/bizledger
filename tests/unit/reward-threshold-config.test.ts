/**
 * §TEST: Customer Reward Threshold configuration — REAL DB tests.
 *
 * Run: npx tsx tests/unit/reward-threshold-config.test.ts  (or: bun tests/unit/reward-threshold-config.test.ts)
 *
 * Covers (per the feature spec):
 *  1.  default threshold = 400
 *  2.  valid threshold update, e.g. 300
 *  3.  valid threshold update, e.g. 500
 *  4.  invalid zero rejected
 *  5.  invalid negative rejected
 *  6.  invalid NaN / non-numeric rejected (incl. Infinity)
 *  7.  unauthorized role (STAFF) cannot update it
 *  8.  another business cannot update it (cross-tenant isolation; body.businessId ignored)
 *  9.  existing CustomerRewardCycle.threshold remains unchanged after global update (snapshot invariant)
 *  10. newly created reward cycle snapshots the new configured threshold
 *  11. Give Reward starts a new cycle using the currently configured threshold
 *  12. unrelated AppSettings fields remain unchanged
 */
/// <reference types="bun-types" />
export {}

import { mock } from 'bun:test'
import { db } from '../../src/lib/db'
import { accrueCustomerRewardFromInvoice } from '../../src/lib/rewards'
import { NextRequest, NextResponse } from 'next/server'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

// ─── Session + business mock ─────────────────────────────────────────
// §AUTH: requireRole is mocked so we can exercise OWNER/ADMIN/STAFF
// roles + cross-tenant isolation without seeding a real users table or
// cookies. businessId is derived from currentBusinessOverride (set per
// test) — NEVER from the client body, matching the real route's use of
// getCurrentBusiness().
let currentBusinessOverride: { id: string; name: string; currency: string } | null = null
let sessionRoleOverride: string = 'OWNER' // 'OWNER' | 'ADMIN' | 'STAFF' | 'NONE'

await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

await mock.module('@/lib/auth/session', () => ({
  requireRole: async (allowedRoles: string[]) => {
    if (sessionRoleOverride === 'NONE') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    if (!allowedRoles.includes(sessionRoleOverride)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }
    return {
      id: 'test-user-' + (currentBusinessOverride?.id ?? 'x'),
      email: 'owner@test.com',
      name: 'Test Owner',
      role: sessionRoleOverride,
      businessId: currentBusinessOverride?.id ?? 'no-biz',
    }
  },
  requireAuth: async () => {
    if (sessionRoleOverride === 'NONE') {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    return {
      id: 'test-user-' + (currentBusinessOverride?.id ?? 'x'),
      email: 'owner@test.com',
      name: 'Test Owner',
      role: sessionRoleOverride,
      businessId: currentBusinessOverride?.id ?? 'no-biz',
    }
  },
}))

const settingsRoute = await import('@/app/api/app-settings/route')
const rewardsRoute = await import('@/app/api/parties/[id]/rewards/route')
const giveRoute = await import('@/app/api/parties/[id]/rewards/[cycleId]/give/route')

const TEST_BIZ_A = 'test-rt-A-' + Date.now()
const TEST_BIZ_B = 'test-rt-B-' + Date.now()
let partyA1: string
let productA1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'RT Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'RT Biz B', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_A } }) // default rewardThreshold=400
  await db.appSettings.create({ data: { businessId: TEST_BIZ_B } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'RT A1', type: 'customer' } })).id
  productA1 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'RT Prod', purchasePrice: 50, salePrice: 100 } })).id
}

async function cleanup() {
  try {
    await db.customerRewardEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.customerRewardCycle.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.invoice.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.product.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.appSettings.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.auditLog.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

async function callPut(body: unknown) {
  return settingsRoute.PUT(
    new NextRequest('http://localhost/api/app-settings', {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

async function callGetSettings() {
  return settingsRoute.GET()
}

async function callGive(partyId: string, cycleId: string) {
  return giveRoute.POST(
    new NextRequest(`http://localhost/api/parties/${partyId}/rewards/${cycleId}/give`, { method: 'POST' }),
    { params: Promise.resolve({ id: partyId, cycleId }) }
  )
}

async function createInvoice(businessId: string, partyId: string, opts: { subtotal?: number; items?: Array<{ productId: string; quantity: number }> } = {}) {
  const inv = await db.invoice.create({
    data: {
      businessId, partyId, type: 'sales', status: 'paid',
      subtotal: opts.subtotal ?? 100, discountAmount: 0,
      grandTotal: opts.subtotal ?? 100, gstAmount: 0,
      invoiceNumber: 'INV-' + Date.now() + '-' + Math.random().toString(36).substring(7),
    },
  })
  if (opts.items) {
    for (const item of opts.items) {
      await db.invoiceItem.create({
        data: {
          invoiceId: inv.id, productId: item.productId, name: 'Test',
          quantity: item.quantity, unitPrice: 100, total: 100 * item.quantity,
          purchasePriceSnapshot: null,
        },
      })
    }
  }
  return inv
}

async function main() {
  console.log('\n🧪 Customer Reward Threshold Configuration Tests\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'RT Biz A', currency: 'INR' }
  sessionRoleOverride = 'OWNER'

  // ─── 1. Default threshold = 400 ───────────────────────────────────
  console.log('1. Default threshold = 400')
  {
    const res = await callGetSettings()
    const body = await res.json()
    assert(body.rewardThreshold === 400, `1.1: default rewardThreshold=400 (got ${body.rewardThreshold})`)
  }

  // ─── 2. Valid threshold update to 300 ─────────────────────────────
  console.log('\n2. Valid threshold update to 300')
  {
    const res = await callPut({ rewardThreshold: 300 })
    assert(res.status === 200, `2.1: PUT 300 → 200 (got ${res.status})`)
    const body = await res.json()
    assert(body.rewardThreshold === 300, `2.2: response rewardThreshold=300 (got ${body.rewardThreshold})`)
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 300, `2.3: DB rewardThreshold=300 (got ${settings?.rewardThreshold.toNumber()})`)
  }

  // ─── 3. Valid threshold update to 500 ─────────────────────────────
  console.log('\n3. Valid threshold update to 500')
  {
    const res = await callPut({ rewardThreshold: 500 })
    assert(res.status === 200, `3.1: PUT 500 → 200 (got ${res.status})`)
    const body = await res.json()
    assert(body.rewardThreshold === 500, `3.2: response rewardThreshold=500 (got ${body.rewardThreshold})`)
  }

  // ─── 4. Invalid zero rejected ────────────────────────────────────
  console.log('\n4. Invalid zero rejected')
  {
    const res = await callPut({ rewardThreshold: 0 })
    assert(res.status === 400, `4.1: PUT 0 → 400 (got ${res.status})`)
    const body = await res.json()
    assert(/finite positive/i.test(body.error), `4.2: error mentions "finite positive" (got ${body.error})`)
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 500, `4.3: DB unchanged=500 (got ${settings?.rewardThreshold.toNumber()})`)
  }

  // ─── 5. Invalid negative rejected ────────────────────────────────
  console.log('\n5. Invalid negative rejected')
  {
    const res = await callPut({ rewardThreshold: -100 })
    assert(res.status === 400, `5.1: PUT -100 → 400 (got ${res.status})`)
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 500, `5.2: DB unchanged=500`)
  }

  // ─── 6. Invalid / wrong-type / non-finite / over-maximum rejected ────
  console.log('\n6. Invalid values rejected (wrong type / non-numeric / non-finite / over-maximum)')
  {
    // §STRICT-TYPE-CHECK (API contract): the API must explicitly reject
    // non-numeric types (booleans, null, objects, arrays) + non-numeric /
    // non-finite strings ("NaN", "Infinity", "abc", "") + over-maximum.
    // This is an API-level validation test; it does NOT prove React UI
    // behavior. (zero + negative are covered separately by tests 4 + 5.)
    const cases: Array<{ label: string; value: unknown }> = [
      { label: 'true', value: true },
      { label: 'false', value: false },
      { label: 'null', value: null },
      { label: '[]', value: [] },
      { label: '{}', value: {} },
      { label: '""', value: '' },
      { label: '"NaN"', value: 'NaN' },
      { label: '"Infinity"', value: 'Infinity' },
      { label: '"abc"', value: 'abc' },
      { label: 'over-maximum (1000001)', value: 1_000_001 },
    ]
    for (const c of cases) {
      const res = await callPut({ rewardThreshold: c.value })
      assert(res.status === 400, `6: PUT ${c.label} → 400 (got ${res.status})`)
    }
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 500, `6: DB unchanged=500 after all invalid attempts (got ${settings?.rewardThreshold.toNumber()})`)
  }

  // ─── 7. Unauthorized role (STAFF) cannot update it ────────────────
  console.log('\n7. Unauthorized role (STAFF) cannot update it')
  {
    sessionRoleOverride = 'STAFF'
    const res = await callPut({ rewardThreshold: 300 })
    assert(res.status === 403, `7.1: STAFF PUT → 403 (got ${res.status})`)
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 500, `7.2: DB unchanged=500 (STAFF could not update)`)
    sessionRoleOverride = 'OWNER'
  }

  // ─── 8. Another business cannot update it (cross-tenant) ─────────
  console.log('\n8. Another business cannot update it (cross-tenant isolation)')
  {
    // currentBusinessOverride is TEST_BIZ_A; a PUT can only affect TEST_BIZ_A
    // (businessId is derived from the session via getCurrentBusiness, never
    // from the client body). Verify TEST_BIZ_B stays at its default 400.
    await callPut({ rewardThreshold: 700 })
    const settingsA = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    const settingsB = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_B } })
    assert(settingsA?.rewardThreshold.toNumber() === 700, `8.1: Biz A threshold=700 (got ${settingsA?.rewardThreshold.toNumber()})`)
    assert(settingsB?.rewardThreshold.toNumber() === 400, `8.2: Biz B threshold unchanged=400 (got ${settingsB?.rewardThreshold.toNumber()})`)
    // Cross-tenant: even if a client tries to send businessId in the body,
    // the route ignores it (uses session-derived businessId). Verify by
    // sending a foreign businessId in the body.
    const res = await callPut({ rewardThreshold: 123, businessId: TEST_BIZ_B })
    assert(res.status === 200, `8.3: PUT with foreign businessId in body → 200 (route ignores body.businessId) (got ${res.status})`)
    const settingsB2 = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_B } })
    assert(settingsB2?.rewardThreshold.toNumber() === 400, `8.4: Biz B threshold still 400 (body.businessId ignored) (got ${settingsB2?.rewardThreshold.toNumber()})`)
  }

  // ─── 9. Existing cycle threshold unchanged after global update ─────
  console.log('\n9. Existing CustomerRewardCycle.threshold unchanged after global update (snapshot invariant)')
  {
    await callPut({ rewardThreshold: 250 })
    const inv = await createInvoice(TEST_BIZ_A, partyA1, { subtotal: 100, items: [{ productId: productA1, quantity: 1 }] })
    await accrueCustomerRewardFromInvoice(TEST_BIZ_A, inv.id)
    const cycleBefore = await db.customerRewardCycle.findFirst({ where: { businessId: TEST_BIZ_A, partyId: partyA1 } })
    assert(cycleBefore?.threshold.toNumber() === 250, `9.1: cycle threshold snapshot=250 (got ${cycleBefore?.threshold.toNumber()})`)
    // Change the global threshold to 999 — existing cycle MUST NOT mutate.
    await callPut({ rewardThreshold: 999 })
    const cycleAfter = await db.customerRewardCycle.findFirst({ where: { businessId: TEST_BIZ_A, partyId: partyA1 } })
    assert(cycleAfter?.threshold.toNumber() === 250, `9.2: existing cycle threshold UNCHANGED=250 after global update (got ${cycleAfter?.threshold.toNumber()})`)
    // cleanup this cycle for subsequent tests
    await db.customerRewardEvent.deleteMany({ where: { partyId: partyA1 } })
    await db.customerRewardCycle.deleteMany({ where: { partyId: partyA1 } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyA1 } } })
    await db.invoice.deleteMany({ where: { partyId: partyA1 } })
  }

  // ─── 10. Newly created reward cycle snapshots the new configured threshold
  console.log('\n10. Newly created reward cycle snapshots the new configured threshold')
  {
    // Global threshold is 999 (from test 9). Create a NEW cycle for a NEW party.
    const partyA2 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'RT A2', type: 'customer' } })).id
    const inv = await createInvoice(TEST_BIZ_A, partyA2, { subtotal: 100, items: [{ productId: productA1, quantity: 1 }] })
    await accrueCustomerRewardFromInvoice(TEST_BIZ_A, inv.id)
    const cycle = await db.customerRewardCycle.findFirst({ where: { businessId: TEST_BIZ_A, partyId: partyA2 } })
    assert(cycle?.threshold.toNumber() === 999, `10.1: new cycle threshold snapshot=999 (got ${cycle?.threshold.toNumber()})`)
    await db.customerRewardEvent.deleteMany({ where: { partyId: partyA2 } })
    await db.customerRewardCycle.deleteMany({ where: { partyId: partyA2 } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyA2 } } })
    await db.invoice.deleteMany({ where: { partyId: partyA2 } })
    await db.party.delete({ where: { id: partyA2 } })
  }

  // ─── 11. Give Reward starts a new cycle using the currently configured threshold
  console.log('\n11. Give Reward starts a new cycle using the currently configured threshold')
  {
    // Set a fresh threshold (50) so a ₹100 profit invoice unlocks immediately.
    await callPut({ rewardThreshold: 50 })
    const partyA3 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'RT A3', type: 'customer' } })).id
    const inv = await createInvoice(TEST_BIZ_A, partyA3, { subtotal: 100, items: [{ productId: productA1, quantity: 1 }] })
    await accrueCustomerRewardFromInvoice(TEST_BIZ_A, inv.id)
    const unlocked = await db.customerRewardCycle.findFirst({ where: { businessId: TEST_BIZ_A, partyId: partyA3, status: 'UNLOCKED' } })
    assert(!!unlocked, '11.1: cycle unlocked (profit ≥ threshold 50)')
    assert(unlocked?.threshold.toNumber() === 50, `11.2: unlocked cycle threshold=50 (got ${unlocked?.threshold.toNumber()})`)
    // Change the global threshold to 800 BEFORE give-reward → the next cycle
    // should snapshot the CURRENT configured threshold (800), NOT carry the
    // old cycle's threshold (50) forward.
    await callPut({ rewardThreshold: 800 })
    const giveRes = await callGive(partyA3, unlocked!.id)
    assert(giveRes.status === 200, `11.3: give reward → 200 (got ${giveRes.status})`)
    const giveBody = await giveRes.json()
    assert(giveBody.ok === true, '11.4: give reward ok=true')
    assert(giveBody.nextCycle?.status === 'ACTIVE', `11.5: next cycle ACTIVE (got ${giveBody.nextCycle?.status})`)
    assert(giveBody.nextCycle?.threshold === 800, `11.6: next cycle threshold=800 (current configured, NOT carry-forward 50) (got ${giveBody.nextCycle?.threshold})`)
    await db.customerRewardEvent.deleteMany({ where: { partyId: partyA3 } })
    await db.customerRewardCycle.deleteMany({ where: { partyId: partyA3 } })
    await db.invoiceItem.deleteMany({ where: { invoice: { partyId: partyA3 } } })
    await db.invoice.deleteMany({ where: { partyId: partyA3 } })
    await db.party.delete({ where: { id: partyA3 } })
  }

  // ─── 12. Unrelated AppSettings fields remain unchanged ───────────
  console.log('\n12. Unrelated AppSettings fields remain unchanged')
  {
    // Set some unrelated fields first.
    await callPut({ notificationsEnabled: false, invoicePrefix: 'RTINV', language: 'hi', defaulterRegistryEnabled: false })
    const before = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(before?.notificationsEnabled === false, '12.1a: setup notificationsEnabled=false')
    assert(before?.invoicePrefix === 'RTINV', '12.1b: setup invoicePrefix=RTINV')
    assert(before?.language === 'hi', '12.1c: setup language=hi')
    assert(before?.defaulterRegistryEnabled === false, '12.1d: setup defaulterRegistryEnabled=false')
    // Now update ONLY rewardThreshold.
    await callPut({ rewardThreshold: 333 })
    const after = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(after?.rewardThreshold.toNumber() === 333, `12.2: rewardThreshold=333 (got ${after?.rewardThreshold.toNumber()})`)
    assert(after?.notificationsEnabled === false, `12.3: notificationsEnabled preserved=false (got ${after?.notificationsEnabled})`)
    assert(after?.invoicePrefix === 'RTINV', `12.4: invoicePrefix preserved=RTINV (got ${after?.invoicePrefix})`)
    assert(after?.language === 'hi', `12.5: language preserved=hi (got ${after?.language})`)
    assert(after?.defaulterRegistryEnabled === false, `12.6: defaulterRegistryEnabled preserved=false (got ${after?.defaulterRegistryEnabled})`)
  }

  // ─── 13. 2-decimal server rounding: server returns the rounded value ──
  console.log('\n13. 2-decimal server rounding — server returns the rounded value')
  {
    // §API-CONTRACT: the PUT response body contains the server-persisted
    // rewardThreshold, 2-dp-rounded (Prisma Decimal(18,2)). This is an
    // API-level contract test (the response shape), NOT a React UI test.
    const res = await callPut({ rewardThreshold: 300.456 })
    assert(res.status === 200, `13.1: PUT 300.456 → 200 (got ${res.status})`)
    const body = await res.json()
    assert(body.rewardThreshold === 300.46, `13.2: response rewardThreshold=300.46 (2-dp rounded) (got ${body.rewardThreshold})`)
    const settings = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(settings?.rewardThreshold.toNumber() === 300.46, `13.3: DB rewardThreshold=300.46 (got ${settings?.rewardThreshold.toNumber()})`)
  }

  // ─── 14. Rejected invalid save preserves the previous saved value ────
  console.log('\n14. Rejected invalid save — previous server value preserved')
  {
    // §API-CONTRACT: a rejected (invalid) save returns 400 AND leaves the
    // persisted value unchanged. API-level contract test, NOT a React UI test.
    await callPut({ rewardThreshold: 500 }) // set a known server value
    const before = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(before?.rewardThreshold.toNumber() === 500, `14.1: prev server value=500 (got ${before?.rewardThreshold.toNumber()})`)
    const res = await callPut({ rewardThreshold: 0 }) // invalid → rejected
    assert(res.status === 400, `14.2: PUT 0 → 400 (got ${res.status})`)
    const after = await db.appSettings.findUnique({ where: { businessId: TEST_BIZ_A } })
    assert(after?.rewardThreshold.toNumber() === 500, `14.3: DB unchanged=500 after rejected save (got ${after?.rewardThreshold.toNumber()})`)
  }

  // ─── 15. Refetch same AppSettings id — returns the updated threshold ──
  console.log('\n15. Refetch same AppSettings id — returns the updated reward threshold')
  {
    // §API-CONTRACT: a GET (refetch) after a save returns the SAME
    // AppSettings id + the UPDATED rewardThreshold. API-level contract test
    // (the GET response shape after a PUT), NOT a React UI test.
    const before = await callGetSettings()
    const beforeBody = await before.json()
    const settingsId = beforeBody.id
    const beforeValue = beforeBody.rewardThreshold
    // Save a new value
    const saveRes = await callPut({ rewardThreshold: 777 })
    assert(saveRes.status === 200, `15.1: PUT 777 → 200 (got ${saveRes.status})`)
    const saveBody = await saveRes.json()
    assert(saveBody.rewardThreshold === 777, `15.2: apiPut response rewardThreshold=777 (got ${saveBody.rewardThreshold})`)
    // Refetch (GET) — same id, but updated rewardThreshold
    const after = await callGetSettings()
    const afterBody = await after.json()
    assert(afterBody.id === settingsId, `15.3: refetch returns SAME id (got ${afterBody.id})`)
    assert(afterBody.rewardThreshold === 777, `15.4: refetch rewardThreshold=777 (updated, same id) (got ${afterBody.rewardThreshold})`)
    assert(beforeValue !== 777, `15.5: value actually changed (was ${beforeValue})`)
  }

  await cleanup()
  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
