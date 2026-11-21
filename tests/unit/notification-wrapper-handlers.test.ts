/**
 * §TEST: Notification — Wrapper-level route handler tests.
 *
 * Run: bun run tests/unit/notification-wrapper-handlers.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: Imports + calls the ACTUAL exported PUT / GET handlers
 *     from `src/app/api/notification-preferences/route.ts` and the ACTUAL
 *     exported POST handler from `src/app/api/invoices/route.ts`. Verifies
 *     real `NextResponse` status codes and JSON bodies.
 *   - REAL DB: Prisma client against the SQLite dev database — real rows are
 *     inserted/queried to prove the wrapper actually persisted state.
 *   - MOCKED DEPENDENCY (auth boundary): `getCurrentBusiness()` from
 *     `@/lib/db` is replaced via Bun's `mock.module`. The mock returns a
 *     controllable business object (or null to simulate "no session"). The
 *     real `db` (Prisma client) is preserved unchanged inside the same mock
 *     so the wrapper's DB calls hit the real dev database.
 *   - MOCKED DEPENDENCY (invoice-service boundary): `createInvoice()` from
 *     `@/lib/invoice-service` is replaced for the invoice POST wrapper test
 *     only — so we don't need a full valid invoice payload. The real
 *     `createSaleNotification()` (the extracted core function) is NOT mocked
 *     and runs against the real DB.
 *   - STATIC CONTRACT: Migration SQL is read from disk (NOT executed against
 *     PostgreSQL). The migration-lock confirms PostgreSQL provider only.
 *
 * §WHY-BUN: This file uses Bun's `mock.module()` to replace `getCurrentBusiness`
 * at the module-loading boundary. `mock.module` requires the Bun runtime, so
 * this file is run with `bun run` (not `npx tsx`). The sibling file
 * `notification-correctness.test.ts` runs under both `tsx` and `bun` because
 * it only mocks `global.fetch` (no module-level mocking needed for the
 * extracted core-function tests).
 *
 * §MOCK-ORDERING: `mock.module()` intercepts FUTURE imports of a module path.
 * The real `db` is imported BEFORE the mock is registered (so we hold a real
 * handle to it). The mock factory returns the SAME `db` reference plus the
 * mocked `getCurrentBusiness`. The route handlers are imported AFTER the
 * mock is registered, so they receive the mocked `getCurrentBusiness`.
 *
 * NO production logic is copied into the test. The test imports the REAL
 * exported `PUT` / `GET` / `POST` functions and calls them with real
 * `NextRequest` instances.
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

const TEST_BIZ_ID = 'test-notif-wrapper-' + Date.now()

// ──────────────────────────────────────────────────────────────────────
// §MOCK-SETUP: Register module mocks BEFORE importing the route handlers.
// ──────────────────────────────────────────────────────────────────────

// §AUTH-BOUNDARY: Controllable override for getCurrentBusiness().
// - null  → simulates "no authenticated session" (route returns 400/401).
// - object → simulates an authenticated business (route proceeds).
let currentBusinessOverride: { id: string; name: string; currency: string } | null = null

// §PRESERVE-REAL-DB: We import the real `db` (above) and pass it through the
// mock factory so the route's DB calls hit the real dev database. Only
// `getCurrentBusiness` is replaced.
await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

// §INVOICE-SERVICE-BOUNDARY: Replace `createInvoice` so the invoice POST
// wrapper test doesn't need a full valid invoice payload. Preserve the real
// `InvoiceValidationError` class so the wrapper's `instanceof` check still
// works (we test that path too).
const realInvoiceService = await import('@/lib/invoice-service')
let mockInvoiceResult: any = null
let createInvoiceCallCount = 0
let lastCreateInvoiceArgs: { body: any; business: any } | null = null
await mock.module('@/lib/invoice-service', () => ({
  ...realInvoiceService,
  createInvoice: async (body: any, business: any) => {
    createInvoiceCallCount++
    lastCreateInvoiceArgs = { body, business }
    return mockInvoiceResult
  },
}))

// §IMPORT-ROUTES-AFTER-MOCKS: Now the route handlers will use the mocked
// getCurrentBusiness and the mocked createInvoice.
const prefRoute = await import('@/app/api/notification-preferences/route')
const invoiceRoute = await import('@/app/api/invoices/route')

// ──────────────────────────────────────────────────────────────────────
// §TEST-FIXTURES
// ──────────────────────────────────────────────────────────────────────

async function setupTestBusiness() {
  await db.business.create({ data: { id: TEST_BIZ_ID, name: 'Wrapper Test Biz', currency: 'INR' } })
}

async function cleanupTestBusiness() {
  try {
    await db.notificationChannelPreference.deleteMany({ where: { businessId: TEST_BIZ_ID } })
    await db.notification.deleteMany({ where: { businessId: TEST_BIZ_ID } })
    await db.business.delete({ where: { id: TEST_BIZ_ID } })
  } catch {}
}

function makePutRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/notification-preferences', {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

function makeGetRequest(): NextRequest {
  return new NextRequest('http://localhost/api/notification-preferences', { method: 'GET' })
}

function makeInvoicePostRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/invoices', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

// ──────────────────────────────────────────────────────────────────────
// §MAIN
// ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🧪 Notification Wrapper-Handler Tests — REAL exported PUT/GET/POST\n')
  await setupTestBusiness()
  // Point the auth-boundary mock at the real test business.
  currentBusinessOverride = { id: TEST_BIZ_ID, name: 'Wrapper Test Biz', currency: 'INR' }

  // ─── A. WRAPPER PUT — valid request → real 200 + body ────────────────
  console.log('A. WRAPPER PUT — valid { key: "sales", value: false } → 200')
  {
    const req = makePutRequest({ key: 'sales', value: false })
    const res = await prefRoute.PUT(req)

    assert(res.status === 200, `A1: real NextResponse status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.ok === true, 'A2: response body has ok=true')
    assert(body.key === 'sales', 'A3: response body has key="sales"')
    assert(body.value === false, 'A4: response body has value=false')

    // §REAL-DB-PROOF: Verify the wrapper actually persisted via the real db.
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(pref !== null, 'A5: real DB row exists (wrapper persisted)')
    assert(pref?.enabled === false, 'A6: real DB has enabled=false (wrapper wrote real row)')
  }

  // ─── B. WRAPPER PUT — invalid key → real 400 ────────────────────────
  console.log('\nB. WRAPPER PUT — invalid key → 400')
  {
    const req = makePutRequest({ key: 'invalidKey', value: true })
    const res = await prefRoute.PUT(req)

    assert(res.status === 400, `B1: real NextResponse status=400 (got ${res.status})`)
    const body = await res.json()
    assert(body.error !== undefined, 'B2: response body has error field')
    assert(typeof body.error === 'string' && body.error.length > 0, 'B3: error is a non-empty string')
    assert(body.error.includes('Invalid key'), `B4: error mentions invalid key (got "${body.error}")`)

    // §REAL-DB-PROOF: No row created for the invalid key.
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'invalidKey' } as any },
    })
    assert(pref === null, 'B5: no DB row for invalid key (wrapper rejected)')
  }

  // ─── C. WRAPPER PUT — non-boolean value → real 400 ──────────────────
  console.log('\nC. WRAPPER PUT — non-boolean value → 400')
  {
    const req = makePutRequest({ key: 'sales', value: 'yes' })
    const res = await prefRoute.PUT(req)

    assert(res.status === 400, `C1: real NextResponse status=400 (got ${res.status})`)
    const body = await res.json()
    assert(body.error !== undefined, 'C2: response body has error field')
    assert(body.error.includes('boolean'), `C3: error mentions boolean (got "${body.error}")`)

    // §REAL-DB-PROOF: The existing sales=false (set in test A) is unchanged.
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(pref?.enabled === false, 'C4: existing sales=false unchanged (invalid request did not overwrite)')
  }

  // ─── D. WRAPPER PUT — missing body fields → real 400 ────────────────
  console.log('\nD. WRAPPER PUT — missing body fields → 400')
  {
    // §MISSING-KEY: key is undefined → fails the VALID_KEYS.includes check.
    const req = makePutRequest({ value: true })
    const res = await prefRoute.PUT(req)
    assert(res.status === 400, `D1: real NextResponse status=400 for missing key (got ${res.status})`)
  }

  // ─── E. WRAPPER PUT — no business → real 400 + "No business" ────────
  console.log('\nE. WRAPPER PUT — no business (auth boundary returns null) → 400')
  {
    const savedBusiness = currentBusinessOverride
    currentBusinessOverride = null // §SIMULATE no authenticated session
    try {
      const req = makePutRequest({ key: 'lowStock', value: false })
      const res = await prefRoute.PUT(req)

      assert(res.status === 400, `E1: real NextResponse status=400 (got ${res.status})`)
      const body = await res.json()
      assert(body.error === 'No business', `E2: response body error="No business" (got "${body.error}")`)

      // §REAL-DB-PROOF: No row was created (auth rejected before DB write).
      const pref = await db.notificationChannelPreference.findUnique({
        where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'lowStock' } },
      })
      assert(pref === null, 'E3: no DB row created (auth rejected before DB write)')
    } finally {
      currentBusinessOverride = savedBusiness
    }
  }

  // ─── F. WRAPPER GET — real response body with channels map ──────────
  console.log('\nF. WRAPPER GET — returns real channels map')
  {
    // Pre-seed a lowStock=false preference so GET returns a non-default value.
    await db.notificationChannelPreference.upsert({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'lowStock' } },
      update: { enabled: false },
      create: { businessId: TEST_BIZ_ID, key: 'lowStock', enabled: false },
    })

    const res = await prefRoute.GET()

    assert(res.status === 200, `F1: real NextResponse status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.channels !== undefined, 'F2: response body has channels field')
    assert(body.channels.sales === false, 'F3: channels.sales=false (from test A, real DB read)')
    assert(body.channels.lowStock === false, 'F4: channels.lowStock=false (from pre-seed, real DB read)')
    // Defaults for channels with no DB row:
    assert(body.channels.overduePayments === true, 'F5: channels.overduePayments=true (default — no row)')
    assert(body.channels.gradeChanges === true, 'F6: channels.gradeChanges=true (default)')
    assert(body.channels.backups === true, 'F7: channels.backups=true (default)')
  }

  // ─── G. WRAPPER GET — no business → real 400 ───────────────────────
  console.log('\nG. WRAPPER GET — no business → 400')
  {
    const savedBusiness = currentBusinessOverride
    currentBusinessOverride = null
    try {
      const res = await prefRoute.GET()
      assert(res.status === 400, `G1: real NextResponse status=400 (got ${res.status})`)
      const body = await res.json()
      assert(body.error === 'No business', `G2: response body error="No business" (got "${body.error}")`)
    } finally {
      currentBusinessOverride = savedBusiness
    }
  }

  // ─── H. WRAPPER invoice POST — sales=true → notification created + header ─
  console.log('\nH. WRAPPER invoice POST — sales=true → 200 + X-Notification-Created header')
  {
    // §ENSURE-SALES-ENABLED: Reset sales=true for this test.
    await db.notificationChannelPreference.upsert({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
      update: { enabled: true },
      create: { businessId: TEST_BIZ_ID, key: 'sales', enabled: true },
    })

    // §MOCK-CREATEINVOICE: The wrapper calls createInvoice(body, business);
    // we intercept it and return a controlled invoice object. The wrapper
    // then calls the REAL createSaleNotification, which writes to the real DB.
    const invoiceId = 'wrapper-inv-' + Date.now()
    mockInvoiceResult = {
      id: invoiceId,
      items: [{ name: 'Rice', quantity: 3 }, { name: 'Oil', quantity: 2 }],
      party: { name: 'Wrapper Party' },
      grandTotal: 2450,
    }
    createInvoiceCallCount = 0
    lastCreateInvoiceArgs = null

    const req = makeInvoicePostRequest({ items: [{ name: 'Rice', quantity: 3, price: 100 }] })
    const res = await invoiceRoute.POST(req)

    assert(res.status === 200, `H1: real NextResponse status=200 (got ${res.status})`)
    assert(createInvoiceCallCount === 1, `H2: mocked createInvoice called exactly once (got ${createInvoiceCallCount})`)
    // §CFA-NOTE: lastCreateInvoiceArgs is assigned inside a mock-factory callback
    // which TS control-flow analysis does not track, so we cast to the declared
    // union type at the access point to avoid spurious narrowing to `null`.
    const capturedArgs = lastCreateInvoiceArgs as { body: any; business: any } | null
    assert(capturedArgs?.business?.id === TEST_BIZ_ID, 'H3: createInvoice received the mocked business (auth boundary wired)')

    // §HEADER-CHECK: Wrapper sets X-Notification-Created=sale when a notification was created.
    const notifHeader = res.headers.get('X-Notification-Created')
    assert(notifHeader === 'sale', `H4: X-Notification-Created=sale header set (got "${notifHeader}")`)

    // §RESPONSE-BODY: The wrapper returns serializeDecimals(invoice).
    const body = await res.json()
    assert(body.id === invoiceId, `H5: response body echoes mocked invoice id (got ${body.id})`)

    // §REAL-DB-PROOF: createSaleNotification (the real, NOT-mocked core function)
    // wrote exactly ONE notification row for this invoice.
    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId },
    })
    assert(notifCount === 1, `H6: exactly 1 notification in real DB (got ${notifCount})`)

    const notif = await db.notification.findFirst({
      where: { businessId: TEST_BIZ_ID, invoiceId },
    })
    assert(notif?.type === 'sale', 'H7: notification type=sale')
    assert((notif?.body || '').includes('Wrapper Party'), 'H8: notification body includes party name')
    assert((notif?.body || '').includes('2 items'), 'H9: notification body includes item count')
    assert(notif?.link === 'history', 'H10: notification link=history')
  }

  // ─── I. WRAPPER invoice POST — sales=false → NO notification, no header ─
  console.log('\nI. WRAPPER invoice POST — sales=false → 200, NO notification, NO header')
  {
    // §DISABLE-SALES: Set sales=false.
    await db.notificationChannelPreference.upsert({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
      update: { enabled: false },
      create: { businessId: TEST_BIZ_ID, key: 'sales', enabled: false },
    })

    const invoiceId = 'wrapper-inv-nosale-' + Date.now()
    mockInvoiceResult = {
      id: invoiceId,
      items: [{ name: 'Sugar', quantity: 1 }],
      party: { name: 'No Sale Party' },
      grandTotal: 50,
    }

    const req = makeInvoicePostRequest({ items: [{ name: 'Sugar', quantity: 1, price: 50 }] })
    const res = await invoiceRoute.POST(req)

    assert(res.status === 200, `I1: real NextResponse status=200 (got ${res.status})`)
    const notifHeader = res.headers.get('X-Notification-Created')
    assert(notifHeader === null, `I2: NO X-Notification-Created header (got "${notifHeader}")`)

    // §REAL-DB-PROOF: Zero notifications for this invoice (sales disabled).
    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId },
    })
    assert(notifCount === 0, `I3: zero notifications in real DB (got ${notifCount})`)
  }

  // ─── J. WRAPPER invoice POST — no business → real 400 ────────────────
  console.log('\nJ. WRAPPER invoice POST — no business → 400')
  {
    const savedBusiness = currentBusinessOverride
    currentBusinessOverride = null
    createInvoiceCallCount = 0
    try {
      const req = makeInvoicePostRequest({ items: [] })
      const res = await invoiceRoute.POST(req)

      assert(res.status === 400, `J1: real NextResponse status=400 (got ${res.status})`)
      const body = await res.json()
      assert(body.error === 'No business', `J2: response body error="No business" (got "${body.error}")`)
      assert(createInvoiceCallCount === 0, `J3: createInvoice NOT called (auth rejected first) — got ${createInvoiceCallCount}`)
    } finally {
      currentBusinessOverride = savedBusiness
    }
  }

  // ─── K. WRAPPER invoice POST — InvoiceValidationError → real 400 ────
  console.log('\nK. WRAPPER invoice POST — InvoiceValidationError → 400')
  {
    // §TEMP-MOCK-THROW: Make the mocked createInvoice throw a REAL
    // InvoiceValidationError (the class is preserved in the mock). The
    // wrapper's catch block checks `instanceof InvoiceValidationError`.
    const realCreate = realInvoiceService.createInvoice
    const validationErr = new realInvoiceService.InvoiceValidationError('Test: invalid quantity')
    await mock.module('@/lib/invoice-service', () => ({
      ...realInvoiceService,
      createInvoice: async () => { throw validationErr },
    }))

    try {
      const req = makeInvoicePostRequest({ items: [{ name: 'X', quantity: -1, price: 10 }] })
      const res = await invoiceRoute.POST(req)

      assert(res.status === 400, `K1: real NextResponse status=400 (got ${res.status})`)
      const body = await res.json()
      assert(body.error === 'Test: invalid quantity', `K2: response body has validation message (got "${body.error}")`)
    } finally {
      // §RESTORE: Re-install the controllable mock for any later tests.
      await mock.module('@/lib/invoice-service', () => ({
        ...realInvoiceService,
        createInvoice: async (body: any, business: any) => {
          createInvoiceCallCount++
          lastCreateInvoiceArgs = { body, business }
          return mockInvoiceResult
        },
      }))
      // Reference realCreate to satisfy TS (no-op, indicates original preserved).
      void realCreate
    }
  }

  // ─── L. WRAPPER invoice POST — generic error → real 500 ─────────────
  console.log('\nL. WRAPPER invoice POST — generic Error → 500')
  {
    await mock.module('@/lib/invoice-service', () => ({
      ...realInvoiceService,
      createInvoice: async () => { throw new Error('Unexpected DB failure') },
    }))

    try {
      const req = makeInvoicePostRequest({ items: [{ name: 'X', quantity: 1, price: 10 }] })
      const res = await invoiceRoute.POST(req)

      assert(res.status === 500, `L1: real NextResponse status=500 (got ${res.status})`)
      const body = await res.json()
      assert(body.error !== undefined, 'L2: response body has error field')
      // In non-production NODE_ENV, the wrapper returns String(e).
      assert(body.error.includes('Unexpected DB failure'), `L3: error includes real message in dev (got "${body.error}")`)
    } finally {
      // §RESTORE controllable mock.
      await mock.module('@/lib/invoice-service', () => ({
        ...realInvoiceService,
        createInvoice: async (body: any, business: any) => {
          createInvoiceCallCount++
          lastCreateInvoiceArgs = { body, business }
          return mockInvoiceResult
        },
      }))
    }
  }

  // ─── M. STATIC: Migration file contract (file read, NOT PostgreSQL exec) ─
  console.log('\nM. STATIC: Migration file contract (file read, NOT PostgreSQL execution)')
  {
    const fs = await import('fs')
    const migrationSql = fs.readFileSync(
      'prisma/migrations/20260908000000_add_notification_channel_preferences/migration.sql',
      'utf-8',
    )
    assert(migrationSql.includes('CREATE TABLE "NotificationChannelPreference"'), 'M1: CREATE TABLE present')
    assert(migrationSql.includes('CREATE UNIQUE INDEX "NotificationChannelPreference_businessId_key_key"'), 'M2: UNIQUE INDEX on (businessId, key)')
    assert(migrationSql.includes('FOREIGN KEY'), 'M3: FK to Business')
    const sqlCode = migrationSql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    assert(!sqlCode.includes('gen_random_uuid'), 'M4: no gen_random_uuid in SQL code')
    // §PRECISE-TYPEOF-CHECK: 'typeof(' is a SQLite-only function. The substring
    // check must NOT false-positive on PostgreSQL's 'jsonb_typeof('. We strip
    // SQL comments first, then match 'typeof(' only when NOT preceded by
    // 'jsonb_'. (jsonb_typeof() is a VALID PostgreSQL function used here.)
    const typeofMatches = sqlCode.match(/(?<!jsonb_)typeof\(/g)
    assert(typeofMatches === null, `M5: no standalone typeof() (SQLite-only) — found ${typeofMatches?.length ?? 0} matches`)
    assert(migrationSql.includes('jsonb_typeof'), 'M5b: uses jsonb_typeof() (valid PostgreSQL function)')
    assert(migrationSql.includes('jsonb_each_text'), 'M6: uses jsonb_each_text (PostgreSQL JSON)')
    assert(migrationSql.includes('ON CONFLICT'), 'M7: uses ON CONFLICT (idempotent DML)')

    // §PROVIDER-LOCK: migration_lock.toml declares PostgreSQL ONLY. This is
    // a STATIC file read — we are NOT executing the migration against a
    // running PostgreSQL instance.
    const lockToml = fs.readFileSync('prisma/migrations/migration_lock.toml', 'utf-8')
    assert(lockToml.includes('postgresql'), 'M8: migration_lock.toml declares postgresql provider')
  }

  await cleanupTestBusiness()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Notification Wrapper-Handler Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanupTestBusiness().finally(() => process.exit(1))
})
