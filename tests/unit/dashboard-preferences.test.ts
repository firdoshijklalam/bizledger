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
  moveItemInOrder,
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

  // ─── 10. quickActions.visibleActions defaults to all 4 actions ────────
  console.log('\n  10. quickActions.visibleActions defaults to all 4 actions:')
  {
    const cfg = DEFAULT_DASHBOARD_CONFIG
    assertEqual(
      cfg.quickActions.visibleActions,
      ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
      'Q1: default quickActions.visibleActions = [add-party,add-product,new-invoice,add-transaction]'
    )
    assertEqual(cfg.quickActions.visibleActions.length, 4, 'Q2: 4 actions by default')

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
    assert(config2.quickActions.visibleActions.length === 4, 'D8: quickActions.visibleActions missing → defaults (4)')

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
    // E1: Default config → all 4 in default order
    const ids1 = getOrderedQuickActions(DEFAULT_DASHBOARD_CONFIG)
    assert(ids1.length === 4, 'E1: default config → 4 actions')
    assert(ids1[0] === 'add-party', 'E1: default order[0]=add-party')
    assert(ids1[1] === 'add-product', 'E1: default order[1]=add-product')
    assert(ids1[2] === 'new-invoice', 'E1: default order[2]=new-invoice')
    assert(ids1[3] === 'add-transaction', 'E1: default order[3]=add-transaction')

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

  // ─── Summary ─────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
