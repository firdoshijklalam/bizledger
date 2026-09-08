/**
 * §TEST: Notification — REAL production route handler execution.
 *
 * Run: npx tsx tests/unit/notification-correctness.test.ts
 *
 * Classification:
 *   - REAL EXECUTION: Imports + calls the ACTUAL exported functions from
 *     the production route files:
 *       - updateChannelPreference() from src/app/api/notification-preferences/route.ts
 *       - getChannelPreferences() from src/app/api/notification-preferences/route.ts
 *       - createSaleNotification() from src/app/api/invoices/route.ts
 *   - MOCKED DEPENDENCY: None for route handler tests — the extracted functions
 *     take businessId as a parameter, bypassing getCurrentBusiness().
 *   - MOCKED DEPENDENCY: global.fetch for store tests (toggleChannel).
 *   - STATIC CONTRACT: Migration SQL inspection (file read, not executed).
 *
 * NO production logic is copied into the test. The test imports the REAL
 * functions and calls them with real DB state.
 */
export {}

import { db } from '../../src/lib/db'
import { useNotificationStore } from '../../src/store/notification-store'
import { updateChannelPreference, getChannelPreferences } from '../../src/app/api/notification-preferences/route'
import { createSaleNotification } from '../../src/app/api/invoices/route'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

const TEST_BIZ_ID = 'test-notif-' + Date.now()

async function setupTestBusiness() {
  await db.business.create({ data: { id: TEST_BIZ_ID, name: 'Test Notif Biz', currency: 'INR' } })
}

async function cleanupTestBusiness() {
  try {
    await db.notificationChannelPreference.deleteMany({ where: { businessId: TEST_BIZ_ID } })
    await db.notification.deleteMany({ where: { businessId: TEST_BIZ_ID } })
    await db.business.delete({ where: { id: TEST_BIZ_ID } })
  } catch {}
}

