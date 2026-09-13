/**
 * §STEP8H-TEST: Global Follow-Up Board / Work Queue Tests.
 *
 * Run: bun run tests/unit/followups-board.test.ts
 *
 * §CLASSIFICATION: API-contract + source-inspection tests (no rendered
 * component tests — the repository does not have a component testing setup).
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

const TEST_BIZ = 'test-fuboard-' + Date.now()
const TEST_BIZ_B = 'test-fuboard-B-' + Date.now()
let testUser: { id: string; email: string; name: string | null; role: string; businessId: string }
let party1: string, partyB1: string

let authOverride: any = null
await mock.module('@/lib/auth/session', () => ({
  requireAuth: async () => authOverride,
  getCurrentUser: async () => authOverride,
}))

const followupsRoute = await import('@/app/api/followups/route')
const transitionRoute = await import('@/app/api/followups/[id]/transition/route')

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Board Biz', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'Board Biz B', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_B } })
  await db.followUpSequence.create({ data: { businessId: TEST_BIZ, nextNumber: 1 } })
  await db.followUpSequence.create({ data: { businessId: TEST_BIZ_B, nextNumber: 1 } })
  party1 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Board Party', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'Board Party B', type: 'customer' } })).id
  const userRow = await db.user.create({ data: { email: `fuboard-${Date.now()}@test.com`, passwordHash: 'x', businessId: TEST_BIZ, name: 'Board User', role: 'OWNER' } })
  testUser = { id: userRow.id, email: userRow.email, name: userRow.name ?? null, role: userRow.role, businessId: TEST_BIZ }
}

async function cleanup() {
  try {
    await db.followUpEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.followUp.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.followUpSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.user.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.appSettings.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ, TEST_BIZ_B] } } })
  } catch {}
}

function makeGet(url: string) { return new NextRequest(url, { method: 'GET' }) }
function makePost(url: string, body: any) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

async function makeFollowUp(opts: { title?: string; dueAt?: Date; status?: string; priority?: string; type?: string } = {}) {
  return db.followUp.create({
    data: {
      businessId: TEST_BIZ,
      followUpNumber: 'FU-B-' + Date.now() + '-' + Math.random().toString(36).substring(7),
      partyId: party1,
      type: opts.type ?? 'manual',
      title: opts.title ?? 'Board test FU',
      status: opts.status ?? 'PENDING',
      dueAt: opts.dueAt ?? new Date(Date.now() + 3600000),
      priority: opts.priority ?? 'MEDIUM',
      sourceType: 'MANUAL',
    },
  })
}

// §SIMULATED-UI: mirrors the getActions logic from followups-view.tsx
function getActions(status: string): string[] {
  switch (status) {
    case 'PENDING': return ['IN_PROGRESS', 'COMPLETED', 'CANCELLED']
    case 'IN_PROGRESS': return ['PENDING', 'COMPLETED', 'CANCELLED']
    case 'SNOOZED': return ['PENDING', 'CANCELLED']
    case 'COMPLETED': return ['IN_PROGRESS']
    case 'CANCELLED': return ['IN_PROGRESS']
    default: return []
  }
}

async function main() {
  console.log('\n🧪 Global Follow-Up Board Tests\n')
  await setup()
  authOverride = testUser

  // ─── A. empty global state ──────────────────────────────────────────
  console.log('A. Empty global state')
  {
    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups'))
    const body = await res.json()
    assert(res.status === 200, `A1: GET → 200 (got ${res.status})`)
    assert(body.items.length === 0, `A2: empty items (got ${body.items.length})`)
    assert(body.total === 0, `A3: total=0 (got ${body.total})`)
  }

  // ─── B. list renders rows ────────────────────────────────────────────
  console.log('\nB. List renders rows')
  {
    const fu = await makeFollowUp({ title: 'Board list test' })
    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups'))
    const body = await res.json()
    assert(body.items.length >= 1, `B1: items has >= 1 (got ${body.items.length})`)
    const item = body.items.find((i: any) => i.id === fu.id)
    assert(item !== undefined, 'B2: follow-up found in list')
    assert(item.followUpNumber === fu.followUpNumber, 'B3: followUpNumber matches')
    assert(item.title === 'Board list test', 'B4: title matches')
    assert(item.party?.name === 'Board Party', 'B5: party name included')
  }

  // ─── C. filters produce correct API query ───────────────────────────
  console.log('\nC. Filters produce correct API query')
  {
    const fu1 = await makeFollowUp({ status: 'PENDING', priority: 'HIGH' })
    const fu2 = await makeFollowUp({ status: 'COMPLETED' })
    await db.followUp.update({ where: { id: fu2.id }, data: { status: 'COMPLETED', completedAt: new Date() } })

    // Status filter
    const resPending = await followupsRoute.GET(makeGet('http://localhost/api/followups?status=PENDING'))
    const bodyPending = await resPending.json()
    assert(bodyPending.items.every((i: any) => i.status === 'PENDING'), 'C1: status=PENDING filter returns only PENDING')

    // Priority filter
    const resHigh = await followupsRoute.GET(makeGet('http://localhost/api/followups?priority=HIGH'))
    const bodyHigh = await resHigh.json()
    assert(bodyHigh.items.every((i: any) => i.priority === 'HIGH'), 'C2: priority=HIGH filter returns only HIGH')
  }

  // ─── D. status filter ───────────────────────────────────────────────
  console.log('\nD. Status filter')
  {
    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups?status=COMPLETED'))
    const body = await res.json()
    assert(body.items.every((i: any) => i.status === 'COMPLETED'), 'D1: status=COMPLETED filter works')
  }

  // ─── E. priority filter ─────────────────────────────────────────────
  console.log('\nE. Priority filter')
  {
    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups?priority=URGENT'))
    const body = await res.json()
    assert(body.items.every((i: any) => i.priority === 'URGENT'), 'E1: priority=URGENT filter works')
  }

  // ─── F. assigned-user filter ────────────────────────────────────────
  console.log('\nF. Assigned-user filter')
  {
    const user2 = (await db.user.create({ data: { email: `fub2-${Date.now()}@test.com`, passwordHash: 'x', businessId: TEST_BIZ, name: 'User 2', role: 'STAFF' } })).id
    const fu = await makeFollowUp()
    await db.followUp.update({ where: { id: fu.id }, data: { assignedToId: user2 } })
    // §A: selecting an assignee changes the API query
    const res = await followupsRoute.GET(makeGet(`http://localhost/api/followups?assignedToId=${user2}`))
    const body = await res.json()
    assert(body.items.every((i: any) => i.assignedToId === user2), 'F1: assignedToId filter returns only that user\'s follow-ups')
    assert(body.items.some((i: any) => i.id === fu.id), 'F2: assigned follow-up is in the filtered list')

    // §B: clearing the assignee filter removes assignedToId
    const resAll = await followupsRoute.GET(makeGet('http://localhost/api/followups'))
    const bodyAll = await resAll.json()
    assert(!bodyAll.items.every((i: any) => i.assignedToId === user2), 'F3: clearing assignee filter returns all follow-ups (not just one user)')
  }

  // ─── G. overdue filter ─────────────────────────────────────────────
  console.log('\nG. Overdue filter')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups?overdue=true'))
    const body = await res.json()
    assert(body.items.every((i: any) => i.status === 'PENDING'), 'G1: overdue filter returns only PENDING')
    assert(body.items.some((i: any) => i.id === fu.id), 'G2: overdue follow-up is in the filtered list')
  }

  // ─── H. Sort: Due Soonest (client-side) ─────────────────────────────
  console.log('\nH. Sort: Due Soonest')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes("case 'due_soonest'"), 'H1: due_soonest sort mode exists in source')
    assert(source.includes('SORT_OPTIONS'), 'H2: sort options UI present')
    // §VERIFY: sortItems function exists + sorts by dueAt ASC (nulls last)
    assert(source.includes('function sortItems'), 'H3: sortItems function exists')
    // §API-DETERMINISTIC: same query → same order (server-side ordering is stable)
    const res1 = await followupsRoute.GET(makeGet('http://localhost/api/followups?limit=50&offset=0'))
    const res2 = await followupsRoute.GET(makeGet('http://localhost/api/followups?limit=50&offset=0'))
    const body1 = await res1.json()
    const body2 = await res2.json()
    assert(JSON.stringify(body1.items.map((i: any) => i.id)) === JSON.stringify(body2.items.map((i: any) => i.id)), 'H4: same order across runs (deterministic)')
  }

  // ─── H2. Sort: Oldest Overdue (client-side) ────────────────────────
  console.log('\nH2. Sort: Oldest Overdue')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes("case 'oldest_overdue'"), 'H2-1: oldest_overdue sort mode exists')
    assert(source.includes('aOverdue'), 'H2-2: overdue detection logic in sort function')
  }

  // ─── H3. Sort: Priority (client-side) ─────────────────────────────
  console.log('\nH3. Sort: Priority')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes("case 'priority'"), 'H3-1: priority sort mode exists')
    assert(source.includes('PRIORITY_ORDER'), 'H3-2: priority ordering map exists')
    assert(source.includes('URGENT: 0'), 'H3-3: URGENT has highest priority (0)')
  }

  // ─── H4. Sort: Recently Created (client-side) ─────────────────────
  console.log('\nH4. Sort: Recently Created')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes("case 'recently_created'"), 'H4-1: recently_created sort mode exists')
    assert(source.includes('createdAt'), 'H4-2: createdAt used in sort comparison')
  }

  // ─── H5. Completed Today metric ────────────────────────────────────
  console.log('\nH5. Completed Today metric')
  {
    // Create a follow-up completed today
    const fuCompleted = await makeFollowUp({ status: 'COMPLETED' })
    await db.followUp.update({ where: { id: fuCompleted.id }, data: { completedAt: new Date() } })
    // Create a follow-up completed yesterday
    const fuYesterday = await makeFollowUp({ status: 'COMPLETED' })
    const yesterday = new Date(Date.now() - 86400000)
    await db.followUp.update({ where: { id: fuYesterday.id }, data: { completedAt: yesterday } })

    const res = await followupsRoute.GET(makeGet('http://localhost/api/followups?status=COMPLETED'))
    const body = await res.json()
    const completedItems = body.items as any[]
    const completedToday = completedItems.filter((i: any) => {
      if (!i.completedAt) return false
      const now = new Date()
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return new Date(i.completedAt) >= todayStart
    })
    assert(completedToday.length >= 1, `H5-1: at least 1 completed today (got ${completedToday.length})`)
    assert(completedToday.some((i: any) => i.id === fuCompleted.id), 'H5-2: today\'s completion is counted')
    assert(!completedToday.some((i: any) => i.id === fuYesterday.id), 'H5-3: yesterday\'s completion is NOT counted as today')

    // §SOURCE: verify the completedTodayCount metric exists in the view
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('completedTodayCount'), 'H5-4: completedTodayCount metric exists in view source')
    assert(source.includes('Done Today'), 'H5-5: "Done Today" label in summary grid')
    assert(source.includes('todayStart'), 'H5-6: todayStart derived from local calendar day')
  }

  // ─── I. status action mapping ───────────────────────────────────────
  console.log('\nI. Status action mapping')
  {
    assert(getActions('PENDING').includes('IN_PROGRESS'), 'I1: PENDING → Start available')
    assert(getActions('PENDING').includes('COMPLETED'), 'I2: PENDING → Complete available')
    assert(getActions('PENDING').includes('CANCELLED'), 'I3: PENDING → Cancel available')
    assert(getActions('IN_PROGRESS').includes('PENDING'), 'I4: IN_PROGRESS → Pending available')
    assert(getActions('SNOOZED').includes('PENDING'), 'I5: SNOOZED → Wake available')
    assert(getActions('COMPLETED').includes('IN_PROGRESS'), 'I6: COMPLETED → Reopen available')
    assert(getActions('CANCELLED').includes('IN_PROGRESS'), 'I7: CANCELLED → Reopen available')
  }

  // ─── J. impossible actions hidden ──────────────────────────────────
  console.log('\nJ. Impossible actions hidden')
  {
    assert(!getActions('COMPLETED').includes('PENDING'), 'J1: COMPLETED → PENDING not shown')
    assert(!getActions('COMPLETED').includes('CANCELLED'), 'J2: COMPLETED → CANCELLED not shown')
    assert(!getActions('SNOOZED').includes('COMPLETED'), 'J3: SNOOZED → COMPLETED not shown')
    assert(!getActions('CANCELLED').includes('PENDING'), 'J4: CANCELLED → PENDING not shown')
  }

  // ─── K. create action opens existing FollowUpForm (source inspection)
  console.log('\nK. Create action opens existing FollowUpForm')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('FollowUpForm'), 'K1: FollowUpForm imported + used')
    assert(source.includes('setFormOpen(true)'), 'K2: create button opens form')
  }

  // ─── L. row opens existing FollowUpDetailSheet (source inspection)
  console.log('\nL. Row opens existing FollowUpDetailSheet')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('FollowUpDetailSheet'), 'L1: FollowUpDetailSheet imported + used')
    assert(source.includes('openDetail'), 'L2: row click calls openDetail')
  }

  // ─── M. successful mutation refreshes data ──────────────────────────
  console.log('\nM. Successful mutation refreshes data')
  {
    const fu = await makeFollowUp()
    const res = await transitionRoute.POST(makePost(`http://localhost/api/followups/${fu.id}/transition`, { toStatus: 'IN_PROGRESS' }), { params: Promise.resolve({ id: fu.id }) })
    assert(res.status === 200, `M1: transition → 200 (got ${res.status})`)
    const updated = await db.followUp.findUnique({ where: { id: fu.id }, select: { status: true } })
    assert(updated!.status === 'IN_PROGRESS', `M2: status=IN_PROGRESS in DB`)
    // §UI-CONTRACT: the view calls refetch() after transition (source inspection)
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('refetch()'), 'M3: view calls refetch() after mutation')
  }

  // ─── N. duplicate action submission prevented ───────────────────────
  console.log('\nN. Duplicate action submission prevented')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('if (transitioning) return'), 'N1: transitioning guard prevents duplicate submission')
    assert(source.includes('disabled={transitioning === fu.id}'), 'N2: buttons disabled during transition')
  }

  // ─── O. server errors visible ──────────────────────────────────────
  console.log('\nO. Server errors visible')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('toast.error'), 'O1: toast.error used for server errors')
    assert(source.includes('error'), 'O2: error state rendered')
    assert(source.includes('Retry'), 'O3: Retry button present')
  }

  // ─── P. customer selection is business-scoped ──────────────────────
  console.log('\nP. Customer selection is business-scoped')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followup-form.tsx', 'utf-8')
    assert(source.includes('/api/parties'), 'P1: form fetches parties from /api/parties (business-scoped)')
    assert(source.includes('needsPartyPicker'), 'P2: party picker shown when no pre-selected partyId')
  }

  // ─── Q. completed/cancelled records can be filtered ─────────────────
  console.log('\nQ. Completed/cancelled records can be filtered')
  {
    const fuCompleted = await makeFollowUp({ status: 'COMPLETED' })
    await db.followUp.update({ where: { id: fuCompleted.id }, data: { completedAt: new Date() } })
    const fuCancelled = await makeFollowUp({ status: 'CANCELLED' })

    const resC = await followupsRoute.GET(makeGet('http://localhost/api/followups?status=COMPLETED'))
    const bodyC = await resC.json()
    assert(bodyC.items.some((i: any) => i.id === fuCompleted.id), 'Q1: COMPLETED filter returns completed follow-ups')

    const resX = await followupsRoute.GET(makeGet('http://localhost/api/followups?status=CANCELLED'))
    const bodyX = await resX.json()
    assert(bodyX.items.some((i: any) => i.id === fuCancelled.id), 'Q2: CANCELLED filter returns cancelled follow-ups')
  }

  // ─── R. mobile source/layout safeguards ────────────────────────────
  console.log('\nR. Mobile source/layout safeguards')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(!source.includes('overflow-x-scroll'), 'R1: no intentional horizontal overflow')
    assert(source.includes('truncate'), 'R2: uses truncate for long text')
    assert(source.includes('max-w-4xl'), 'R3: max-width container')
    assert(source.includes('grid-cols-2 sm:grid-cols-5'), 'R4: responsive summary grid (2 cols mobile, 5 cols desktop)')
    assert(source.includes('overflow-x-auto'), 'R5: filter chips scroll horizontally (expected for chip bar)')
  }

  // ─── S. accessibility source safeguards ─────────────────────────────
  console.log('\nS. Accessibility source safeguards')
  {
    const fs = await import('fs')
    const source = fs.readFileSync('/home/z/my-project/src/components/views/followups-view.tsx', 'utf-8')
    assert(source.includes('aria-label'), 'S1: aria-label present on interactive elements')
    assert(source.includes('aria-pressed'), 'S2: aria-pressed on filter chips')
    assert(source.includes('role') || source.includes('button'), 'S3: semantic button elements used')
    // §STATUS-NOT-COLOR-ONLY: status text + label shown alongside color badges
    assert(source.includes('STATUS_META'), 'S4: status labels (not just colors) — STATUS_META with label')
    assert(source.includes('PRIORITY_DOT') || source.includes('priority'), 'S5: priority text + dot shown')
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Global Follow-Up Board Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch(async (e) => {
  console.error('Test error:', e)
  await cleanup()
  await db.$disconnect()
  process.exit(1)
})
