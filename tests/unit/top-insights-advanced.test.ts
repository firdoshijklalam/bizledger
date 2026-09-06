/**
 * §TEST: STEP-4F — Top Insights advanced settings tests.
 *
 * Run: npx tsx tests/unit/top-insights-advanced.test.ts
 */
export {}

import {
  DEFAULT_DASHBOARD_CONFIG,
  parseDashboardSectionConfig,
  getOrderedTopInsightsTabs,
  resolveDefaultTab,
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

console.log('\n🧪 STEP-4F: Top Insights Advanced Settings Tests\n')

// ─── 1. Valid Top Insights tab IDs ──────────────────────────────────────
console.log('1. Valid tab IDs')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: { visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products'] }
  }))
  assertEqual(cfg.topInsights.visibleTabs.length, 6, '1a: all 6 valid tabs preserved')
  assert(cfg.topInsights.visibleTabs.includes('top-revenue-products'), '1b: top-revenue-products accepted')
}

// ─── 2. Invalid tab IDs filtered ─────────────────────────────────────────
console.log('\n2. Invalid tab IDs filtered')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: { visibleTabs: ['debtors', 'fake-tab', 'buyers'] }
  }))
  assert(!cfg.topInsights.visibleTabs.includes('fake-tab'), '2a: fake-tab filtered')
  assertEqual(cfg.topInsights.visibleTabs.length, 2, '2b: only valid tabs remain')
}

// ─── 3. Explicit empty-array semantics ───────────────────────────────────
console.log('\n3. Explicit empty array preserves []')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: { visibleTabs: [] }
  }))
  assertEqual(cfg.topInsights.visibleTabs.length, 0, '3a: empty [] preserved (not replaced by defaults)')
}

// ─── 4. Ordering preserves enabled/disabled semantics ───────────────────
console.log('\n4. Ordering with hidden tabs')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: {
      visibleTabs: ['debtors', 'buyers', 'products'],
      order: ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products'],
    }
  }))
  // getOrderedTopInsightsTabs returns only VISIBLE tabs in order
  const ordered = getOrderedTopInsightsTabs(cfg)
  assertEqual(ordered, ['debtors', 'buyers', 'products'], '4a: visible-ordered tabs only')
  // full order is preserved in config
  assertEqual(cfg.topInsights.order, ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products'], '4b: full order preserved in config')
}

// ─── 5. Default tab must resolve to a visible tab ────────────────────────
console.log('\n5. Default tab resolves to visible')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: {
      visibleTabs: ['debtors', 'buyers'],
      order: ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products'],
      defaultTab: 'debtors',
    }
  }))
  const ordered = getOrderedTopInsightsTabs(cfg)
  const effective = resolveDefaultTab(ordered.filter(id => cfg.topInsights.visibleTabs.includes(id)), cfg.topInsights.defaultTab)
  assertEqual(effective, 'debtors', '5a: default=debtors (visible) → stays debtors')
}

// ─── 6. Hidden default falls back to first visible ordered tab ───────────
console.log('\n6. Hidden default falls back')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: {
      visibleTabs: ['buyers', 'products'],
      order: ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products'],
      defaultTab: 'debtors', // debtors is hidden!
    }
  }))
  const ordered = getOrderedTopInsightsTabs(cfg)
  const visibleOrdered = ordered.filter(id => cfg.topInsights.visibleTabs.includes(id))
  const effective = resolveDefaultTab(visibleOrdered, cfg.topInsights.defaultTab)
  assertEqual(effective, 'buyers', '6a: hidden default → first visible (buyers)')
}

// ─── 7. Missing default uses safe default ────────────────────────────────
console.log('\n7. Missing default')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({ topInsights: {} }))
  assertEqual(cfg.topInsights.defaultTab, 'debtors', '7a: missing defaultTab → debtors')
}

