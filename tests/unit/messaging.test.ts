/**
 * §TEST: Unified Messaging — REAL wrapper-handler execution against real DB.
 *
 * Run: bun run tests/unit/messaging.test.ts
 *
 * §COVERAGE (A-N):
 *   A. conversation creation
 *   B. conversation retrieval
 *   C. channel separation
 *   D. same customer on multiple channels
 *   E. message creation
 *   F. chronological order
 *   G. unread behavior
 *   H. mark-read idempotency
 *   I. cross-tenant isolation
 *   J. external identity uniqueness (CustomerChannelIdentity)
 *   K. external message idempotency
 *   L. message → complaint
 *   M. invalid ownership
 *   N. in_app send/reply behavior
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

const conversationsRoute = await import('@/app/api/conversations/route')
const conversationItemRoute = await import('@/app/api/conversations/[id]/route')
const messagesRoute = await import('@/app/api/messages/route')
const messageReadRoute = await import('@/app/api/messages/[id]/read/route')
const messageComplaintRoute = await import('@/app/api/messages/[id]/create-complaint/route')

const TEST_BIZ_A = 'test-msg-biz-A-' + Date.now()
const TEST_BIZ_B = 'test-msg-biz-B-' + Date.now()
let partyA1: string, partyA2: string, partyB1: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'Biz B', currency: 'INR' } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'Party A1', type: 'customer', phone: '1111111111' } })).id
  partyA2 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'Party A2', type: 'customer', phone: '2222222222' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'Party B1', type: 'customer', phone: '3333333333' } })).id
}

async function cleanup() {
  try {
    await db.message.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.conversation.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.customerChannelIdentity.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaint.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.complaintSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.auditLog.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

function makeReq(url: string, method: string, body?: unknown): NextRequest {
  return new NextRequest(url, {
    method,
    body: body ? JSON.stringify(body) : undefined,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
  })
}

async function callConvList(partyId?: string) {
  const url = partyId ? `http://localhost/api/conversations?partyId=${partyId}` : 'http://localhost/api/conversations'
  return conversationsRoute.GET(makeReq(url, 'GET'))
}
async function callConvCreate(body: unknown) {
  return conversationsRoute.POST(makeReq('http://localhost/api/conversations', 'POST', body))
}
async function callConvGet(id: string) {
  return conversationItemRoute.GET(makeReq(`http://localhost/api/conversations/${id}`, 'GET'), { params: Promise.resolve({ id }) })
}
async function callMsgList(conversationId: string) {
  return messagesRoute.GET(makeReq(`http://localhost/api/messages?conversationId=${conversationId}`, 'GET'))
}
async function callMsgCreate(body: unknown) {
  return messagesRoute.POST(makeReq('http://localhost/api/messages', 'POST', body))
}
async function callMsgRead(id: string) {
  return messageReadRoute.POST(makeReq(`http://localhost/api/messages/${id}/read`, 'POST'), { params: Promise.resolve({ id }) })
}
async function callMsgComplaint(id: string, body?: unknown) {
  return messageComplaintRoute.POST(makeReq(`http://localhost/api/messages/${id}/create-complaint`, 'POST', body || {}), { params: Promise.resolve({ id }) })
}

async function main() {
  console.log('\n🧪 Unified Messaging Tests — REAL wrapper handlers + real DB\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' }

  let convId1: string | null = null
  let convId2: string | null = null
  let msgId1: string | null = null

  // ─── A. Conversation creation ──────────────────────────────────────
  console.log('A. Conversation creation (in_app)')
  {
    const res = await callConvCreate({ partyId: partyA1, channel: 'in_app' })
    assert(res.status === 201, `A1: status=201 (got ${res.status})`)
    const body = await res.json()
    assert(body.conversation.id !== undefined, 'A2: conversation has id')
    assert(body.conversation.channel === 'in_app', 'A3: channel=in_app')
    assert(body.conversation.partyId === partyA1, 'A4: partyId correct')
    assert(body.conversation.unreadCount === 0, 'A5: unreadCount=0')
    convId1 = body.conversation.id
  }

  // ─── B. Conversation retrieval ────────────────────────────────────
  console.log('\nB. Conversation retrieval')
  {
    const res = await callConvGet(convId1!)
    assert(res.status === 200, `B1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.conversation.id === convId1, 'B2: correct conversation id')
    assert(body.conversation.party.name === 'Party A1', 'B3: party name included')
  }

  // ─── C. Channel separation ────────────────────────────────────────
  console.log('\nC. Channel separation (same customer, different channels)')
  {
    // Create a whatsapp conversation for the same customer
    const res = await callConvCreate({ partyId: partyA1, channel: 'whatsapp', externalId: 'wa-thread-001' })
    assert(res.status === 201, `C1: whatsapp conversation created (got ${res.status})`)
    const body = await res.json()
    assert(body.conversation.channel === 'whatsapp', 'C2: channel=whatsapp')
    assert(body.conversation.externalId === 'wa-thread-001', 'C3: externalId correct')
    convId2 = body.conversation.id

    // Verify both conversations exist for the same customer
    const listRes = await callConvList(partyA1)
    const listBody = await listRes.json()
    assert(listBody.items.length === 2, `C4: 2 conversations for partyA1 (got ${listBody.items.length})`)
  }

  // ─── D. Same customer on multiple channels ────────────────────────
  console.log('\nD. Same customer on multiple channels')
  {
    // Try to create a SECOND in_app conversation for the same customer — should return existing
    const res = await callConvCreate({ partyId: partyA1, channel: 'in_app' })
    assert(res.status === 200, `D1: returns existing (got ${res.status})`)
    const body = await res.json()
    assert(body.conversation.id === convId1, 'D2: same conversation id (dedup)')
  }

  // ─── E. Message creation ──────────────────────────────────────────
  console.log('\nE. Message creation')
  {
    const res = await callMsgCreate({
      conversationId: convId1!,
      direction: 'inbound',
      senderType: 'customer',
      body: 'Hello, I have a question about my order.',
    })
    assert(res.status === 201, `E1: status=201 (got ${res.status})`)
    const body = await res.json()
    assert(body.message.body === 'Hello, I have a question about my order.', 'E2: body correct')
    assert(body.message.direction === 'inbound', 'E3: direction=inbound')
    assert(body.message.isRead === false, 'E4: isRead=false (inbound)')
    assert(body.message.channel === 'in_app', 'E5: channel denormalized from conversation')
    msgId1 = body.message.id
  }

  // ─── F. Chronological order ───────────────────────────────────────
  console.log('\nF. Chronological order')
  {
    // Create a second message (outbound reply)
    await callMsgCreate({
      conversationId: convId1!,
      direction: 'outbound',
      senderType: 'staff',
      body: 'Sure, how can I help?',
      senderId: 'Staff',
    })
    const res = await callMsgList(convId1!)
    const body = await res.json()
    assert(body.items.length === 2, `F1: 2 messages (got ${body.items.length})`)
    // Ascending order (oldest first)
    assert(body.items[0].body === 'Hello, I have a question about my order.', 'F2: first message is the inbound')
    assert(body.items[1].body === 'Sure, how can I help?', 'F3: second message is the outbound')
  }

  // ─── G. Unread behavior ───────────────────────────────────────────
  console.log('\nG. Unread behavior')
  {
    // Verify conversation unreadCount was incremented by the inbound message
    const convRes = await callConvGet(convId1!)
    const convBody = await convRes.json()
    assert(convBody.conversation.unreadCount === 1, `G1: unreadCount=1 (got ${convBody.conversation.unreadCount})`)
    assert(convBody.conversation.lastMessagePreview === 'Sure, how can I help?', 'G2: lastMessagePreview correct')
  }

  // ─── H. Mark-read idempotency ─────────────────────────────────────
  console.log('\nH. Mark-read idempotency')
  {
    // Mark the inbound message as read
    const res1 = await callMsgRead(msgId1!)
    assert(res1.status === 200, `H1: mark-read status=200 (got ${res1.status})`)
    const body1 = await res1.json()
    assert(body1.ok === true, 'H2: ok=true')
    assert(body1.alreadyRead === false, 'H3: alreadyRead=false (first read)')

    // Verify conversation unreadCount was decremented
    const convRes = await callConvGet(convId1!)
    const convBody = await convRes.json()
    assert(convBody.conversation.unreadCount === 0, `H4: unreadCount=0 after read (got ${convBody.conversation.unreadCount})`)

    // Mark-read again — should be idempotent
    const res2 = await callMsgRead(msgId1!)
    const body2 = await res2.json()
    assert(body2.alreadyRead === true, 'H5: alreadyRead=true (idempotent)')

    // Verify conversation unreadCount did NOT go negative
    const convRes2 = await callConvGet(convId1!)
    const convBody2 = await convRes2.json()
    assert(convBody2.conversation.unreadCount === 0, `H6: unreadCount still 0 (no negative, got ${convBody2.conversation.unreadCount})`)
  }

  // ─── I. Cross-tenant isolation ────────────────────────────────────
  console.log('\nI. Cross-tenant isolation')
  {
    // Switch to Biz B
    currentBusinessOverride = { id: TEST_BIZ_B, name: 'Biz B', currency: 'INR' }

    // Biz B tries to GET Biz A's conversation → 404
    const getRes = await callConvGet(convId1!)
    assert(getRes.status === 404, `I1: cross-tenant GET conversation → 404 (got ${getRes.status})`)

    // Biz B tries to GET messages in Biz A's conversation → 404
    const msgRes = await callMsgList(convId1!)
    assert(msgRes.status === 404, `I2: cross-tenant GET messages → 404 (got ${msgRes.status})`)

    // Biz B tries to POST message to Biz A's conversation → 404
    const postRes = await callMsgCreate({ conversationId: convId1!, direction: 'outbound', senderType: 'staff', body: 'sneaky' })
    assert(postRes.status === 404, `I3: cross-tenant POST message → 404 (got ${postRes.status})`)

    // Biz B tries to create-complaint from Biz A's message → 404
    const complaintRes = await callMsgComplaint(msgId1!)
    assert(complaintRes.status === 404, `I4: cross-tenant create-complaint → 404 (got ${complaintRes.status})`)

    // Switch back to Biz A
    currentBusinessOverride = { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' }
  }

  // ─── J. External identity uniqueness (CustomerChannelIdentity) ─────
  console.log('\nJ. External identity uniqueness')
  {
    // Create a channel identity for partyA1
    await db.customerChannelIdentity.create({
      data: {
        businessId: TEST_BIZ_A,
        partyId: partyA1,
        channel: 'whatsapp',
        externalUserId: '919876543210',
        phoneNumber: '+919876543210',
        displayName: 'Party A1 on WhatsApp',
      },
    })

    // Try to create the SAME identity for partyA2 — should fail (unique constraint)
    try {
      await db.customerChannelIdentity.create({
        data: {
          businessId: TEST_BIZ_A,
          partyId: partyA2,
          channel: 'whatsapp',
          externalUserId: '919876543210',
          phoneNumber: '+919876543210',
        },
      })
      assert(false, 'J1: should have failed (unique constraint) — but it did NOT')
    } catch (e: any) {
      assert(e?.code === 'P2002', `J1: unique constraint violated (P2002) — got ${e?.code}`)
    }

    // Same external ID for a DIFFERENT business — should succeed (tenant isolation)
    await db.customerChannelIdentity.create({
      data: {
        businessId: TEST_BIZ_B,
        partyId: partyB1,
        channel: 'whatsapp',
        externalUserId: '919876543210',
        phoneNumber: '+919876543210',
      },
    })
    assert(true, 'J2: same external ID for different business succeeds (tenant isolation)')

    // Verify resolution: lookup by (businessId, channel, externalUserId) → correct party
    const identity = await db.customerChannelIdentity.findUnique({
      where: { businessId_channel_externalUserId: { businessId: TEST_BIZ_A, channel: 'whatsapp', externalUserId: '919876543210' } },
    })
    assert(identity?.partyId === partyA1, 'J3: identity resolves to correct party (partyA1)')
  }

  // ─── K. External message idempotency ──────────────────────────────
  console.log('\nK. External message idempotency')
  {
    const externalMsgId = 'wa-msg-001-' + Date.now()
    // Create a message with externalMessageId
    const res1 = await callMsgCreate({
      conversationId: convId2!,
      direction: 'inbound',
      senderType: 'customer',
      body: 'WhatsApp message from customer',
      externalMessageId: externalMsgId,
    })
    assert(res1.status === 201, `K1: first create → 201 (got ${res1.status})`)
    const body1 = await res1.json()
    const firstMsgId = body1.message.id

    // Try to create the SAME message (webhook replay) — should return existing
    const res2 = await callMsgCreate({
      conversationId: convId2!,
      direction: 'inbound',
      senderType: 'customer',
      body: 'WhatsApp message from customer',
      externalMessageId: externalMsgId,
    })
    assert(res2.status === 200, `K2: replay → 200 (got ${res2.status})`)
    const body2 = await res2.json()
    assert(body2.message.id === firstMsgId, 'K3: same message id (idempotent — no duplicate)')
  }

  // ─── L. Message → Complaint ───────────────────────────────────────
  console.log('\nL. Message → Complaint')
  {
    const res = await callMsgComplaint(msgId1!, { title: 'Customer complaint from message', priority: 'HIGH' })
    assert(res.status === 201, `L1: create-complaint → 201 (got ${res.status})`)
    const body = await res.json()
    assert(body.complaint.sourceType === 'MESSAGE', 'L2: sourceType=MESSAGE')
    assert(body.complaint.sourceId === msgId1, 'L3: sourceId=message.id')
    assert(body.complaint.partyId === partyA1, 'L4: complaint.partyId = message.partyId')
    assert(body.complaint.complaintNumber.startsWith('CMP-'), `L5: complaintNumber starts with CMP- (got ${body.complaint.complaintNumber})`)

    // Verify the complaint has a CREATED event
    const events = await db.complaintEvent.findMany({ where: { complaintId: body.complaint.id } })
    assert(events.length === 1, `L6: 1 CREATED event (got ${events.length})`)
    assert(events[0].eventType === 'CREATED', 'L7: event type=CREATED')
  }

  // ─── M. Invalid ownership ─────────────────────────────────────────
  console.log('\nM. Invalid ownership')
  {
    // Create a conversation for partyA2
    const createRes = await callConvCreate({ partyId: partyA2, channel: 'in_app' })
    const otherConvId = (await createRes.json()).conversation.id

    // Try to POST a message to partyA2's conversation but with conversationId from partyA1
    // The API uses the conversation's partyId, not a body partyId — so this should work
    // but the message will be associated with the conversation's partyId (partyA2), not partyA1
    const res = await callMsgCreate({
      conversationId: otherConvId,
      direction: 'inbound',
      senderType: 'customer',
      body: 'test',
    })
    assert(res.status === 201, `M1: message created for correct conversation (got ${res.status})`)
    const body = await res.json()
    assert(body.message.partyId === partyA2, 'M2: message.partyId = conversation.partyId (not from body)')

    // Non-existent conversation → 404
    const res2 = await callMsgCreate({ conversationId: 'nonexistent', direction: 'inbound', senderType: 'customer', body: 'test' })
    assert(res2.status === 404, `M3: non-existent conversation → 404 (got ${res2.status})`)

    // Non-existent party → 404
    const res3 = await callConvCreate({ partyId: 'nonexistent', channel: 'in_app' })
    assert(res3.status === 404, `M4: non-existent party → 404 (got ${res3.status})`)
  }

  // ─── N. In-app send/reply behavior ────────────────────────────────
  console.log('\nN. In-app send/reply behavior')
  {
    // Send an outbound message (staff reply)
    const res = await callMsgCreate({
      conversationId: convId1!,
      direction: 'outbound',
      senderType: 'staff',
      body: 'Reply from staff',
      senderId: 'Staff Member',
    })
    assert(res.status === 201, `N1: outbound message created (got ${res.status})`)
    const body = await res.json()
    assert(body.message.isRead === true, 'N2: outbound is auto-read')
    assert(body.message.senderId === 'Staff Member', 'N3: senderId correct')

    // Send an internal note
    const res2 = await callMsgCreate({
      conversationId: convId1!,
      direction: 'internal_note',
      senderType: 'staff',
      body: 'Internal note about this customer',
      senderId: 'Staff Member',
    })
    assert(res2.status === 201, `N4: internal_note created (got ${res2.status})`)
    const body2 = await res2.json()
    assert(body2.message.isRead === true, 'N5: internal_note is auto-read')

    // Verify conversation unreadCount did NOT increase from outbound/note
    const convRes = await callConvGet(convId1!)
    const convBody = await convRes.json()
    assert(convBody.conversation.unreadCount === 0, `N6: unreadCount still 0 (outbound/note doesn't increment, got ${convBody.conversation.unreadCount})`)

    // Send another inbound — should increment unreadCount
    await callMsgCreate({
      conversationId: convId1!,
      direction: 'inbound',
      senderType: 'customer',
      body: 'Another question',
    })
    const convRes2 = await callConvGet(convId1!)
    const convBody2 = await convRes2.json()
    assert(convBody2.conversation.unreadCount === 1, `N7: unreadCount=1 after inbound (got ${convBody2.conversation.unreadCount})`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Unified Messaging Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
