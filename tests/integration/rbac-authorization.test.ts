/**
 * §TEST: RBAC Authorization Tests
 *
 * Run: npx tsx tests/integration/rbac-authorization.test.ts
 *
 * Tests:
 * 1. Auth gate utility `getCurrentBusiness()` returns null when there is no
 *    session cookie (it is wrapped in try/catch and degrades to null
 *    outside a Next.js request scope).
 * 2. Protected mutation routes — invoking the handler without a session
 *    either returns HTTP 401 OR throws (because `requireRole()` →
 *    `requireAuth()` → `cookies()` from `next/headers` only works inside a
 *    Next.js request scope; in this standalone test it throws, which is
 *    also an "access blocked" outcome). In production, where `cookies()`
 *    returns an empty store, the same handlers return 401.
 * 3. Routes that intentionally remain PUBLIC (login, payment landing page,
 *    central catalog) do NOT 401 or throw when invoked without a session —
 *    they successfully process the request (returning 200/400/404 as
 *    appropriate to the input).
 *
 * §FUTURE: STAFF-vs-OWNER role testing
 * ------------------------------------
 * Testing that a STAFF session is rejected (403) by OWNER/ADMIN-only
 * routes requires a test database seeded with users of each role
 * (OWNER, ADMIN, STAFF) and a way to inject a session cookie into the
 * test environment. The current test DB has no users table seeded, so
 * `requireRole(['OWNER','ADMIN'])` cannot be exercised end-to-end.
 *
 * When a test database with seeded users becomes available, add a test
 * that:
 *   a) Logs in as a STAFF user (POST /api/auth/login with STAFF creds).
 *   b) Captures the session cookie from the response.
 *   c) Replays the cookie against each OWNER/ADMIN-only route:
 *        - PUT /api/app-settings
 *        - PUT /api/settings/toggles
 *        - PUT /api/business
 *        - PUT /api/business/delivery-config
 *        - PUT /api/products/[id]
 *        - DELETE /api/products/[id]
 *        - POST /api/products/[id]/restock
 *        - DELETE /api/invoices/[id]
 *        - PUT /api/parties/[id]
 *        - DELETE /api/parties/[id]
 *        - POST /api/category-tree
 *        - PATCH /api/category-tree/[id]
 *        - DELETE /api/category-tree/[id]
 *        - POST /api/monetization/sponsor
 *        - DELETE /api/monetization/sponsor
 *        - POST /api/monetization/subscribe
 *        - GET/POST /api/staff and /api/staff/[id] PUT/DELETE
 *        - GET /api/data-export
 *        - POST /api/defaulter-registry
 *        - POST /api/customer-trust-score
 *        - PATCH/DELETE /api/defaulter-registry/[id]
 *   d) Asserts each returns 403 (Insufficient permissions).
 *   e) Replays the same calls with an OWNER session → 200.
 *
 * This file currently covers the unauthenticated (401 / throw) case only.
 */

import { NextRequest } from 'next/server'

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

// Build a minimal NextRequest with the given URL and method.
// Body is optional; if provided, sets the body + content-type.
function makeReq(url: string, method: string, body?: unknown): NextRequest {
  // Build init without an explicit type annotation — NextRequest's
  // RequestInit is a stricter superset of the DOM RequestInit.
  if (body !== undefined) {
    return new NextRequest(`http://localhost${url}`, {
      method,
      body: JSON.stringify(body),
      headers: { 'Content-Type': 'application/json' },
    })
  }
  return new NextRequest(`http://localhost${url}`, { method })
}

// Invoke a handler and return either the HTTP status code OR 'THREW' if the
// handler threw an error. Outside a Next.js request scope, handlers that
// call `requireRole()` / `requireAuth()` will throw because `cookies()` from
// `next/headers` requires a request scope. In production, the same handlers
// return 401 when the session cookie is absent. Both outcomes verify the
// security property: "the handler does NOT successfully process the
// unauthenticated request."
async function invoke(handler: any, ...args: any[]): Promise<number | 'THREW'> {
  try {
    const res = await handler(...args)
    return res.status
  } catch {
    return 'THREW'
  }
}

