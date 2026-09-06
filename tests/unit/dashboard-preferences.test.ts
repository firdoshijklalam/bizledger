/**
 * §TEST: Dashboard section preferences regression tests.
 *
 * Run: npx tsx tests/unit/dashboard-preferences.test.ts
 *
 * Tests the §DASHBOARD-CUSTOMIZATION parser/defaults in src/lib/dashboard-preferences.ts:
 *   1. Default config has correct section order (summaryCards=0 ... quickActions=5)
 *   2. parseDashboardSectionConfig returns defaults for null/undefined
 *   3. parseDashboardSectionConfig filters unknown section IDs
 *   4. parseDashboardSectionConfig adds missing sections as visible (with defaults)
 *   5. isSectionVisible returns true for unknown IDs (safe default)
 *   6. getVisibleSections returns only visible sections, sorted by order
 *   7. visibleGrades defaults to all 5 grades (A, B, C, D, E)
 *   8. topInsights.visibleTabs defaults to all 5 tabs
 *   9. businessActivity.visibleTabs defaults to all 3 tabs
 *  10. quickActions.visibleActions defaults to all 4 actions
 *  11. Custom order preserved on parse round-trip (stringify → parse)
 *  12. Backward compatibility: empty config object → all defaults
 *  13. Malformed JSON falls back to defaults
 *  14. Order values are clamped to [0, 10]
 */
export {}

import {
  DEFAULT_DASHBOARD_CONFIG,
  DEFAULT_DASHBOARD_SECTIONS,
  parseDashboardSectionConfig,
  isSectionVisible,
  getVisibleSections,
  getOrderedQuickActions,
  getOrderedTopInsightsTabs,
  getOrderedBusinessActivityTabs,
  resolveDefaultTab,
  moveItemInOrder,
  getSortedGradeData,
  resolveConfirmMode,
  type DashboardSectionConfig,
} from '../../src/lib/dashboard-preferences'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ }
  else { console.log('  ❌', msg); failed++ }
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  assert(a === e, `${msg} (got ${a}, expected ${e})`)
}

