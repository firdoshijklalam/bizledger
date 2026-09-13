/**
 * §STEP8G-TEST: Follow-Up Notification Preference + Reminder Tests.
 *
 * Run: bun run tests/unit/followup-notification-pref.test.ts
 *
 * §WHAT-IT-VERIFIES (A-O per Step 8G task spec):
 */
/// <reference types="bun-types" />
export {}

import { mock } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '../../src/lib/db'
import {
  processDueSoonReminders,
  processOverdueReminders,
  processWakeableFollowUps,
} from '../../src/lib/followup-scheduler'
import { updateChannelPreference, getChannelPreferences } from '../../src/app/api/notification-preferences/route'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const TEST_BIZ = 'test-fupref-' + Date.now()
const TEST_BIZ_B = 'test-fupref-B-' + Date.now()
let party1: string, partyB1: string

let bizOverride: { id: string; name: string; currency: string } | null = null
await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => bizOverride,
}))

const notificationsRoute = await import('@/app/api/notifications/route')

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ, name: 'Pref Biz', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'Pref Biz B', currency: 'INR' } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ } })
  await db.appSettings.create({ data: { businessId: TEST_BIZ_B } })
  party1 = (await db.party.create({ data: { businessId: TEST_BIZ, name: 'Pref Party', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'Pref Party B', type: 'customer' } })).id
  // Create a followUpSequence for the test businesses
  await db.followUpSequence.create({ data: { businessId: TEST_BIZ, nextNumber: 1 } })
  await db.followUpSequence.create({ data: { businessId: TEST_BIZ_B, nextNumber: 1 } })
}

async function cleanup() {
  try {
    await db.notification.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.notificationChannelPreference.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.followUpEvent.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.followUp.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.followUpSequence.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.appSettings.deleteMany({ where: { businessId: { in: [TEST_BIZ, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ, TEST_BIZ_B] } } })
  } catch {}
}

async function makeFollowUp(opts: {
  businessId?: string
  partyId?: string
  dueAt?: Date
  status?: string
  snoozedUntil?: Date | null
}) {
  return db.followUp.create({
    data: {
      businessId: opts.businessId ?? TEST_BIZ,
      followUpNumber: 'FU-P-' + Date.now() + '-' + Math.random().toString(36).substring(7),
      partyId: opts.partyId ?? party1,
      type: 'manual',
      title: 'Pref test FU',
      status: opts.status ?? 'PENDING',
      dueAt: opts.dueAt ?? new Date(Date.now() + 1800000),
      snoozedUntil: opts.snoozedUntil ?? null,
      priority: 'MEDIUM',
      sourceType: 'MANUAL',
    },
  })
}

function makeGet(url: string) { return new NextRequest(url, { method: 'GET' }) }
function makePost(url: string, body: any) {
  return new NextRequest(url, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } })
}

