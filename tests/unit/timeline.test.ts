/**
 * §TEST: Customer Timeline — REAL wrapper-handler execution against real DB.
 *
 * Run: bun run tests/unit/timeline.test.ts
 *
 * §COVERAGE (A-P):
 *   A. tenant isolation
 *   B. correct party filtering
 *   C. invoice event inclusion
 *   D. transaction event inclusion
 *   E. message event inclusion
 *   F. complaint event inclusion
 *   G. complaint-event inclusion
 *   H. behaviour-history inclusion
 *   I. note inclusion
 *   J. ordering newest -> oldest
 *   K. deterministic tie-breaking
 *   L. pagination without duplicate events
 *   M. pagination without skipped events
 *   N. empty timeline
 *   O. no mutation
 *   P. Decimal/date serialization
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

const TEST_BIZ_A = 'test-tl-A-' + Date.now()
const TEST_BIZ_B = 'test-tl-B-' + Date.now()
let partyA1: string, partyA2: string, partyB1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'TL Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'TL Biz B', currency: 'INR' } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL A1', type: 'customer' } })).id
  partyA2 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL A2', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'TL B1', type: 'customer' } })).id
}

async function cleanup() {
  try {
    await db.complaintEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaint.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.message.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.conversation.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.customerBehaviourHistory.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.customerBehaviour.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.partyNote.deleteMany({ where: { party: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.invoice.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.transaction.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

async function callGet(partyId: string, limit?: number, offset?: number) {
  const params = new URLSearchParams()
  if (limit) params.set('limit', String(limit))
  if (offset) params.set('offset', String(offset))
  const qs = params.toString()
  const url = qs ? `http://localhost/api/parties/${partyId}/timeline?${qs}` : `http://localhost/api/parties/${partyId}/timeline`
  return timelineRoute.GET(new NextRequest(url, { method: 'GET' }), { params: Promise.resolve({ id: partyId }) })
}

async function main() {
  console.log('\n🧪 Customer Timeline Tests\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'TL Biz A', currency: 'INR' }

  // ─── A. Tenant isolation ──────────────────────────────────────────
  console.log('A. Tenant isolation')
  {
    const res = await callGet(partyB1)
    assert(res.status === 404, `A1: cross-tenant GET → 404 (got ${res.status})`)
  }

  // ─── B. Correct party filtering ───────────────────────────────────
  console.log('\nB. Correct party filtering')
  {
    // Create an invoice for partyA1
    await db.invoice.create({ data: { businessId: TEST_BIZ_A, partyId: partyA1, invoiceNumber: 'TL-INV-1', type: 'sales', status: 'paid', subtotal: 100, grandTotal: 100, discountAmount: 0, gstAmount: 0 } })
    // Create a transaction for partyA2
    await db.transaction.create({ data: { businessId: TEST_BIZ_A, partyId: partyA2, type: 'credit', amount: 50, description: 'test' } })

    const res1 = await callGet(partyA1)
    const body1 = await res1.json()
    assert(body1.items.every((e: any) => e.partyId === partyA1), 'B1: all events belong to partyA1')

    const res2 = await callGet(partyA2)
    const body2 = await res2.json()
    assert(body2.items.every((e: any) => e.partyId === partyA2), 'B2: all events belong to partyA2')
    assert(body1.items.some((e: any) => e.type === 'invoice'), 'B3: partyA1 has invoice event')
    assert(body2.items.some((e: any) => e.type === 'transaction'), 'B4: partyA2 has transaction event')
    assert(!body1.items.some((e: any) => e.type === 'transaction'), 'B5: partyA1 does NOT have partyA2 transaction')
  }

  // ─── C. Invoice event inclusion ───────────────────────────────────
  console.log('\nC. Invoice event inclusion')
  {
    const res = await callGet(partyA1)
    const body = await res.json()
    const invEvent = body.items.find((e: any) => e.type === 'invoice')
    assert(invEvent !== undefined, 'C1: invoice event exists')
    assert(invEvent.entityType === 'invoice', 'C2: entityType=invoice')
    assert(invEvent.title.includes('TL-INV-1'), `C3: title includes invoice number (got "${invEvent.title}")`)
    assert(invEvent.metadata?.grandTotal === 100, `C4: metadata.grandTotal=100 (got ${invEvent.metadata?.grandTotal})`)
    assert(invEvent.metadata?.status === 'paid', `C5: metadata.status=paid (got ${invEvent.metadata?.status})`)
  }

  // ─── D. Transaction event inclusion ───────────────────────────────
  console.log('\nD. Transaction event inclusion')
  {
    const res = await callGet(partyA2)
    const body = await res.json()
    const txEvent = body.items.find((e: any) => e.type === 'transaction')
    assert(txEvent !== undefined, 'D1: transaction event exists')
    assert(txEvent.entityType === 'transaction', 'D2: entityType=transaction')
    assert(txEvent.metadata?.amount === 50, `D3: metadata.amount=50 (got ${txEvent.metadata?.amount})`)
    assert(txEvent.metadata?.type === 'credit', `D4: metadata.type=credit (got ${txEvent.metadata?.type})`)
  }

  // ─── E. Message event inclusion ───────────────────────────────────
  console.log('\nE. Message event inclusion')
  {
    // Create a conversation + message for partyA1
    const conv = await db.conversation.create({ data: { businessId: TEST_BIZ_A, partyId: partyA1, channel: 'in_app' } })
    await db.message.create({ data: { businessId: TEST_BIZ_A, conversationId: conv.id, partyId: partyA1, channel: 'in_app', direction: 'inbound', senderType: 'customer', body: 'Hello from customer' } })

    const res = await callGet(partyA1)
    const body = await res.json()
    const msgEvent = body.items.find((e: any) => e.type === 'message')
    assert(msgEvent !== undefined, 'E1: message event exists')
    assert(msgEvent.entityType === 'message', 'E2: entityType=message')
    assert(msgEvent.title.includes('in_app') || msgEvent.metadata?.channel === 'in_app', 'E3: channel in title or metadata')
    assert(msgEvent.description?.includes('Hello from customer'), `E4: description includes body (got "${msgEvent.description}")`)
  }

  // ─── F. Complaint event inclusion ─────────────────────────────────
  console.log('\nF. Complaint event inclusion')
  {
    // Create a complaint for partyA1
    const seq = await db.complaintSequence.upsert({ where: { businessId: TEST_BIZ_A }, update: { nextNumber: { increment: 1 } }, create: { businessId: TEST_BIZ_A, nextNumber: 1 } })
    const complaint = await db.complaint.create({ data: { businessId: TEST_BIZ_A, complaintNumber: `CMP-${String(seq.nextNumber).padStart(4, '0')}`, partyId: partyA1, sourceType: 'MANUAL', title: 'Test complaint', priority: 'HIGH', status: 'NEW' } })

    const res = await callGet(partyA1)
    const body = await res.json()
    const compEvent = body.items.find((e: any) => e.type === 'complaint')
    assert(compEvent !== undefined, 'F1: complaint event exists')
    assert(compEvent.entityType === 'complaint', 'F2: entityType=complaint')
    assert(compEvent.title.includes('CMP-'), `F3: title includes complaint number (got "${compEvent.title}")`)
    assert(compEvent.metadata?.status === 'NEW', `F4: metadata.status=NEW (got ${compEvent.metadata?.status})`)
    assert(compEvent.metadata?.priority === 'HIGH', `F5: metadata.priority=HIGH (got ${compEvent.metadata?.priority})`)
  }

  // ─── G. Complaint-event inclusion ─────────────────────────────────
  console.log('\nG. Complaint-event inclusion')
  {
    // Create a complaint event (status change) for the complaint above
    const complaint = await db.complaint.findFirst({ where: { businessId: TEST_BIZ_A, partyId: partyA1 }, orderBy: { createdAt: 'desc' } })
    if (complaint) {
      await db.complaintEvent.create({ data: { businessId: TEST_BIZ_A, complaintId: complaint.id, eventType: 'STATUS_CHANGE', fromValue: 'NEW', toValue: 'IN_PROGRESS', note: 'Started working on it' } })
    }

    const res = await callGet(partyA1)
    const body = await res.json()
    const ceEvent = body.items.find((e: any) => e.type === 'complaint_event')
    assert(ceEvent !== undefined, 'G1: complaint_event exists')
    assert(ceEvent.entityType === 'complaint_event', 'G2: entityType=complaint_event')
    assert(ceEvent.metadata?.eventType === 'STATUS_CHANGE', `G3: metadata.eventType=STATUS_CHANGE (got ${ceEvent.metadata?.eventType})`)
    assert(ceEvent.metadata?.fromValue === 'NEW', `G4: metadata.fromValue=NEW (got ${ceEvent.metadata?.fromValue})`)
    assert(ceEvent.metadata?.toValue === 'IN_PROGRESS', `G5: metadata.toValue=IN_PROGRESS (got ${ceEvent.metadata?.toValue})`)
  }

  // ─── H. Behaviour-history inclusion ───────────────────────────────
  console.log('\nH. Behaviour-history inclusion')
  {
    // Create behaviour + history for partyA1
    const beh = await db.customerBehaviour.create({ data: { businessId: TEST_BIZ_A, partyId: partyA1, rating: 'GOOD', tags: JSON.stringify(['Respectful']), notes: 'Test note' } })
    await db.customerBehaviourHistory.create({ data: { businessId: TEST_BIZ_A, partyId: partyA1, behaviourId: beh.id, rating: 'GOOD', tags: JSON.stringify(['Respectful']), notes: 'Test note', ratedBy: 'Staff' } })

    const res = await callGet(partyA1)
    const body = await res.json()
    const behEvent = body.items.find((e: any) => e.type === 'behaviour_change')
    assert(behEvent !== undefined, 'H1: behaviour_change event exists')
    assert(behEvent.entityType === 'behaviour_history', 'H2: entityType=behaviour_history')
    assert(behEvent.title.includes('GOOD'), `H3: title includes rating (got "${behEvent.title}")`)
    assert(behEvent.metadata?.rating === 'GOOD', `H4: metadata.rating=GOOD (got ${behEvent.metadata?.rating})`)
  }

  // ─── I. Note inclusion ────────────────────────────────────────────
  console.log('\nI. Note inclusion')
  {
    await db.partyNote.create({ data: { partyId: partyA1, type: 'call', content: 'Customer called about order', author: 'Staff' } })

    const res = await callGet(partyA1)
    const body = await res.json()
    const noteEvent = body.items.find((e: any) => e.type === 'note')
    assert(noteEvent !== undefined, 'I1: note event exists')
    assert(noteEvent.entityType === 'party_note', 'I2: entityType=party_note')
    assert(noteEvent.title.includes('call'), `I3: title includes note type (got "${noteEvent.title}")`)
    assert(noteEvent.description?.includes('Customer called'), `I4: description includes content (got "${noteEvent.description}")`)
    assert(noteEvent.metadata?.author === 'Staff', `I5: metadata.author=Staff (got ${noteEvent.metadata?.author})`)
  }

  // ─── J. Ordering newest -> oldest ─────────────────────────────────
  console.log('\nJ. Ordering newest -> oldest')
  {
    // Create events with distinct timestamps
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL Order Test', type: 'customer' } })).id
    // Create 3 invoices with increasing timestamps
    await new Promise(r => setTimeout(r, 10))
    await db.invoice.create({ data: { businessId: TEST_BIZ_A, partyId: party, invoiceNumber: 'TL-ORD-1', type: 'sales', status: 'paid', subtotal: 10, grandTotal: 10, discountAmount: 0, gstAmount: 0 } })
    await new Promise(r => setTimeout(r, 10))
    await db.invoice.create({ data: { businessId: TEST_BIZ_A, partyId: party, invoiceNumber: 'TL-ORD-2', type: 'sales', status: 'paid', subtotal: 20, grandTotal: 20, discountAmount: 0, gstAmount: 0 } })
    await new Promise(r => setTimeout(r, 10))
    await db.invoice.create({ data: { businessId: TEST_BIZ_A, partyId: party, invoiceNumber: 'TL-ORD-3', type: 'sales', status: 'paid', subtotal: 30, grandTotal: 30, discountAmount: 0, gstAmount: 0 } })

    const res = await callGet(party)
    const body = await res.json()
    const invEvents = body.items.filter((e: any) => e.type === 'invoice')
    assert(invEvents.length === 3, `J1: 3 invoice events (got ${invEvents.length})`)
    // Newest first: TL-ORD-3 should be first
    assert(invEvents[0].title.includes('TL-ORD-3'), `J2: newest first = TL-ORD-3 (got "${invEvents[0].title}")`)
    assert(invEvents[2].title.includes('TL-ORD-1'), `J3: oldest last = TL-ORD-1 (got "${invEvents[2].title}")`)
    // Verify timestamps are descending
    const timestamps = invEvents.map((e: any) => new Date(e.occurredAt).getTime())
    assert(timestamps[0] >= timestamps[1], 'J4: first timestamp >= second')
    assert(timestamps[1] >= timestamps[2], 'J5: second timestamp >= third')
  }

  // ─── K. Deterministic tie-breaking ────────────────────────────────
  console.log('\nK. Deterministic tie-breaking')
  {
    // Create multiple events with THE SAME timestamp by inserting in a batch
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL Tie Test', type: 'customer' } })).id
    const now = new Date()
    // Create 3 invoices with the same createdAt (using DB default)
    // They'll have slightly different timestamps, so we'll also create notes with exact same time
    await db.partyNote.create({ data: { partyId: party, type: 'general', content: 'Note A', author: 'Staff', createdAt: now } })
    await db.partyNote.create({ data: { partyId: party, type: 'general', content: 'Note B', author: 'Staff', createdAt: now } })
    await db.partyNote.create({ data: { partyId: party, type: 'general', content: 'Note C', author: 'Staff', createdAt: now } })

    const res = await callGet(party)
    const body = await res.json()
    const noteEvents = body.items.filter((e: any) => e.type === 'note')
    assert(noteEvents.length === 3, `K1: 3 note events (got ${noteEvents.length})`)
    // All should have the same timestamp
    const timestamps = noteEvents.map((e: any) => new Date(e.occurredAt).getTime())
    assert(timestamps[0] === timestamps[1], 'K2: first and second have same timestamp')
    assert(timestamps[1] === timestamps[2], 'K3: second and third have same timestamp')
    // The id DESC tie-breaker should produce a deterministic order
    // Since ids are "note:<noteId>", the order should be consistent
    const ids = noteEvents.map((e: any) => e.id)
    // Verify they're in descending id order (string comparison)
    assert(ids[0] > ids[1], `K4: id DESC tie-breaker — first id > second id`)
    assert(ids[1] > ids[2], `K5: id DESC tie-breaker — second id > third id`)

    // Verify ordering is STABLE — calling again produces the same order
    const res2 = await callGet(party)
    const body2 = await res2.json()
    const ids2 = body2.items.filter((e: any) => e.type === 'note').map((e: any) => e.id)
    assert(JSON.stringify(ids) === JSON.stringify(ids2), 'K6: stable ordering (same result on second call)')
  }

  // ─── L. Pagination without duplicate events ───────────────────────
  console.log('\nL. Pagination without duplicate events')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL Pag Test', type: 'customer' } })).id
    // Create 10 notes
    for (let i = 0; i < 10; i++) {
      await db.partyNote.create({ data: { partyId: party, type: 'general', content: `Note ${i}`, author: 'Staff' } })
      await new Promise(r => setTimeout(r, 5)) // ensure distinct timestamps
    }

    // Page 1: limit=5, offset=0
    const res1 = await callGet(party, 5, 0)
    const body1 = await res1.json()
    assert(body1.items.length === 5, `L1: page 1 has 5 items (got ${body1.items.length})`)
    assert(body1.hasMore === true, 'L2: hasMore=true')

    // Page 2: limit=5, offset=5
    const res2 = await callGet(party, 5, 5)
    const body2 = await res2.json()
    assert(body2.items.length === 5, `L3: page 2 has 5 items (got ${body2.items.length})`)
    assert(body2.hasMore === false, 'L4: hasMore=false')

    // Verify NO duplicates across pages
    const ids1 = new Set(body1.items.map((e: any) => e.id))
    const ids2 = body2.items.map((e: any) => e.id)
    const duplicates = ids2.filter((id: string) => ids1.has(id))
    assert(duplicates.length === 0, `L5: no duplicate events across pages (got ${duplicates.length} duplicates)`)
  }

  // ─── M. Pagination without skipped events ──────────────────────────
  console.log('\nM. Pagination without skipped events')
  {
    // Use the same party from L
    const party = (await db.party.findFirst({ where: { businessId: TEST_BIZ_A, name: 'TL Pag Test' } }))?.id
    if (party) {
      // Fetch ALL events (limit=100)
      const resAll = await callGet(party, 100, 0)
      const bodyAll = await resAll.json()
      const allIds = bodyAll.items.map((e: any) => e.id)

      // Fetch in 2 pages
      const res1 = await callGet(party, 5, 0)
      const res2 = await callGet(party, 5, 5)
      const body1 = await res1.json()
      const body2 = await res2.json()
      const pagedIds = [...body1.items.map((e: any) => e.id), ...body2.items.map((e: any) => e.id)]

      // Verify paged = first 10 of all
      assert(pagedIds.length === 10, `M1: 10 paged events (got ${pagedIds.length})`)
      assert(allIds.length >= 10, `M2: all events >= 10 (got ${allIds.length})`)
      // The first 10 of allIds should match pagedIds
      const first10 = allIds.slice(0, 10)
      assert(JSON.stringify(first10) === JSON.stringify(pagedIds), `M3: paged = first 10 of all (no skips)`)
    }
  }

  // ─── N. Empty timeline ─────────────────────────────────────────────
  console.log('\nN. Empty timeline')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'TL Empty', type: 'customer' } })).id
    const res = await callGet(party)
    const body = await res.json()
    assert(body.items.length === 0, `N1: 0 events (got ${body.items.length})`)
    assert(body.total === 0, `N2: total=0 (got ${body.total})`)
    assert(body.hasMore === false, 'N3: hasMore=false')
  }

  // ─── O. No mutation ────────────────────────────────────────────────
  console.log('\nO. No mutation')
  {
    const beforeInvCount = await db.invoice.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const beforeTxCount = await db.transaction.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const beforeNoteCount = await db.partyNote.count({ where: { partyId: partyA1 } })

    // Call timeline 5 times
    for (let i = 0; i < 5; i++) {
      await callGet(partyA1)
    }

    const afterInvCount = await db.invoice.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const afterTxCount = await db.transaction.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const afterNoteCount = await db.partyNote.count({ where: { partyId: partyA1 } })

    assert(beforeInvCount === afterInvCount, `O1: invoice count unchanged (${beforeInvCount} → ${afterInvCount})`)
    assert(beforeTxCount === afterTxCount, `O2: transaction count unchanged (${beforeTxCount} → ${afterTxCount})`)
    assert(beforeNoteCount === afterNoteCount, `O3: note count unchanged (${beforeNoteCount} → ${afterNoteCount})`)
  }

  // ─── P. Decimal/date serialization ─────────────────────────────────
  console.log('\nP. Decimal/date serialization')
  {
    const res = await callGet(partyA1)
    const body = await res.json()
    assert(body.items.length > 0, 'P1: has events')
    const first = body.items[0]
    assert(typeof first.occurredAt === 'string', `P2: occurredAt is string (got ${typeof first.occurredAt})`)
    // Verify it's a valid ISO date
    assert(!isNaN(new Date(first.occurredAt).getTime()), 'P3: occurredAt is valid ISO date')
    // Verify metadata numbers are JS numbers (not Decimal strings)
    if (first.metadata?.grandTotal !== undefined) {
      assert(typeof first.metadata.grandTotal === 'number', `P4: grandTotal is number (got ${typeof first.metadata.grandTotal})`)
    }
    if (first.metadata?.amount !== undefined) {
      assert(typeof first.metadata.amount === 'number', `P5: amount is number (got ${typeof first.metadata.amount})`)
    }
  }

  // ─── Q. Non-existent party → 404 ──────────────────────────────────
  console.log('\nQ. Non-existent party → 404')
  {
    const res = await callGet('nonexistent-party-id')
    assert(res.status === 404, `Q1: non-existent party → 404 (got ${res.status})`)
  }

  // ─── R. No business → 400 ─────────────────────────────────────────
  console.log('\nR. No business → 400')
  {
    const saved = currentBusinessOverride
    currentBusinessOverride = null
    try {
      const res = await callGet(partyA1)
      assert(res.status === 400, `R1: no business → 400 (got ${res.status})`)
    } finally {
      currentBusinessOverride = saved
    }
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Customer Timeline Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