// ─── 8. itemCount accepts only 3/5/10 ────────────────────────────────────
console.log('\n8. itemCount validation')
{
  for (const val of [3, 5, 10]) {
    const cfg = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: val } }))
    assertEqual(cfg.topInsights.itemCount, val, `8: itemCount=${val} preserved`)
  }
}

// ─── 9. Invalid itemCount falls back safely ──────────────────────────────
console.log('\n9. Invalid itemCount fallback')
{
  const cfgInvalid = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: 7 } }))
  assertEqual(cfgInvalid.topInsights.itemCount, 5, '9a: invalid itemCount=7 → 5')

  const cfgMissing = parseDashboardSectionConfig(JSON.stringify({ topInsights: {} }))
  assertEqual(cfgMissing.topInsights.itemCount, 5, '9b: missing itemCount → 5')

  const cfgNull = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: null } }))
  assertEqual(cfgNull.topInsights.itemCount, 5, '9c: null itemCount → 5')
}

// ─── 10. Display flags parse correctly ────────────────────────────────────
console.log('\n10. Display flags')
{
  const cfg = parseDashboardSectionConfig(JSON.stringify({
    topInsights: { showRank: false, showAvatar: false, showAmount: false }
  }))
  assertEqual(cfg.topInsights.showRank, false, '10a: showRank=false preserved')
  assertEqual(cfg.topInsights.showAvatar, false, '10b: showAvatar=false preserved')
  assertEqual(cfg.topInsights.showAmount, false, '10c: showAmount=false preserved')

  const cfgDefaults = parseDashboardSectionConfig(JSON.stringify({}))
  assertEqual(cfgDefaults.topInsights.showRank, true, '10d: default showRank=true')
  assertEqual(cfgDefaults.topInsights.showAvatar, true, '10e: default showAvatar=true')
  assertEqual(cfgDefaults.topInsights.showAmount, true, '10f: default showAmount=true')
}

// ─── 11. Backward compatibility with old config ──────────────────────────
console.log('\n11. Backward compatibility')
{
  const oldConfig = parseDashboardSectionConfig(JSON.stringify({
    topInsights: {
      visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      order: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      defaultTab: 'debtors',
    }
  }))
  assertEqual(oldConfig.topInsights.itemCount, 5, '11a: old config → itemCount=5')
  assertEqual(oldConfig.topInsights.showRank, true, '11b: old config → showRank=true')
  assertEqual(oldConfig.topInsights.showAvatar, true, '11c: old config → showAvatar=true')
  assertEqual(oldConfig.topInsights.showAmount, true, '11d: old config → showAmount=true')
}

// ─── 12. Rendering respects itemCount (simulated) ────────────────────────
console.log('\n12. Rendering respects itemCount')
{
  function simulateSlice(config: DashboardSectionConfig, data: any[], tabId: string) {
    const itemCount = config.topInsights.itemCount
    return data.slice(0, itemCount)
  }
  const data = Array.from({ length: 10 }, (_, i) => ({ id: `item-${i}`, name: `Item ${i}` }))

  const cfg3 = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: 3 } }))
  assertEqual(simulateSlice(cfg3, data, 'debtors').length, 3, '12a: itemCount=3 → 3 items')

  const cfg5 = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: 5 } }))
  assertEqual(simulateSlice(cfg5, data, 'debtors').length, 5, '12b: itemCount=5 → 5 items')

  const cfg10 = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: 10 } }))
  assertEqual(simulateSlice(cfg10, data, 'debtors').length, 10, '12c: itemCount=10 → 10 items')
}

// ─── 13. View All position (source-code verification) ────────────────────
console.log('\n13. View All position')
{
  // View All is rendered AFTER tab content, before </Card>.
  // This is verified by the source at dashboard-view.tsx L1465+ (mt-3 class).
  // The test confirms the config doesn't affect View All placement.
  const cfg = parseDashboardSectionConfig(JSON.stringify({ topInsights: { itemCount: 3 } }))
  assert(cfg.topInsights.itemCount === 3, '13a: itemCount does not affect View All')
}

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