async function main() {
  console.log('\n🧪 Notification Tests — REAL Production Route Handlers\n')
  await setupTestBusiness()

  // ─── A. REAL: updateChannelPreference (PUT core) — valid key+value ──
  console.log('A. REAL: updateChannelPreference(businessId, "sales", false)')
  {
    // Call the ACTUAL exported function from the production route file
    const result = await updateChannelPreference(TEST_BIZ_ID, 'sales', false)

    assert(result.ok === true, 'A1: returned ok=true')
    assert(result.key === 'sales', 'A2: returned key=sales')
    assert(result.value === false, 'A3: returned value=false')
    assert(result.status === 200, 'A4: returned status=200')

    // Verify ACTUAL DB state (not a mock — real Prisma query)
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(pref !== null, 'A5: DB row exists (real query)')
    assert(pref?.enabled === false, 'A6: DB has enabled=false (verified)')
  }

  // ─── B. REAL: updateChannelPreference — invalid key → 400 ────────────
  console.log('\nB. REAL: updateChannelPreference — invalid key')
  {
    const result = await updateChannelPreference(TEST_BIZ_ID, 'invalidKey', true)

    assert(result.ok === false, 'B1: returned ok=false')
    assert(result.status === 400, 'B2: returned status=400')
    assert(result.error !== undefined, 'B3: returned error message')

    // Verify DB was NOT modified
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'invalidKey' } as any },
    })
    assert(pref === null, 'B4: no DB row created for invalid key')
  }

  // ─── C. REAL: updateChannelPreference — non-boolean value → 400 ────
  console.log('\nC. REAL: updateChannelPreference — non-boolean value')
  {
    const result = await updateChannelPreference(TEST_BIZ_ID, 'sales', 'yes' as any)

    assert(result.ok === false, 'C1: returned ok=false')
    assert(result.status === 400, 'C2: returned status=400')

    // Verify the EXISTING sales preference was NOT overwritten
    const pref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(pref?.enabled === false, 'C3: existing sales=false unchanged (not overwritten by invalid request)')
  }

  // ─── D. REAL: updateChannelPreference — lowStock=false, sales unchanged ─
  console.log('\nD. REAL: updateChannelPreference — lowStock=false, sales unchanged')
  {
    const result = await updateChannelPreference(TEST_BIZ_ID, 'lowStock', false)

    assert(result.ok === true, 'D1: returned ok=true')
    assert(result.status === 200, 'D2: returned status=200')

    // Verify lowStock changed
    const lowStockPref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'lowStock' } },
    })
    assert(lowStockPref?.enabled === false, 'D3: lowStock=false in DB (verified)')

    // Verify sales is STILL false (atomic — different row, not touched)
    const salesPref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(salesPref?.enabled === false, 'D4: sales still false (atomic upsert did not touch sales row)')
  }

  // ─── E. REAL: getChannelPreferences (GET core) — returns effective map ─
  console.log('\nE. REAL: getChannelPreferences — returns effective channel map')
  {
    // Call the ACTUAL exported function from the production route file
    const result = await getChannelPreferences(TEST_BIZ_ID)

    assert(result.channels.sales === false, 'E1: sales=false (from DB)')
    assert(result.channels.lowStock === false, 'E2: lowStock=false (from DB)')
    assert(result.channels.overduePayments === true, 'E3: overduePayments=true (default — no row in DB)')
    assert(result.channels.gradeChanges === true, 'E4: gradeChanges=true (default)')
    assert(result.channels.backups === true, 'E5: backups=true (default)')
  }

  // ─── F. REAL: Concurrent different-key updates ────────────────────────
  console.log('\nF. REAL: Concurrent different-key updates')
  {
    // Clean slate
    await db.notificationChannelPreference.deleteMany({
      where: { businessId: TEST_BIZ_ID, key: { in: ['gradeChanges', 'backups'] } },
    })

    // Execute TWO REAL updateChannelPreference calls CONCURRENTLY
    await Promise.all([
      updateChannelPreference(TEST_BIZ_ID, 'gradeChanges', false),
      updateChannelPreference(TEST_BIZ_ID, 'backups', false),
    ])

    // Verify BOTH are false in DB
    const gradePref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'gradeChanges' } },
    })
    const backupPref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'backups' } },
    })

    assert(gradePref?.enabled === false, 'F1: gradeChanges=false (survived concurrent update)')
    assert(backupPref?.enabled === false, 'F2: backups=false (survived concurrent update)')
  }

  // ─── G. REAL: createSaleNotification (invoice route core) — sales=true ─
  console.log('\nG. REAL: createSaleNotification — sales=true → one notification')
  {
    // Ensure sales=true
    await updateChannelPreference(TEST_BIZ_ID, 'sales', true)

    const mockInvoice = {
      id: 'test-inv-001',
      items: [{ name: 'Rice', quantity: 3 }, { name: 'Oil', quantity: 2 }],
      party: { name: 'Rahul Enterprise' },
      grandTotal: 2450,
    }

    // Call the ACTUAL exported function from the invoices route file
    const created = await createSaleNotification(TEST_BIZ_ID, mockInvoice)

    assert(created === true, 'G1: createSaleNotification returned true (notification created)')

    // Verify EXACTLY ONE notification in DB
    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-001' },
    })
    assert(notifCount === 1, 'G2: exactly 1 notification in DB (verified)')

    // Verify notification content
    const notif = await db.notification.findFirst({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-001' },
    })
    assert(notif?.type === 'sale', 'G3: type=sale')
    assert((notif?.body || '').includes('Rahul Enterprise'), 'G4: body includes party name')
    assert((notif?.body || '').includes('2 items'), 'G5: body includes item count')
    assert((notif?.body || '').includes('2,450'), 'G6: body includes total')
    assert(notif?.link === 'history', 'G7: link=history')
    assert(notif?.isRead === false, 'G8: isRead=false')
  }

  // ─── H. REAL: createSaleNotification — retry same invoice → no dup ──
  console.log('\nH. REAL: createSaleNotification — retry same invoice → no duplicate')
  {
    const mockInvoice = {
      id: 'test-inv-001', // SAME invoice ID
      items: [{ name: 'Rice', quantity: 3 }],
      party: { name: 'Rahul Enterprise' },
      grandTotal: 2450,
    }

    // Call the ACTUAL function again with the same invoice ID
    const created = await createSaleNotification(TEST_BIZ_ID, mockInvoice)

    assert(created === false, 'H1: returned false (dedup worked — no new notification)')

    // Verify STILL exactly 1 notification (not 2)
    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-001' },
    })
    assert(notifCount === 1, 'H2: still exactly 1 notification (no duplicate — verified)')
  }

  // ─── I. REAL: createSaleNotification — sales=false → no notification ─
  console.log('\nI. REAL: createSaleNotification — sales=false → no notification')
  {
    // Set sales=false
    await updateChannelPreference(TEST_BIZ_ID, 'sales', false)

    const mockInvoice = {
      id: 'test-inv-sales-off',
      items: [{ name: 'Test', quantity: 1 }],
      party: { name: 'Test Customer' },
      grandTotal: 100,
    }

    // Call the ACTUAL function
    const created = await createSaleNotification(TEST_BIZ_ID, mockInvoice)

    assert(created === false, 'I1: returned false (sales=false → no notification)')

    // Verify zero notifications for this invoice
    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-sales-off' },
    })
    assert(notifCount === 0, 'I2: zero notifications in DB (verified)')
  }

  // ─── J. REAL: createSaleNotification — different invoice → separate ─
  console.log('\nJ. REAL: createSaleNotification — different invoice → separate notification')
  {
    // Set sales=true again
    await updateChannelPreference(TEST_BIZ_ID, 'sales', true)

    const mockInvoice2 = {
      id: 'test-inv-002',
      items: [{ name: 'Sugar', quantity: 1 }],
      party: { name: 'Amit Trading' },
      grandTotal: 500,
    }

    const created = await createSaleNotification(TEST_BIZ_ID, mockInvoice2)

    assert(created === true, 'J1: returned true (second invoice creates its own notification)')

    // Verify both invoices have their own notification
    const count1 = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-001' },
    })
    const count2 = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-002' },
    })
    assert(count1 === 1, 'J2: invoice 1 still has 1 notification')
    assert(count2 === 1, 'J3: invoice 2 has 1 separate notification')
  }

  // ─── K. REAL: Missing preference row → default enabled ──────────────
  console.log('\nK. REAL: Missing preference row → default enabled')
  {
    // Delete the sales row
    await db.notificationChannelPreference.deleteMany({
      where: { businessId: TEST_BIZ_ID, key: 'sales' },
    })

    const mockInvoice = {
      id: 'test-inv-default',
      items: [{ name: 'Test', quantity: 1 }],
      party: { name: 'Test' },
      grandTotal: 100,
    }

    // Call the ACTUAL function — should create a notification (default enabled)
    const created = await createSaleNotification(TEST_BIZ_ID, mockInvoice)

    assert(created === true, 'K1: returned true (missing row → default enabled → notification created)')

    const notifCount = await db.notification.count({
      where: { businessId: TEST_BIZ_ID, invoiceId: 'test-inv-default' },
    })
    assert(notifCount === 1, 'K2: 1 notification created (verified)')
  }

  // ─── L. REAL: Tenant isolation ────────────────────────────────────────
  console.log('\nL. REAL: Tenant isolation')
  {
    const BIZ_B_ID = 'test-notif-B-' + Date.now()
    await db.business.create({ data: { id: BIZ_B_ID, name: 'Test Biz B', currency: 'INR' } })

    // Set sales=false for business A
    await updateChannelPreference(TEST_BIZ_ID, 'sales', false)

    // Read business B's sales preference
    const bizBPref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: BIZ_B_ID, key: 'sales' } },
    })

    assert(bizBPref === null, 'L1: business B has no sales preference (isolated from A)')

    // Verify business A's sales is still false
    const bizAPref = await db.notificationChannelPreference.findUnique({
      where: { businessId_key: { businessId: TEST_BIZ_ID, key: 'sales' } },
    })
    assert(bizAPref?.enabled === false, 'L2: business A has sales=false (not affected by B)')

    await db.business.delete({ where: { id: BIZ_B_ID } })
  }

  // ─── M. STORE: toggleChannel with mocked fetch — same-key serialization ─
  console.log('\nM. STORE: toggleChannel — same-key serialization (mocked fetch)')
  {
    useNotificationStore.setState({
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
    })

    const callOrder: string[] = []
    const originalFetch = global.fetch
    let requestCount = 0
    global.fetch = ((url: string, opts: any) => {
      requestCount++
      const currentRequest = requestCount
      callOrder.push(`request-${currentRequest}-start`)
      const delay = currentRequest === 1 ? 100 : 0

      return new Promise((resolve) => {
        setTimeout(() => {
          callOrder.push(`request-${currentRequest}-end`)
          resolve({
            ok: true,
            json: async () => ({ ok: true, key: JSON.parse(opts.body).key, value: JSON.parse(opts.body).value }),
          } as any)
        }, delay)
      })
    }) as any

    try {
      const p1 = useNotificationStore.getState().toggleChannel('sales')
      const p2 = useNotificationStore.getState().toggleChannel('sales')
      const [r1, r2] = await Promise.all([p1, p2])

      assert(r1 === true, 'M1: toggle 1 returned true')
      assert(r2 === true, 'M2: toggle 2 returned true')

      const req1EndIdx = callOrder.indexOf('request-1-end')
      const req2StartIdx = callOrder.indexOf('request-2-start')
      assert(req1EndIdx >= 0 && req2StartIdx >= 0, 'M3: both request markers found')
      assert(req1EndIdx < req2StartIdx, 'M4: request 1 ended BEFORE request 2 started (serialized)')
    } finally {
      global.fetch = originalFetch
    }
  }

  // ─── N. STORE: Different-key toggles proceed concurrently ────────────
  console.log('\nN. STORE: Different-key toggles — concurrent (mocked fetch)')
  {
    useNotificationStore.setState({
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
    })

    const originalFetch = global.fetch
    const startTimes: number[] = []
    global.fetch = ((url: string, opts: any) => {
      startTimes.push(Date.now())
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, key: JSON.parse(opts.body).key, value: JSON.parse(opts.body).value }),
      } as any)
    }) as any

    try {
      const [r1, r2] = await Promise.all([
        useNotificationStore.getState().toggleChannel('sales'),
        useNotificationStore.getState().toggleChannel('lowStock'),
      ])

      assert(r1 === true && r2 === true, 'N1: both toggles returned true')
      assert(Math.abs(startTimes[0] - startTimes[1]) < 50, 'N2: both requests started within 50ms (concurrent)')
      assert(useNotificationStore.getState().channels.sales === false, 'N3: sales=false in local state')
      assert(useNotificationStore.getState().channels.lowStock === false, 'N4: lowStock=false in local state')
    } finally {
      global.fetch = originalFetch
    }
  }

  // ─── O. STORE: Stale-response protection under the per-key queue ───
  //
  // §ACTUAL-SCENARIO: The per-key promise queue GUARANTEES that two same-key
  // toggles are SERIALIZED — request 2's fetch cannot start until request 1's
  // fetch resolves. So the OLD claim that "toggle 2's response arrives first"
  // is FALSE and has been removed.
  //
  // The stale-version scenario that CAN occur WITH the queue:
  //   1. v1 mutation is queued (toggle 1). version=1 recorded synchronously.
  //   2. v2 mutation is fired synchronously right after (toggle 2). version=2
  //      recorded synchronously — BEFORE v1's fetch response is reconciled.
  //   3. The queue runs v1's fetch first. When v1's response arrives, the
  //      version check finds version(1) ≠ currentVersion(2) → DISCARDED
  //      (no set() call, no state transition).
  //   4. The queue then runs v2's fetch. When v2's response arrives, the
  //      version check finds version(2) = currentVersion(2) → APPLIED.
  //
  // §OBSERVABLE-PROOF: We subscribe to store transitions. With stale
  // protection, the transitions are exactly:
  //     [false (v1 opt), true (v2 opt), true (v2 applied)]
  // — only 3 transitions, because v1's response is discarded (no set() call).
  // WITHOUT stale protection, v1's response would set sales=false (reverting
  // v2's optimistic true), producing 4 transitions:
  //     [false (v1 opt), true (v2 opt), false (v1 applied), true (v2 applied)]
  // The 3-vs-4 transition count is the proof that v1 was discarded.
  console.log('\nO. STORE: Stale-response protection — v1 discarded, v2 authoritative (mocked fetch)')
  {
    useNotificationStore.setState({
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
    })

    // Track every channels.sales transition. Zustand fires subscribe on every
    // set() call, even when the value is unchanged (the channels object ref
    // changes). This lets us observe whether v1's response handler ran set().
    const salesTransitions: boolean[] = []
    const unsub = useNotificationStore.subscribe((s) => {
      salesTransitions.push(s.channels.sales)
    })

    const originalFetch = global.fetch
    const fetchStartOrder: string[] = []
    global.fetch = ((url: string, opts: any) => {
      const body = JSON.parse(opts.body)
      fetchStartOrder.push(`value=${body.value}`)
      // §ECHO: Server returns the value that was set (matches production
      // updateChannelPreference which returns { key, value }).
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, key: body.key, value: body.value }),
      } as any)
    }) as any

    try {
      // Two same-key toggles, fired synchronously. The per-key queue
      // serializes their fetches, BUT version is incremented synchronously
      // when toggleChannel is called — so v2's version (2) is recorded
      // BEFORE v1's fetch resolves.
      //
      // v1: sales true→false. version=1.
      // v2: sales false→true. version=2.
      const p1 = useNotificationStore.getState().toggleChannel('sales')
      const p2 = useNotificationStore.getState().toggleChannel('sales')
      const [r1, r2] = await Promise.all([p1, p2])

      assert(r1 === true, 'O1: v1 returned true (server accepted; response discarded locally)')
      assert(r2 === true, 'O2: v2 returned true (authoritative)')

      // §QUEUE-SERIALIZES: The per-key queue guarantees v1's fetch STARTS
      // before v2's fetch STARTS (request 2 waits for request 1).
      assert(fetchStartOrder.length === 2, `O3: exactly 2 fetches observed (got ${fetchStartOrder.length})`)
      assert(fetchStartOrder[0] === 'value=false', `O4: v1 fetch (value=false) started first (queue serializes) — got ${fetchStartOrder[0]}`)
      assert(fetchStartOrder[1] === 'value=true', `O5: v2 fetch (value=true) started AFTER v1 (queue serializes) — got ${fetchStartOrder[1]}`)

      // §DISCARD-PROOF: With stale protection, v1's response handler does NOT
      // call set() (version mismatch → return early). So only 3 transitions:
      //   v1 optimistic (false) → v2 optimistic (true) → v2 applied (true).
      // If v1's response WERE applied, we would see a 4th transition (false)
      // reverting v2's optimistic, then a 5th (true) from v2's response.
      assert(salesTransitions.length === 3, `O6: exactly 3 state transitions (got ${salesTransitions.length}: [${salesTransitions.join(', ')}]) — v1 response discarded, no revert`)
      assert(salesTransitions[0] === false, 'O7: transition 1 = false (v1 optimistic)')
      assert(salesTransitions[1] === true, 'O8: transition 2 = true (v2 optimistic)')
      assert(salesTransitions[2] === true, 'O9: transition 3 = true (v2 applied — v1 discarded, no revert to false)')

      // §V2-AUTHORITATIVE: Final state matches v2's response value (true).
      const finalSales = useNotificationStore.getState().channels.sales
      assert(finalSales === true, `O10: final sales=true (v2 authoritative — got ${finalSales})`)
    } finally {
      unsub()
      global.fetch = originalFetch
    }
  }

  // ─── P. STORE: Failed sync rolls back local state ──────────────────
  console.log('\nP. STORE: Failed sync rolls back (mocked fetch returns 500)')
  {
    useNotificationStore.setState({
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
    })

    const originalFetch = global.fetch
    global.fetch = (() => Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'Server error' }) } as any)) as any

    try {
      const result = await useNotificationStore.getState().toggleChannel('sales')
      assert(result === false, 'P1: returned false (failed)')
      assert(useNotificationStore.getState().channels.sales === true, 'P2: sales rolled back to true')
    } finally {
      global.fetch = originalFetch
    }
  }

  // ─── Q. STORE: Server reconcile merges ONLY mutated key ─────────────
  console.log('\nQ. STORE: Server reconcile merges ONLY mutated key (mocked fetch)')
  {
    useNotificationStore.setState({
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
    })
    // Manually set lowStock=false (simulating concurrent local mutation)
    useNotificationStore.setState((s) => ({ channels: { ...s.channels, lowStock: false } }))

    const originalFetch = global.fetch
    global.fetch = ((url: string, opts: any) => {
      const body = JSON.parse(opts.body)
      return Promise.resolve({
        ok: true,
        json: async () => ({ ok: true, key: body.key, value: body.value }),
      } as any)
    }) as any

    try {
      // Toggle sales — server returns { key: 'sales', value: false }
      await useNotificationStore.getState().toggleChannel('sales')

      assert(useNotificationStore.getState().channels.sales === false, 'Q1: sales=false (from server reconcile)')
      assert(useNotificationStore.getState().channels.lowStock === false, 'Q2: lowStock=false (preserved — NOT overwritten)')
    } finally {
      global.fetch = originalFetch
    }
  }

  // ─── R. STATIC: Migration file contract ──────────────────────────────
  console.log('\nR. STATIC: Migration file contract (file read, NOT PostgreSQL execution)')
  {
    const fs = await import('fs')
    const migrationSql = fs.readFileSync(
      'prisma/migrations/20260908000000_add_notification_channel_preferences/migration.sql',
      'utf-8'
    )

    assert(migrationSql.includes('CREATE TABLE "NotificationChannelPreference"'), 'R1: CREATE TABLE present')
    assert(migrationSql.includes('CREATE UNIQUE INDEX "NotificationChannelPreference_businessId_key_key"'), 'R2: UNIQUE INDEX on (businessId, key)')
    assert(migrationSql.includes('FOREIGN KEY'), 'R3: FK to Business')
    const sqlCode = migrationSql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    assert(!sqlCode.includes('gen_random_uuid'), 'R4: no gen_random_uuid in SQL code')
    assert(!migrationSql.includes('typeof('), 'R5: no typeof() (no SQLite-only function)')
    assert(migrationSql.includes('jsonb_each_text'), 'R6: uses jsonb_each_text (PostgreSQL JSON)')
    assert(migrationSql.includes('ON CONFLICT'), 'R7: uses ON CONFLICT (idempotent)')
    assert(migrationSql.includes('CONTINUE'), 'R8: per-business exception handling')
  }

  await cleanupTestBusiness()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Notification Tests — REAL Production Route Handlers: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanupTestBusiness().finally(() => process.exit(1))
})