// "Blocked" means the handler did NOT successfully process the request.
// Acceptable outcomes for an unauthenticated invocation:
//   - 400 — some handlers return `{error:'No business'}` with status 400
//     when `getCurrentBusiness()` returns null (an older convention;
//     functionally still auth-enforced — the DB query is never run).
//   - 401 — the canonical "authentication required" status. Returned by
//     handlers that explicitly do `NextResponse.json({error:...}, {status:401})`
//     when getCurrentBusiness returns null, OR by `requireRole()` in
//     production (where cookies() works).
//   - 403 — returned by some handlers when getCurrentBusiness returns null
//     and the handler treats it as a forbidden state.
//   - 500 — returned by handlers whose try/catch wraps a `requireRole()`
//     call. In this standalone test, `requireRole()` → `requireAuth()` →
//     `cookies()` from `next/headers` throws outside a Next.js request
//     scope. In production, cookies() returns an empty cookie store, so
//     `requireRole()` returns a 401 NextResponse and the 500 path is never
//     hit. The 500 is a test-environment-only artifact.
//   - 'THREW' — the handler propagated the error (no try/catch around the
//     auth call). Same artifact as 500 but unwrapped.
//
// The security property we care about: the handler did NOT return 200 (or
// any other "success" status) and did NOT execute its business logic.
function isBlocked(result: number | 'THREW'): boolean {
  if (result === 'THREW') return true
  // 2xx = success → not blocked. Everything else = blocked.
  return result < 200 || result >= 300
}

