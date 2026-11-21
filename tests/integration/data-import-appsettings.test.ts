/**
 * §TEST: STEP 2B.2A — REAL DB integration test for AppSettings restore.
 *
 * Run: npx tsx tests/integration/data-import-appsettings.test.ts
 *
 * §CLASSIFICATION: REAL DB / REAL CODE PATH.
 *   Creates REAL Prisma/SQLite fixtures (businesses, AppSettings rows),
 *   invokes the REAL `performImport()` function (the SAME function the
 *   /api/data-import POST handler calls), and verifies against REAL DB state.
 *   NO mock Prisma clients. NO mock sanitizers.
 *
 * §WHAT-THIS-PROVES:
 *   - The actual tx.appSettings.upsert() inside performImport() executes.
 *   - The 8 safe fields are actually persisted to the DB.
 *   - Security fields (pinHash, pinEnabled, userRole, gate*, etc.) are
 *     preserved on the target — NOT overwritten by the import.
 *   - Tenant isolation: the source businessId is NEVER used; only the current
 *     session businessId is used for the upsert.
 *   - Null settings → no create/modify.
 *   - Merge + replace strategies both work.
 *   - Malicious extra fields in the backup envelope cannot modify security fields.
 *
 * §TEST-INFRASTRUCTURE: Mirrors tests/integration/dashboard-breakdown.test.ts:
 *   - Uses real `db` from src/lib/db.
 *   - Creates real Business + AppSettings fixtures.
 *   - Calls gatherExistingIds() + performImport() directly (same as how
 *     dashboard-breakdown.test.ts calls getBreakdown() directly).
 *   - Cleans up all created rows in a finally block.
 */

export {}

