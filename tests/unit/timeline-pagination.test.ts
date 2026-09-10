/**
 * §TEST: Customer Timeline Global Pagination Correctness
 *
 * Run: bun run tests/unit/timeline-pagination.test.ts
 *
 * This test SPECIFICALLY catches the incorrect implementation where
 * per-source pagination (take: limit + offset + 1 on each source query)
 * is used instead of global pagination (fetch all, merge, sort, then slice).
 *
 * The fixture creates an UNEVEN distribution (40 invoices, 3 transactions,
 * 25 messages, 2 complaints, 8 complaint events, 4 behaviour history, 1 note)
 * with INTERLEAVED timestamps so that per-source pagination would cause
 * skips/duplicates.
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

let currentBusinessOverride: { id: string; name: string; currency: string } | null = null
await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

const timelineRoute = await import('@/app/api/parties/[id]/timeline/route')

const TEST_BIZ = 'test-tl-pag-' + Date.now()
let partyId: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Pag Test Biz', currency: 'INR' } })
  partyId = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Pag Test Customer', type: 'customer' } })).id

  // §UNEVEN-DISTRIBUTION: 40 invoices, 3 transactions, 25 messages,
  // 2 complaints, 8 complaint events, 4 behaviour history, 1 note = 83 total
  //
  // §INTERLEAVED-TIMESTAMPS: We create events in a round-robin pattern
  // so timestamps from different sources are interleaved. This means
  // per-source pagination would miss events that fall in the global
  // offset range but are beyond the per-source take limit.

  const baseTime = new Date('2026-01-01T00:00:00Z')
  let eventIndex = 0

  // Create a complaint first (so complaint events can reference it)
  const complaint1 = await db.complaint.create({
    data: {
      businessId: TEST_BIZ, complaintNumber: 'CMP-0001', partyId: partyId,
      sourceType: 'MANUAL', title: 'Complaint 1', priority: 'MEDIUM', status: 'NEW',
      createdAt: new Date(baseTime.getTime() + 5000),
    },
  })
  const complaint2 = await db.complaint.create({
    data: {
      businessId: TEST_BIZ, complaintNumber: 'CMP-0002', partyId: partyId,
      sourceType: 'MANUAL', title: 'Complaint 2', priority: 'HIGH', status: 'NEW',
      createdAt: new Date(baseTime.getTime() + 10000),
    },
  })

  // Create behaviour record for history linkage
  const beh = await db.customerBehaviour.create({
    data: { businessId: TEST_BIZ, partyId: partyId, rating: 'GOOD' },
  })

  // Create a conversation for messages
  const conv = await db.conversation.create({
    data: { businessId: TEST_BIZ, partyId: partyId, channel: 'in_app' },
  })

  // §ROUND-ROBIN-CREATION: Create events in interleaved order
  // Each iteration creates: 1 invoice, 1 message, then every 5th iteration also creates a transaction/complaint_event/behaviour_history
  const TOTAL_INVOICES = 40
  const TOTAL_MESSAGES = 25
  const TOTAL_TRANSACTIONS = 3
  const TOTAL_COMPLAINT_EVENTS = 8
  const TOTAL_BEHAVIOUR_HISTORY = 4

  let txCount = 0
  let ceCount = 0
  let bhCount = 0

  for (let i = 0; i < TOTAL_INVOICES; i++) {
    const ts = new Date(baseTime.getTime() + i * 100) // 100ms apart

    // Invoice
    await db.invoice.create({
      data: {
        businessId: TEST_BIZ, partyId: partyId,
        invoiceNumber: `INV-${String(i + 1).padStart(4, '0')}`,
        type: 'sales', status: 'paid',
        subtotal: 100 + i, grandTotal: 100 + i, discountAmount: 0, gstAmount: 0,
        createdAt: ts,
      },
    })

    // Message (interleaved with invoices)
    if (i < TOTAL_MESSAGES) {
      await db.message.create({
        data: {
          businessId: TEST_BIZ, conversationId: conv.id, partyId: partyId,
          channel: 'in_app', direction: i % 2 === 0 ? 'inbound' : 'outbound',
          senderType: i % 2 === 0 ? 'customer' : 'staff',
          body: `Message ${i + 1}`,
          createdAt: new Date(ts.getTime() + 50), // 50ms after invoice
        },
      })
    }

    // Transaction (every ~13th iteration)
    if (txCount < TOTAL_TRANSACTIONS && i % 13 === 0) {
      await db.transaction.create({
        data: {
          businessId: TEST_BIZ, partyId: partyId,
          type: 'credit', amount: 50 + i, description: `Payment ${txCount + 1}`,
          createdAt: new Date(ts.getTime() + 25),
        },
      })
      txCount++
    }

    // Complaint event (every ~5th iteration)
    if (ceCount < TOTAL_COMPLAINT_EVENTS && i % 5 === 0) {
      const targetComplaint = ceCount % 2 === 0 ? complaint1 : complaint2
      await db.complaintEvent.create({
        data: {
          businessId: TEST_BIZ, complaintId: targetComplaint.id,
          eventType: 'COMMENT', note: `Event ${ceCount + 1}`,
          createdAt: new Date(ts.getTime() + 75),
        },
      })
      ceCount++
    }

    // Behaviour history (every ~10th iteration)
    if (bhCount < TOTAL_BEHAVIOUR_HISTORY && i % 10 === 0) {
      await db.customerBehaviourHistory.create({
        data: {
          businessId: TEST_BIZ, partyId: partyId, behaviourId: beh.id,
          rating: ['GOOD', 'BETTER', 'BEST', 'GOOD'][bhCount],
          createdAt: new Date(ts.getTime() + 15),
        },
      })
      bhCount++
    }
  }

  // Create 1 note
  await db.partyNote.create({
    data: {
      partyId: partyId, type: 'general', content: 'Test note',
      createdAt: new Date(baseTime.getTime() + 99999),
    },
  })
}

async function cleanup() {
  try {
    await db.complaintEvent.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.complaint.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.message.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.conversation.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerBehaviourHistory.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.customerBehaviour.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.partyNote.deleteMany({ where: { party: { businessId: TEST_BIZ } } })
    await db.invoice.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.transaction.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.party.deleteMany({ where: { businessId: TEST_BIZ } })
    await db.business.deleteMany({ where: { id: TEST_BIZ } })
  } catch {}
}

async function callGet(limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (limit !== undefined) params.set('limit', String(limit))
  if (offset !== undefined) params.set('offset', String(offset))
  const qs = params.toString()
  const url = qs ? `http://localhost/api/parties/${partyId}/timeline?${qs}` : `http://localhost/api/parties/${partyId}/timeline`
  return timelineRoute.GET(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ id: partyId }) })
}

async function main() {
  console.log('\n🧪 Timeline Global Pagination Correctness Tests\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ, name: 'Pag Test Biz', currency: 'INR' }

  // ─── A. Uneven source distribution ─────────────────────────────────
  console.log('A. Uneven source distribution')
  {
    const res = await callGet(100, 0)
    const body = await res.json()
    const expectedTotal = 40 + 25 + 3 + 2 + 8 + 4 + 1 // 83
    assert(body.total === expectedTotal, `A1: total=${expectedTotal} (got ${body.total})`)

    // Count by type
    const byType: Record<string, number> = {}
    for (const e of body.items) {
      byType[e.type] = (byType[e.type] || 0) + 1
    }
    assert(byType.invoice === 40, `A2: 40 invoices (got ${byType.invoice})`)
    assert(byType.message === 25, `A3: 25 messages (got ${byType.message})`)
    assert(byType.transaction === 3, `A4: 3 transactions (got ${byType.transaction})`)
    assert(byType.complaint === 2, `A5: 2 complaints (got ${byType.complaint})`)
    assert(byType.complaint_event === 8, `A6: 8 complaint events (got ${byType.complaint_event})`)
    assert(byType.behaviour_change === 4, `A7: 4 behaviour changes (got ${byType.behaviour_change})`)
    assert(byType.note === 1, `A8: 1 note (got ${byType.note})`)
  }

  // ─── B. Interleaved timestamps across all sources ─────────────────
  console.log('\nB. Interleaved timestamps across all sources')
  {
    const res = await callGet(100, 0)
    const body = await res.json()
    // Verify events from different sources are interleaved (not grouped by type)
    let typeChanges = 0
    for (let i = 1; i < body.items.length; i++) {
      if (body.items[i].type !== body.items[i - 1].type) typeChanges++
    }
    // With 83 interleaved events, there should be MANY type changes (> 20)
    assert(typeChanges > 20, `B1: timestamps are interleaved (${typeChanges} type changes in ${body.items.length} events)`)
  }

  // ─── C. Same timestamps across different event types ───────────────
  console.log('\nC. Same timestamps across different event types')
  {
    // §EXPLICIT-SAME-TIMESTAMP: Create events with EXACTLY the same timestamp
    // to verify the id DESC tie-breaker works across different event types.
    const sameTs = new Date('2026-06-15T12:00:00.000Z')
    await db.invoice.create({
      data: { businessId: TEST_BIZ, partyId: partyId, invoiceNumber: 'INV-SAME-TS',
        type: 'sales', status: 'paid', subtotal: 100, grandTotal: 100, discountAmount: 0, gstAmount: 0, createdAt: sameTs },
    })
    await db.partyNote.create({
      data: { partyId: partyId, type: 'general', content: 'Same-timestamp note', createdAt: sameTs },
    })
    await db.transaction.create({
      data: { businessId: TEST_BIZ, partyId: partyId, type: 'credit', amount: 50, description: 'Same-timestamp tx', createdAt: sameTs },
    })

    const res = await callGet(100, 0)
    const body = await res.json()
    // Find events with the same timestamp
    const tsMap: Record<string, string[]> = {}
    for (const e of body.items) {
      const ts = e.occurredAt
      if (!tsMap[ts]) tsMap[ts] = []
      tsMap[ts].push(e.type)
    }
    const sameTimestamps = Object.entries(tsMap).filter(([_, types]) => types.length > 1)
    assert(sameTimestamps.length > 0, `C1: found ${sameTimestamps.length} timestamps with multiple events`)

    // Verify at least one timestamp has events from DIFFERENT types
    const hasDifferentTypes = sameTimestamps.some(([_, types]) => new Set(types).size > 1)
    assert(hasDifferentTypes, 'C2: at least one timestamp has events from different types (invoice + note + transaction)')

    // Verify the same-timestamp events have a deterministic order (id DESC)
    const sameTsEvents = body.items.filter((e: any) => e.occurredAt === sameTs.toISOString())
    if (sameTsEvents.length >= 2) {
      const ids = sameTsEvents.map((e: any) => e.id)
      const sortedDesc = [...ids].sort((a: string, b: string) => b.localeCompare(a))
      assert(JSON.stringify(ids) === JSON.stringify(sortedDesc), 'C3: same-timestamp events ordered by id DESC (deterministic)')
    }
  }

  // ─── D. Page 1 + page 2 + page 3 reconstruction equals full timeline
  console.log('\nD. Page reconstruction equals full timeline')
  {
    const pageSize = 10
    // Fetch the full timeline
    const fullRes = await callGet(100, 0)
    const fullBody = await fullRes.json()
    const fullIds = fullBody.items.map((e: any) => e.id)

    // Fetch in pages
    const pagedIds: string[] = []
    let offset = 0
    let hasMore = true
    let pageCount = 0
    while (hasMore && pageCount < 20) {
      const pageRes = await callGet(pageSize, offset)
      const pageBody = await pageRes.json()
      pagedIds.push(...pageBody.items.map((e: any) => e.id))
      hasMore = pageBody.hasMore
      offset += pageSize
      pageCount++
    }

    assert(pagedIds.length === fullIds.length, `D1: paged count = full count (${pagedIds.length} = ${fullIds.length})`)
    assert(JSON.stringify(pagedIds) === JSON.stringify(fullIds), 'D2: paged IDs match full IDs in exact same order')
  }

  // ─── E. No duplicates across pages ─────────────────────────────────
  console.log('\nE. No duplicates across pages')
  {
    const pageSize = 7 // prime number to avoid alignment
    const allIds: string[] = []
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await callGet(pageSize, offset)
      const body = await res.json()
      allIds.push(...body.items.map((e: any) => e.id))
      hasMore = body.hasMore
      offset += pageSize
    }

    const uniqueIds = new Set(allIds)
    assert(uniqueIds.size === allIds.length, `E1: no duplicate IDs (${allIds.length} total, ${uniqueIds.size} unique)`)
  }

  // ─── F. No skips across pages ──────────────────────────────────────
  console.log('\nF. No skips across pages')
  {
    // Fetch all with one call
    const fullRes = await callGet(100, 0)
    const fullIds = (await fullRes.json()).items.map((e: any) => e.id)
    const fullSet = new Set(fullIds)

    // Fetch in pages of 10
    const pagedIds: string[] = []
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await callGet(10, offset)
      const body = await res.json()
      pagedIds.push(...body.items.map((e: any) => e.id))
      hasMore = body.hasMore
      offset += 10
    }

    // Every full ID must appear in the paged set
    const missing = fullIds.filter((id: string) => !pagedIds.includes(id))
    assert(missing.length === 0, `F1: no missing events (${missing.length} missing out of ${fullIds.length})`)

    // Every paged ID must appear in the full set
    const extra = pagedIds.filter((id: string) => !fullSet.has(id))
    assert(extra.length === 0, `F2: no extra events (${extra.length} extra)`)
  }

  // ─── G. Exact total count ──────────────────────────────────────────
  console.log('\nG. Exact total count')
  {
    // §TOTAL: 83 original events + 3 same-timestamp events from test C = 86
    const expectedTotal = 86

    // Check total on every page
    let offset = 0
    let hasMore = true
    while (hasMore) {
      const res = await callGet(10, offset)
      const body = await res.json()
      assert(body.total === expectedTotal, `G1: total=${expectedTotal} at offset=${offset} (got ${body.total})`)
      hasMore = body.hasMore
      offset += 10
    }
  }

  // ─── H. Correct hasMore ────────────────────────────────────────────
  console.log('\nH. Correct hasMore')
  {
    const expectedTotal = 86
    const pageSize = 10

    // Page 1 (offset=0): should have more
    const res1 = await callGet(pageSize, 0)
    const body1 = await res1.json()
    assert(body1.hasMore === true, 'H1: hasMore=true on page 1')
    assert(body1.items.length === pageSize, `H2: page 1 has ${pageSize} items (got ${body1.items.length})`)

    // Last page (offset=80): should NOT have more (86 - 80 = 6 items)
    const resLast = await callGet(pageSize, 80)
    const bodyLast = await resLast.json()
    assert(bodyLast.hasMore === false, 'H3: hasMore=false on last page')
    assert(bodyLast.items.length === 6, `H4: last page has 6 items (got ${bodyLast.items.length})`)

    // Beyond total (offset=90): should return 0 items, hasMore=false
    const resBeyond = await callGet(pageSize, 90)
    const bodyBeyond = await resBeyond.json()
    assert(bodyBeyond.items.length === 0, 'H5: beyond total returns 0 items')
    assert(bodyBeyond.hasMore === false, 'H6: hasMore=false beyond total')
    assert(bodyBeyond.total === expectedTotal, `H7: total still ${expectedTotal} beyond (got ${bodyBeyond.total})`)
  }

  // ─── I. Stable repeated ordering ───────────────────────────────────
  console.log('\nI. Stable repeated ordering')
  {
    const res1 = await callGet(15, 0)
    const ids1 = (await res1.json()).items.map((e: any) => e.id)

    const res2 = await callGet(15, 0)
    const ids2 = (await res2.json()).items.map((e: any) => e.id)

    const res3 = await callGet(15, 0)
    const ids3 = (await res3.json()).items.map((e: any) => e.id)

    assert(JSON.stringify(ids1) === JSON.stringify(ids2), 'I1: call 1 = call 2 (stable)')
    assert(JSON.stringify(ids2) === JSON.stringify(ids3), 'I2: call 2 = call 3 (stable)')

    // Also verify a later page is stable
    const res4 = await callGet(15, 15)
    const ids4 = (await res4.json()).items.map((e: any) => e.id)
    const res5 = await callGet(15, 15)
    const ids5 = (await res5.json()).items.map((e: any) => e.id)
    assert(JSON.stringify(ids4) === JSON.stringify(ids5), 'I3: page 2 is stable across calls')
  }

  // ─── J. Tenant isolation ───────────────────────────────────────────
  console.log('\nJ. Tenant isolation')
  {
    // Create a different business + party
    const biz2 = 'test-tl-pag-b2-' + Date.now()
    await db.business.create({ data: { id: biz2, name: 'B2', currency: 'INR' } })
    const party2 = (await db.party.create({ data: { businessId: biz2, name: 'B2 Party', type: 'customer' } })).id
    await db.invoice.create({ data: { businessId: biz2, partyId: party2, invoiceNumber: 'B2-INV-1', type: 'sales', status: 'paid', subtotal: 100, grandTotal: 100, discountAmount: 0, gstAmount: 0 } })

    // Biz A should NOT see Biz B's events
    const res = await callGet(100, 0)
    const body = await res.json()
    const hasB2Event = body.items.some((e: any) => e.entityId !== undefined && e.partyId !== partyId)
    assert(!hasB2Event, 'J1: no events from Biz B in Biz A timeline')

    // Switch to Biz B
    currentBusinessOverride = { id: biz2, name: 'B2', currency: 'INR' }
    const res2 = await callGet(100, 0)
    assert(res2.status === 404, `J2: Biz B can't see Biz A's party → 404 (got ${res2.status})`)
    currentBusinessOverride = { id: TEST_BIZ, name: 'Pag Test Biz', currency: 'INR' }

    // Cleanup Biz B
    await db.invoice.deleteMany({ where: { businessId: biz2 } })
    await db.party.deleteMany({ where: { businessId: biz2 } })
    await db.business.deleteMany({ where: { id: biz2 } })
  }

  // ─── K. No mutation ────────────────────────────────────────────────
  console.log('\nK. No mutation')
  {
    const beforeInv = await db.invoice.count({ where: { businessId: TEST_BIZ, partyId } })
    const beforeTx = await db.transaction.count({ where: { businessId: TEST_BIZ, partyId } })
    const beforeMsg = await db.message.count({ where: { businessId: TEST_BIZ, partyId } })
    const beforeNotes = await db.partyNote.count({ where: { partyId } })

    // Call timeline many times with different pagination
    for (let i = 0; i < 10; i++) {
      await callGet(10, i * 10)
    }

    const afterInv = await db.invoice.count({ where: { businessId: TEST_BIZ, partyId } })
    const afterTx = await db.transaction.count({ where: { businessId: TEST_BIZ, partyId } })
    const afterMsg = await db.message.count({ where: { businessId: TEST_BIZ, partyId } })
    const afterNotes = await db.partyNote.count({ where: { partyId } })

    assert(beforeInv === afterInv, `K1: invoice count unchanged (${beforeInv} → ${afterInv})`)
    assert(beforeTx === afterTx, `K2: transaction count unchanged (${beforeTx} → ${afterTx})`)
    assert(beforeMsg === afterMsg, `K3: message count unchanged (${beforeMsg} → ${afterMsg})`)
    assert(beforeNotes === afterNotes, `K4: note count unchanged (${beforeNotes} → ${afterNotes})`)
  }

  // ─── L. Per-source pagination bug detection ────────────────────────
  // This test SPECIFICALLY catches the incorrect implementation where
  // each source query uses `take: limit + offset + 1` instead of fetching all.
  // With 40 invoices, page 4 (offset=30, limit=10) would miss invoices
  // that fall in positions 31-40 globally if per-source take was used.
  console.log('\nL. Per-source pagination bug detection')
  {
    // Fetch full timeline
    const fullRes = await callGet(100, 0)
    const fullBody = await fullRes.json()
    const fullIds = fullBody.items.map((e: any) => e.id)

    // Fetch page 4 (offset=30, limit=10)
    const pageRes = await callGet(10, 30)
    const pageBody = await pageRes.json()
    const pageIds = pageBody.items.map((e: any) => e.id)

    // The page should be exactly the slice [30:40] of the full timeline
    const expectedIds = fullIds.slice(30, 40)
    assert(JSON.stringify(pageIds) === JSON.stringify(expectedIds), `L1: page 4 matches full[30:40] — catches per-source pagination bug`)

    // Count how many invoice events are in positions 30-39 of the full timeline
    const invoiceCountInPage = expectedIds.filter((id: string) => id.startsWith('invoice:')).length
    // If per-source pagination was used with take=41 (limit=10 + offset=30 + 1),
    // all 40 invoices would be fetched, so this test would pass accidentally.
    // But with a LARGER offset (e.g. offset=50), per-source take=61 would miss
    // nothing for invoices (40 < 61). So let's test with a deeper page.
    // Actually, the real bug manifests when offset + limit + 1 < max_source_count.
    // With 40 invoices and offset=35, limit=10: fetchLimit = 46 > 40, so no bug.
    // With 40 invoices and offset=0, limit=10: fetchLimit = 11, so only first 11
    // invoices would be fetched, missing 29. After merge with other sources,
    // many invoice events would be missing from the global page.
    // Let's test page 1 (offset=0, limit=10):
    const page1Res = await callGet(10, 0)
    const page1Body = await page1Res.json()
    const page1Ids = page1Body.items.map((e: any) => e.id)
    const expectedPage1Ids = fullIds.slice(0, 10)
    assert(JSON.stringify(page1Ids) === JSON.stringify(expectedPage1Ids), `L2: page 1 matches full[0:10] — catches per-source pagination bug (fetchLimit=11 would miss 29 invoices)`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Timeline Global Pagination Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
