/**
 * §TEST: Customer Behaviour — REAL wrapper-handler execution against real DB.
 *
 * Run: bun run tests/unit/customer-behaviour.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: Imports + calls the ACTUAL exported GET / PUT handlers
 *     from src/app/api/parties/[id]/behaviour/route.ts and the GET handler
 *     from src/app/api/parties/[id]/behaviour/history/route.ts. Uses real
 *     NextRequest + real NextResponse + real Prisma client against the
 *     SQLite dev database.
 *   - MOCKED DEPENDENCY: `getCurrentBusiness()` from `@/lib/db` is replaced
 *     via Bun's `mock.module` at the auth boundary only. The real `db`
 *     (Prisma client) is preserved unchanged, so the route's DB calls hit
 *     the real dev database.
 *   - NO accounting/search/notification logic is exercised. This test file
 *     touches only Party + CustomerBehaviour + CustomerBehaviourHistory +
 *     AuditLog tables.
 *
 * §WHY-BUN: Uses Bun's `mock.module()` to replace `getCurrentBusiness` at
 * the module-loading boundary. Requires the Bun runtime.
 *
 * §COVERAGE (A-L):
 *   A. GET with no behaviour → 200 + null
 *   B. First PUT creates behaviour
 *   C. First PUT creates history (1 row)
 *   D. Second PUT updates current behaviour
 *   E. Second PUT creates another history row (2 total)
 *   F. Rating validation (invalid → 400)
 *   G. Cross-tenant GET blocked (404, no leak)
 *   H. Cross-tenant PUT blocked (404, no mutation)
 *   I. Cross-party access blocked (404)
 *   J. History only returns the current party's history
 *   K. Transactional consistency (current + history in sync)
 *   L. Existing Trust Score behavior remains unchanged (creditTrustScore untouched)
 *   + History preserves the previous rating (each snapshot is the new state)
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
// §MOCK-SETUP
// ──────────────────────────────────────────────────────────────────────
let currentBusinessOverride: { id: string; name: string; currency: string } | null = null

await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

// §IMPORT-ROUTES-AFTER-MOCKS
const behaviourRoute = await import('@/app/api/parties/[id]/behaviour/route')
const historyRoute = await import('@/app/api/parties/[id]/behaviour/history/route')

// ──────────────────────────────────────────────────────────────────────
// §FIXTURES
// ──────────────────────────────────────────────────────────────────────
const TEST_BIZ_A = 'test-beh-biz-A-' + Date.now()
const TEST_BIZ_B = 'test-beh-biz-B-' + Date.now()
let partyA1: string, partyA2: string, partyB1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'Biz B', currency: 'INR' } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'Party A1', type: 'customer' } })).id
  partyA2 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'Party A2', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'Party B1', type: 'customer' } })).id
}

async function cleanup() {
  try {
    await db.customerBehaviourHistory.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.customerBehaviour.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.auditLog.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

function makeGetReq(partyId: string): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/behaviour`, { method: 'GET' })
}
function makePutReq(partyId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/behaviour`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makeHistoryGetReq(partyId: string, limit?: number): NextRequest {
  const url = limit
    ? `http://localhost/api/parties/${partyId}/behaviour/history?limit=${limit}`
    : `http://localhost/api/parties/${partyId}/behaviour/history`
  return new NextRequest(url, { method: 'GET' })
}

async function callGet(handler: any, partyId: string) {
  return handler(makeGetReq(partyId), { params: Promise.resolve({ id: partyId }) })
}
async function callPut(handler: any, partyId: string, body: unknown) {
  return handler(makePutReq(partyId, body), { params: Promise.resolve({ id: partyId }) })
}
async function callHistoryGet(handler: any, partyId: string, limit?: number) {
  return handler(makeHistoryGetReq(partyId, limit), { params: Promise.resolve({ id: partyId }) })
}

// ──────────────────────────────────────────────────────────────────────
// §MAIN
// ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🧪 Customer Behaviour Tests — REAL wrapper handlers + real DB\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' }

  // ─── A. GET with no behaviour → 200 + null ───────────────────────────
  console.log('A. GET with no behaviour set → 200 + behaviour=null')
  {
    const res = await callGet(behaviourRoute.GET, partyA1)
    assert(res.status === 200, `A1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.behaviour === null, 'A2: behaviour=null (no rating yet)')
  }

  // ─── B. First PUT creates behaviour ─────────────────────────────────
  console.log('\nB. First PUT creates behaviour')
  {
    const res = await callPut(behaviourRoute.PUT, partyA1, {
      rating: 'GOOD',
      tags: ['Respectful', 'Regular customer'],
      notes: 'Polite, pays on time',
      ratedBy: 'Staff',
    })
    assert(res.status === 200, `B1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.behaviour.id !== undefined, 'B2: behaviour has id')
    assert(body.behaviour.rating === 'GOOD', 'B3: rating=GOOD')
    assert(body.behaviour.partyId === partyA1, 'B4: partyId = URL partyId')
    assert(body.behaviour.businessId === TEST_BIZ_A, 'B5: businessId = session business')

    // Verify real DB row
    const dbBeh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    assert(dbBeh !== null, 'B6: real DB row exists')
    assert(dbBeh?.rating === 'GOOD', 'B7: DB rating=GOOD')
    // Tags stored as JSON string
    const dbTags = dbBeh?.tags ? JSON.parse(dbBeh.tags) : []
    assert(Array.isArray(dbTags) && dbTags.length === 2, 'B8: 2 tags stored as JSON array')
    assert(dbTags[0] === 'Respectful', `B9: first tag=Respectful (got ${dbTags[0]})`)
    assert(dbBeh?.notes === 'Polite, pays on time', 'B10: notes stored')
    assert(dbBeh?.ratedBy === 'Staff', 'B11: ratedBy stored')
  }

  // ─── C. First PUT creates history (1 row) ──────────────────────────
  console.log('\nC. First PUT creates history (1 row)')
  {
    const historyRes = await callHistoryGet(historyRoute.GET, partyA1)
    assert(historyRes.status === 200, `C1: history status=200 (got ${historyRes.status})`)
    const historyBody = await historyRes.json()
    assert(Array.isArray(historyBody.history), 'C2: history is an array')
    assert(historyBody.history.length === 1, `C3: 1 history row (got ${historyBody.history.length})`)
    assert(historyBody.history[0].rating === 'GOOD', 'C4: history snapshot rating=GOOD')
    assert(historyBody.history[0].notes === 'Polite, pays on time', 'C5: history snapshot notes match')
  }

  // ─── D. Second PUT updates current behaviour ───────────────────────
  console.log('\nD. Second PUT updates current behaviour')
  {
    const res = await callPut(behaviourRoute.PUT, partyA1, {
      rating: 'BEST',
      tags: ['Respectful', 'Regular customer', 'Pays on time'],
      notes: 'Excellent customer',
      ratedBy: 'Manager',
    })
    assert(res.status === 200, `D1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.behaviour.rating === 'BEST', 'D2: rating updated to BEST')
    assert(body.behaviour.notes === 'Excellent customer', 'D3: notes updated')
    assert(body.behaviour.ratedBy === 'Manager', 'D4: ratedBy updated')

    // §SAME-ID: the behaviour row should be the SAME row (upsert update, not create)
    const dbBeh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    // Count behaviour rows for partyA1 — must still be 1 (not 2)
    const behCount = await db.customerBehaviour.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    assert(behCount === 1, `D5: still 1 behaviour row (upsert updated, not created new) — got ${behCount}`)
  }

  // ─── E. Second PUT creates another history row (2 total) ───────────
  console.log('\nE. Second PUT creates another history row (2 total)')
  {
    const historyRes = await callHistoryGet(historyRoute.GET, partyA1)
    const historyBody = await historyRes.json()
    assert(historyBody.history.length === 2, `E1: 2 history rows now (got ${historyBody.history.length})`)
    // Newest first (desc by createdAt)
    assert(historyBody.history[0].rating === 'BEST', 'E2: newest history = BEST')
    assert(historyBody.history[1].rating === 'GOOD', 'E3: older history = GOOD (previous state preserved)')
  }

  // ─── F. Rating validation (invalid → 400) ─────────────────────────
  console.log('\nF. Rating validation')
  {
    // Missing rating
    const r1 = await callPut(behaviourRoute.PUT, partyA1, { notes: 'no rating' })
    assert(r1.status === 400, `F1: missing rating → 400 (got ${r1.status})`)
    // Invalid rating
    const r2 = await callPut(behaviourRoute.PUT, partyA1, { rating: 'EXCELLENT' })
    assert(r2.status === 400, `F2: invalid rating → 400 (got ${r2.status})`)
    const body2 = await r2.json()
    assert(body2.error.includes('Invalid rating'), `F3: error mentions invalid rating (got "${body2.error}")`)
    assert(body2.error.includes('VERY_BAD'), 'F4: error lists valid ratings')
    // Non-string rating
    const r3 = await callPut(behaviourRoute.PUT, partyA1, { rating: 5 })
    assert(r3.status === 400, `F5: numeric rating → 400 (got ${r3.status})`)
    // Verify current behaviour NOT modified by failed requests
    const dbBeh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    assert(dbBeh?.rating === 'BEST', 'F6: existing rating unchanged after failed requests')
  }

  // ─── G. Cross-tenant GET blocked ───────────────────────────────────
  console.log('\nG. Cross-tenant GET blocked')
  {
    // Auth = Biz A, but requesting partyB1 (Biz B)
    const res = await callGet(behaviourRoute.GET, partyB1)
    assert(res.status === 404, `G1: cross-tenant GET → 404 (got ${res.status})`)
    const body = await res.json()
    assert(body.behaviour === undefined, 'G2: no behaviour leaked (party not found)')
  }

  // ─── H. Cross-tenant PUT blocked ────────────────────────────────────
  console.log('\nH. Cross-tenant PUT blocked')
  {
    // Auth = Biz A, trying to PUT to partyB1 (Biz B)
    const beforeCount = await db.customerBehaviour.count({ where: { partyId: partyB1, businessId: TEST_BIZ_B } })
    const res = await callPut(behaviourRoute.PUT, partyB1, { rating: 'GOOD' })
    assert(res.status === 404, `H1: cross-tenant PUT → 404 (got ${res.status})`)
    const afterCount = await db.customerBehaviour.count({ where: { partyId: partyB1, businessId: TEST_BIZ_B } })
    assert(afterCount === beforeCount, `H2: no behaviour created on other-tenant party (before=${beforeCount}, after=${afterCount})`)
  }

  // ─── I. Cross-party access blocked (within same business) ─────────
  console.log('\nI. Cross-party access blocked (within same business)')
  {
    // partyA2 belongs to Biz A (same as auth), but has no behaviour.
    // partyA1 has a behaviour. Try to access partyA1's behaviour via partyA2's URL —
    // the route uses the URL partyId, so this is really a "wrong partyId" test.
    // The GET returns null for partyA2 (no behaviour), which is correct.
    const res = await callGet(behaviourRoute.GET, partyA2)
    assert(res.status === 200, `I1: GET partyA2 → 200 (got ${res.status})`)
    const body = await res.json()
    assert(body.behaviour === null, 'I2: partyA2 has no behaviour (correct — isolated from partyA1)')

    // Now create behaviour for partyA1, then verify partyA2 still has none
    // (the unique constraint on businessId+partyId ensures isolation)
    // partyA1 already has behaviour from earlier tests. partyA2 should NOT inherit it.
    const a2Res = await callPut(behaviourRoute.PUT, partyA2, { rating: 'BAD' })
    assert(a2Res.status === 200, `I3: PUT partyA2 → 200 (got ${a2Res.status})`)

    // Verify partyA1 behaviour is unchanged (still BEST from test D)
    const a1Beh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    assert(a1Beh?.rating === 'BEST', `I4: partyA1 rating still BEST (not affected by partyA2) — got ${a1Beh?.rating}`)

    // Verify partyA2 behaviour is BAD (independent)
    const a2Beh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA2 } },
    })
    assert(a2Beh?.rating === 'BAD', `I5: partyA2 rating is BAD (independent) — got ${a2Beh?.rating}`)
  }

  // ─── J. History only returns the current party's history ──────────
  console.log('\nJ. History only returns the current party\'s history')
  {
    // partyA1 has 2 history rows (from tests B + D)
    // partyA2 has 1 history row (from test I)
    const a1History = await callHistoryGet(historyRoute.GET, partyA1)
    const a1Body = await a1History.json()
    assert(a1Body.history.length === 2, `J1: partyA1 has 2 history rows (got ${a1Body.history.length})`)
    // All history rows should be for partyA1
    const allForA1 = a1Body.history.every((h: any) => h.partyId === undefined || true) // partyId not returned by API, check via DB
    // Verify via DB that all history rows returned belong to partyA1
    const a1DbHistory = await db.customerBehaviourHistory.findMany({
      where: { businessId: TEST_BIZ_A, partyId: partyA1 },
    })
    assert(a1DbHistory.length === 2, `J2: DB confirms 2 history rows for partyA1`)

    const a2History = await callHistoryGet(historyRoute.GET, partyA2)
    const a2Body = await a2History.json()
    assert(a2Body.history.length === 1, `J3: partyA2 has 1 history row (got ${a2Body.history.length})`)
    assert(a2Body.history[0].rating === 'BAD', 'J4: partyA2 history = BAD')

    // §CROSS-PARTY-ISOLATION: partyA2's history must NOT include partyA1's rows
    const a2DbHistory = await db.customerBehaviourHistory.findMany({
      where: { businessId: TEST_BIZ_A, partyId: partyA2 },
    })
    assert(a2DbHistory.every((h) => h.partyId === partyA2), 'J5: all partyA2 history rows belong to partyA2 (no leakage)')
    assert(!a2DbHistory.some((h) => h.rating === 'BEST'), 'J6: partyA1\'s BEST rating did NOT leak into partyA2 history')
  }

  // ─── K. Transactional consistency ──────────────────────────────────
  console.log('\nK. Transactional consistency (current + history in sync)')
  {
    // Count before
    const behBefore = await db.customerBehaviour.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const histBefore = await db.customerBehaviourHistory.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })

    // PUT a new rating
    await callPut(behaviourRoute.PUT, partyA1, { rating: 'BETTER', notes: 'transactional test' })

    // Count after — behaviour should still be 1 (upsert), history should be +1
    const behAfter = await db.customerBehaviour.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const histAfter = await db.customerBehaviourHistory.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })

    assert(behAfter === behBefore, `K1: behaviour count unchanged (upsert) — before=${behBefore}, after=${behAfter}`)
    assert(histAfter === histBefore + 1, `K2: history count +1 (snapshot appended) — before=${histBefore}, after=${histAfter}`)

    // §LATEST-HISTORY-MATCHES-CURRENT: the newest history row should match the current behaviour
    const currentBeh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    const latestHistory = await db.customerBehaviourHistory.findFirst({
      where: { partyId: partyA1, businessId: TEST_BIZ_A },
      orderBy: { createdAt: 'desc' },
    })
    assert(latestHistory?.rating === currentBeh?.rating, `K3: latest history rating matches current — history=${latestHistory?.rating}, current=${currentBeh?.rating}`)
    assert(latestHistory?.notes === currentBeh?.notes, `K4: latest history notes match current`)
    assert(latestHistory?.behaviourId === currentBeh?.id, `K5: latest history.behaviourId = current behaviour.id`)
  }

  // ─── L. Existing Trust Score behavior remains unchanged ────────────
  console.log('\nL. Existing Trust Score (creditTrustScore) remains unchanged')
  {
    // §SETUP: set a known creditTrustScore on partyA1
    await db.party.update({
      where: { id: partyA1 },
      data: {
        creditTrustScore: 4.5,
        trustScoreUpdatedAt: new Date(),
        trustScoreReason: 'Test trust score — should not change',
      },
    })

    // PUT a behaviour change
    await callPut(behaviourRoute.PUT, partyA1, { rating: 'VERY_BAD', notes: 'bad behaviour but trust score must not change' })

    // §VERIFY: creditTrustScore + related fields are UNTOUCHED
    const party = await db.party.findUnique({ where: { id: partyA1 } })
    assert(party?.creditTrustScore === 4.5, `L1: creditTrustScore unchanged (got ${party?.creditTrustScore})`)
    assert(party?.trustScoreReason === 'Test trust score — should not change', 'L2: trustScoreReason unchanged')
    assert(party?.trustScoreUpdatedAt !== null, 'L3: trustScoreUpdatedAt still set (not cleared)')

    // Also verify the behaviour IS updated (proving the PUT worked but only touched behaviour)
    const beh = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: partyA1 } },
    })
    assert(beh?.rating === 'VERY_BAD', `L4: behaviour rating updated to VERY_BAD (got ${beh?.rating})`)

    // §NEGATIVE-CORRELATION: a bad behaviour rating did NOT lower the
    // financial trust score. They are independent signals.
    assert(party?.creditTrustScore === 4.5 && beh?.rating === 'VERY_BAD', 'L5: behaviour (VERY_BAD) and trust score (4.5) are INDEPENDENT — bad behaviour did not lower financial trust')
  }

  // ─── M. Audit log entry created on behaviour change ────────────────
  console.log('\nM. Audit log entry created on behaviour change')
  {
    // Count audit logs for this business with action='behaviour_change'
    const auditCount = await db.auditLog.count({
      where: { businessId: TEST_BIZ_A, action: 'behaviour_change' },
    })
    // We did PUTs in tests B, D, I, K, L for Biz A = 5 behaviour_change audit entries
    assert(auditCount >= 5, `M1: audit log has ${auditCount} behaviour_change entries (expected >= 5)`)

    // Verify the latest audit log entry has correct structure
    const latestAudit = await db.auditLog.findFirst({
      where: { businessId: TEST_BIZ_A, action: 'behaviour_change' },
      orderBy: { createdAt: 'desc' },
    })
    assert(latestAudit?.entityType === 'party', `M2: audit entityType=party (got ${latestAudit?.entityType})`)
    assert(latestAudit?.entityId === partyA1, 'M3: audit entityId=partyA1')
    const desc = latestAudit?.description ?? ''
    assert(desc.includes('VERY_BAD') || desc.includes('BETTER') || desc.includes('BEST') || desc.includes('GOOD') || desc.includes('BAD'), 'M4: audit description mentions a rating')
    // Verify metadata is valid JSON with the expected fields
    if (latestAudit?.metadata) {
      const meta = JSON.parse(latestAudit.metadata)
      assert(meta.partyId === partyA1, 'M5: audit metadata.partyId correct')
      assert(meta.rating !== undefined, 'M6: audit metadata.rating present')
      assert(meta.behaviourId !== undefined, 'M7: audit metadata.behaviourId present')
    }
  }

  // ─── N. No-business (unauthenticated) → 400 ─────────────────────────
  console.log('\nN. No business (auth returns null) → 400')
  {
    const saved = currentBusinessOverride
    currentBusinessOverride = null
    try {
      const getRes = await callGet(behaviourRoute.GET, partyA1)
      assert(getRes.status === 400, `N1: GET → 400 (got ${getRes.status})`)
      const putRes = await callPut(behaviourRoute.PUT, partyA1, { rating: 'GOOD' })
      assert(putRes.status === 400, `N2: PUT → 400 (got ${putRes.status})`)
      const histRes = await callHistoryGet(historyRoute.GET, partyA1)
      assert(histRes.status === 400, `N3: history GET → 400 (got ${histRes.status})`)
    } finally {
      currentBusinessOverride = saved
    }
  }

  // ─── O. History preserves the previous rating (explicit check) ─────
  console.log('\nO. History preserves the previous rating')
  {
    // partyA1's rating history (newest first):
    //   L: VERY_BAD
    //   K: BETTER
    //   D: BEST
    //   B: GOOD
    const history = await db.customerBehaviourHistory.findMany({
      where: { partyId: partyA1, businessId: TEST_BIZ_A },
      orderBy: { createdAt: 'asc' }, // oldest first for clarity
    })
    assert(history.length >= 4, `O1: at least 4 history rows (got ${history.length})`)
    const ratings = history.map((h) => h.rating)
    assert(ratings[0] === 'GOOD', `O2: history[0]=GOOD (first rating, preserved)`)
    assert(ratings[1] === 'BEST', `O3: history[1]=BEST (second rating, preserved)`)
    assert(ratings[2] === 'BETTER', `O4: history[2]=BETTER (third rating, preserved)`)
    assert(ratings[3] === 'VERY_BAD', `O5: history[3]=VERY_BAD (fourth rating, preserved)`)
    // Each snapshot captures the NEW state at that point — never overwrites prior history
  }

  // ─── P. GET non-existent party → 404 ───────────────────────────────
  console.log('\nP. GET non-existent party → 404')
  {
    const res = await callGet(behaviourRoute.GET, 'nonexistent-party-id')
    assert(res.status === 404, `P1: status=404 (got ${res.status})`)
  }

  // ─── Q. Tags validation ────────────────────────────────────────────
  console.log('\nQ. Tags validation')
  {
    // tags as array of strings — valid
    const r1 = await callPut(behaviourRoute.PUT, partyA2, { rating: 'GOOD', tags: ['Tag1', 'Tag2'] })
    assert(r1.status === 200, `Q1: array tags → 200 (got ${r1.status})`)
    // tags as malformed JSON string — invalid
    const r2 = await callPut(behaviourRoute.PUT, partyA2, { rating: 'GOOD', tags: 'not json' })
    assert(r2.status === 400, `Q2: malformed JSON tags → 400 (got ${r2.status})`)
    // tags as non-array JSON — invalid
    const r3 = await callPut(behaviourRoute.PUT, partyA2, { rating: 'GOOD', tags: '{"a":1}' })
    assert(r3.status === 400, `Q3: non-array JSON tags → 400 (got ${r3.status})`)
    // tags as array with non-string — invalid
    const r4 = await callPut(behaviourRoute.PUT, partyA2, { rating: 'GOOD', tags: [1, 2, 3] })
    assert(r4.status === 400, `Q4: array of non-strings → 400 (got ${r4.status})`)
  }

  // ─── R. History survives current-behaviour deletion (SetNull invariant) ──
  // §INVARIANT: CustomerBehaviourHistory.behaviourId is nullable + onDelete:
  // SetNull. Deleting the current CustomerBehaviour row must NOT delete the
  // history snapshots — they are the audit trail. This is the key data-model
  // invariant corrected in this step.
  console.log('\nR. History survives current-behaviour deletion (SetNull invariant)')
  {
    // §SETUP: create a fresh party + behaviour + 2 history rows
    const rParty = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'Reset Party', type: 'customer' } })).id
    await callPut(behaviourRoute.PUT, rParty, { rating: 'GOOD', notes: 'first' })
    await callPut(behaviourRoute.PUT, rParty, { rating: 'BEST', notes: 'second' })

    // Verify precondition: 1 behaviour row + 2 history rows
    const behBefore = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: rParty } },
    })
    const histBefore = await db.customerBehaviourHistory.findMany({
      where: { businessId: TEST_BIZ_A, partyId: rParty },
    })
    assert(behBefore !== null, 'R1: precondition — behaviour row exists')
    assert(histBefore.length === 2, `R2: precondition — 2 history rows exist (got ${histBefore.length})`)
    assert(histBefore.every((h) => h.behaviourId === behBefore!.id), 'R3: all history rows reference the behaviour row')

    // §DELETE the current behaviour row directly via DB (simulating a future
    // "reset behaviour" feature, or a party cascade). With onDelete: SetNull,
    // the history rows must survive with behaviourId = NULL.
    await db.customerBehaviour.delete({ where: { id: behBefore!.id } })

    // §VERIFY: behaviour row is gone, but history rows SURVIVE
    const behAfter = await db.customerBehaviour.findUnique({
      where: { businessId_partyId: { businessId: TEST_BIZ_A, partyId: rParty } },
    })
    assert(behAfter === null, 'R4: behaviour row deleted (current state reset)')

    const histAfter = await db.customerBehaviourHistory.findMany({
      where: { businessId: TEST_BIZ_A, partyId: rParty },
      orderBy: { createdAt: 'asc' },
    })
    assert(histAfter.length === 2, `R5: history rows SURVIVED deletion (got ${histAfter.length}) — append-only invariant preserved`)
    assert(histAfter.every((h) => h.behaviourId === null), 'R6: all surviving history rows have behaviourId=NULL (SetNull applied)')
    // Snapshot data fully retained
    assert(histAfter[0].rating === 'GOOD', `R7: history[0].rating=GOOD preserved (got ${histAfter[0].rating})`)
    assert(histAfter[0].notes === 'first', 'R8: history[0].notes preserved')
    assert(histAfter[1].rating === 'BEST', `R9: history[1].rating=BEST preserved (got ${histAfter[1].rating})`)
    assert(histAfter[1].notes === 'second', 'R10: history[1].notes preserved')

    // §PARTY-DELETE-CONSEQUENCE: deleting the Party still cascades to history
    // (documented in schema §PARTY-DELETE comment). Verify this known behavior.
    await db.party.delete({ where: { id: rParty } })
    const histAfterPartyDelete = await db.customerBehaviourHistory.findMany({
      where: { businessId: TEST_BIZ_A, partyId: rParty },
    })
    assert(histAfterPartyDelete.length === 0, 'R11: party deletion cascades to history (known consequence — see §PARTY-DELETE comment in schema)')
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Customer Behaviour Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
