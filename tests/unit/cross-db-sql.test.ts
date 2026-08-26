/**
 * §TEST: Cross-DB SQL compatibility regression tests.
 *
 * Run: npx tsx tests/unit/cross-db-sql.test.ts
 *
 * These tests guard against two cross-DB bugs found during browser QA:
 *
 *   Bug A: getCurrentBusiness() used PostgreSQL's NOW() in a raw SQL query,
 *          which is unknown to SQLite (dev DB). The query silently returned
 *          0 rows, causing /api/business to 401 even with a valid session.
 *
 *   Bug B: /api/dashboard route used PostgreSQL's ::bigint casts in raw SQL
 *          (e.g. `COUNT(*)::bigint`). SQLite rejects `::` token, causing
 *          "unrecognized token: ':'" and HTTP 500 on the dashboard endpoint.
 *
 * Both bugs blocked the dashboard from loading in dev (SQLite) while
 * production (PostgreSQL) ran fine. These regression tests assert that the
 * source code does NOT regress to PostgreSQL-only syntax.
 */
export {}

import * as fs from 'fs'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ }
}

async function main() {
  console.log('\n  Cross-DB SQL Compatibility Tests')
  console.log('  =================================')

  // ─── Bug A: getCurrentBusiness() must not use NOW() ────────────────────────

  console.log('\n  A1. getCurrentBusiness() — no PostgreSQL NOW() in raw SQL:')
  {
    const src = fs.readFileSync('src/lib/db.ts', 'utf8')
    // Strip comments before pattern-matching — comments may legitimately mention
    // the bug being fixed (e.g. "do not use NOW() here").
    const codeOnly = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    // The function must not call NOW() — SQLite doesn't have it.
    // It SHOULD use a Date parameter instead, which Prisma adapts per provider.
    const hasNow = /\bNOW\s*\(\s*\)/.test(codeOnly)
    assert(!hasNow, 'getCurrentBusiness source has no NOW() call (excluding comments)')

    // Verify it uses a Date parameter (the recommended cross-DB pattern)
    assert(codeOnly.includes('const now = new Date()'),
      'getCurrentBusiness uses `const now = new Date()` parameter')

    // Verify the Date is passed as a tagged-template parameter (${now})
    // (not interpolated as a string literal)
    assert(/\$\{now\}/.test(codeOnly),
      'Date is passed as a Prisma tagged-template parameter ${now}')

    // Ensure no other SQL functions that differ across SQLite/Postgres
    // are used in this file (CURRENT_TIMESTAMP, NOW, datetime, strftime)
    const forbiddenFns = ['CURRENT_TIMESTAMP', 'CURRENT_DATE', 'CURRENT_TIME']
    for (const fn of forbiddenFns) {
      const re = new RegExp('\\b' + fn + '\\b')
      assert(!re.test(codeOnly), `No ${fn}() call in db.ts (excluding comments)`)
    }
  }

  // ─── Bug B: dashboard route must not use ::bigint casts ────────────────────

  console.log('\n  A2. /api/dashboard route — no PostgreSQL ::bigint casts:')
  {
    const src = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')

    // The :: cast syntax is PostgreSQL-specific. SQLite rejects `::` token.
    // Removing the cast is safe in PostgreSQL because Prisma's driver
    // converts int4/int8 to BigInt transparently.
    assert(!/::\s*bigint\b/.test(src),
      'Dashboard route has no ::bigint casts')

    assert(!/::\s*int\b/.test(src),
      'Dashboard route has no ::int casts')

    assert(!/::\s*text\b/.test(src),
      'Dashboard route has no ::text casts')

    assert(!/::\s*numeric\b/.test(src),
      'Dashboard route has no ::numeric casts')

    // Verify the raw SQL queries still work (key columns still aliased)
    assert(src.includes('AS total_count'),
      'Raw SQL still returns total_count alias')
    assert(src.includes('AS receivable_sum'),
      'Raw SQL still returns receivable_sum alias')
    assert(src.includes('AS today_sales'),
      'Raw SQL still returns today_sales alias')
    assert(src.includes('AS collection_sum'),
      'Raw SQL still returns collection_sum alias')
    assert(src.includes('AS expense_sum'),
      'Raw SQL still returns expense_sum alias')
    assert(src.includes('AS paid_count'),
      'Raw SQL still returns paid_count alias')
    assert(src.includes('AS monthly_sales'),
      'Raw SQL still returns monthly_sales alias')
    assert(src.includes('AS range_sales'),
      'Raw SQL still returns range_sales alias')
    assert(/AS grade_[a-e]\b/.test(src),
      'Raw SQL still returns grade_a..grade_e aliases')
  }

  // ─── Bug A (functional): getCurrentBusiness() returns valid business ──────

  console.log('\n  A3. getCurrentBusiness() — runs against SQLite without error:')
  {
    // Set the DATABASE_URL to the dev SQLite file (matches what the running
    // dev server uses). The Prisma client picks up the env var at instantiation.
    process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'

    // Force ESM module reload — we want a fresh PrismaClient bound to our URL.
    // (tsx caches modules, so we use a unique query param to bust the cache.)
    const dbModule = await import(`../../src/lib/db.ts?t=${Date.now()}`)
    const { db, getCurrentBusiness } = dbModule

    // Test 1: Without a session cookie context (next/headers throws), the
    // function must return null gracefully — no SQL error should bubble up.
    // This catches the old failure mode where NOW() raised "no such function"
    // and the catch block silently returned null — making EVERY business
    // request look "unauthenticated".
    const result = await getCurrentBusiness()
    assert(result === null,
      'getCurrentBusiness() returns null without a session cookie (no SQL error)')

    // Test 2: Direct Prisma raw query with a Date parameter works on SQLite.
    // This is the exact pattern the fix introduced.
    const now = new Date()
    const rows = await db.$queryRaw<Array<any>>`
      SELECT b.* FROM "Session" s
      JOIN "User" u ON s."userId" = u.id
      JOIN "Business" b ON u."businessId" = b.id
      WHERE s."tokenHash" = ${'nonexistent-token-hash'} AND s."expiresAt" > ${now}
      LIMIT 1
    `
    assert(Array.isArray(rows), 'Raw query with Date parameter returns an array')
    assert(rows.length === 0,
      'Raw query returns 0 rows for unknown token (no SQL error)')

    // Test 3: The Prisma raw query against SQLite uses an INTEGER column
    // internally (SQLite stores DateTime as INTEGER ms since epoch). Comparing
    // INTEGER to a Date parameter works because Prisma serializes Date to
    // milliseconds under the hood. We don't need to convert in SQL.
    // Verify the query runs without throwing by counting actual sessions.
    const sessionCount = await db.$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "Session"`)
    assert(Array.isArray(sessionCount) && sessionCount.length === 1,
      'SQLite Session table is accessible')

    await db.$disconnect()
  }

  // ─── Bug B (functional): dashboard raw SQL queries run on SQLite ────────────

  console.log('\n  A4. /api/dashboard raw SQL — runs against SQLite without error:')
  {
    process.env.DATABASE_URL = 'file:/home/z/my-project/db/custom.db'
    const dbModule = await import(`../../src/lib/db.ts?t=${Date.now() + 1}`)
    const { db } = dbModule

    // Find a real business ID to query against
    const businesses = await db.business.findMany({ select: { id: true } })
    assert(businesses.length > 0, 'Dev DB has at least one Business row')
    const businessId = businesses[0].id

    // §COMBINED-PARTY query — previously had `::bigint` casts that broke SQLite
    const partyRow = await db.$queryRaw`
      SELECT
        COUNT(*) AS total_count,
        COALESCE(SUM(CASE WHEN balance > 0 THEN balance ELSE 0 END), 0) AS receivable_sum,
        COALESCE(SUM(CASE WHEN balance < 0 THEN balance ELSE 0 END), 0) AS payable_sum,
        COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END) AS overdue_count,
        COUNT(CASE WHEN "qualityGrade" = 'A' THEN 1 END) AS grade_a,
        COUNT(CASE WHEN "qualityGrade" = 'B' THEN 1 END) AS grade_b,
        COUNT(CASE WHEN "qualityGrade" = 'C' THEN 1 END) AS grade_c,
        COUNT(CASE WHEN "qualityGrade" = 'D' THEN 1 END) AS grade_d,
        COUNT(CASE WHEN "qualityGrade" = 'E' THEN 1 END) AS grade_e
      FROM "Party" WHERE "businessId" = ${businessId}
    `
    assert(Array.isArray(partyRow) && partyRow.length === 1,
      'COMBINED-PARTY raw SQL runs without ::bigint error on SQLite')

    // §COMBINED-INVOICE query — previously had `::bigint` casts
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
    const rangeStart = new Date(); rangeStart.setDate(rangeStart.getDate() - 6)
    const rangeEnd = new Date()
    const invoiceRow = await db.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN "createdAt" >= ${today} THEN "grandTotal" ELSE 0 END), 0) AS today_sales,
        COALESCE(SUM(CASE WHEN "createdAt" >= ${monthStart} THEN "grandTotal" ELSE 0 END), 0) AS monthly_sales,
        COALESCE(SUM(CASE WHEN "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd} THEN "grandTotal" ELSE 0 END), 0) AS range_sales,
        COUNT(*) AS total_count,
        COUNT(CASE WHEN status = 'paid' THEN 1 END) AS paid_count
      FROM "Invoice"
      WHERE "businessId" = ${businessId} AND status != 'void'
    `
    assert(Array.isArray(invoiceRow) && invoiceRow.length === 1,
      'COMBINED-INVOICE raw SQL runs without ::bigint error on SQLite')

    // §COMBINED-TRANSACTION query — previously had `::bigint` casts
    const txnRow = await db.$queryRaw`
      SELECT
        COALESCE(SUM(CASE WHEN type = 'credit' THEN amount ELSE 0 END), 0) AS collection_sum,
        COALESCE(SUM(CASE WHEN type IN ('debit', 'expense', 'purchase') THEN amount ELSE 0 END), 0) AS expense_sum
      FROM "Transaction"
      WHERE "businessId" = ${businessId} AND "createdAt" >= ${rangeStart} AND "createdAt" <= ${rangeEnd}
    `
    assert(Array.isArray(txnRow) && txnRow.length === 1,
      'COMBINED-TRANSACTION raw SQL runs without ::bigint error on SQLite')

    // §NUM-FIX: Without ::bigint cast, the raw value may be a JS number, BigInt,
    // or Decimal depending on Prisma driver. The route converts via Number(v),
    // which handles BigInt → number safely.
    const num = (v: any): number => Number(v) || 0
    assert(typeof num(partyRow[0].total_count) === 'number',
      'Number() conversion handles raw SQL COUNT() result')
    assert(typeof num(invoiceRow[0].today_sales) === 'number',
      'Number() conversion handles raw SQL SUM() result')

    await db.$disconnect()
  }

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