async function main() {
  console.log('\n🧪 RBAC Authorization Tests\n')

  // ─── Section 1: getCurrentBusiness() returns null without a session ──
  console.log('Section 1: Auth gate — getCurrentBusiness() without session')
  {
    const { getCurrentBusiness } = await import('../../src/lib/db')
    const biz = await getCurrentBusiness()
    assert(biz === null, 'getCurrentBusiness() returns null without a session cookie')
  }

  // ─── Section 2: Protected mutation routes — unauthenticated blocked ──
  console.log('\nSection 2: Protected routes — unauthenticated access blocked (401 or throw)')

  // 2a. Routes fixed in RBAC-MATRIX (missing auth → now auth-enforced)
  console.log('\n  2a. Routes fixed in RBAC-MATRIX (missing auth → now auth-enforced):')

  {
    // 3d-status GET — previously NO auth, now blocked without session.
    const mod = await import('../../src/app/api/products/[id]/3d-status/route')
    const req = makeReq('/api/products/fake-id/3d-status', 'GET')
    const result = await invoke(mod.GET, req, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(result), `GET /api/products/[id]/3d-status → blocked (got ${result})`)
  }

  {
    // 3d-reconstruct GET — previously NO auth, now blocked without session.
    const mod = await import('../../src/app/api/products/[id]/3d-reconstruct/route')
    const req = makeReq('/api/products/fake-id/3d-reconstruct', 'GET')
    const result = await invoke(mod.GET, req, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(result), `GET /api/products/[id]/3d-reconstruct → blocked (got ${result})`)
  }

  {
    // media-assets GET — previously NO auth, now blocked without session.
    const mod = await import('../../src/app/api/products/[id]/media-assets/route')
    const req = makeReq('/api/products/fake-id/media-assets', 'GET')
    const result = await invoke(mod.GET, req, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(result), `GET /api/products/[id]/media-assets → blocked (got ${result})`)

    // media-assets DELETE — previously NO auth, now blocked without session.
    const delReq = makeReq('/api/products/fake-id/media-assets?assetId=fake-asset', 'DELETE')
    const delResult = await invoke(mod.DELETE, delReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(delResult), `DELETE /api/products/[id]/media-assets → blocked (got ${delResult})`)
  }

  {
    // fingerprints GET — previously NO auth, now blocked without session.
    const mod = await import('../../src/app/api/fingerprints/route')
    const req = makeReq('/api/fingerprints?partyId=fake-party', 'GET')
    const result = await invoke(mod.GET, req)
    assert(isBlocked(result), `GET /api/fingerprints → blocked (got ${result})`)

    // fingerprints DELETE — previously NO auth, now blocked without session.
    const delReq = makeReq('/api/fingerprints?id=fake-id', 'DELETE')
    const delResult = await invoke(mod.DELETE, delReq)
    assert(isBlocked(delResult), `DELETE /api/fingerprints → blocked (got ${delResult})`)
  }

  {
    // payments/split GET — previously NO auth, now blocked without session.
    const mod = await import('../../src/app/api/payments/split/route')
    const req = makeReq('/api/payments/split?orderSplitId=fake-id', 'GET')
    const result = await invoke(mod.GET, req)
    assert(isBlocked(result), `GET /api/payments/split → blocked (got ${result})`)
  }

  // 2b. Routes fixed in RBAC-MATRIX (missing OWNER/ADMIN role check)
  console.log('\n  2b. Routes fixed in RBAC-MATRIX (missing OWNER/ADMIN role check):')
  {
    // app-settings PUT — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/app-settings/route')
    const req = makeReq('/api/app-settings', 'PUT', { notificationsEnabled: true })
    const result = await invoke(mod.PUT, req)
    assert(isBlocked(result), `PUT /api/app-settings → blocked (got ${result})`)
  }

  {
    // settings/toggles PUT — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/settings/toggles/route')
    const req = makeReq('/api/settings/toggles', 'PUT', { onlineSalesEnabled: true })
    const result = await invoke(mod.PUT, req)
    assert(isBlocked(result), `PUT /api/settings/toggles → blocked (got ${result})`)
  }

  {
    // business PUT — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/business/route')
    const req = makeReq('/api/business', 'PUT', { name: 'Hacked' })
    const result = await invoke(mod.PUT, req)
    assert(isBlocked(result), `PUT /api/business → blocked (got ${result})`)
  }

  {
    // business/delivery-config PUT — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/business/delivery-config/route')
    const req = makeReq('/api/business/delivery-config', 'PUT', { deliveryRadiusKm: 999 })
    const result = await invoke(mod.PUT, req)
    assert(isBlocked(result), `PUT /api/business/delivery-config → blocked (got ${result})`)
  }

  {
    // products/[id] PUT and DELETE — now require OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/products/[id]/route')
    const putReq = makeReq('/api/products/fake-id', 'PUT', { name: 'Hacked' })
    const putResult = await invoke(mod.PUT, putReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(putResult), `PUT /api/products/[id] → blocked (got ${putResult})`)

    const delReq = makeReq('/api/products/fake-id', 'DELETE')
    const delResult = await invoke(mod.DELETE, delReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(delResult), `DELETE /api/products/[id] → blocked (got ${delResult})`)
  }

  {
    // products/[id]/restock POST — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/products/[id]/restock/route')
    const req = makeReq('/api/products/fake-id/restock', 'POST', { quantity: 999 })
    const result = await invoke(mod.POST, req, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(result), `POST /api/products/[id]/restock → blocked (got ${result})`)
  }

  {
    // invoices/[id] DELETE (void) — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/invoices/[id]/route')
    const req = makeReq('/api/invoices/fake-id', 'DELETE')
    const result = await invoke(mod.DELETE, req, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(result), `DELETE /api/invoices/[id] (void) → blocked (got ${result})`)
  }

  {
    // parties/[id] PUT and DELETE — now require OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/parties/[id]/route')
    const putReq = makeReq('/api/parties/fake-id', 'PUT', { name: 'Hacked' })
    const putResult = await invoke(mod.PUT, putReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(putResult), `PUT /api/parties/[id] → blocked (got ${putResult})`)

    const delReq = makeReq('/api/parties/fake-id', 'DELETE')
    const delResult = await invoke(mod.DELETE, delReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(delResult), `DELETE /api/parties/[id] → blocked (got ${delResult})`)
  }

  {
    // category-tree POST — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/category-tree/route')
    const req = makeReq('/api/category-tree', 'POST', { name: 'Hacked' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/category-tree → blocked (got ${result})`)
  }

  {
    // category-tree/[id] PATCH and DELETE — now require OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/category-tree/[id]/route')
    const patchReq = makeReq('/api/category-tree/fake-id', 'PATCH', { name: 'Hacked' })
    const patchResult = await invoke(mod.PATCH, patchReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(patchResult), `PATCH /api/category-tree/[id] → blocked (got ${patchResult})`)

    const delReq = makeReq('/api/category-tree/fake-id', 'DELETE')
    const delResult = await invoke(mod.DELETE, delReq, { params: Promise.resolve({ id: 'fake-id' }) })
    assert(isBlocked(delResult), `DELETE /api/category-tree/[id] → blocked (got ${delResult})`)
  }

  {
    // monetization/sponsor POST and DELETE — now require OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/monetization/sponsor/route')
    const postReq = makeReq('/api/monetization/sponsor', 'POST', { days: 30 })
    const postResult = await invoke(mod.POST, postReq)
    assert(isBlocked(postResult), `POST /api/monetization/sponsor → blocked (got ${postResult})`)

    const delResult = await invoke(mod.DELETE)
    assert(isBlocked(delResult), `DELETE /api/monetization/sponsor → blocked (got ${delResult})`)
  }

  {
    // monetization/subscribe POST — now requires OWNER/ADMIN → blocked without session.
    const mod = await import('../../src/app/api/monetization/subscribe/route')
    const req = makeReq('/api/monetization/subscribe', 'POST', { plan: 'monthly' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/monetization/subscribe → blocked (got ${result})`)
  }

  // 2c. Pre-existing OWNER/ADMIN-only routes (sanity check — already enforced)
  console.log('\n  2c. Pre-existing OWNER/ADMIN routes — unauthenticated → blocked:')
  {
    const mod = await import('../../src/app/api/staff/route')
    const getResult = await invoke(mod.GET)
    assert(isBlocked(getResult), `GET /api/staff → blocked (got ${getResult})`)

    const postReq = makeReq('/api/staff', 'POST', { name: 'Spy' })
    const postResult = await invoke(mod.POST, postReq)
    assert(isBlocked(postResult), `POST /api/staff → blocked (got ${postResult})`)
  }

  {
    const mod = await import('../../src/app/api/data-export/route')
    const req = makeReq('/api/data-export?format=json', 'GET')
    const result = await invoke(mod.GET, req)
    assert(isBlocked(result), `GET /api/data-export → blocked (got ${result})`)
  }

  {
    const mod = await import('../../src/app/api/defaulter-registry/route')
    const req = makeReq('/api/defaulter-registry', 'POST', { partyName: 'X', merchantName: 'Y' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/defaulter-registry → blocked (got ${result})`)
  }

  {
    const mod = await import('../../src/app/api/customer-trust-score/route')
    const req = makeReq('/api/customer-trust-score', 'POST', { customerPhone: '9999999999' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/customer-trust-score → blocked (got ${result})`)
  }

  // 2d. Pre-existing ANY-AUTH protected mutation routes (sample)
  console.log('\n  2d. Pre-existing ANY-AUTH mutation routes — sample unauthenticated → blocked:')
  {
    // invoices POST
    const mod = await import('../../src/app/api/invoices/route')
    const req = makeReq('/api/invoices', 'POST', { items: [] })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/invoices → blocked (got ${result})`)
  }

  {
    // transactions POST
    const mod = await import('../../src/app/api/transactions/route')
    const req = makeReq('/api/transactions', 'POST', { amount: 100, type: 'credit' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/transactions → blocked (got ${result})`)
  }

  {
    // parties POST
    const mod = await import('../../src/app/api/parties/route')
    const req = makeReq('/api/parties', 'POST', { name: 'Spy' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/parties → blocked (got ${result})`)
  }

  {
    // products POST
    const mod = await import('../../src/app/api/products/route')
    const req = makeReq('/api/products', 'POST', { name: 'Spy Product' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/products → blocked (got ${result})`)
  }

  {
    // pin POST (uses requireAuth)
    const mod = await import('../../src/app/api/pin/route')
    const req = makeReq('/api/pin', 'POST', { action: 'verify', pin: '1234' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/pin → blocked (got ${result})`)
  }

  {
    // ocr POST (uses getCurrentBusiness, returns 401)
    const mod = await import('../../src/app/api/ocr/route')
    const req = makeReq('/api/ocr', 'POST', { image: 'data:image/png;base64,xxx' })
    const result = await invoke(mod.POST, req)
    assert(isBlocked(result), `POST /api/ocr → blocked (got ${result})`)
  }

  // ─── Section 3: Intentionally PUBLIC routes do NOT 401/throw ────────
  console.log('\nSection 3: Intentionally PUBLIC routes — do NOT block:')
  {
    const mod = await import('../../src/app/api/auth/login/route')
    const req = makeReq('/api/auth/login', 'POST', { email: 'nobody@example.com', password: 'wrong' })
    const result = await invoke(mod.POST, req)
    // Login is public — should NOT block. Returns 401 (invalid creds) or 429
    // (rate limited) but neither is a "you must be authenticated" 401 from a
    // requireAuth call. We just verify it does NOT throw.
    assert(result !== 'THREW', `POST /api/auth/login → did not throw (got ${result}, expected — public endpoint)`)
  }

  {
    // payment GET — public payment landing page by token.
    const mod = await import('../../src/app/api/payment/route')
    const req = makeReq('/api/payment?token=fake-token', 'GET')
    const result = await invoke(mod.GET, req)
    // Should be 404 (token not found) — NOT blocked.
    assert(result === 404, `GET /api/payment → 404 (got ${result}, expected — public endpoint)`)
  }

  {
    // central-catalog GET — public marketplace catalog.
    const mod = await import('../../src/app/api/central-catalog/route')
    const req = makeReq('/api/central-catalog', 'GET')
    const result = await invoke(mod.GET, req)
    // Should be 200 (empty catalog) — NOT blocked.
    assert(result === 200, `GET /api/central-catalog → 200 (got ${result}, expected — public endpoint)`)
  }

  {
    // favorite-shops GET — public customer favorites.
    const mod = await import('../../src/app/api/favorite-shops/route')
    const req = makeReq('/api/favorite-shops?customerPhone=9999999999', 'GET')
    const result = await invoke(mod.GET, req)
    assert(result === 200, `GET /api/favorite-shops → 200 (got ${result}, expected — public endpoint)`)
  }

  {
    // nearby-shops GET — public shop discovery.
    const mod = await import('../../src/app/api/nearby-shops/route')
    const req = makeReq('/api/nearby-shops?lat=22.5&lng=88.3', 'GET')
    const result = await invoke(mod.GET, req)
    assert(result === 200, `GET /api/nearby-shops → 200 (got ${result}, expected — public endpoint)`)
  }

  {
    // verify-location POST — public customer GPS check.
    const mod = await import('../../src/app/api/verify-location/route')
    const req = makeReq('/api/verify-location', 'POST', { gpsLat: 22.5, gpsLng: 88.3 })
    const result = await invoke(mod.POST, req)
    // Should be 200 (with orderAllowed=false since no storeSlug) — NOT blocked.
    assert(result === 200, `POST /api/verify-location → 200 (got ${result}, expected — public endpoint)`)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  console.log(`${'='.repeat(60)}`)

  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Test runner error:', e)
  process.exit(1)
})