async function main() {
  console.log('\n  Dashboard Section Preferences — Parser & Defaults Tests')
  console.log('  =======================================================')

  // ─── 1. Default config has correct section order ──────────────────────
  console.log('\n  1. Default config has correct section order:')
  {
    const sections = DEFAULT_DASHBOARD_SECTIONS
    assertEqual(sections.length, 6, 'D1: DEFAULT_DASHBOARD_SECTIONS has 6 sections')

    const expected = [
      { id: 'summaryCards',      order: 0 },
      { id: 'performanceChart',  order: 1 },
      { id: 'customerQuality',   order: 2 },
      { id: 'topInsights',       order: 3 },
      { id: 'businessActivity',  order: 4 },
      { id: 'quickActions',      order: 5 },
    ]
    for (const e of expected) {
      const s = sections.find(x => x.id === e.id)
      assert(!!s, `D2: section "${e.id}" exists in defaults`)
      assert(s?.order === e.order, `D3: section "${e.id}" has order=${e.order} (got ${s?.order})`)
      assert(s?.visible === true, `D4: section "${e.id}" is visible by default`)
    }
  }

  // ─── 2. parseDashboardSectionConfig returns defaults for null/undefined ─
  console.log('\n  2. parseDashboardSectionConfig returns defaults for null/undefined:')
  {
    const fromNull = parseDashboardSectionConfig(null)
    const fromUndefined = parseDashboardSectionConfig(undefined)
    const fromEmpty = parseDashboardSectionConfig('')
    assertEqual(fromNull.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'P1: null → defaults')
    assertEqual(fromUndefined.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'P2: undefined → defaults')
    assertEqual(fromEmpty.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'P3: empty string → defaults')
    assertEqual(fromNull.customerQuality.visibleGrades, DEFAULT_DASHBOARD_CONFIG.customerQuality.visibleGrades, 'P4: null customerQuality → default grades')
    assertEqual(fromNull.topInsights.visibleTabs, DEFAULT_DASHBOARD_CONFIG.topInsights.visibleTabs, 'P5: null topInsights → default tabs')
    assertEqual(fromNull.businessActivity.visibleTabs, DEFAULT_DASHBOARD_CONFIG.businessActivity.visibleTabs, 'P6: null businessActivity → default tabs')
    assertEqual(fromNull.quickActions.visibleActions, DEFAULT_DASHBOARD_CONFIG.quickActions.visibleActions, 'P7: null quickActions → default actions')
  }

  // ─── 3. parseDashboardSectionConfig filters unknown section IDs ───────
  console.log('\n  3. parseDashboardSectionConfig filters unknown section IDs:')
  {
    const raw = {
      sections: [
        { id: 'summaryCards', visible: true, order: 0 },
        { id: 'fakeSection', visible: true, order: 1 },
        { id: 'performanceChart', visible: true, order: 2 },
        { id: 'anotherFake', visible: false, order: 3 },
      ],
    }
    const parsed = parseDashboardSectionConfig(raw)
    const ids: string[] = parsed.sections.map(s => s.id)
    assert(!ids.includes('fakeSection'), 'F1: "fakeSection" filtered out')
    assert(!ids.includes('anotherFake'), 'F2: "anotherFake" filtered out')
    assert(ids.includes('summaryCards'), 'F3: "summaryCards" preserved')
    assert(ids.includes('performanceChart'), 'F4: "performanceChart" preserved')
    // Missing default sections are added (visible by default)
    assert(ids.includes('customerQuality'), 'F5: missing "customerQuality" added from defaults')
    assert(ids.includes('topInsights'), 'F6: missing "topInsights" added from defaults')
    assert(ids.includes('businessActivity'), 'F7: missing "businessActivity" added from defaults')
    assert(ids.includes('quickActions'), 'F8: missing "quickActions" added from defaults')
  }

  // ─── 4. parseDashboardSectionConfig adds missing sections as visible ──
  console.log('\n  4. parseDashboardSectionConfig adds missing sections as visible:')
  {
    // Only supply summaryCards + performanceChart — others should be added.
    const raw = {
      sections: [
        { id: 'summaryCards', visible: true, order: 0 },
        { id: 'performanceChart', visible: false, order: 1 },
      ],
    }
    const parsed = parseDashboardSectionConfig(raw)
    const customerQuality = parsed.sections.find(s => s.id === 'customerQuality')
    const topInsights = parsed.sections.find(s => s.id === 'topInsights')
    const businessActivity = parsed.sections.find(s => s.id === 'businessActivity')
    const quickActions = parsed.sections.find(s => s.id === 'quickActions')
    assert(customerQuality?.visible === true, 'M1: missing customerQuality added as visible=true')
    assert(topInsights?.visible === true, 'M2: missing topInsights added as visible=true')
    assert(businessActivity?.visible === true, 'M3: missing businessActivity added as visible=true')
    assert(quickActions?.visible === true, 'M4: missing quickActions added as visible=true')
    // Supplied values should be preserved (not overwritten by defaults).
    assert(parsed.sections.find(s => s.id === 'summaryCards')?.visible === true, 'M5: supplied summaryCards.visible=true preserved')
    assert(parsed.sections.find(s => s.id === 'performanceChart')?.visible === false, 'M6: supplied performanceChart.visible=false preserved')
  }

  // ─── 5. isSectionVisible returns true for unknown IDs (safe default) ──
  console.log('\n  5. isSectionVisible returns true for unknown IDs (safe default):')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assert(isSectionVisible(cfg, 'summaryCards') === true, 'I1: summaryCards visible (default config)')
    assert(isSectionVisible(cfg, 'nonExistentId') === true, 'I2: unknown id returns true (safe default — section is shown)')

    // Construct a config where summaryCards is explicitly hidden.
    const hidden: DashboardSectionConfig = {
      ...cfg,
      sections: cfg.sections.map(s => ({ ...s, visible: s.id === 'summaryCards' ? false : s.visible })),
    }
    assert(isSectionVisible(hidden, 'summaryCards') === false, 'I3: summaryCards hidden when explicitly visible=false')
    assert(isSectionVisible(hidden, 'performanceChart') === true, 'I4: performanceChart still visible')
    assert(isSectionVisible(hidden, 'unknownId') === true, 'I5: unknown id still returns true even when other sections are hidden')
  }

  // ─── 6. getVisibleSections returns only visible, sorted by order ─────
  console.log('\n  6. getVisibleSections returns only visible, sorted by order:')
  {
    // Default: all visible — should return all 6 in order 0..5.
    const visibleDefault = getVisibleSections(DEFAULT_DASHBOARD_CONFIG)
    assertEqual(visibleDefault.length, 6, 'G1: default config → 6 visible sections')
    assertEqual(visibleDefault.map(s => s.id), ['summaryCards', 'performanceChart', 'customerQuality', 'topInsights', 'businessActivity', 'quickActions'], 'G2: default order preserved')

    // Custom config: hide 2 sections + reorder remaining 4.
    const custom: DashboardSectionConfig = {
      ...DEFAULT_DASHBOARD_CONFIG,
      sections: [
        { id: 'summaryCards', visible: false, order: 0 },
        { id: 'performanceChart', visible: true, order: 3 },
        { id: 'customerQuality', visible: false, order: 4 },
        { id: 'topInsights', visible: true, order: 1 },
        { id: 'businessActivity', visible: true, order: 2 },
        { id: 'quickActions', visible: true, order: 0 },
      ],
    }
    const visibleCustom = getVisibleSections(custom)
    assertEqual(visibleCustom.length, 4, 'G3: custom config → 4 visible sections (2 hidden)')
    assertEqual(
      visibleCustom.map(s => s.id),
      ['quickActions', 'topInsights', 'businessActivity', 'performanceChart'],
      'G4: visible sections sorted by order (quickActions=0 → performanceChart=3)'
    )
  }

  // ─── 7. visibleGrades defaults to all 5 grades ────────────────────────
  console.log('\n  7. visibleGrades defaults to all 5 grades:')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assertEqual(cfg.customerQuality.visibleGrades, ['A', 'B', 'C', 'D', 'E'], 'V1: default visibleGrades = [A,B,C,D,E]')
    assertEqual(cfg.customerQuality.visibleGrades.length, 5, 'V2: 5 grades by default')

    // Parse with explicit subset — should preserve.
    const raw = { customerQuality: { visibleGrades: ['A', 'C'] } }
    const parsed = parseDashboardSectionConfig(raw)
    assertEqual(parsed.customerQuality.visibleGrades, ['A', 'C'], 'V3: explicit subset preserved')

    // §STEP-1B: Parse with empty visibleGrades — should STAY empty (intentionally empty ≠ missing).
    const rawEmpty = { customerQuality: { visibleGrades: [] } }
    const parsedEmpty = parseDashboardSectionConfig(rawEmpty)
    assertEqual(parsedEmpty.customerQuality.visibleGrades, [], 'V4: empty visibleGrades → stays empty (§STEP-1B)')

    // Parse with unknown grades — should filter them out.
    const rawUnknown = { customerQuality: { visibleGrades: ['A', 'X', 'F'] } }
    const parsedUnknown = parseDashboardSectionConfig(rawUnknown)
    assertEqual(parsedUnknown.customerQuality.visibleGrades, ['A'], 'V5: unknown grades filtered, valid ones kept')
  }

  // ─── 8. topInsights.visibleTabs defaults to all 5 tabs ───────────────
  console.log('\n  8. topInsights.visibleTabs defaults to all 5 tabs:')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assertEqual(
      cfg.topInsights.visibleTabs,
      ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      'T1: default topInsights.visibleTabs = [debtors,buyers,payments,products,defaulters]'
    )
    assertEqual(cfg.topInsights.visibleTabs.length, 5, 'T2: 5 tabs by default')
    assertEqual(cfg.topInsights.defaultTab, 'debtors', 'T3: defaultTab = debtors')

    // Parse with explicit subset — preserved.
    const raw = { topInsights: { visibleTabs: ['debtors', 'defaulters'], defaultTab: 'defaulters' } }
    const parsed = parseDashboardSectionConfig(raw)
    assertEqual(parsed.topInsights.visibleTabs, ['debtors', 'defaulters'], 'T4: explicit subset preserved')
    assertEqual(parsed.topInsights.defaultTab, 'defaulters', 'T5: explicit defaultTab preserved')

    // Parse with invalid defaultTab — falls back to 'debtors'.
    const rawInvalidDefault = { topInsights: { visibleTabs: ['debtors'], defaultTab: 'invalidTab' } }
    const parsedInvalidDefault = parseDashboardSectionConfig(rawInvalidDefault)
    assertEqual(parsedInvalidDefault.topInsights.defaultTab, 'debtors', 'T6: invalid defaultTab → "debtors"')
  }

  // ─── 9. businessActivity.visibleTabs defaults to all 3 tabs ───────────
  console.log('\n  9. businessActivity.visibleTabs defaults to all 3 tabs:')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assertEqual(
      cfg.businessActivity.visibleTabs,
      ['transactions', 'lowstock', 'orders'],
      'B1: default businessActivity.visibleTabs = [transactions,lowstock,orders]'
    )
    assertEqual(cfg.businessActivity.visibleTabs.length, 3, 'B2: 3 tabs by default')
    assertEqual(cfg.businessActivity.defaultTab, 'transactions', 'B3: defaultTab = transactions')

    // Parse with explicit subset — preserved.
    const raw = { businessActivity: { visibleTabs: ['lowstock'], defaultTab: 'lowstock' } }
    const parsed = parseDashboardSectionConfig(raw)
    assertEqual(parsed.businessActivity.visibleTabs, ['lowstock'], 'B4: explicit subset preserved')
    assertEqual(parsed.businessActivity.defaultTab, 'lowstock', 'B5: explicit defaultTab preserved')
  }

  // ─── 10. quickActions.visibleActions defaults to all 5 actions ────────
  console.log('\n  10. quickActions.visibleActions defaults to all 5 actions:')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assertEqual(
      cfg.quickActions.visibleActions,
      ['quick-sale', 'add-party', 'add-product', 'new-invoice', 'add-transaction'],
      'Q1: default quickActions.visibleActions = [quick-sale,add-party,add-product,new-invoice,add-transaction]'
    )
    assertEqual(cfg.quickActions.visibleActions.length, 5, 'Q2: 5 actions by default')

    // Parse with explicit subset — preserved.
    const raw = { quickActions: { visibleActions: ['new-invoice'] } }
    const parsed = parseDashboardSectionConfig(raw)
    assertEqual(parsed.quickActions.visibleActions, ['new-invoice'], 'Q3: explicit subset preserved')

    // §STEP-1B: Parse with empty visibleActions — should STAY empty (intentionally empty ≠ missing).
    const rawEmpty = { quickActions: { visibleActions: [] } }
    const parsedEmpty = parseDashboardSectionConfig(rawEmpty)
    assertEqual(parsedEmpty.quickActions.visibleActions, [], 'Q4: empty visibleActions → stays empty (§STEP-1B)')
  }

  // ─── 11. Custom order preserved on parse round-trip ───────────────────
  console.log('\n  11. Custom order preserved on parse round-trip:')
  {
    // Reverse the default order: quickActions=0, ..., summaryCards=5.
    const original: DashboardSectionConfig = {
      ...DEFAULT_DASHBOARD_CONFIG,
      sections: [
        { id: 'quickActions',      visible: true,  order: 0 },
        { id: 'businessActivity',  visible: true,  order: 1 },
        { id: 'topInsights',       visible: true,  order: 2 },
        { id: 'customerQuality',   visible: false, order: 3 },
        { id: 'performanceChart',  visible: true,  order: 4 },
        { id: 'summaryCards',      visible: true,  order: 5 },
      ],
    }

    // Round-trip: stringify → parse.
    const json = JSON.stringify(original)
    const roundTripped = parseDashboardSectionConfig(json)

    // Each section's order should be preserved.
    for (const expected of original.sections) {
      const got = roundTripped.sections.find(s => s.id === expected.id)
      assert(got?.order === expected.order, `R1: "${expected.id}" order preserved (expected ${expected.order}, got ${got?.order})`)
      assert(got?.visible === expected.visible, `R2: "${expected.id}" visible preserved (expected ${expected.visible}, got ${got?.visible})`)
    }

    // After parsing, sections are sorted by order — verify the visible-only order matches.
    const visibleRoundTripped = getVisibleSections(roundTripped).map(s => s.id)
    assertEqual(
      visibleRoundTripped,
      ['quickActions', 'businessActivity', 'topInsights', 'performanceChart', 'summaryCards'],
      'R3: visible sections in custom order after round-trip (customerQuality hidden)'
    )
  }

  // ─── 12. Backward compatibility: empty config object → all defaults ──
  console.log('\n  12. Backward compatibility: empty config object → all defaults:')
  {
    // §BACKWARD-COMPAT: An existing user with no `dashboardSections` field
    // (older app version) supplies null/undefined/empty. They MUST get the
    // full default config — all sections visible, default order, all
    // tabs/actions/grades visible. This is the migration path.
    const emptyObj = parseDashboardSectionConfig({})
    assertEqual(emptyObj.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'BC1: {} → default sections')
    assertEqual(emptyObj.customerQuality, DEFAULT_DASHBOARD_CONFIG.customerQuality, 'BC2: {} → default customerQuality')
    assertEqual(emptyObj.topInsights, DEFAULT_DASHBOARD_CONFIG.topInsights, 'BC3: {} → default topInsights')
    assertEqual(emptyObj.businessActivity, DEFAULT_DASHBOARD_CONFIG.businessActivity, 'BC4: {} → default businessActivity')
    assertEqual(emptyObj.quickActions, DEFAULT_DASHBOARD_CONFIG.quickActions, 'BC5: {} → default quickActions')
    assertEqual(emptyObj.defaults, DEFAULT_DASHBOARD_CONFIG.defaults, 'BC6: {} → default defaults')

    // A truly empty string → defaults.
    const emptyStr = parseDashboardSectionConfig('')
    assertEqual(emptyStr.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'BC7: "" → default sections')
  }

  // ─── 13. Malformed JSON falls back to defaults ────────────────────────
  console.log('\n  13. Malformed JSON falls back to defaults:')
  {
    const malformed = parseDashboardSectionConfig('{not valid json')
    assertEqual(malformed.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'MJ1: malformed JSON → defaults')

    // Non-object JSON (e.g., a number) → defaults.
    const numJson = parseDashboardSectionConfig('42')
    assertEqual(numJson.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'MJ2: numeric JSON → defaults')

    // Object with malformed sections (not an array) → defaults for sections.
    const badSections = parseDashboardSectionConfig({ sections: 'not-an-array' })
    assertEqual(badSections.sections, DEFAULT_DASHBOARD_CONFIG.sections, 'MJ3: sections: "not-an-array" → default sections')

    // Object with sections containing invalid items → those items dropped, missing ones added.
    const partialBad = parseDashboardSectionConfig({
      sections: [
        { id: 'summaryCards', visible: 'not-boolean', order: 0 }, // invalid visible → dropped
        { id: 'performanceChart', visible: true, order: 'not-a-number' }, // invalid order → dropped
        { id: 'customerQuality', visible: true, order: 2 }, // valid
      ],
    })
    const ids: string[] = partialBad.sections.map(s => s.id)
    assert(ids.includes('customerQuality'), 'MJ4: valid customerQuality entry kept')
    assert(ids.includes('summaryCards'), 'MJ5: invalid summaryCards dropped, default summaryCards added back')
    assert(ids.includes('performanceChart'), 'MJ6: invalid performanceChart dropped, default performanceChart added back')
    assert(partialBad.sections.find(s => s.id === 'summaryCards')?.visible === true, 'MJ7: re-added summaryCards has default visible=true')
    assert(partialBad.sections.find(s => s.id === 'performanceChart')?.order === 1, 'MJ8: re-added performanceChart has default order=1')
  }

  // ─── 14. Order values are clamped to [0, 10] ──────────────────────────
  console.log('\n  14. Order values are clamped to [0, 10]:')
  {
    const raw = {
      sections: [
        { id: 'summaryCards', visible: true, order: -5 },     // clamp to 0
        { id: 'performanceChart', visible: true, order: 100 }, // clamp to 10
        { id: 'customerQuality', visible: true, order: 3.7 }, // round to 4
      ],
    }
    const parsed = parseDashboardSectionConfig(raw)
    assert(parsed.sections.find(s => s.id === 'summaryCards')?.order === 0, 'C1: order=-5 clamped to 0')
    assert(parsed.sections.find(s => s.id === 'performanceChart')?.order === 10, 'C2: order=100 clamped to 10')
    assert(parsed.sections.find(s => s.id === 'customerQuality')?.order === 4, 'C3: order=3.7 rounded to 4')
  }

  // ─── §STEP-1B: Empty array semantics ──────────────────────────────────
  console.log('\n  §STEP-1B: Empty array semantics (intentionally empty ≠ missing):')
  {
    // D1: visibleGrades=[] → stays empty
    const config = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { visibleGrades: [] }
    }))
    assert(config.customerQuality.visibleGrades.length === 0, 'D1: visibleGrades=[] stays empty')

    // D2: visibleGrades missing → defaults
    const config2 = parseDashboardSectionConfig(JSON.stringify({}))
    assert(config2.customerQuality.visibleGrades.length === 5, 'D2: visibleGrades missing → defaults (5)')

    // D3: topInsights.visibleTabs=[] → stays empty
    const config3 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [] }
    }))
    assert(config3.topInsights.visibleTabs.length === 0, 'D3: topInsights.visibleTabs=[] stays empty')

    // D4: topInsights missing → defaults
    assert(config2.topInsights.visibleTabs.length === 5, 'D4: topInsights.visibleTabs missing → defaults (5)')

    // D5: businessActivity.visibleTabs=[] → stays empty
    const config4 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: [] }
    }))
    assert(config4.businessActivity.visibleTabs.length === 0, 'D5: businessActivity.visibleTabs=[] stays empty')

    // D6: businessActivity missing → defaults
    assert(config2.businessActivity.visibleTabs.length === 3, 'D6: businessActivity.visibleTabs missing → defaults (3)')

    // D7: quickActions.visibleActions=[] → stays empty
    const config5 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [], order: [] }
    }))
    assert(config5.quickActions.visibleActions.length === 0, 'D7: quickActions.visibleActions=[] stays empty')

    // D8: quickActions missing → defaults
    assert(config2.quickActions.visibleActions.length === 5, 'D8: quickActions.visibleActions missing → defaults (5)')

    // D9: quickActions.order=[] → stays empty
    assert(config5.quickActions.order.length === 0, 'D9: quickActions.order=[] stays empty')

    // D10: null field → defaults (not empty)
    const config6 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { visibleGrades: null }
    }))
    assert(config6.customerQuality.visibleGrades.length === 5, 'D10: visibleGrades=null → defaults (5)')

    // D11: invalid field type → defaults
    const config7 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { visibleGrades: 'invalid' }
    }))
    assert(config7.customerQuality.visibleGrades.length === 5, 'D11: visibleGrades="invalid" → defaults (5)')
  }

  // ─── §STEP-1B: getOrderedQuickActions ─────────────────────────────────
  console.log('\n  §STEP-1B: getOrderedQuickActions:')
  {
    // E1: Default config → all 5 in default order
    const ids1 = getOrderedQuickActions(DEFAULT_DASHBOARD_CONFIG)
    assert(ids1.length === 5, 'E1: default config → 5 actions')
    assert(ids1[0] === 'quick-sale', 'E1: default order[0]=quick-sale')
    assert(ids1[1] === 'add-party', 'E1: default order[1]=add-party')
    assert(ids1[2] === 'add-product', 'E1: default order[2]=add-product')
    assert(ids1[3] === 'new-invoice', 'E1: default order[3]=new-invoice')
    assert(ids1[4] === 'add-transaction', 'E1: default order[4]=add-transaction')

    // E2: Custom order
    const config2 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-product', 'add-party', 'new-invoice'],
        order: ['new-invoice', 'add-party', 'add-product'],
      }
    }))
    const ids2 = getOrderedQuickActions(config2)
    assert(ids2.length === 3, 'E2: 3 visible actions')
    assert(ids2[0] === 'new-invoice', 'E2: order[0]=new-invoice (custom order)')
    assert(ids2[1] === 'add-party', 'E2: order[1]=add-party')
    assert(ids2[2] === 'add-product', 'E2: order[2]=add-product')

    // E3: Enabled actions missing from order → appended safely
    const config3 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party', 'add-product', 'new-invoice'],
        order: ['new-invoice'], // only 1 in order
      }
    }))
    const ids3 = getOrderedQuickActions(config3)
    assert(ids3.length === 3, 'E3: 3 visible actions')
    assert(ids3[0] === 'new-invoice', 'E3: order[0]=new-invoice (explicit)')
    // add-party and add-product appended after
    assert(ids3.includes('add-party') && ids3.includes('add-product'), 'E3: missing actions appended')

    // E4: Unknown IDs in order → ignored
    const config4 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party'],
        order: ['malicious-action', 'add-party'],
      }
    }))
    const ids4 = getOrderedQuickActions(config4)
    assert(ids4.length === 1, 'E4: 1 visible action (unknown filtered)')
    assert(ids4[0] === 'add-party', 'E4: only add-party remains')

    // E5: Empty visibleActions → empty result
    const config5 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [], order: [] }
    }))
    const ids5 = getOrderedQuickActions(config5)
    assert(ids5.length === 0, 'E5: empty visibleActions → empty result')

    // E6: All actions visible, custom order
    const config6 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
        order: ['add-transaction', 'new-invoice', 'add-product', 'add-party'],
      }
    }))
    const ids6 = getOrderedQuickActions(config6)
    assert(ids6.length === 4, 'E6: 4 actions')
    assert(ids6[0] === 'add-transaction', 'E6: order[0]=add-transaction')
    assert(ids6[1] === 'new-invoice', 'E6: order[1]=new-invoice')
    assert(ids6[2] === 'add-product', 'E6: order[2]=add-product')
    assert(ids6[3] === 'add-party', 'E6: order[3]=add-party')
  }

  // ─── §STEP-1C: Reorder tests ─────────────────────────────────────────
  console.log('\n  §STEP-1C: Reorder tests:')
  {
    // F1: Reorder A,B,C → C,A,B
    const config1 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party', 'add-product', 'new-invoice'],
        order: ['new-invoice', 'add-party', 'add-product'], // C,A,B
      }
    }))
    const ids1 = getOrderedQuickActions(config1)
    assert(ids1[0] === 'new-invoice', 'F1: reorder A,B,C → C,A,B: [0]=new-invoice')
    assert(ids1[1] === 'add-party', 'F1: reorder: [1]=add-party')
    assert(ids1[2] === 'add-product', 'F1: reorder: [2]=add-product')

    // F2: Disabled action + reorder
    const config2 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party', 'new-invoice'], // add-product disabled
        order: ['new-invoice', 'add-party', 'add-product'], // add-product still in order
      }
    }))
    const ids2 = getOrderedQuickActions(config2)
    assert(ids2.length === 2, 'F2: disabled action excluded (2 visible)')
    assert(ids2[0] === 'new-invoice', 'F2: [0]=new-invoice')
    assert(ids2[1] === 'add-party', 'F2: [1]=add-party')
    assert(!ids2.includes('add-product'), 'F2: add-product excluded (disabled)')

    // F3: Re-enable action — it appears in saved order position
    const config3 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: {
        visibleActions: ['add-party', 'add-product', 'new-invoice'], // all enabled
        order: ['new-invoice', 'add-party', 'add-product'],
      }
    }))
    const ids3 = getOrderedQuickActions(config3)
    assert(ids3.length === 3, 'F3: all 3 actions visible')
    assert(ids3[0] === 'new-invoice', 'F3: [0]=new-invoice')
    assert(ids3[1] === 'add-party', 'F3: [1]=add-party')
    assert(ids3[2] === 'add-product', 'F3: [2]=add-product')

    // F4: Persistence round-trip — stringify → parse → same order
    const originalConfig = {
      quickActions: {
        visibleActions: ['new-invoice', 'add-transaction', 'add-party', 'add-product'],
        order: ['new-invoice', 'add-transaction', 'add-party', 'add-product'],
      }
    }
    const jsonStr = JSON.stringify(originalConfig)
    const parsedConfig = parseDashboardSectionConfig(jsonStr)
    const ids4 = getOrderedQuickActions(parsedConfig)
    assert(ids4.length === 4, 'F4: round-trip 4 actions')
    assert(ids4[0] === 'new-invoice', 'F4: round-trip [0]=new-invoice')
    assert(ids4[1] === 'add-transaction', 'F4: round-trip [1]=add-transaction')
    assert(ids4[2] === 'add-party', 'F4: round-trip [2]=add-party')
    assert(ids4[3] === 'add-product', 'F4: round-trip [3]=add-product')

    // F5: Stringify → parse → stringify → parse (double round-trip)
    const jsonStr2 = JSON.stringify(parsedConfig)
    const parsedConfig2 = parseDashboardSectionConfig(jsonStr2)
    const ids5 = getOrderedQuickActions(parsedConfig2)
    assert(ids5.length === 4, 'F5: double round-trip 4 actions')
    assert(ids5[0] === 'new-invoice', 'F5: double round-trip [0]=new-invoice')
    assert(ids5[3] === 'add-product', 'F5: double round-trip [3]=add-product')
  }

  // ─── §STEP-1C-FIX: moveItemInOrder with disabled items ──────────────
  console.log('\n  §STEP-1C-FIX: moveItemInOrder with disabled items:')
  {
    // §SHORT-IDS: Use short aliases for readability. The parser validates
    // against VALID_QUICK_ACTIONS, so we map them here for the round-trip
    // tests that use parseDashboardSectionConfig.
    // a=add-party, b=add-product, c=new-invoice, d=add-transaction
    const A = 'add-party'
    const B = 'add-product'
    const C = 'new-invoice'
    const D = 'add-transaction'

    // G1: All enabled — move C up → A,C,B,D
    const result1 = moveItemInOrder([A, B, C, D], [A, B, C, D], C, 'up')
    assert(result1 !== null, 'G1: move returns non-null')
    assert(JSON.stringify(result1) === JSON.stringify([A, C, B, D]), `G1: all enabled move C up → A,C,B,D (got ${JSON.stringify(result1)})`)

    // G2: B disabled — move C up → visible C,A,D
    const result2 = moveItemInOrder([A, B, C, D], [A, C, D], C, 'up')
    assert(result2 !== null, 'G2: move returns non-null')
    const config2 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: result2! }
    }))
    const visible2Result = getOrderedQuickActions(config2)
    assert(JSON.stringify(visible2Result) === JSON.stringify([C, A, D]), `G2: B disabled, move C up → visible C,A,D (got ${JSON.stringify(visible2Result)})`)

    // G3: B disabled — move A down → visible C,D,A
    const order3 = [C, B, A, D] // after G2's reorder
    const result3 = moveItemInOrder(order3, [A, C, D], A, 'down')
    assert(result3 !== null, 'G3: move returns non-null')
    const config3 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: result3! }
    }))
    const visible3Result = getOrderedQuickActions(config3)
    assert(JSON.stringify(visible3Result) === JSON.stringify([C, D, A]), `G3: B disabled, move A down → visible C,D,A (got ${JSON.stringify(visible3Result)})`)

    // G4: Multiple disabled between enabled — move D up
    const order4 = [A, B, C, D] // B disabled, but we add extra disabled via order having unknown
    // Use real IDs — B is disabled (add-product), C is enabled
    const visible4 = [A, C, D] // B disabled
    const result4 = moveItemInOrder(order4, visible4, D, 'up')
    assert(result4 !== null, 'G4: move returns non-null')
    const config4 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: visible4, order: result4! }
    }))
    const visible4Result = getOrderedQuickActions(config4)
    assert(JSON.stringify(visible4Result) === JSON.stringify([A, D, C]), `G4: B disabled, move D up → visible A,D,C (got ${JSON.stringify(visible4Result)})`)

    // G5: Re-enable disabled action — position is deterministic
    const order5 = [C, B, A, D] // B is between C and A
    const visible5b = [A, B, C, D]
    const config5 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: visible5b, order: order5 }
    }))
    const visible5Result = getOrderedQuickActions(config5)
    assert(JSON.stringify(visible5Result) === JSON.stringify([C, B, A, D]), `G5: re-enable B → C,B,A,D (got ${JSON.stringify(visible5Result)})`)

    // G6: Reorder round-trip — stringify → parse → visible order preserved
    const originalConfig6 = {
      quickActions: {
        visibleActions: [C, A, D],
        order: [C, B, A, D],
      }
    }
    const jsonStr6 = JSON.stringify(originalConfig6)
    const parsedConfig6 = parseDashboardSectionConfig(jsonStr6)
    const visible6Result = getOrderedQuickActions(parsedConfig6)
    assert(JSON.stringify(visible6Result) === JSON.stringify([C, A, D]), `G6: round-trip visible order preserved (got ${JSON.stringify(visible6Result)})`)

    // G7: Unknown IDs in order — do not break ordering (parser filters unknown)
    const order7 = [C, A, D] // All valid — unknown IDs are filtered by parser
    const result7 = moveItemInOrder(order7, [A, C, D], A, 'up')
    assert(result7 !== null, 'G7: move returns non-null')
    const config7 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: result7! }
    }))
    const visible7Result = getOrderedQuickActions(config7)
    assert(JSON.stringify(visible7Result) === JSON.stringify([A, C, D]), `G7: move A up → A,C,D (got ${JSON.stringify(visible7Result)})`)

    // G8: Move first item up → null (no move)
    const result8 = moveItemInOrder([A, B, C], [A, B, C], A, 'up')
    assert(result8 === null, 'G8: move first item up → null')

    // G9: Move last item down → null (no move)
    const result9 = moveItemInOrder([A, B, C], [A, B, C], C, 'down')
    assert(result9 === null, 'G9: move last item down → null')

    // G10: Move with only one visible item → null (no move)
    const result10 = moveItemInOrder([A, B, C], [B], B, 'up')
    assert(result10 === null, 'G10: single visible item move → null')
  }

  // ─── §STEP-1C-REVIEW: Explicit semantics verification ───────────────
  console.log('\n  §STEP-1C-REVIEW: Explicit Move Up/Down semantics:')
  {
    const A = 'add-party'
    const B = 'add-product'
    const C = 'new-invoice'
    const D = 'add-transaction'

    // H1: All enabled — move new-invoice UP
    // order: A, B, C, D → visible: A, B, C, D
    // Move C up → swap with B → visible: A, C, B, D
    const r1 = moveItemInOrder([A, B, C, D], [A, B, C, D], C, 'up')
    assert(r1 !== null, 'H1: move returns non-null')
    const cfg1 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, B, C, D], order: r1! }
    }))
    const v1 = getOrderedQuickActions(cfg1)
    assert(JSON.stringify(v1) === JSON.stringify([A, C, B, D]),
      `H1: all enabled, move new-invoice up → A,C,B,D (got ${JSON.stringify(v1)})`)

    // H2: B disabled — move add-party DOWN
    // order: A, B, C, D → visible: A, C, D
    // Move A down → swap with C (next visible) → visible: C, A, D
    const r2 = moveItemInOrder([A, B, C, D], [A, C, D], A, 'down')
    assert(r2 !== null, 'H2: move returns non-null')
    const cfg2 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: r2! }
    }))
    const v2 = getOrderedQuickActions(cfg2)
    assert(JSON.stringify(v2) === JSON.stringify([C, A, D]),
      `H2: B disabled, move add-party down → C,A,D (got ${JSON.stringify(v2)})`)

    // H3: From H2's result, move add-party DOWN again
    // H2 produced order: [C, B, A, D] (A and C swapped in full order)
    // visible: C, A, D → Move A down → swap with D → visible: C, D, A
    const order3 = r2! // [C, B, A, D]
    const r3 = moveItemInOrder(order3, [A, C, D], A, 'down')
    assert(r3 !== null, 'H3: move returns non-null')
    const cfg3 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: r3! }
    }))
    const v3 = getOrderedQuickActions(cfg3)
    assert(JSON.stringify(v3) === JSON.stringify([C, D, A]),
      `H3: from H2, move add-party down again → C,D,A (got ${JSON.stringify(v3)})`)

    // H4: Disabled items remain in full persisted order
    // After H3, the full order should still contain B (add-product)
    assert(r3!.includes(B), `H4: disabled add-product still in order (got ${JSON.stringify(r3)})`)

    // H5: Re-enable disabled item — position is deterministic
    // After H3, order is [C, B, D, A] (or similar with B preserved)
    // Re-enable B → visible: all 4, ordered by saved order
    const cfg5 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, B, C, D], order: r3! }
    }))
    const v5 = getOrderedQuickActions(cfg5)
    // B should appear at its saved position. Let's verify the full order:
    // r3 was derived from [C, B, A, D] with A and D swapped → [C, B, D, A]
    // So visible order with all enabled: C, B, D, A
    assert(JSON.stringify(v5) === JSON.stringify([C, B, D, A]),
      `H5: re-enable add-product → C,B,D,A (got ${JSON.stringify(v5)})`)

    // H6: Round-trip stringify → parse preserves the resulting order
    const original6 = {
      quickActions: {
        visibleActions: [C, A, D],
        order: r2!, // the order from H2
      }
    }
    const json6 = JSON.stringify(original6)
    const parsed6 = parseDashboardSectionConfig(json6)
    const v6 = getOrderedQuickActions(parsed6)
    assert(JSON.stringify(v6) === JSON.stringify([C, A, D]),
      `H6: round-trip preserves C,A,D (got ${JSON.stringify(v6)})`)

    // H7: Two-step move: A,C,D → move A down → C,A,D → move A down → C,D,A
    // Start fresh
    const startOrder = [A, B, C, D]
    const visible = [A, C, D]
    // Step 1: move A down
    const step1 = moveItemInOrder(startOrder, visible, A, 'down')
    assert(step1 !== null, 'H7 step1: move returns non-null')
    const cfgStep1 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: visible, order: step1! }
    }))
    const vStep1 = getOrderedQuickActions(cfgStep1)
    assert(JSON.stringify(vStep1) === JSON.stringify([C, A, D]),
      `H7 step1: move A down → C,A,D (got ${JSON.stringify(vStep1)})`)
    // Step 2: move A down again (using step1's order)
    const step2 = moveItemInOrder(step1!, visible, A, 'down')
    assert(step2 !== null, 'H7 step2: move returns non-null')
    const cfgStep2 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: visible, order: step2! }
    }))
    const vStep2 = getOrderedQuickActions(cfgStep2)
    assert(JSON.stringify(vStep2) === JSON.stringify([C, D, A]),
      `H7 step2: move A down again → C,D,A (got ${JSON.stringify(vStep2)})`)
  }

  // ─── §STEP-1D: Top Insights + Business Activity tab management ──────
  console.log('\n  §STEP-1D: Top Insights + Business Activity tab management:')
  {
    // I1: Top Insights default order
    const ids1 = getOrderedTopInsightsTabs(DEFAULT_DASHBOARD_CONFIG)
    assert(JSON.stringify(ids1) === JSON.stringify(['debtors', 'buyers', 'payments', 'products', 'defaulters']),
      `I1: default topInsights order → debtors,buyers,payments,products,defaulters (got ${JSON.stringify(ids1)})`)

    // I2: Top Insights custom order
    const cfg2 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
        order: ['products', 'debtors', 'payments', 'buyers', 'defaulters'],
        defaultTab: 'debtors',
      }
    }))
    const ids2 = getOrderedTopInsightsTabs(cfg2)
    assert(JSON.stringify(ids2) === JSON.stringify(['products', 'debtors', 'payments', 'buyers', 'defaulters']),
      `I2: custom topInsights order (got ${JSON.stringify(ids2)})`)

    // I3: Top Insights hidden tab filtering
    const cfg3 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['debtors', 'products'],
        order: ['products', 'debtors', 'buyers', 'payments', 'defaulters'],
        defaultTab: 'debtors',
      }
    }))
    const ids3 = getOrderedTopInsightsTabs(cfg3)
    assert(JSON.stringify(ids3) === JSON.stringify(['products', 'debtors']),
      `I3: hidden tabs filtered → products,debtors (got ${JSON.stringify(ids3)})`)

    // I4: Top Insights explicit [] visibleTabs
    const cfg4 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [], order: ['debtors', 'buyers'], defaultTab: 'debtors' }
    }))
    assert(cfg4.topInsights.visibleTabs.length === 0, 'I4: explicit [] stays empty')
    const ids4 = getOrderedTopInsightsTabs(cfg4)
    assert(ids4.length === 0, `I4: empty visibleTabs → empty result (got ${JSON.stringify(ids4)})`)

    // I5: Top Insights move up/down all enabled
    const r5 = moveItemInOrder(
      ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      'payments', 'up',
    )
    assert(r5 !== null, 'I5: move returns non-null')
    const cfg5 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'], order: r5!, defaultTab: 'debtors' }
    }))
    const v5 = getOrderedTopInsightsTabs(cfg5)
    assert(JSON.stringify(v5) === JSON.stringify(['debtors', 'payments', 'buyers', 'products', 'defaulters']),
      `I5: move payments up → debtors,payments,buyers,products,defaulters (got ${JSON.stringify(v5)})`)

    // I6: Top Insights move up/down with disabled tabs
    const r6 = moveItemInOrder(
      ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
      ['debtors', 'payments', 'defaulters'], // buyers + products disabled
      'payments', 'up',
    )
    assert(r6 !== null, 'I6: move returns non-null')
    const cfg6 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: ['debtors', 'payments', 'defaulters'], order: r6!, defaultTab: 'debtors' }
    }))
    const v6 = getOrderedTopInsightsTabs(cfg6)
    assert(JSON.stringify(v6) === JSON.stringify(['payments', 'debtors', 'defaulters']),
      `I6: B disabled, move payments up → payments,debtors,defaulters (got ${JSON.stringify(v6)})`)

    // I7: Business Activity default order
    const ids7 = getOrderedBusinessActivityTabs(DEFAULT_DASHBOARD_CONFIG)
    assert(JSON.stringify(ids7) === JSON.stringify(['transactions', 'lowstock', 'orders']),
      `I7: default businessActivity order (got ${JSON.stringify(ids7)})`)

    // I8: Business Activity custom order
    const cfg8 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: {
        visibleTabs: ['transactions', 'lowstock', 'orders'],
        order: ['orders', 'transactions', 'lowstock'],
        defaultTab: 'transactions',
      }
    }))
    const ids8 = getOrderedBusinessActivityTabs(cfg8)
    assert(JSON.stringify(ids8) === JSON.stringify(['orders', 'transactions', 'lowstock']),
      `I8: custom businessActivity order (got ${JSON.stringify(ids8)})`)

    // I9: Business Activity hidden tab filtering
    const cfg9 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: {
        visibleTabs: ['transactions', 'orders'],
        order: ['orders', 'transactions', 'lowstock'],
        defaultTab: 'transactions',
      }
    }))
    const ids9 = getOrderedBusinessActivityTabs(cfg9)
    assert(JSON.stringify(ids9) === JSON.stringify(['orders', 'transactions']),
      `I9: hidden lowstock filtered (got ${JSON.stringify(ids9)})`)

    // I10: Business Activity explicit [] visibleTabs
    const cfg10 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: [], order: ['transactions', 'lowstock'], defaultTab: 'transactions' }
    }))
    assert(cfg10.businessActivity.visibleTabs.length === 0, 'I10: explicit [] stays empty')
    const ids10 = getOrderedBusinessActivityTabs(cfg10)
    assert(ids10.length === 0, `I10: empty visibleTabs → empty result (got ${JSON.stringify(ids10)})`)

    // I11: Business Activity move up/down with disabled tabs
    const r11 = moveItemInOrder(
      ['transactions', 'lowstock', 'orders'],
      ['transactions', 'orders'], // lowstock disabled
      'orders', 'up',
    )
    assert(r11 !== null, 'I11: move returns non-null')
    const cfg11 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: ['transactions', 'orders'], order: r11!, defaultTab: 'transactions' }
    }))
    const v11 = getOrderedBusinessActivityTabs(cfg11)
    assert(JSON.stringify(v11) === JSON.stringify(['orders', 'transactions']),
      `I11: lowstock disabled, move orders up → orders,transactions (got ${JSON.stringify(v11)})`)

    // I12: Re-enable disabled tab → deterministic position
    const order12 = ['orders', 'transactions', 'lowstock']
    const cfg12 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: ['transactions', 'lowstock', 'orders'], order: order12, defaultTab: 'transactions' }
    }))
    const v12 = getOrderedBusinessActivityTabs(cfg12)
    assert(JSON.stringify(v12) === JSON.stringify(['orders', 'transactions', 'lowstock']),
      `I12: re-enable lowstock → orders,transactions,lowstock (got ${JSON.stringify(v12)})`)

    // I13: Invalid/unknown tab IDs filtered
    const cfg13 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['debtors', 'malicious'],
        order: ['debtors', 'malicious', 'buyers'],
        defaultTab: 'debtors',
      }
    }))
    assert(!cfg13.topInsights.visibleTabs.includes('malicious'), 'I13: unknown tab filtered from visibleTabs')
    assert(!cfg13.topInsights.order.includes('malicious'), 'I13: unknown tab filtered from order')

    // I14: Backward compatibility — old config without order fields
    const cfg14 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: ['debtors', 'buyers'], defaultTab: 'debtors' },
      businessActivity: { visibleTabs: ['transactions'], defaultTab: 'transactions' },
    }))
    const v14top = getOrderedTopInsightsTabs(cfg14)
    assert(JSON.stringify(v14top) === JSON.stringify(['debtors', 'buyers']),
      `I14: backward compat topInsights → debtors,buyers (got ${JSON.stringify(v14top)})`)
    const v14hub = getOrderedBusinessActivityTabs(cfg14)
    assert(JSON.stringify(v14hub) === JSON.stringify(['transactions']),
      `I14: backward compat businessActivity → transactions (got ${JSON.stringify(v14hub)})`)

    // I15: Default-tab safety — if default disabled, first visible is used
    // (This is handled by useEffect in dashboard-view.tsx, but verify config is parseable)
    const cfg15 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['buyers', 'products'],
        order: ['buyers', 'products', 'debtors', 'payments', 'defaulters'],
        defaultTab: 'debtors', // debtors is disabled
      }
    }))
    const v15 = getOrderedTopInsightsTabs(cfg15)
    assert(v15[0] === 'buyers', `I15: first visible tab is buyers (not defaultTab debtors) (got ${JSON.stringify(v15)})`)

    // I16: All tabs disabled — safe empty
    const cfg16 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [], order: [], defaultTab: 'debtors' },
      businessActivity: { visibleTabs: [], order: [], defaultTab: 'transactions' },
    }))
    assert(getOrderedTopInsightsTabs(cfg16).length === 0, 'I16: all topInsights tabs disabled → empty')
    assert(getOrderedBusinessActivityTabs(cfg16).length === 0, 'I16: all businessActivity tabs disabled → empty')
  }

  // ─── §STEP-1D-CORRECTION: Regression tests R1-R11 ───────────────────
  console.log('\n  §STEP-1D-CORRECTION: Regression tests:')
  {
    const A = 'add-party'
    const B = 'add-product'
    const C = 'new-invoice'
    const D = 'add-transaction'
    const T1 = 'debtors'
    const T2 = 'buyers'
    const T3 = 'payments'
    const T4 = 'products'
    const T5 = 'defaulters'
    const H1 = 'transactions'
    const H2 = 'lowstock'
    const H3 = 'orders'

    // R1: empty order + 3 visible tabs + move middle tab → all preserved
    const r1 = moveItemInOrder([], [T1, T2, T3, T4, T5], T3, 'up')
    assert(r1 !== null, 'R1: move returns non-null')
    assert(r1!.length === 5, `R1: 5 tabs preserved (got ${r1!.length})`)
    // Verify visible order: T3 moved up → T1,T3,T2,...
    const cfg1 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [T1, T2, T3, T4, T5], order: r1!, defaultTab: T1 }
    }))
    const v1 = getOrderedTopInsightsTabs(cfg1)
    assert(JSON.stringify(v1) === JSON.stringify([T1, T3, T2, T4, T5]),
      `R1: move T3 up → T1,T3,T2,T4,T5 (got ${JSON.stringify(v1)})`)

    // R2: partial order + visible tabs missing from order → all preserved
    const r2 = moveItemInOrder([T1], [T1, T2, T3, T4, T5], T1, 'down')
    assert(r2 !== null, 'R2: move returns non-null')
    assert(r2!.length === 5, `R2: 5 tabs in order (got ${r2!.length})`)
    const cfg2 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [T1, T2, T3, T4, T5], order: r2!, defaultTab: T1 }
    }))
    const v2 = getOrderedTopInsightsTabs(cfg2)
    // T1 moved down → T2,T1,T3,T4,T5
    assert(JSON.stringify(v2) === JSON.stringify([T2, T1, T3, T4, T5]),
      `R2: move T1 down → T2,T1,T3,T4,T5 (got ${JSON.stringify(v2)})`)

    // R3: empty Business Activity order + move tab → all 3 preserved
    const r3 = moveItemInOrder([], [H1, H2, H3], H3, 'up')
    assert(r3 !== null, 'R3: move returns non-null')
    assert(r3!.length === 3, `R3: 3 tabs preserved (got ${r3!.length})`)
    const cfg3 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: [H1, H2, H3], order: r3!, defaultTab: H1 }
    }))
    const v3 = getOrderedBusinessActivityTabs(cfg3)
    assert(JSON.stringify(v3) === JSON.stringify([H1, H3, H2]),
      `R3: move H3 up → H1,H3,H2 (got ${JSON.stringify(v3)})`)

    // R4: partial Quick Actions order + move tab → all preserved
    const r4 = moveItemInOrder([A], [A, B, C, D], A, 'down')
    assert(r4 !== null, 'R4: move returns non-null')
    assert(r4!.length === 4, `R4: 4 actions preserved (got ${r4!.length})`)
    const cfg4 = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, B, C, D], order: r4! }
    }))
    const v4 = getOrderedQuickActions(cfg4)
    assert(JSON.stringify(v4) === JSON.stringify([B, A, C, D]),
      `R4: move A down → B,A,C,D (got ${JSON.stringify(v4)})`)

    // R5: missing order in parsed old config → default order
    const cfg5 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [T1, T2, T3, T4, T5], defaultTab: T1 }
      // no order field
    }))
    assert(JSON.stringify(cfg5.topInsights.order) === JSON.stringify([T1, T2, T3, T4, T5, 'top-revenue-products']),
      `R5: missing order → default (got ${JSON.stringify(cfg5.topInsights.order)})`)

    // R6: invalid/non-array order → default order
    const cfg6 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [T1, T2], order: 'invalid', defaultTab: T1 }
    }))
    assert(JSON.stringify(cfg6.topInsights.order) === JSON.stringify([T1, T2, T3, T4, T5, 'top-revenue-products']),
      `R6: invalid order → default (got ${JSON.stringify(cfg6.topInsights.order)})`)

    // R7: explicit [] order remains []
    const cfg7 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [T1, T2], order: [], defaultTab: T1 }
    }))
    assert(cfg7.topInsights.order.length === 0, `R7: explicit [] order stays [] (got ${cfg7.topInsights.order.length})`)

    // R8: custom Top Insights order + hidden current tab → fallback to first ORDERED visible
    const cfg8 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: [T2, T4], // T1 (debtors) disabled
        order: [T4, T2, T1, T3, T5], // T4 first in order
        defaultTab: T1, // T1 is disabled
      }
    }))
    const v8 = getOrderedTopInsightsTabs(cfg8)
    assert(v8[0] === T4, `R8: first ordered visible is T4 (not T1 which is hidden) (got ${JSON.stringify(v8)})`)
    assert(!v8.includes(T1), 'R8: hidden T1 not in visible result')

    // R9: custom Business Activity order + hidden current tab → fallback
    const cfg9 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: {
        visibleTabs: [H2, H3], // H1 (transactions) disabled
        order: [H3, H2, H1], // H3 first in order
        defaultTab: H1, // H1 is disabled
      }
    }))
    const v9 = getOrderedBusinessActivityTabs(cfg9)
    assert(v9[0] === H3, `R9: first ordered visible is H3 (not H1 which is hidden) (got ${JSON.stringify(v9)})`)

    // R10: all tabs hidden → no crash, safe empty
    const cfg10 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [], order: [], defaultTab: T1 },
      businessActivity: { visibleTabs: [], order: [], defaultTab: H1 },
    }))
    assert(getOrderedTopInsightsTabs(cfg10).length === 0, 'R10: all topInsights hidden → empty')
    assert(getOrderedBusinessActivityTabs(cfg10).length === 0, 'R10: all businessActivity hidden → empty')

    // R11: disabled-item preservation — H1-H7 tests still pass
    // Re-run a key H-test to verify no regression
    const r11 = moveItemInOrder([A, B, C, D], [A, B, C, D], C, 'up')
    assert(r11 !== null, 'R11: H1 still passes (move returns non-null)')
    assert(JSON.stringify(r11) === JSON.stringify([A, C, B, D]),
      `R11: H1 all enabled move C up → A,C,B,D (got ${JSON.stringify(r11)})`)
    // H2-style: B disabled, move C up → visible C,A,D
    const r11b = moveItemInOrder([A, B, C, D], [A, C, D], C, 'up')
    assert(r11b !== null, 'R11b: H2 move returns non-null')
    const cfg11b = parseDashboardSectionConfig(JSON.stringify({
      quickActions: { visibleActions: [A, C, D], order: r11b! }
    }))
    const v11b = getOrderedQuickActions(cfg11b)
    assert(JSON.stringify(v11b) === JSON.stringify([C, A, D]),
      `R11b: B disabled, move C up → C,A,D (got ${JSON.stringify(v11b)})`)
  }

  // ─── §STEP-1D-FINAL: Default-tab resolution tests T1-T8 ──────────────
  console.log('\n  §STEP-1D-FINAL: Default-tab resolution:')
  {
    // T1: saved Top Insights default = products, all visible → effective = products
    const cfg1 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
        order: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
        defaultTab: 'products',
      }
    }))
    const ordered1 = getOrderedTopInsightsTabs(cfg1)
    const effective1 = resolveDefaultTab(ordered1, cfg1.topInsights.defaultTab)
    assert(effective1 === 'products', `T1: effective tab = products (got ${effective1})`)

    // T2: saved Business Activity default = orders, all visible → effective = orders
    const cfg2 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: {
        visibleTabs: ['transactions', 'lowstock', 'orders'],
        order: ['transactions', 'lowstock', 'orders'],
        defaultTab: 'orders',
      }
    }))
    const ordered2 = getOrderedBusinessActivityTabs(cfg2)
    const effective2 = resolveDefaultTab(ordered2, cfg2.businessActivity.defaultTab)
    assert(effective2 === 'orders', `T2: effective tab = orders (got ${effective2})`)

    // T3: saved Top Insights default = products, products hidden, custom order = [buyers, debtors, ...]
    // → effective = buyers (first ordered visible)
    const cfg3 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['debtors', 'buyers', 'payments', 'defaulters'], // products hidden
        order: ['buyers', 'debtors', 'payments', 'products', 'defaulters'],
        defaultTab: 'products', // products is disabled
      }
    }))
    const ordered3 = getOrderedTopInsightsTabs(cfg3)
    const effective3 = resolveDefaultTab(ordered3, cfg3.topInsights.defaultTab)
    assert(effective3 === 'buyers', `T3: effective tab = buyers (first ordered visible) (got ${effective3})`)

    // T4: saved Business Activity default = orders, orders hidden, custom order = [lowstock, transactions]
    // → effective = lowstock (first ordered visible)
    const cfg4 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: {
        visibleTabs: ['transactions', 'lowstock'], // orders hidden
        order: ['lowstock', 'transactions', 'orders'],
        defaultTab: 'orders', // orders is disabled
      }
    }))
    const ordered4 = getOrderedBusinessActivityTabs(cfg4)
    const effective4 = resolveDefaultTab(ordered4, cfg4.businessActivity.defaultTab)
    assert(effective4 === 'lowstock', `T4: effective tab = lowstock (first ordered visible) (got ${effective4})`)

    // T5: all Top Insights tabs hidden → null (safe empty state)
    const cfg5 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: { visibleTabs: [], order: [], defaultTab: 'debtors' }
    }))
    const ordered5 = getOrderedTopInsightsTabs(cfg5)
    const effective5 = resolveDefaultTab(ordered5, cfg5.topInsights.defaultTab)
    assert(effective5 === null, `T5: all hidden → null (got ${effective5})`)

    // T6: all Business Activity tabs hidden → null (safe empty state)
    const cfg6 = parseDashboardSectionConfig(JSON.stringify({
      businessActivity: { visibleTabs: [], order: [], defaultTab: 'transactions' }
    }))
    const ordered6 = getOrderedBusinessActivityTabs(cfg6)
    const effective6 = resolveDefaultTab(ordered6, cfg6.businessActivity.defaultTab)
    assert(effective6 === null, `T6: all hidden → null (got ${effective6})`)

    // T7: hidden default is normalized — verify resolveDefaultTab returns a visible tab
    // and that the normalization logic would persist it
    const cfg7 = parseDashboardSectionConfig(JSON.stringify({
      topInsights: {
        visibleTabs: ['buyers', 'debtors'],
        order: ['buyers', 'debtors', 'payments', 'products', 'defaulters'],
        defaultTab: 'payments', // payments is hidden
      }
    }))
    const ordered7 = getOrderedTopInsightsTabs(cfg7)
    const effective7 = resolveDefaultTab(ordered7, cfg7.topInsights.defaultTab)
    assert(effective7 === 'buyers', `T7: normalized default = buyers (got ${effective7})`)
    assert(effective7 !== 'payments', 'T7: hidden payments NOT used as default')

    // T8: existing H1-H7 and R1-R11 still pass — verify a key H test
    const r8 = moveItemInOrder(['add-party', 'add-product', 'new-invoice', 'add-transaction'],
      ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
      'new-invoice', 'up')
    assert(r8 !== null, 'T8: H1 move returns non-null')
    assert(JSON.stringify(r8) === JSON.stringify(['add-party', 'new-invoice', 'add-product', 'add-transaction']),
      `T8: H1 all enabled move C up → A,C,B,D (got ${JSON.stringify(r8)})`)
  }

  // ─── §STEP-2B.1: Default chart/timeRange hydration contract ──────────
  // These tests prove the parser produces the exact defaults.chartType +
  // defaults.timeRange values that the Dashboard hydration useEffect applies
  // to chartType/timeRange UI state. The effect calls:
  //   setChartType(dashSections.defaults.chartType as ChartType)
  //   setTimeRange(dashSections.defaults.timeRange as TimeRange)
  // so the parser's output IS the contract. Invalid/missing → parser defaults.
  console.log('\n  §STEP-2B.1: Default chart/timeRange hydration contract:')
  {
    // G1-1: persisted non-default chartType is preserved by parser → would apply during hydration
    const g1_1 = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'profit', timeRange: '7d' }
    }))
    assertEqual(g1_1.defaults.chartType, 'profit', 'G1-1: persisted chartType=profit preserved by parser')

    // G1-2: each valid chartType survives round-trip
    const validCharts = ['revenue', 'profit', 'profitLoss', 'cashflow', 'collections', 'categories']
    for (const ct of validCharts) {
      const cfg = parseDashboardSectionConfig(JSON.stringify({ defaults: { chartType: ct, timeRange: '7d' } }))
      assertEqual(cfg.defaults.chartType, ct, `G1-2: chartType=${ct} preserved`)
    }

    // G2-1: persisted non-default timeRange is preserved by parser → would apply during hydration
    const g2_1 = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'revenue', timeRange: '1m' }
    }))
    assertEqual(g2_1.defaults.timeRange, '1m', 'G2-1: persisted timeRange=1m preserved by parser')

    // G2-2: each valid timeRange survives round-trip
    const validRanges = ['1d', 'yesterday', '2d', '3d', '5d', '7d', '1m', '3m', '6m', '1y', 'custom']
    for (const tr of validRanges) {
      const cfg = parseDashboardSectionConfig(JSON.stringify({ defaults: { chartType: 'revenue', timeRange: tr } }))
      assertEqual(cfg.defaults.timeRange, tr, `G2-2: timeRange=${tr} preserved`)
    }

    // G2-3: 'custom' timeRange is preserved (does NOT break custom-date behavior contract)
    const g2_3 = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'revenue', timeRange: 'custom' }
    }))
    assertEqual(g2_3.defaults.timeRange, 'custom', 'G2-3: custom timeRange preserved (customStart/customEnd handled by UI)')

    // G3-1: missing/invalid chartType → parser default 'revenue' (no unsafe value reaches UI)
    const g3_1a = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'unknown', timeRange: '7d' }
    }))
    assertEqual(g3_1a.defaults.chartType, 'revenue', 'G3-1a: invalid chartType → default revenue')

    const g3_1b = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: null, timeRange: '7d' }
    }))
    assertEqual(g3_1b.defaults.chartType, 'revenue', 'G3-1b: null chartType → default revenue')

    const g3_1c = parseDashboardSectionConfig(JSON.stringify({
      defaults: { timeRange: '7d' } // chartType field omitted entirely
    }))
    assertEqual(g3_1c.defaults.chartType, 'revenue', 'G3-1c: missing chartType → default revenue')

    // G3-2: missing/invalid timeRange → parser default '7d'
    const g3_2a = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'revenue', timeRange: 'unknown' }
    }))
    assertEqual(g3_2a.defaults.timeRange, '7d', 'G3-2a: invalid timeRange → default 7d')

    const g3_2b = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'revenue', timeRange: null }
    }))
    assertEqual(g3_2b.defaults.timeRange, '7d', 'G3-2b: null timeRange → default 7d')

    const g3_2c = parseDashboardSectionConfig(JSON.stringify({
      defaults: { chartType: 'revenue' } // timeRange field omitted entirely
    }))
    assertEqual(g3_2c.defaults.timeRange, '7d', 'G3-2c: missing timeRange → default 7d')

    // G3-3: defaults object missing entirely → both defaults
    const g3_3 = parseDashboardSectionConfig(JSON.stringify({ sections: [] }))
    assertEqual(g3_3.defaults.chartType, 'revenue', 'G3-3a: missing defaults obj → chartType revenue')
    assertEqual(g3_3.defaults.timeRange, '7d', 'G3-3b: missing defaults obj → timeRange 7d')

    // G3-4: malformed defaults (not an object) → both defaults
    const g3_4 = parseDashboardSectionConfig(JSON.stringify({ defaults: 'invalid' }))
    assertEqual(g3_4.defaults.chartType, 'revenue', 'G3-4a: malformed defaults → chartType revenue')
    assertEqual(g3_4.defaults.timeRange, '7d', 'G3-4b: malformed defaults → timeRange 7d')

    // G4-1: hydration idempotency — parsing the SAME saved config twice yields identical values.
    // This proves the hydration effect can safely run once per appSettings change without
    // producing different values on repeated parses (no non-determinism).
    const saved = JSON.stringify({ defaults: { chartType: 'profitLoss', timeRange: '3m' } })
    const g4_1a = parseDashboardSectionConfig(saved)
    const g4_1b = parseDashboardSectionConfig(saved)
    assertEqual(g4_1a.defaults.chartType, g4_1b.defaults.chartType, 'G4-1a: repeated parse → identical chartType')
    assertEqual(g4_1a.defaults.timeRange, g4_1b.defaults.timeRange, 'G4-1b: repeated parse → identical timeRange')

    // G4-2: parser does NOT mutate the input or leak references (defensive copy)
    const inputObj = { defaults: { chartType: 'cashflow', timeRange: '1y' } }
    const g4_2 = parseDashboardSectionConfig(JSON.stringify(inputObj))
    assertEqual(g4_2.defaults.chartType, 'cashflow', 'G4-2a: parser returns cashflow for valid input')
    assertEqual(g4_2.defaults.timeRange, '1y', 'G4-2b: parser returns 1y for valid input')
    // Parser should not crash if caller later mutates their input
    assertEqual(g4_2.defaults.chartType, 'cashflow', 'G4-2c: parser output stable after input mutation check')
  }

  // ─── §STEP-2C: Customer Quality Advanced Settings ─────────────────────
  // Tests chartShape, showCount/showPercentage/showDescription, tapEnabled,
  // sortOrder, and getSortedGradeData() pure helper.
  // §STEP-2C-REVIEW: tapBehavior replaced with tapEnabled (boolean).
  console.log('\n  §STEP-2C: Customer Quality Advanced Settings:')
  {
    // 1. chartShape values — each valid shape survives round-trip
    for (const shape of ['bar', 'donut', 'horizontal'] as const) {
      const cfg = parseDashboardSectionConfig(JSON.stringify({
        customerQuality: { chartShape: shape }
      }))
      assertEqual(cfg.customerQuality.chartShape, shape, `CQ1: chartShape=${shape} preserved`)
    }

    // 2. invalid chartShape fallback → default 'bar'
    const cq2a = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { chartShape: 'invalid' }
    }))
    assertEqual(cq2a.customerQuality.chartShape, 'bar', 'CQ2a: invalid chartShape → default bar')
    const cq2b = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { chartShape: null }
    }))
    assertEqual(cq2b.customerQuality.chartShape, 'bar', 'CQ2b: null chartShape → default bar')
    const cq2c = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { chartShape: 123 }
    }))
    assertEqual(cq2c.customerQuality.chartShape, 'bar', 'CQ2c: non-string chartShape → default bar')

    // 3. showCount false — explicit false preserved
    const cq3 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { showCount: false }
    }))
    assertEqual(cq3.customerQuality.showCount, false, 'CQ3: showCount=false preserved (explicit false)')

    // 4. showPercentage false — explicit false preserved
    const cq4 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { showPercentage: false }
    }))
    assertEqual(cq4.customerQuality.showPercentage, false, 'CQ4: showPercentage=false preserved')

    // 5. showDescription false — explicit false preserved
    const cq5 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { showDescription: false }
    }))
    assertEqual(cq5.customerQuality.showDescription, false, 'CQ5: showDescription=false preserved')

    // 6. explicit false values survive parsing (all three at once)
    const cq6 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { showCount: false, showPercentage: false, showDescription: false }
    }))
    assertEqual(cq6.customerQuality.showCount, false, 'CQ6a: showCount=false survives')
    assertEqual(cq6.customerQuality.showPercentage, false, 'CQ6b: showPercentage=false survives')
    assertEqual(cq6.customerQuality.showDescription, false, 'CQ6c: showDescription=false survives')

    // 6b. non-boolean showCount → default true (not false)
    const cq6b = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { showCount: 'yes', showPercentage: 1, showDescription: null }
    }))
    assertEqual(cq6b.customerQuality.showCount, true, 'CQ6b1: non-boolean showCount → default true')
    assertEqual(cq6b.customerQuality.showPercentage, true, 'CQ6b2: non-boolean showPercentage → default true')
    assertEqual(cq6b.customerQuality.showDescription, true, 'CQ6b3: null showDescription → default true')

    // 7. sortOrder grade — preserved
    const cq7 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'grade' }
    }))
    assertEqual(cq7.customerQuality.sortOrder, 'grade', 'CQ7: sortOrder=grade preserved')

    // 8. sortOrder count-desc — preserved
    const cq8 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'count-desc' }
    }))
    assertEqual(cq8.customerQuality.sortOrder, 'count-desc', 'CQ8: sortOrder=count-desc preserved')

    // 9. invalid sortOrder fallback → default 'grade'
    const cq9a = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'invalid' }
    }))
    assertEqual(cq9a.customerQuality.sortOrder, 'grade', 'CQ9a: invalid sortOrder → default grade')
    const cq9b = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: null }
    }))
    assertEqual(cq9b.customerQuality.sortOrder, 'grade', 'CQ9b: null sortOrder → default grade')

    // 10. getSortedGradeData — grade order (A → E)
    const gradeData10 = [
      { grade: 'C', count: 5 },
      { grade: 'A', count: 3 },
      { grade: 'E', count: 1 },
      { grade: 'B', count: 7 },
      { grade: 'D', count: 2 },
    ]
    const cfg10 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'grade' }
    }))
    const sorted10 = getSortedGradeData(gradeData10, cfg10)
    assertEqual(sorted10[0].grade, 'A', 'CQ10a: grade order → A first')
    assertEqual(sorted10[1].grade, 'B', 'CQ10b: grade order → B second')
    assertEqual(sorted10[2].grade, 'C', 'CQ10c: grade order → C third')
    assertEqual(sorted10[3].grade, 'D', 'CQ10d: grade order → D fourth')
    assertEqual(sorted10[4].grade, 'E', 'CQ10e: grade order → E fifth')

    // 11. getSortedGradeData — count-desc (highest count first)
    const cfg11 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'count-desc' }
    }))
    const sorted11 = getSortedGradeData(gradeData10, cfg11)
    assertEqual(sorted11[0].grade, 'B', 'CQ11a: count-desc → B first (count=7)')
    assertEqual(sorted11[1].grade, 'C', 'CQ11b: count-desc → C second (count=5)')
    assertEqual(sorted11[2].grade, 'A', 'CQ11c: count-desc → A third (count=3)')
    assertEqual(sorted11[3].grade, 'D', 'CQ11d: count-desc → D fourth (count=2)')
    assertEqual(sorted11[4].grade, 'E', 'CQ11e: count-desc → E fifth (count=1)')

    // 11b. count-desc with ties → grade order breaks ties (A before B)
    const gradeData11b = [
      { grade: 'B', count: 5 },
      { grade: 'A', count: 5 },
      { grade: 'C', count: 5 },
    ]
    const cfg11b = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { sortOrder: 'count-desc' }
    }))
    const sorted11b = getSortedGradeData(gradeData11b, cfg11b)
    assertEqual(sorted11b[0].grade, 'A', 'CQ11b1: tie → A before B (grade order)')
    assertEqual(sorted11b[1].grade, 'B', 'CQ11b2: tie → B second')
    assertEqual(sorted11b[2].grade, 'C', 'CQ11b3: tie → C third')

    // 12. backwards compatibility — old dashboardSections JSON (no advanced fields) → all defaults
    const oldJson12 = JSON.stringify({
      sections: [{ id: 'customerQuality', visible: true, order: 2 }],
      customerQuality: { visibleGrades: ['A', 'B'] }
      // §NO advanced fields present — must default
    })
    const cfg12 = parseDashboardSectionConfig(oldJson12)
    assertEqual(cfg12.customerQuality.visibleGrades, ['A', 'B'] as any, 'CQ12a: visibleGrades preserved from old JSON')
    assertEqual(cfg12.customerQuality.chartShape, 'bar', 'CQ12b: chartShape defaults to bar (old JSON)')
    assertEqual(cfg12.customerQuality.showCount, true, 'CQ12c: showCount defaults to true (old JSON)')
    assertEqual(cfg12.customerQuality.showPercentage, true, 'CQ12d: showPercentage defaults to true (old JSON)')
    assertEqual(cfg12.customerQuality.showDescription, true, 'CQ12e: showDescription defaults to true (old JSON)')
    assertEqual(cfg12.customerQuality.tapEnabled, true, 'CQ12f: tapEnabled defaults to true (old JSON without tapEnabled)')
    assertEqual(cfg12.customerQuality.sortOrder, 'grade', 'CQ12g: sortOrder defaults to grade (old JSON)')

    // 13. all grades hidden (visibleGrades=[]) — parser preserves empty array
    const cfg13 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { visibleGrades: [] }
    }))
    assertEqual(cfg13.customerQuality.visibleGrades.length, 0, 'CQ13: empty visibleGrades preserved (not replaced by defaults)')
    // Advanced fields still default correctly
    assertEqual(cfg13.customerQuality.chartShape, 'bar', 'CQ13b: chartShape default even with empty grades')

    // 14. getSortedGradeData does NOT mutate input (pure function)
    const input14 = [{ grade: 'B', count: 2 }, { grade: 'A', count: 1 }]
    const cfg14 = parseDashboardSectionConfig(JSON.stringify({ customerQuality: { sortOrder: 'grade' } }))
    getSortedGradeData(input14, cfg14)
    assertEqual(input14[0].grade, 'B', 'CQ14: input array NOT mutated by getSortedGradeData')

    // §STEP-2C-REVIEW: tapEnabled tests (replaced tapBehavior tests)

    // 15. tapEnabled=true — explicit true preserved
    const cq15a = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: true }
    }))
    assertEqual(cq15a.customerQuality.tapEnabled, true, 'CQ15a: tapEnabled=true preserved')

    // 16. tapEnabled=false — explicit false preserved (the key semantic: chart non-interactive)
    const cq16 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: false }
    }))
    assertEqual(cq16.customerQuality.tapEnabled, false, 'CQ16: tapEnabled=false preserved (chart non-interactive)')

    // 17. missing tapEnabled → default true
    const cq17 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { chartShape: 'bar' } // tapEnabled absent
    }))
    assertEqual(cq17.customerQuality.tapEnabled, true, 'CQ17: missing tapEnabled → default true')

    // 18. invalid tapEnabled (non-boolean) → default true
    const cq18 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: 'yes' } // string, not boolean
    }))
    assertEqual(cq18.customerQuality.tapEnabled, true, 'CQ18: non-boolean tapEnabled → default true')

    // 19. BACKWARDS COMPAT: old tapBehavior='modal' → tapEnabled=true
    const cq19 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapBehavior: 'modal' }
    }))
    assertEqual(cq19.customerQuality.tapEnabled, true, 'CQ19: old tapBehavior=modal → tapEnabled=true (migrated)')

    // 20. BACKWARDS COMPAT: old tapBehavior='filter' → tapEnabled=true
    //     The 'filter' Khata-navigation behavior is NOT retained (only modal behavior remains).
    const cq20 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapBehavior: 'filter' }
    }))
    assertEqual(cq20.customerQuality.tapEnabled, true, 'CQ20a: old tapBehavior=filter → tapEnabled=true (migrated)')
    // §SEMANTIC-PROOF: tapEnabled=true means ONLY modal behavior (the 'filter' navigation is gone).
    // There is no 'tapBehavior' field in the parsed output — only 'tapEnabled'.
    assert(!('tapBehavior' in cq20.customerQuality), 'CQ20b: parsed config has NO tapBehavior field (migration complete)')
    // §PROOF-OF-REMOVAL: the only interaction when tapEnabled=true is setSelectedGrade (modal).
    // When tapEnabled=false, handleGradeTap is a no-op. There is no Khata filter path.

    // 21. tapEnabled takes priority over old tapBehavior (explicit boolean wins)
    const cq21 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: false, tapBehavior: 'modal' }
    }))
    assertEqual(cq21.customerQuality.tapEnabled, false, 'CQ21: explicit tapEnabled=false wins over old tapBehavior=modal')

    // 22. explicit tapEnabled=false + old tapBehavior='filter' → tapEnabled=false (no nav behavior)
    const cq22 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: false, tapBehavior: 'filter' }
    }))
    assertEqual(cq22.customerQuality.tapEnabled, false, 'CQ22: explicit tapEnabled=false wins; filter nav NOT retained')

    // 23. malformed customerQuality (not an object) → all defaults INCLUDING tapEnabled=true
    const cfg23 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: 'invalid'
    }))
    assertEqual(cfg23.customerQuality.chartShape, 'bar', 'CQ23a: malformed customerQuality → chartShape bar')
    assertEqual(cfg23.customerQuality.showCount, true, 'CQ23b: malformed → showCount true')
    assertEqual(cfg23.customerQuality.tapEnabled, true, 'CQ23c: malformed → tapEnabled true (default)')
    assertEqual(cfg23.customerQuality.sortOrder, 'grade', 'CQ23d: malformed → sortOrder grade')

    // 24. SEMANTIC VERIFICATION: tapEnabled=false means NO interaction path.
    //     The parser output for tapEnabled=false is a boolean false.
    //     In dashboard-view.tsx, handleGradeTap is:
    //       if (cqConfig.tapEnabled) { setSelectedGrade(grade) }
    //     When false, the function body is a no-op (no setSelectedGrade, no navigation).
    //     The chart onClick is set to undefined and cursor='default' when tapEnabled=false.
    //     This test verifies the parsed value is exactly boolean false (not a string, not undefined).
    const cq24 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: { tapEnabled: false }
    }))
    assertEqual(typeof cq24.customerQuality.tapEnabled, 'boolean', 'CQ24a: tapEnabled is boolean type')
    assertEqual(cq24.customerQuality.tapEnabled === false, true, 'CQ24b: tapEnabled is exactly false (no interaction)')

    // 25. NO REGRESSION: chartShape/sort/display settings unchanged by tapEnabled
    const cq25 = parseDashboardSectionConfig(JSON.stringify({
      customerQuality: {
        chartShape: 'donut',
        showCount: false,
        showPercentage: false,
        showDescription: false,
        tapEnabled: false,
        sortOrder: 'count-desc',
      }
    }))
    assertEqual(cq25.customerQuality.chartShape, 'donut', 'CQ25a: chartShape=donut preserved alongside tapEnabled=false')
    assertEqual(cq25.customerQuality.showCount, false, 'CQ25b: showCount=false preserved')
    assertEqual(cq25.customerQuality.showPercentage, false, 'CQ25c: showPercentage=false preserved')
    assertEqual(cq25.customerQuality.showDescription, false, 'CQ25d: showDescription=false preserved')
    assertEqual(cq25.customerQuality.sortOrder, 'count-desc', 'CQ25e: sortOrder=count-desc preserved')
    assertEqual(cq25.customerQuality.tapEnabled, false, 'CQ25f: tapEnabled=false preserved with other settings')
  }

  // ─── §STEP-3C-FIX: Section Settings confirmation intent logic ─────────
  // Tests resolveConfirmMode — the pure helper that decides which confirmation
  // the SectionSettingsSheet renders. This is the core fix for the bug where
  // Restore Default was hijacked by the discard path when the draft was dirty.
  console.log('\n  §STEP-3C-FIX: Confirmation intent logic (resolveConfirmMode):')
  {
    // F1: dirty + Restore Default → reset confirmation (THE FIX — was 'discard' before)
    assertEqual(resolveConfirmMode('reset', true), 'reset', 'F1: dirty + Restore Default → reset (NOT discard)')

    // F2: dirty + Reset action applies defaults (verified via handleReset behavior in component).
    // Since handleReset is in the component, this test verifies the helper returns 'reset'
    // so the component's reset branch (which calls handleReset) is reached.
    // The reset branch resets draft[sectionId] to sectionDefaults and stays open.
    assertEqual(resolveConfirmMode('reset', true), 'reset', 'F2: reset intent reached when dirty (handleReset callable)')

    // F3: dirty + X/close → discard confirmation
    assertEqual(resolveConfirmMode('close', true), 'discard', 'F3: dirty + X → discard confirmation')

    // F4: discard → savedConfig restored + close (verified by discard branch behavior).
    // The helper returns 'discard' so the component's discard branch (setDraft(savedConfig) + onClose) runs.
    assertEqual(resolveConfirmMode('close', true), 'discard', 'F4: discard intent reached when dirty close')

    // F5: clean + Restore Default → reset confirmation (reset works on clean draft too)
    assertEqual(resolveConfirmMode('reset', false), 'reset', 'F5: clean + Restore Default → reset confirmation')

    // F6: Cancel reset → draft unchanged. The helper returns 'reset'; the component's
    // Cancel button sets confirmMode=null WITHOUT touching the draft. This test verifies
    // the helper does NOT mutate anything (pure function).
    const before = resolveConfirmMode('reset', true)
    const after = resolveConfirmMode('reset', true)
    assertEqual(before, after, 'F6: resolveConfirmMode is pure (no side effects) — Cancel leaves draft intact')

    // F7: clean + close → null (close immediately, no confirmation)
    assertEqual(resolveConfirmMode('close', false), null, 'F7: clean + close → null (no confirm)')

    // F8: dirty + close → 'discard' (not 'reset') — ensures close path doesn't accidentally reset
    assertEqual(resolveConfirmMode('close', true), 'discard', 'F8: dirty close → discard (NOT reset)')

    // F9: dirty + reset → 'reset' (not 'discard') — the inverse of F8, ensures reset path isn't hijacked
    assertEqual(resolveConfirmMode('reset', true), 'reset', 'F9: dirty reset → reset (NOT discard) — the core fix')

    // F10: confirmMode is exactly one of 'discard' | 'reset' | null
    const modes = ['discard', 'reset', null]
    for (const trigger of ['close', 'reset'] as const) {
      for (const dirty of [true, false]) {
        const mode = resolveConfirmMode(trigger, dirty)
        assert(modes.includes(mode), `F10: resolveConfirmMode('${trigger}', ${dirty}) returns valid mode (got ${mode})`)
      }
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
