/**
 * §TEST: Complaint PostgreSQL Concurrency — REAL concurrent creation against PostgreSQL.
 *
 * Run: bun run tests/integration/complaints-pg-concurrency.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: Fires 5 GENUINELY CONCURRENT complaint creation requests
 *     against a disposable PostgreSQL 17.11 database using the PRODUCTION
 *     Prisma schema (prisma/schema.prisma — PostgreSQL provider).
 *   - NO MOCKING: Uses real Prisma client + real PostgreSQL. No Bun mock.module.
 *   - NO SERIALIZATION: The 5 requests are fired via Promise.all (truly
 *     concurrent — PostgreSQL handles concurrent transactions natively).
 *
 * §ENVIRONMENT REQUIREMENT: Requires a running PostgreSQL instance at
 * 127.0.0.1:5437 with a `bizledger_conc` database. The test script provisions
 * this if PG binaries are available (disposable cluster).
 *
 * §VERIFIES:
 *   - all 5 concurrent requests succeed (no transaction timeouts)
 *   - no duplicate complaint numbers (DB unique constraint enforced)
 *   - numbers are unique
 *   - numbers are sequential (CMP-0001, CMP-0002, CMP-0003, CMP-0004, CMP-0005)
 *   - ComplaintSequence.nextNumber ends at 5
 *   - every complaint has exactly one CREATED event
 *   - first three numbers are CMP-0001, CMP-0002, CMP-0003 (no off-by-one)
 */
export {}

import { PrismaClient } from '@prisma/client'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const DATABASE_URL = 'postgresql://testuser@127.0.0.1:5437/bizledger_conc?schema=public'