import { db } from '../../src/lib/db'
import { performImport, gatherExistingIds } from '../../src/app/api/data-import/route'
import {
  validateBackup,
  DEFAULT_IMPORT_OPTIONS,
  type BackupEnvelope,
  type ImportOptions,
} from '../../src/lib/backup-format'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(actual === expected, `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

let testBusinessIds: string[] = []

async function cleanup() {
  for (const id of testBusinessIds) {
    await db.appSettings.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: id } } }).catch(() => {})
    await db.transaction.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.invoice.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.party.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.product.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.category.deleteMany({ where: { businessId: id } }).catch(() => {})
    await db.business.delete({ where: { id } }).catch(() => {})
  }
}

async function createBusiness(name: string) {
  const biz = await db.business.create({ data: { name, currency: 'INR' } })
  testBusinessIds.push(biz.id)
  return biz
}

async function createAppSettings(businessId: string, overrides: Record<string, any> = {}) {
  return db.appSettings.create({
    data: {
      businessId,
      language: overrides.language ?? 'en',
      dateFormat: overrides.dateFormat ?? 'DD/MM/YYYY',
      invoicePrefix: overrides.invoicePrefix ?? 'INV',
      notificationsEnabled: overrides.notificationsEnabled ?? true,
      autoBackupEnabled: overrides.autoBackupEnabled ?? false,
      cardPreferences: overrides.cardPreferences ?? null,
      dashboardCards: overrides.dashboardCards ?? null,
      dashboardSections: overrides.dashboardSections ?? null,
      // security fields
      pinHash: overrides.pinHash ?? null,
      pinEnabled: overrides.pinEnabled ?? false,
      userRole: overrides.userRole ?? 'owner',
      biometricEnabled: overrides.biometricEnabled ?? false,
      gateLockdownUntil: overrides.gateLockdownUntil ?? null,
      gateOwnerSwitch: overrides.gateOwnerSwitch ?? true,
      gateHighValueDiscount: overrides.gateHighValueDiscount ?? true,
      gateDiscountLimit: overrides.gateDiscountLimit ?? 5000,
      gateDataExport: overrides.gateDataExport ?? true,
      gateInventoryPrice: overrides.gateInventoryPrice ?? true,
      gateDangerZone: overrides.gateDangerZone ?? true,
      externalScannerEnabled: overrides.externalScannerEnabled ?? false,
      defaulterRegistryEnabled: overrides.defaulterRegistryEnabled ?? true,
      onlineSalesEnabled: overrides.onlineSalesEnabled ?? true,
      offlineOnlyMode: overrides.offlineOnlyMode ?? false,
      cloudSyncMode: overrides.cloudSyncMode ?? false,
      telegramFileIdMode: overrides.telegramFileIdMode ?? false,
      appMode: overrides.appMode ?? 'merchant',
      telegramEnabled: overrides.telegramEnabled ?? false,
      driveEnabled: overrides.driveEnabled ?? false,
    },
  })
}

function buildEnvelope(settings: any | null): BackupEnvelope {
  const raw: any = {
    format: 'bizledger-backup',
    version: 1,
    createdAt: new Date().toISOString(),
    business: { id: 'SOURCE-BIZ-ID', name: 'Source Business', currency: 'INR', createdAt: new Date().toISOString() },
    parties: [],
    products: [],
    invoices: [],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  }
  if (settings !== null) {
    // §MALICIOUS-FIELDS: include security fields to prove the sanitizer strips them.
    // The restore upsert reads from envelope.settings AFTER sanitizeAppSettings(),
    // so these can never reach the DB.
    raw.settings = settings
  }
  const validation = validateBackup(raw)
  if (!validation.ok || !validation.envelope) {
    throw new Error('Test setup: invalid envelope: ' + validation.error)
  }
  return validation.envelope
}

async function runImport(envelope: BackupEnvelope, targetBusinessId: string, opts: ImportOptions) {
  const existingIds = await gatherExistingIds(targetBusinessId)
  return performImport(envelope, targetBusinessId, existingIds, opts)
}

async function main() {
  console.log('\n🧪 STEP 2B.2A — REAL DB AppSettings Restore Integration Tests\n')
  console.log('  (Exercises the REAL performImport() + tx.appSettings.upsert() path)\n')

  try {
    // ─── A. ACTUAL RESTORE — all 8 safe fields persisted ──────────────────
    console.log('  A. ACTUAL RESTORE — safe fields persisted to DB:')
    {
      const target = await createBusiness('Target A')
      // §TARGET-START: target has default AppSettings
      await createAppSettings(target.id)

      // §BACKUP-SETTINGS: a full set of distinct non-default safe values
      const envelope = buildEnvelope({
        language: 'hi',
        dateFormat: 'MM/DD/YYYY',
        invoicePrefix: 'BIZ',
        notificationsEnabled: false,
        autoBackupEnabled: true,
        cardPreferences: '{"showOwner":true,"showPhone":false}',
        dashboardCards: '[{"id":"totalSales","visible":true,"order":0}]',
        dashboardSections: '{"sections":[{"id":"summaryCards","visible":true,"order":0}]}',
      })

      const opts: ImportOptions = { strategy: 'merge', updateExisting: false }
      const result = await runImport(envelope, target.id, opts)
      assert(result.failed.errors.length === 0, `A: import succeeded with no errors`)

      // §VERIFY-DB: read the actual AppSettings row from the DB
      const restored = await db.appSettings.findUnique({ where: { businessId: target.id } })
      assert(restored !== null, 'A: AppSettings row exists after import')
      if (restored) {
        assertEqual(restored.language, 'hi', 'A1: language persisted')
        assertEqual(restored.dateFormat, 'MM/DD/YYYY', 'A2: dateFormat persisted')
        assertEqual(restored.invoicePrefix, 'BIZ', 'A3: invoicePrefix persisted')
        assertEqual(restored.notificationsEnabled, false, 'A4: notificationsEnabled persisted')
        assertEqual(restored.autoBackupEnabled, true, 'A5: autoBackupEnabled persisted')
        assertEqual(restored.cardPreferences, '{"showOwner":true,"showPhone":false}', 'A6: cardPreferences persisted')
        assertEqual(restored.dashboardCards, '[{"id":"totalSales","visible":true,"order":0}]', 'A7: dashboardCards persisted')
        assertEqual(restored.dashboardSections, '{"sections":[{"id":"summaryCards","visible":true,"order":0}]}', 'A8: dashboardSections persisted')
      }
    }

    // ─── B. EXISTING TARGET — update path ─────────────────────────────────
    console.log('\n  B. EXISTING TARGET — update path (no duplicate row):')
    {
      const target = await createBusiness('Target B')
      // §TARGET-START: target has known safe values
      await createAppSettings(target.id, {
        language: 'en', dateFormat: 'DD/MM/YYYY', invoicePrefix: 'INV',
        notificationsEnabled: true, autoBackupEnabled: false,
      })

      const envelope = buildEnvelope({
        language: 'bn',
        dateFormat: 'YYYY-MM-DD',
        invoicePrefix: 'TGT',
        notificationsEnabled: false,
        autoBackupEnabled: true,
        cardPreferences: '{"showAddress":true}',
      })

      const result = await runImport(envelope, target.id, DEFAULT_IMPORT_OPTIONS)
      assert(result.failed.errors.length === 0, 'B: import succeeded')

      // §VERIFY: row count is still 1 (no duplicate), values changed
      const rows = await db.appSettings.findMany({ where: { businessId: target.id } })
      assertEqual(rows.length, 1, 'B1: exactly 1 AppSettings row (no duplicate)')
      const r = rows[0]
      assertEqual(r.language, 'bn', 'B2: language changed to backup value')
      assertEqual(r.dateFormat, 'YYYY-MM-DD', 'B3: dateFormat changed to backup value')
      assertEqual(r.invoicePrefix, 'TGT', 'B4: invoicePrefix changed to backup value')
      assertEqual(r.notificationsEnabled, false, 'B5: notificationsEnabled changed to backup value')
      assertEqual(r.autoBackupEnabled, true, 'B6: autoBackupEnabled changed to backup value')
      assertEqual(r.cardPreferences, '{"showAddress":true}', 'B7: cardPreferences changed to backup value')
    }

    // ─── C. SECURITY PRESERVATION — target security fields unchanged ──────
    console.log('\n  C. SECURITY PRESERVATION — target security fields unchanged:')
    {
      const target = await createBusiness('Target C')
      // §TARGET-SECURITY: distinct known security values
      const lockdown = new Date('2026-12-31T23:59:59Z')
      await createAppSettings(target.id, {
        pinHash: 'TARGET-PIN-HASH',
        pinEnabled: true,
        userRole: 'manager',
        biometricEnabled: true,
        gateLockdownUntil: lockdown,
        gateOwnerSwitch: false,
        gateHighValueDiscount: false,
        gateDiscountLimit: 1234,
        gateDataExport: false,
        gateInventoryPrice: false,
        gateDangerZone: false,
        externalScannerEnabled: true,
        defaulterRegistryEnabled: false,
        onlineSalesEnabled: false,
        offlineOnlyMode: true,
        cloudSyncMode: true,
        telegramFileIdMode: true,
        appMode: 'customer',
        telegramEnabled: true,
        driveEnabled: true,
      })

      // §MALICIOUS-BACKUP: backup tries to set security fields — sanitizer must strip
      const envelope = buildEnvelope({
        language: 'hi',
        // malicious security fields (must be stripped by sanitizeAppSettings allow-list)
        pinHash: 'EVIL-PIN-HASH',
        pinEnabled: false,
        userRole: 'sales',
        biometricEnabled: false,
        gateLockdownUntil: '2020-01-01',
        gateOwnerSwitch: true,
        gateHighValueDiscount: true,
        gateDiscountLimit: 99999,
        gateDataExport: true,
        gateInventoryPrice: true,
        gateDangerZone: true,
        externalScannerEnabled: false,
        defaulterRegistryEnabled: true,
        onlineSalesEnabled: true,
        offlineOnlyMode: false,
        cloudSyncMode: false,
        telegramFileIdMode: false,
        appMode: 'merchant',
        telegramEnabled: false,
        driveEnabled: false,
      })

      const result = await runImport(envelope, target.id, DEFAULT_IMPORT_OPTIONS)
      assert(result.failed.errors.length === 0, 'C: import succeeded')

      const r = await db.appSettings.findUnique({ where: { businessId: target.id } })
      assert(r !== null, 'C: AppSettings row exists')
      if (r) {
        // §ALL-SECURITY-FIELDS-UNCHANGED:
        assertEqual(r.pinHash, 'TARGET-PIN-HASH', 'C1: pinHash unchanged (not overwritten)')
        assertEqual(r.pinEnabled, true, 'C2: pinEnabled unchanged')
        assertEqual(r.userRole, 'manager', 'C3: userRole unchanged')
        assertEqual(r.biometricEnabled, true, 'C4: biometricEnabled unchanged')
        assert(r.gateLockdownUntil !== null && r.gateLockdownUntil.getTime() === lockdown.getTime(), 'C5: gateLockdownUntil unchanged')
        assertEqual(r.gateOwnerSwitch, false, 'C6: gateOwnerSwitch unchanged')
        assertEqual(r.gateHighValueDiscount, false, 'C7: gateHighValueDiscount unchanged')
        assertEqual(Number(r.gateDiscountLimit), 1234, 'C8: gateDiscountLimit unchanged')
        assertEqual(r.gateDataExport, false, 'C9: gateDataExport unchanged')
        assertEqual(r.gateInventoryPrice, false, 'C10: gateInventoryPrice unchanged')
        assertEqual(r.gateDangerZone, false, 'C11: gateDangerZone unchanged')
        assertEqual(r.externalScannerEnabled, true, 'C12: externalScannerEnabled unchanged')
        assertEqual(r.defaulterRegistryEnabled, false, 'C13: defaulterRegistryEnabled unchanged')
        assertEqual(r.onlineSalesEnabled, false, 'C14: onlineSalesEnabled unchanged')
        assertEqual(r.offlineOnlyMode, true, 'C15: offlineOnlyMode unchanged')
        assertEqual(r.cloudSyncMode, true, 'C16: cloudSyncMode unchanged')
        assertEqual(r.telegramFileIdMode, true, 'C17: telegramFileIdMode unchanged')
        assertEqual(r.appMode, 'customer', 'C18: appMode unchanged')
        assertEqual(r.telegramEnabled, true, 'C19: telegramEnabled unchanged')
        assertEqual(r.driveEnabled, true, 'C20: driveEnabled unchanged')
        // §SAFE-FIELD-STILL-RESTORED: language (the one safe field in the backup) IS restored
        assertEqual(r.language, 'hi', 'C21: safe field (language) restored despite malicious extras')
      }
    }

    // ─── D. TENANT ISOLATION — source businessId never used ─────────────
    console.log('\n  D. TENANT ISOLATION — source businessId never used:')
    {
      // §SOURCE-BIZ: create a separate source business with its own AppSettings
      const sourceBiz = await createBusiness('Source D')
      await createAppSettings(sourceBiz.id, { language: 'source-lang', invoicePrefix: 'SRC' })

      // §TARGET-BIZ: the authenticated/current business
      const targetBiz = await createBusiness('Target D')
      await createAppSettings(targetBiz.id, { language: 'target-lang', invoicePrefix: 'TGT' })

      // §BACKUP-ENVELOPE: business.id = sourceBiz.id (must be IGNORED)
      // The restore uses businessId = targetBiz.id (from performImport param)
      const rawEnvelope: any = {
        format: 'bizledger-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        business: { id: sourceBiz.id, name: 'Source Business', currency: 'INR', createdAt: new Date().toISOString() },
        settings: {
          language: 'imported-lang',
          invoicePrefix: 'IMP',
        },
        parties: [],
        products: [],
        invoices: [],
        invoiceItems: [],
        transactions: [],
        categories: [],
        customPrices: [],
        staff: [],
        partyNotes: [],
        stockMovements: [],
      }
      const validation = validateBackup(rawEnvelope)
      assert(validation.ok, 'D: envelope validates')
      const envelope = validation.envelope!

      // §IMPORT-INTO-TARGET: pass targetBiz.id (simulating the session businessId)
      const result = await runImport(envelope, targetBiz.id, DEFAULT_IMPORT_OPTIONS)
      assert(result.failed.errors.length === 0, 'D: import succeeded')

      // §VERIFY-TARGET: target's AppSettings updated
      const targetAfter = await db.appSettings.findUnique({ where: { businessId: targetBiz.id } })
      assert(targetAfter !== null, 'D1: target AppSettings exists')
      if (targetAfter) {
        assertEqual(targetAfter.language, 'imported-lang', 'D2: target language = backup value (not source, not original)')
        assertEqual(targetAfter.invoicePrefix, 'IMP', 'D3: target invoicePrefix = backup value')
      }

      // §VERIFY-SOURCE-UNCHANGED: source business's AppSettings UNTOUCHED
      const sourceAfter = await db.appSettings.findUnique({ where: { businessId: sourceBiz.id } })
      assert(sourceAfter !== null, 'D4: source AppSettings still exists')
      if (sourceAfter) {
        assertEqual(sourceAfter.language, 'source-lang', 'D5: source language UNCHANGED (tenant isolation)')
        assertEqual(sourceAfter.invoicePrefix, 'SRC', 'D6: source invoicePrefix UNCHANGED (tenant isolation)')
      }
    }

    // ─── E. NULL SETTINGS — target untouched ──────────────────────────────
    console.log('\n  E. NULL SETTINGS — target AppSettings untouched:')
    {
      const target = await createBusiness('Target E')
      // §TARGET-START: known safe + security values
      await createAppSettings(target.id, {
        language: 'en', invoicePrefix: 'INV',
        pinHash: 'TARGET-HASH', pinEnabled: true, userRole: 'manager',
      })

      // §NULL-SETTINGS: envelope with NO settings field
      const envelope = buildEnvelope(null)
      assert(envelope.settings === null, 'E1: envelope.settings is null')

      const result = await runImport(envelope, target.id, DEFAULT_IMPORT_OPTIONS)
      assert(result.failed.errors.length === 0, 'E2: import succeeded (null settings is valid)')

      // §VERIFY: target AppSettings UNCHANGED
      const r = await db.appSettings.findUnique({ where: { businessId: target.id } })
      assert(r !== null, 'E3: target AppSettings still exists')
      if (r) {
        assertEqual(r.language, 'en', 'E4: language unchanged (null settings → no restore)')
        assertEqual(r.invoicePrefix, 'INV', 'E5: invoicePrefix unchanged')
        assertEqual(r.pinHash, 'TARGET-HASH', 'E6: pinHash unchanged')
        assertEqual(r.pinEnabled, true, 'E7: pinEnabled unchanged')
        assertEqual(r.userRole, 'manager', 'E8: userRole unchanged')
      }
    }

    // ─── F. MERGE — updates existing row without duplicate ────────────────
    console.log('\n  F. MERGE — updates existing row without duplicate:')
    {
      const target = await createBusiness('Target F')
      await createAppSettings(target.id, {
        language: 'en', dashboardCards: '[{"id":"old","visible":true,"order":0}]',
      })

      const envelope = buildEnvelope({
        language: 'hi',
        dashboardCards: '[{"id":"new","visible":false,"order":1}]',
      })

      const opts: ImportOptions = { strategy: 'merge', updateExisting: false }
      const result = await runImport(envelope, target.id, opts)
      assert(result.failed.errors.length === 0, 'F: merge import succeeded')

      const rows = await db.appSettings.findMany({ where: { businessId: target.id } })
      assertEqual(rows.length, 1, 'F1: exactly 1 row after merge (no duplicate)')
      assertEqual(rows[0].language, 'hi', 'F2: language updated by merge')
      assertEqual(rows[0].dashboardCards, '[{"id":"new","visible":false,"order":1}]', 'F3: dashboardCards updated by merge')
    }

    // ─── G. REPLACE — preserves AppSettings + applies safe settings ──────
    console.log('\n  G. REPLACE — preserves AppSettings + applies safe settings:')
    {
      const target = await createBusiness('Target G')
      await createAppSettings(target.id, {
        language: 'en', invoicePrefix: 'INV',
        pinHash: 'REPLACE-HASH', pinEnabled: true, userRole: 'sales',
        gateDangerZone: false,
      })

      const envelope = buildEnvelope({
        language: 'bn',
        invoicePrefix: 'REP',
      })

      const opts: ImportOptions = { strategy: 'replace', updateExisting: false }
      const result = await runImport(envelope, target.id, opts)
      assert(result.failed.errors.length === 0, 'G: replace import succeeded')

      // §VERIFY: AppSettings row still exists (NOT deleted by replace strategy)
      const rows = await db.appSettings.findMany({ where: { businessId: target.id } })
      assertEqual(rows.length, 1, 'G1: AppSettings row preserved after replace (not deleted)')

      const r = rows[0]
      assertEqual(r.language, 'bn', 'G2: language updated by replace')
      assertEqual(r.invoicePrefix, 'REP', 'G3: invoicePrefix updated by replace')
      // §SECURITY-UNCHANGED-UNDER-REPLACE:
      assertEqual(r.pinHash, 'REPLACE-HASH', 'G4: pinHash unchanged under replace')
      assertEqual(r.pinEnabled, true, 'G5: pinEnabled unchanged under replace')
      assertEqual(r.userRole, 'sales', 'G6: userRole unchanged under replace')
      assertEqual(r.gateDangerZone, false, 'G7: gateDangerZone unchanged under replace')
    }

    // ─── H. MALICIOUS EXTRA SETTINGS — security fields never modified ─────
    console.log('\n  H. MALICIOUS EXTRA SETTINGS — security fields never modified:')
    {
      const target = await createBusiness('Target H')
      await createAppSettings(target.id, {
        pinHash: 'ORIG-HASH',
        pinEnabled: true,
        userRole: 'manager',
        gateDangerZone: false,
        telegramEnabled: true,
      })

      // §MALICIOUS: raw backup with security fields in settings
      // (sanitizeAppSettings must strip ALL of these before they reach the restore)
      const rawEnvelope: any = {
        format: 'bizledger-backup',
        version: 1,
        createdAt: new Date().toISOString(),
        business: { id: 'EVIL-BIZ', name: 'Evil Source', currency: 'INR', createdAt: new Date().toISOString() },
        settings: {
          language: 'hi', // one safe field to confirm restore still runs
          pinHash: 'EVIL-HASH',
          pinEnabled: false,
          userRole: 'owner',
          gateDangerZone: true,
          telegramEnabled: false,
        },
        parties: [],
        products: [],
        invoices: [],
        invoiceItems: [],
        transactions: [],
        categories: [],
        customPrices: [],
        staff: [],
        partyNotes: [],
        stockMovements: [],
      }
      const validation = validateBackup(rawEnvelope)
      assert(validation.ok, 'H: envelope with malicious settings validates (sanitizer strips extras)')
      const envelope = validation.envelope!

      // §PROVE-STRIPPED: envelope.settings has NO security fields
      const s = envelope.settings as any
      assert(!('pinHash' in s), 'H1: pinHash stripped from envelope.settings')
      assert(!('pinEnabled' in s), 'H2: pinEnabled stripped from envelope.settings')
      assert(!('userRole' in s), 'H3: userRole stripped from envelope.settings')
      assert(!('gateDangerZone' in s), 'H4: gateDangerZone stripped from envelope.settings')
      assert(!('telegramEnabled' in s), 'H5: telegramEnabled stripped from envelope.settings')

      const result = await runImport(envelope, target.id, DEFAULT_IMPORT_OPTIONS)
      assert(result.failed.errors.length === 0, 'H6: import succeeded')

      const r = await db.appSettings.findUnique({ where: { businessId: target.id } })
      assert(r !== null, 'H7: target AppSettings exists')
      if (r) {
        // §SECURITY-UNTOUCHED: all target security values preserved
        assertEqual(r.pinHash, 'ORIG-HASH', 'H8: pinHash NOT modified by malicious backup')
        assertEqual(r.pinEnabled, true, 'H9: pinEnabled NOT modified')
        assertEqual(r.userRole, 'manager', 'H10: userRole NOT modified')
        assertEqual(r.gateDangerZone, false, 'H11: gateDangerZone NOT modified')
        assertEqual(r.telegramEnabled, true, 'H12: telegramEnabled NOT modified')
        // §SAFE-FIELD-RESTORED: the one safe field DID restore
        assertEqual(r.language, 'hi', 'H13: safe field (language) restored despite malicious extras')
      }
    }

    console.log(`\n✅ Passed: ${passed}`)
    console.log(`❌ Failed: ${failed}`)
  } finally {
    console.log('\n  Cleaning up...')
    await cleanup()
    console.log('  Done.')
  }
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
