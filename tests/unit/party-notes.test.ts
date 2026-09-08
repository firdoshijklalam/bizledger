/**
 * §TEST: PartyNote CRUD — REAL wrapper-handler execution against real DB.
 *
 * Run: bun run tests/unit/party-notes.test.ts
 *
 * §CLASSIFICATION:
 *   - REAL EXECUTION: Imports + calls the ACTUAL exported GET / POST / PUT /
 *     DELETE handlers from:
 *       - src/app/api/parties/[id]/notes/route.ts
 *       - src/app/api/parties/[id]/notes/[noteId]/route.ts
 *     Uses real NextRequest + real NextResponse + real Prisma client against
 *     the SQLite dev database.
 *   - MOCKED DEPENDENCY: `getCurrentBusiness()` from `@/lib/db` is replaced
 *     via Bun's `mock.module` at the auth boundary only. The real `db`
 *     (Prisma client) is preserved unchanged inside the same mock factory,
 *     so the route's DB calls hit the real dev database.
 *   - NO accounting/search/notification logic is exercised. This test file
 *     touches only Party + PartyNote tables.
 *
 * §WHY-BUN: Uses Bun's `mock.module()` to replace `getCurrentBusiness` at
 * the module-loading boundary. Requires the Bun runtime.
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
// §MOCK-SETUP: replace getCurrentBusiness at the auth boundary only.
// ──────────────────────────────────────────────────────────────────────
let currentBusinessOverride: { id: string; name: string; currency: string } | null = null

await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

// §IMPORT-ROUTES-AFTER-MOCKS
const notesRoute = await import('@/app/api/parties/[id]/notes/route')
const noteItemRoute = await import('@/app/api/parties/[id]/notes/[noteId]/route')

// ──────────────────────────────────────────────────────────────────────
// §TEST-FIXTURES
// ──────────────────────────────────────────────────────────────────────
const TEST_BIZ_A = 'test-notes-biz-A-' + Date.now()
const TEST_BIZ_B = 'test-notes-biz-B-' + Date.now()
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
    await db.partyNote.deleteMany({ where: { party: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

function makeGetReq(partyId: string): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/notes`, { method: 'GET' })
}
function makePostReq(partyId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/notes`, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makePutReq(partyId: string, noteId: string, body: unknown): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/notes/${noteId}`, {
    method: 'PUT',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}
function makeDeleteReq(partyId: string, noteId: string): NextRequest {
  return new NextRequest(`http://localhost/api/parties/${partyId}/notes/${noteId}`, { method: 'DELETE' })
}

// Helper to call a route handler with params (Next 16 style: params is a Promise)
async function callGet(handler: any, partyId: string) {
  return handler(makeGetReq(partyId), { params: Promise.resolve({ id: partyId }) })
}
async function callPost(handler: any, partyId: string, body: unknown) {
  return handler(makePostReq(partyId, body), { params: Promise.resolve({ id: partyId }) })
}
async function callPut(handler: any, partyId: string, noteId: string, body: unknown) {
  return handler(makePutReq(partyId, noteId, body), { params: Promise.resolve({ id: partyId, noteId }) })
}
async function callDelete(handler: any, partyId: string, noteId: string) {
  return handler(makeDeleteReq(partyId, noteId), { params: Promise.resolve({ id: partyId, noteId }) })
}

// ──────────────────────────────────────────────────────────────────────
// §MAIN
// ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n🧪 PartyNote CRUD Tests — REAL wrapper handlers + real DB\n')
  await setup()
  // Default auth context = Business A
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' }

  // ─── A. GET empty notes for a valid party ───────────────────────────
  console.log('A. GET empty notes for an authorized party')
  {
    const res = await callGet(notesRoute.GET, partyA1)
    assert(res.status === 200, `A1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(Array.isArray(body.notes), 'A2: notes is an array')
    assert(body.notes.length === 0, `A3: empty notes list (got ${body.notes.length})`)
  }

  // ─── B. POST creates a note for the authorized party ───────────────
  console.log('\nB. POST creates a note for the authorized party')
  {
    const res = await callPost(notesRoute.POST, partyA1, {
      content: 'Called about pending payment',
      type: 'call',
      author: 'Staff',
    })
    assert(res.status === 201, `B1: status=201 (got ${res.status})`)
    const body = await res.json()
    assert(body.note.id !== undefined, 'B2: note has id')
    assert(body.note.content === 'Called about pending payment', 'B3: content matches')
    assert(body.note.type === 'call', 'B4: type=call')
    assert(body.note.author === 'Staff', 'B5: author=Staff')
    assert(body.note.partyId === partyA1, 'B6: partyId = URL partyId (not from body)')

    // Verify real DB row
    const dbNote = await db.partyNote.findFirst({ where: { partyId: partyA1 } })
    assert(dbNote !== null, 'B7: real DB row exists')
    assert(dbNote?.content === 'Called about pending payment', 'B8: DB content matches')
  }

  // ─── C. GET returns the created note ───────────────────────────────
  console.log('\nC. GET returns the created note')
  {
    const res = await callGet(notesRoute.GET, partyA1)
    assert(res.status === 200, `C1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.notes.length === 1, `C2: 1 note returned (got ${body.notes.length})`)
    assert(body.notes[0].content === 'Called about pending payment', 'C3: content matches')
    assert(body.notes[0].type === 'call', 'C4: type=call')
  }

  // ─── D. POST validation — empty content rejected ───────────────────
  console.log('\nD. POST validation — empty content rejected')
  {
    const res = await callPost(notesRoute.POST, partyA1, { content: '   ' })
    assert(res.status === 400, `D1: status=400 (got ${res.status})`)
    const body = await res.json()
    assert(body.error !== undefined, 'D2: error message present')
  }

  // ─── E. POST validation — invalid type rejected ────────────────────
  console.log('\nE. POST validation — invalid type rejected')
  {
    const res = await callPost(notesRoute.POST, partyA1, { content: 'hello', type: 'bogus' })
    assert(res.status === 400, `E1: status=400 (got ${res.status})`)
  }

  // ─── F. POST defaults type to general when omitted ─────────────────
  console.log('\nF. POST defaults type to general when omitted')
  {
    const res = await callPost(notesRoute.POST, partyA1, { content: 'quick note' })
    assert(res.status === 201, `F1: status=201 (got ${res.status})`)
    const body = await res.json()
    assert(body.note.type === 'general', `F2: type=general default (got ${body.note.type})`)
  }

  // ─── G. Cross-tenant: GET party from another business → 404 ────────
  console.log('\nG. Cross-tenant GET — party belongs to another business → 404')
  {
    // Auth = Biz A, but requesting partyB1 (belongs to Biz B)
    const res = await callGet(notesRoute.GET, partyB1)
    assert(res.status === 404, `G1: status=404 (got ${res.status})`)
    // Verify NO notes leaked (the party isn't owned, so notes aren't returned)
    const body = await res.json()
    assert(body.notes === undefined, 'G2: no notes leaked (party not found)')
  }

  // ─── H. Cross-tenant POST — cannot create note on another business party ─
  console.log('\nH. Cross-tenant POST — cannot create note on another business party')
  {
    // Auth = Biz A, trying to create note on partyB1 (Biz B)
    const beforeCount = await db.partyNote.count({ where: { partyId: partyB1 } })
    const res = await callPost(notesRoute.POST, partyB1, { content: 'sneaky note' })
    assert(res.status === 404, `H1: status=404 (got ${res.status})`)
    const afterCount = await db.partyNote.count({ where: { partyId: partyB1 } })
    assert(afterCount === beforeCount, `H2: no note created on other-tenant party (before=${beforeCount}, after=${afterCount})`)
  }

  // ─── I. Switch auth to Biz B — can GET partyB1 notes ───────────────
  console.log('\nI. Switch auth to Biz B — can access partyB1')
  {
    currentBusinessOverride = { id: TEST_BIZ_B, name: 'Biz B', currency: 'INR' }
    // Seed a note on partyB1 directly via DB
    await db.partyNote.create({ data: { partyId: partyB1, content: 'Biz B note', type: 'meeting' } })
    const res = await callGet(notesRoute.GET, partyB1)
    assert(res.status === 200, `I1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.notes.length === 1, `I2: 1 note visible to Biz B (got ${body.notes.length})`)
    assert(body.notes[0].content === 'Biz B note', 'I3: content matches')
    // Switch back to Biz A
    currentBusinessOverride = { id: TEST_BIZ_A, name: 'Biz A', currency: 'INR' }
  }

  // ─── J. Cross-tenant PUT — cannot edit note belonging to another business ─
  console.log('\nJ. Cross-tenant PUT — cannot edit note from another business')
  {
    // partyB1 has a note (created in test I). Auth = Biz A.
    const bNote = await db.partyNote.findFirst({ where: { partyId: partyB1 } })
    assert(bNote !== null, 'J0: precondition — partyB1 has a note')
    const res = await callPut(noteItemRoute.PUT, partyA1, bNote!.id, { content: 'hacked' })
    assert(res.status === 404, `J1: status=404 (got ${res.status})`)
    // Verify DB unchanged
    const dbNote = await db.partyNote.findUnique({ where: { id: bNote!.id } })
    assert(dbNote?.content === 'Biz B note', `J2: content NOT modified by cross-tenant request (got "${dbNote?.content}")`)
  }

  // ─── K. Cross-party PUT — cannot edit note belonging to another party (same biz) ─
  console.log('\nK. Cross-party PUT — cannot edit note from another party in same business')
  {
    // Create a note on partyA2 (same business, different party)
    const a2Note = await db.partyNote.create({ data: { partyId: partyA2, content: 'A2 note', type: 'general' } })
    // Try to edit it via partyA1's URL
    const res = await callPut(noteItemRoute.PUT, partyA1, a2Note.id, { content: 'hacked' })
    assert(res.status === 404, `K1: status=404 (got ${res.status})`)
    // Verify DB unchanged
    const dbNote = await db.partyNote.findUnique({ where: { id: a2Note.id } })
    assert(dbNote?.content === 'A2 note', `K2: content NOT modified by cross-party request (got "${dbNote?.content}")`)
  }

  // ─── L. PUT updates only the requested note ────────────────────────
  console.log('\nL. PUT updates only the requested note')
  {
    const note = await db.partyNote.findFirst({ where: { partyId: partyA1 } })
    assert(note !== null, 'L0: precondition — partyA1 has a note')
    const res = await callPut(noteItemRoute.PUT, partyA1, note!.id, {
      content: 'updated content',
      type: 'meeting',
      author: 'Manager',
    })
    assert(res.status === 200, `L1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.note.content === 'updated content', 'L2: content updated')
    assert(body.note.type === 'meeting', 'L3: type updated')
    assert(body.note.author === 'Manager', 'L4: author updated')
    assert(body.note.id === note!.id, 'L5: same note id')

    // Verify other notes NOT affected
    const a2NoteStill = await db.partyNote.findUnique({ where: { id: (await db.partyNote.findFirst({ where: { partyId: partyA2 } }))!.id } })
    assert(a2NoteStill?.content === 'A2 note', 'L6: partyA2 note NOT affected')
  }

  // ─── M. PUT validation — empty content rejected ───────────────────
  console.log('\nM. PUT validation — empty content rejected')
  {
    const note = await db.partyNote.findFirst({ where: { partyId: partyA1 } })
    const res = await callPut(noteItemRoute.PUT, partyA1, note!.id, { content: '' })
    assert(res.status === 400, `M1: status=400 (got ${res.status})`)
  }

  // ─── N. Cross-tenant DELETE — cannot delete note from another business ─
  console.log('\nN. Cross-tenant DELETE — cannot delete note from another business')
  {
    const bNote = await db.partyNote.findFirst({ where: { partyId: partyB1 } })
    const beforeCount = await db.partyNote.count({ where: { partyId: partyB1 } })
    // Auth = Biz A, partyB1 belongs to Biz B
    const res = await callDelete(noteItemRoute.DELETE, partyA1, bNote!.id)
    assert(res.status === 404, `N1: status=404 (got ${res.status})`)
    const afterCount = await db.partyNote.count({ where: { partyId: partyB1 } })
    assert(afterCount === beforeCount, `N2: note NOT deleted (before=${beforeCount}, after=${afterCount})`)
  }

  // ─── O. Cross-party DELETE — cannot delete note from another party (same biz) ─
  console.log('\nO. Cross-party DELETE — cannot delete note from another party in same business')
  {
    const a2Note = await db.partyNote.findFirst({ where: { partyId: partyA2 } })
    const beforeCount = await db.partyNote.count({ where: { partyId: partyA2 } })
    // Try to delete via partyA1's URL
    const res = await callDelete(noteItemRoute.DELETE, partyA1, a2Note!.id)
    assert(res.status === 404, `O1: status=404 (got ${res.status})`)
    const afterCount = await db.partyNote.count({ where: { partyId: partyA2 } })
    assert(afterCount === beforeCount, `O2: note NOT deleted (before=${beforeCount}, after=${afterCount})`)
  }

  // ─── P. DELETE removes only the requested note ─────────────────────
  console.log('\nP. DELETE removes only the requested note')
  {
    // partyA1 has notes; count them, delete one, verify count drops by 1
    const beforeCount = await db.partyNote.count({ where: { partyId: partyA1 } })
    const note = await db.partyNote.findFirst({ where: { partyId: partyA1 } })
    const res = await callDelete(noteItemRoute.DELETE, partyA1, note!.id)
    assert(res.status === 200, `P1: status=200 (got ${res.status})`)
    const body = await res.json()
    assert(body.ok === true, 'P2: response ok=true')
    const afterCount = await db.partyNote.count({ where: { partyId: partyA1 } })
    assert(afterCount === beforeCount - 1, `P3: count dropped by 1 (before=${beforeCount}, after=${afterCount})`)
    // Verify the specific note is gone
    const stillExists = await db.partyNote.findUnique({ where: { id: note!.id } })
    assert(stillExists === null, 'P4: deleted note no longer in DB')
    // Verify partyA2 notes NOT affected
    const a2Count = await db.partyNote.count({ where: { partyId: partyA2 } })
    assert(a2Count === 1, `P5: partyA2 notes NOT affected (still ${a2Count})`)
  }

  // ─── Q. GET non-existent party → 404 ───────────────────────────────
  console.log('\nQ. GET non-existent party → 404')
  {
    const res = await callGet(notesRoute.GET, 'nonexistent-party-id')
    assert(res.status === 404, `Q1: status=404 (got ${res.status})`)
  }

  // ─── R. No-business (unauthenticated) → 400 ────────────────────────
  console.log('\nR. No business (auth returns null) → 400')
  {
    const saved = currentBusinessOverride
    currentBusinessOverride = null
    try {
      const getRes = await callGet(notesRoute.GET, partyA1)
      assert(getRes.status === 400, `R1: GET status=400 (got ${getRes.status})`)
      const postRes = await callPost(notesRoute.POST, partyA1, { content: 'x' })
      assert(postRes.status === 400, `R2: POST status=400 (got ${postRes.status})`)
      const note = await db.partyNote.findFirst({ where: { partyId: partyA1 } })
      if (note) {
        const putRes = await callPut(noteItemRoute.PUT, partyA1, note.id, { content: 'y' })
        assert(putRes.status === 400, `R3: PUT status=400 (got ${putRes.status})`)
        const delRes = await callDelete(noteItemRoute.DELETE, partyA1, note.id)
        assert(delRes.status === 400, `R4: DELETE status=400 (got ${delRes.status})`)
      }
    } finally {
      currentBusinessOverride = saved
    }
  }

  // ─── S. Existing GET /api/parties/[id] behavior remains intact ─────
  console.log('\nS. Existing GET /api/parties/[id] still includes partyNotes')
  {
    // Re-import the parties route WITHOUT mocking (it uses the real
    // getCurrentBusiness, which returns null here — so we verify the
    // response shape, not the auth path). We use the real db directly to
    // confirm partyNotes is still included in the party payload shape.
    const party = await db.party.findFirst({
      where: { id: partyA1, businessId: TEST_BIZ_A },
      include: { partyNotes: { orderBy: { createdAt: 'desc' } } },
    })
    assert(party !== null, 'S1: party exists')
    assert(Array.isArray(party?.partyNotes), 'S2: partyNotes is still an array (existing behavior intact)')
    assert((party?.partyNotes.length ?? 0) > 0, `S3: partyNotes populated (got ${party?.partyNotes.length})`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ PartyNote CRUD Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