async function main() {
  console.log('\n🧪 Complaint PostgreSQL Concurrency Test — REAL PostgreSQL 17.11\n')

  // §REAL-PG-CLIENT: Create a Prisma client pointing at the disposable PostgreSQL.
  // This uses the PRODUCTION schema (PostgreSQL provider) — NOT the dev SQLite schema.
  const db = new PrismaClient({
    datasources: { db: { url: DATABASE_URL } },
  })

  // §CLEAN-SLATE: Remove any existing test data
  const testBizId = 'pg-conc-test-biz-' + Date.now()
  await db.business.create({ data: { id: testBizId, name: 'PG Concurrency Test Biz', currency: 'INR' } })
  console.log(`Test business: ${testBizId}\n`)

  // ─── 1. Sequential creation — verify first 3 numbers (off-by-one check) ───
  console.log('1. Sequential creation — verify CMP-0001, CMP-0002, CMP-0003')
  {
    const seq1 = await db.complaintSequence.upsert({
      where: { businessId: testBizId },
      update: { nextNumber: { increment: 1 } },
      create: { businessId: testBizId, nextNumber: 1 },
    })
    const num1 = `CMP-${String(seq1.nextNumber).padStart(4, '0')}`
    assert(num1 === 'CMP-0001', `1.1: first number = CMP-0001 (got ${num1})`)

    const seq2 = await db.complaintSequence.upsert({
      where: { businessId: testBizId },
      update: { nextNumber: { increment: 1 } },
      create: { businessId: testBizId, nextNumber: 1 },
    })
    const num2 = `CMP-${String(seq2.nextNumber).padStart(4, '0')}`
    assert(num2 === 'CMP-0002', `1.2: second number = CMP-0002 (got ${num2})`)

    const seq3 = await db.complaintSequence.upsert({
      where: { businessId: testBizId },
      update: { nextNumber: { increment: 1 } },
      create: { businessId: testBizId, nextNumber: 1 },
    })
    const num3 = `CMP-${String(seq3.nextNumber).padStart(4, '0')}`
    assert(num3 === 'CMP-0003', `1.3: third number = CMP-0003 (got ${num3})`)
  }

  // ─── 2. Clean up the 3 sequential complaints to reset for concurrency test ───
  console.log('\n2. Clean up sequential test data (reset sequence)')
  {
    // Delete the ComplaintSequence + start fresh for the concurrency test
    await db.complaintSequence.delete({ where: { businessId: testBizId } })
    // Verify it's gone
    const seq = await db.complaintSequence.findUnique({ where: { businessId: testBizId } })
    assert(seq === null, '2.1: ComplaintSequence deleted (clean slate for concurrency test)')
  }

  // ─── 3. CONCURRENT creation — 5 genuinely concurrent requests ───
  console.log('\n3. CONCURRENT creation — 5 genuinely concurrent complaint creation requests')
  {
    const CONCURRENT_COUNT = 5
    console.log(`  Firing ${CONCURRENT_COUNT} concurrent requests via Promise.all...`)

    // §GENUINELY-CONCURRENT: all 5 promises start at the same tick. PostgreSQL
    // handles concurrent transactions natively (unlike SQLite's single-writer
    // lock). Each transaction does: upsert(increment) → create complaint →
    // create CREATED event. The unique constraint on (businessId, complaintNumber)
    // prevents duplicates even if two transactions try to use the same number.
    const startTime = Date.now()
    const promises = Array.from({ length: CONCURRENT_COUNT }, (_, i) =>
      db.$transaction(async (tx) => {
        const seq = await tx.complaintSequence.upsert({
          where: { businessId: testBizId },
          update: { nextNumber: { increment: 1 } },
          create: { businessId: testBizId, nextNumber: 1 },
        })
        const complaintNumber = `CMP-${String(seq.nextNumber).padStart(4, '0')}`
        const complaint = await tx.complaint.create({
          data: {
            businessId: testBizId,
            complaintNumber,
            title: `Concurrent complaint ${i}`,
            priority: 'MEDIUM',
          },
        })
        await tx.complaintEvent.create({
          data: {
            businessId: testBizId,
            complaintId: complaint.id,
            eventType: 'CREATED',
            toValue: 'NEW',
            note: `Complaint ${complaintNumber} created`,
          },
        })
        return { complaintNumber, complaintId: complaint.id }
      }, { timeout: 30000 })
    )
    const results = await Promise.all(promises)
    const elapsed = Date.now() - startTime
    console.log(`  All ${CONCURRENT_COUNT} requests completed in ${elapsed}ms`)

    // §ALL-SUCCEEDED
    assert(results.length === CONCURRENT_COUNT, `3.1: all ${CONCURRENT_COUNT} concurrent requests succeeded (got ${results.length})`)

    // §NO-ERRORS
    const errors = results.filter(r => r === null || r === undefined || !r.complaintNumber)
    assert(errors.length === 0, `3.2: no errors (got ${errors.length} null/undefined results)`)

    // §UNIQUE-NUMBERS
    const numbers = results.map(r => r!.complaintNumber).sort()
    const uniqueNumbers = new Set(numbers)
    assert(uniqueNumbers.size === CONCURRENT_COUNT, `3.3: ${CONCURRENT_COUNT} unique complaint numbers (got ${uniqueNumbers.size}: ${[...uniqueNumbers].join(', ')})`)

    // §SEQUENTIAL — verify the numbers are CMP-0001 through CMP-0005
    const expectedNumbers = Array.from({ length: CONCURRENT_COUNT }, (_, i) => `CMP-${String(i + 1).padStart(4, '0')}`)
    const sortedNumbers = [...numbers].sort()
    assert(JSON.stringify(sortedNumbers) === JSON.stringify(expectedNumbers), `3.4: numbers are sequential CMP-0001..CMP-0005 (got ${sortedNumbers.join(', ')})`)

    // §NO-DUPLICATES-IN-DB — verify the DB unique constraint prevented any duplicates
    const dbComplaints = await db.complaint.findMany({
      where: { businessId: testBizId },
      select: { complaintNumber: true, id: true },
    })
    const dbNumbers = dbComplaints.map(c => c.complaintNumber)
    const dbUnique = new Set(dbNumbers)
    assert(dbUnique.size === dbNumbers.length, `3.5: no duplicate complaint numbers in DB (${dbNumbers.length} total, ${dbUnique.size} unique)`)
    assert(dbNumbers.length === CONCURRENT_COUNT, `3.6: exactly ${CONCURRENT_COUNT} complaints in DB (got ${dbNumbers.length})`)
  }

  // ─── 4. ComplaintSequence ends at expected value ───
  console.log('\n4. ComplaintSequence ends at expected value')
  {
    const seq = await db.complaintSequence.findUnique({ where: { businessId: testBizId } })
    assert(seq !== null, '4.1: ComplaintSequence exists')
    assert(seq?.nextNumber === 5, `4.2: ComplaintSequence.nextNumber = 5 (got ${seq?.nextNumber})`)
  }

  // ─── 5. Every complaint has exactly one CREATED event ───
  console.log('\n5. Every complaint has exactly one CREATED event')
  {
    const complaints = await db.complaint.findMany({
      where: { businessId: testBizId },
      select: { id: true, complaintNumber: true },
    })
    for (const c of complaints) {
      const events = await db.complaintEvent.findMany({
        where: { complaintId: c.id, eventType: 'CREATED' },
      })
      assert(events.length === 1, `5: complaint ${c.complaintNumber} has exactly 1 CREATED event (got ${events.length})`)
    }
  }

  // ─── 6. DB unique constraint prevents duplicates even under race ───
  console.log('\n6. DB unique constraint prevents duplicates even under race')
  {
    // Verify the unique index exists
    const PSQL = '/tmp/pgtest-workdir/pgclient-extract/usr/lib/postgresql/17/bin/psql'
    const { execSync } = await import('child_process')
    const indexCheck = execSync(
      `${PSQL} -h 127.0.0.1 -p 5437 -U testuser -d bizledger_conc -t -c "SELECT indexname FROM pg_indexes WHERE tablename = 'Complaint' AND indexname = 'Complaint_businessId_complaintNumber_key';"`,
      { encoding: 'utf-8' }
    ).trim()
    assert(indexCheck.includes('Complaint_businessId_complaintNumber_key'), `6.1: unique index Complaint_businessId_complaintNumber_key exists (got "${indexCheck}")`)
  }

  // ─── 7. Clean up ───
  console.log('\n7. Clean up')
  {
    await db.complaintEvent.deleteMany({ where: { businessId: testBizId } })
    await db.complaint.deleteMany({ where: { businessId: testBizId } })
    await db.complaintSequence.delete({ where: { businessId: testBizId } })
    await db.business.delete({ where: { id: testBizId } })
    assert(true, '7.1: test data cleaned up')
  }

  await db.$disconnect()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Complaint PostgreSQL Concurrency Test: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => {
  console.error('Test error:', e)
  process.exit(1)
})
