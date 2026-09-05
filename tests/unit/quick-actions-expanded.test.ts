/**
 * §TEST: STEP-4E-REVIEW — Quick Actions expanded catalog + maxVisible tests.
 *
 * Run: npx tsx tests/unit/quick-actions-expanded.test.ts
 *
 * Tests:
 * 1. maxVisible accepts 4, 6, 8
 * 2. invalid/missing maxVisible falls back to 4
 * 3. Quick Actions rendering respects maxVisible (displayed vs overflow)
 * 4. overflow contains remaining enabled actions
 * 5. disabling/re-enabling actions preserves deterministic order
 * 6. existing 4-action default remains backward-compatible
 * 7. expanded VALID_QUICK_ACTIONS includes new action IDs
 */
export {}

import {
  DEFAULT_DASHBOARD_CONFIG,
  parseDashboardSectionConfig,
  getOrderedQuickActions,
  type DashboardSectionConfig,
} from '../../src/lib/dashboard-preferences'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

console.log('\n🧪 STEP-4E-REVIEW: Quick Actions Expanded Catalog + maxVisible Tests\n')

// ─── 1. maxVisible accepts 4, 6, 8 ────────────────────────────────────────
console.log('1. maxVisible accepts 4, 6, 8')
{
  for (const val of [4, 6, 8]) {
    const cfg = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { maxVisible: val }
    }))
    assertEqual(cfg.quickActions.maxVisible, val, `1: maxVisible=${val} preserved`)
  }
}

// ─── 2. invalid/missing maxVisible falls back to 4 ──────────────────────
console.log('\n2. invalid/missing maxVisible falls back to 4')
{
  const cfgMissing = parseDashboardSectionConfig(JSON.stringify({ quickActions: {} }))
  assertEqual(cfgMissing.quickActions.maxVisible, 4, '2a: missing maxVisible → 4')

  const cfgInvalid = parseDashboardSectionConfig(JSON.stringify({ quickActions: { maxVisible: 5 } }))
  assertEqual(cfgInvalid.quickActions.maxVisible, 4, '2b: maxVisible=5 → 4 (invalid)')

  const cfgNull = parseDashboardSectionConfig(JSON.stringify({ quickActions: { maxVisible: null } }))
  assertEqual(cfgNull.quickActions.maxVisible, 4, '2c: null maxVisible → 4')

  const cfgString = parseDashboardSectionConfig(JSON.stringify({ quickActions: { maxVisible: '4' } }))
  assertEqual(cfgString.quickActions.maxVisible, 4, '2d: string maxVisible → 4')

  const cfgNoQuickActions = parseDashboardSectionConfig(JSON.stringify({}))
  assertEqual(cfgNoQuickActions.quickActions.maxVisible, 4, '2e: no quickActions → 4')
}

// ─── 3. Quick Actions rendering respects maxVisible ─────────────────────
console.log('\n3. Rendering respects maxVisible (displayed vs overflow)')
{
  // Simulate the dashboard-view rendering logic
  function simulateRender(config: DashboardSectionConfig, allActions: string[]) {
    const orderedIds = getOrderedQuickActions(config)
    const visibleActions = orderedIds.filter(id => allActions.includes(id))
    const maxVisible = config.quickActions.maxVisible
    const displayed = visibleActions.slice(0, maxVisible)
    const overflow = visibleActions.slice(maxVisible)
    return { displayed, overflow, total: visibleActions.length }
  }

  const allActions = ['add-party', 'add-product', 'new-invoice', 'add-transaction', 'view-invoices', 'low-stock', 'add-customer', 'add-supplier']

  const cfg4 = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: allActions,
      order: allActions,
      maxVisible: 4,
    }
  }))
  const r4 = simulateRender(cfg4, allActions)
  assertEqual(r4.displayed.length, 4, '3a: maxVisible=4 → 4 displayed')
  assertEqual(r4.overflow.length, 4, '3b: maxVisible=4 → 4 overflow')

  const cfg6 = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: allActions,
      order: allActions,
      maxVisible: 6,
    }
  }))
  const r6 = simulateRender(cfg6, allActions)
  assertEqual(r6.displayed.length, 6, '3c: maxVisible=6 → 6 displayed')
  assertEqual(r6.overflow.length, 2, '3d: maxVisible=6 → 2 overflow')

  const cfg8 = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: allActions,
      order: allActions,
      maxVisible: 8,
    }
  }))
  const r8 = simulateRender(cfg8, allActions)
  assertEqual(r8.displayed.length, 8, '3e: maxVisible=8 → 8 displayed')
  assertEqual(r8.overflow.length, 0, '3f: maxVisible=8 → 0 overflow')
}