async function main() {
  console.log('\n🧪 Follow-Up Notification Preference Tests\n')
  await setup()
  bizOverride = { id: TEST_BIZ, name: 'Pref Biz', currency: 'INR' }

  // ─── A. no preference row follows existing default ─────────────────
  console.log('A. No preference row → default enabled')
  {
    const { channels } = await getChannelPreferences(TEST_BIZ)
    assert(channels.followUps === true, 'A1: followUps defaults to true (no preference row)')
  }

  // ─── B. followUps enabled → due-soon notification created ──────────
  console.log('\nB. followUps enabled → due-soon created')
  {
    await updateChannelPreference(TEST_BIZ, 'followUps', true)
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() + 1800000) })
    await processDueSoonReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_due_soon' } })
    assert(notif !== null, 'B1: due-soon notification created when followUps enabled')
  }

  // ─── C. followUps enabled → overdue notification created ──────────────
  console.log('\nC. followUps enabled → overdue created')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'C1: overdue notification created when followUps enabled')
  }

  // ─── D. followUps disabled → due-soon skipped ────────────────────────
  console.log('\nD. followUps disabled → due-soon skipped')
  {
    await updateChannelPreference(TEST_BIZ, 'followUps', false)
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() + 1800000) })
    const result = await processDueSoonReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_due_soon' } })
    assert(notif === null, 'D1: no due-soon notification when followUps disabled')
    assert(result.skipped >= 1, `D2: skipped count >= 1 (got ${result.skipped})`)
  }

  // ─── E. followUps disabled → overdue skipped ────────────────────────
  console.log('\nE. followUps disabled → overdue skipped')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    const result = await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif === null, 'E1: no overdue notification when followUps disabled')
    assert(result.skipped >= 1, `E2: skipped count >= 1 (got ${result.skipped})`)
  }

  // ─── F. disabled preference does not disable snooze auto-wake ──────
  console.log('\nF. Disabled preference does not disable snooze auto-wake')
  {
    const fu = await makeFollowUp({
      status: 'SNOOZED',
      snoozedUntil: new Date(Date.now() - 60000),
      dueAt: new Date(Date.now() - 30000),
    })
    const result = await processWakeableFollowUps(50)
    const after = await db.followUp.findUnique({ where: { id: fu.id }, select: { status: true } })
    assert(result.woken >= 1, `F1: follow-up woken despite followUps disabled (got woken=${result.woken})`)
    assert(after!.status === 'PENDING', 'F2: status=PENDING (wake independent of preference)')
  }

  // ─── G. re-enabled preference allows future reminder creation ──────
  console.log('\nG. Re-enabled preference allows future reminder creation')
  {
    await updateChannelPreference(TEST_BIZ, 'followUps', true)
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'G1: overdue notification created after re-enabling')
  }

  // ─── H. existing sale notification preference unchanged ────────────
  console.log('\nH. Existing sale notification preference unchanged')
  {
    await updateChannelPreference(TEST_BIZ, 'sales', false)
    const { channels } = await getChannelPreferences(TEST_BIZ)
    assert(channels.sales === false, 'H1: sales preference = false (unchanged by followUp changes)')
    assert(channels.followUps === true, 'H2: followUps preference = true (independent of sales)')
    await updateChannelPreference(TEST_BIZ, 'sales', true) // reset
  }

  // ─── I. existing other notification preferences unchanged ──────────
  console.log('\nI. Other notification preferences unchanged')
  {
    await updateChannelPreference(TEST_BIZ, 'lowStock', false)
    await updateChannelPreference(TEST_BIZ, 'gradeChanges', false)
    const { channels } = await getChannelPreferences(TEST_BIZ)
    assert(channels.lowStock === false, 'I1: lowStock = false (unchanged)')
    assert(channels.gradeChanges === false, 'I2: gradeChanges = false (unchanged)')
    assert(channels.followUps === true, 'I3: followUps = true (unchanged by other pref changes)')
    assert(channels.overduePayments === true, 'I4: overduePayments = true (default, untouched)')
    assert(channels.backups === true, 'I5: backups = true (default, untouched)')
  }

  // ─── J. duplicate follow-up reminder still dedupes at DB level ─────
  console.log('\nJ. Duplicate follow-up reminder still dedupes')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() + 1800000) })
    await processDueSoonReminders(50)
    const before = await db.notification.count({ where: { followUpId: fu.id, type: 'followup_due_soon' } })
    await processDueSoonReminders(50)
    const after = await db.notification.count({ where: { followUpId: fu.id, type: 'followup_due_soon' } })
    assert(before === after, `J1: no duplicate due-soon on repeated run (${before} → ${after})`)
  }

  // ─── K. mark-read works through existing notification API ──────────
  console.log('\nK. Mark-read works through existing notification API')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'K1: overdue notification exists')
    assert(notif!.isRead === false, 'K2: notification starts unread')

    // Mark read via existing API
    bizOverride = { id: TEST_BIZ, name: 'Pref Biz', currency: 'INR' }
    const res = await notificationsRoute.POST(makePost('http://localhost/api/notifications', { id: notif!.id }))
    assert(res.status === 200, `K3: mark-read → 200 (got ${res.status})`)
    const updated = await db.notification.findUnique({ where: { id: notif!.id }, select: { isRead: true } })
    assert(updated!.isRead === true, 'K4: notification marked read')
  }

  // ─── L. delete/dismiss works through existing notification API ─────
  console.log('\nL. Delete/dismiss works through existing notification API')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'L1: overdue notification exists')

    const res = await notificationsRoute.DELETE(makePost('http://localhost/api/notifications', { id: notif!.id }))
    assert(res.status === 200, `L2: delete → 200 (got ${res.status})`)
    const deleted = await db.notification.findUnique({ where: { id: notif!.id } })
    assert(deleted === null, 'L3: notification deleted')
  }

  // ─── M. unread count includes follow-up notifications ─────────────
  console.log('\nM. Unread count includes follow-up notifications')
  {
    // Create an overdue follow-up notification
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'M1: overdue notification exists')

    // Get notifications via API
    const res = await notificationsRoute.GET(makeGet('http://localhost/api/notifications?unread=1'))
    const body = await res.json()
    assert(res.status === 200, `M2: GET → 200 (got ${res.status})`)
    assert(body.unreadTotal >= 1, `M3: unreadTotal >= 1 (got ${body.unreadTotal}) — includes follow-up notification`)
    assert(body.items.some((n: any) => n.id === notif!.id), 'M4: follow-up notification in unread list')
  }

  // ─── N. generated link uses existing Party/customer route ──────────
  console.log('\nN. Generated link uses existing Party/customer route')
  {
    const fu = await makeFollowUp({ dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)
    const notif = await db.notification.findFirst({ where: { followUpId: fu.id, type: 'followup_overdue' } })
    assert(notif !== null, 'N1: notification exists')
    assert(notif!.link !== null, 'N2: link is set')
    assert(notif!.link!.includes('party='), `N3: link contains party= param (got "${notif!.link}")`)
    assert(notif!.link!.includes(party1), 'N4: link contains the correct partyId')
  }

  // ─── O. cross-business notification isolation remains intact ──────
  console.log('\nO. Cross-business notification isolation')
  {
    // Create follow-up in Biz B
    const fuB = await makeFollowUp({ businessId: TEST_BIZ_B, partyId: partyB1, dueAt: new Date(Date.now() - 3600000) })
    await processOverdueReminders(50)

    // Get Biz A notifications — should NOT include Biz B's
    const resA = await notificationsRoute.GET(makeGet('http://localhost/api/notifications'))
    const bodyA = await resA.json()
    assert(bodyA.items.every((n: any) => n.businessId === TEST_BIZ), 'O1: all Biz A notifications are from Biz A')
    assert(!bodyA.items.some((n: any) => n.followUpId === fuB.id), 'O2: Biz B follow-up notification NOT in Biz A list')

    // Get Biz B notifications — SHOULD include Biz B's
    bizOverride = { id: TEST_BIZ_B, name: 'Pref Biz B', currency: 'INR' }
    const resB = await notificationsRoute.GET(makeGet('http://localhost/api/notifications'))
    const bodyB = await resB.json()
    assert(bodyB.items.some((n: any) => n.followUpId === fuB.id), 'O3: Biz B follow-up notification IS in Biz B list')
    bizOverride = { id: TEST_BIZ, name: 'Pref Biz', currency: 'INR' }
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Follow-Up Notification Preference Tests: ${passed} passed, ${failed} failed`)
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