// ─── 4. overflow contains remaining enabled actions ─────────────────────
console.log('\n4. overflow contains remaining enabled actions')
{
  const allActions = ['add-party', 'add-product', 'new-invoice', 'add-transaction', 'view-invoices', 'low-stock', 'add-customer', 'add-supplier']
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: allActions,
      order: allActions,
      maxVisible: 4,
    }
  }))
  const orderedIds = getOrderedQuickActions(cfg)
  const displayed = orderedIds.slice(0, 4)
  const overflow = orderedIds.slice(4)
  assertEqual(displayed, ['add-party', 'add-product', 'new-invoice', 'add-transaction'], '4a: first 4 displayed')
  assertEqual(overflow, ['view-invoices', 'low-stock', 'add-customer', 'add-supplier'], '4b: remaining 4 in overflow')
}

// ─── 5. disabling/re-enabling actions preserves deterministic order ──────
console.log('\n5. disabling/re-enabling preserves deterministic order')
{
  const allActions = ['add-party', 'add-product', 'new-invoice', 'add-transaction', 'view-invoices', 'low-stock', 'add-customer', 'add-supplier']

  // Start with all 8 visible
  const cfgAll = parseDashboardSectionConfig(JSON.stringify({
    quickActions: { visibleActions: allActions, order: allActions, maxVisible: 4 }
  }))

  // Disable 'view-invoices' and 'add-customer'
  const cfgDisabled = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: ['add-party', 'add-product', 'new-invoice', 'add-transaction', 'low-stock', 'add-supplier'],
      order: allActions, // order preserves all IDs
      maxVisible: 4,
    }
  }))
  const orderedDisabled = getOrderedQuickActions(cfgDisabled)
  assert(!orderedDisabled.includes('view-invoices'), '5a: view-invoices not in ordered (disabled)')
  assert(!orderedDisabled.includes('add-customer'), '5b: add-customer not in ordered (disabled)')
  assertEqual(orderedDisabled.length, 6, '5c: 6 visible actions')

  // Re-enable view-invoices and add-customer
  const cfgReEnabled = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: allActions,
      order: allActions,
      maxVisible: 4,
    }
  }))
  const orderedReEnabled = getOrderedQuickActions(cfgReEnabled)
  assertEqual(orderedReEnabled, allActions, '5d: re-enabled → original order restored deterministically')
}

// ─── 6. existing 4-action default remains backward-compatible ────────────
console.log('\n6. existing 4-action default remains backward-compatible')
{
  // Old config WITHOUT maxVisible and WITHOUT new actions
  const oldConfig = parseDashboardSectionConfig(JSON.stringify({
    quickActions: {
      visibleActions: ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
      order: ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
    }
  }))
  assertEqual(oldConfig.quickActions.maxVisible, 4, '6a: old config → maxVisible defaults to 4')
  assertEqual(oldConfig.quickActions.visibleActions, ['add-party', 'add-product', 'new-invoice', 'add-transaction'], '6b: old config → 4 actions preserved')
  assertEqual(oldConfig.quickActions.order, ['add-party', 'add-product', 'new-invoice', 'add-transaction'], '6c: old config → order preserved')

  const ordered = getOrderedQuickActions(oldConfig)
  assertEqual(ordered.length, 4, '6d: 4 ordered actions')
  assertEqual(ordered, ['add-party', 'add-product', 'new-invoice', 'add-transaction'], '6e: correct order')
}

// ─── 7. expanded VALID_QUICK_ACTIONS includes new action IDs ─────────────
console.log('\n7. Expanded VALID_QUICK_ACTIONS includes new action IDs')
{
  const newActionIds = ['view-invoices', 'low-stock', 'add-customer', 'add-supplier']
  for (const id of newActionIds) {
    const cfg = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [id] }
    }))
    assert(cfg.quickActions.visibleActions.includes(id), `7: ${id} accepted by parser`)
  }

  // Unknown action ID is filtered
  const cfgUnknown = parseDashboardSectionConfig(JSON.stringify({
    quickActions: { visibleActions: ['fake-action'] }
  }))
  assert(!cfgUnknown.quickActions.visibleActions.includes('fake-action'), '7e: unknown action filtered')
}

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
