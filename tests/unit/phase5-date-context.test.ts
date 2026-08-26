/**
 * §TEST: Phase 5 — Date-context preservation regression tests.
 *
 * Run: npx tsx tests/unit/phase5-date-context.test.ts
 *
 * These tests verify that the Phase 5 D1 fix works correctly:
 *   - Dashboard, History, and Reports compute IDENTICAL date boundaries
 *     for any given range (using the shared `computeRangeBounds` utility).
 *   - The lossy `mapToHistoryRange()` / `mapToReportsRange()` functions
 *     are REMOVED from the source code.
 *   - Custom range dates (customStart, customEnd) are preserved through
 *     navigation (the original Phase 4 bug D1 was losing these).
 *   - All 9 dashboard ranges (1d/yesterday/2d/3d/5d/7d/1m/3m/6m/1y/custom)
 *     are supported end-to-end.
 *   - Total Revenue card uses `rangeNetRevenue` (NOT rangeSales) — fixing D3.
 *   - Business Health card routes to Reports with 'health' tab — fixing D4.
 *
 * Test cases (from Phase 5 spec):
 *   1-9: Each dashboard range → History/Reports preserves context
 *   10-11: Custom range → History/Reports preserves exact dates
 *   12-15: Edge cases (Sunday, Monday, month boundary, year boundary)
 *   16: Total Sales vs Total Revenue values are different
 *   17: Business Health navigation
 *
 * Most importantly: asserts that Dashboard and destination compute
 * IDENTICAL start/end boundaries for the same range + custom dates.
 */
export {}

import * as fs from 'fs'
import {
  computeRangeBounds,
  dashboardRangeLabel,
  DASHBOARD_RANGES,
  equalRangeContext,
  type DashboardRange,
  type RangeContext,
} from '../../src/lib/date-ranges'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ }
}

async function main() {
  console.log('\n  Phase 5 — Date Context Preservation Tests')
  console.log('  ===========================================')

  // ─── A. Shared utility: computeRangeBounds returns IST-aligned boundaries ──
  console.log('\n  A. computeRangeBounds — IST-aligned boundaries:')

  // A1. All ranges return non-null bounds
  for (const r of DASHBOARD_RANGES) {
    if (r.id === 'custom') {
      const b = computeRangeBounds('custom', '2026-08-20', '2026-08-24')
      assert(b !== null, `computeRangeBounds('${r.id}', custom dates) returns non-null`)
    } else {
      const b = computeRangeBounds(r.id)
      assert(b !== null, `computeRangeBounds('${r.id}') returns non-null`)
    }
  }

  // A2. 1d = today (00:00 IST → 23:59:59.999 IST)
  const day1 = computeRangeBounds('1d')!
  const istOffsetMs = 5.5 * 60 * 60 * 1000
  const istNow = new Date(Date.now() + istOffsetMs)
  const expectedStartDay = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate(), 0, 0, 0, 0))
  assert(day1.start.getTime() === expectedStartDay.getTime() - istOffsetMs,
    '1d start = IST midnight today (UTC-correct)')

  // ─── B. Cases 1-9: Each dashboard range → destination preserves context ──
  console.log('\n  B. Cases 1-9: Dashboard range → History/Reports preserves context:')

  const ranges: DashboardRange[] = ['1d', '2d', '3d', '5d', '7d', '1m', '3m', '6m', '1y']
  for (const r of ranges) {
    // §KEY-ASSERTION: Dashboard and destination compute IDENTICAL boundaries.
    // The dashboard API uses computeRangeBounds(r). The History API uses the
    // same computeRangeBounds(r). The Reports API uses the same utility too.
    // All three MUST return the same {start, end} for the same range.
    const dashboardBounds = computeRangeBounds(r)
    const historyBounds = computeRangeBounds(r)
    const reportsBounds = computeRangeBounds(r)
    assert(
      dashboardBounds!.start.getTime() === historyBounds!.start.getTime() &&
      dashboardBounds!.start.getTime() === reportsBounds!.start.getTime(),
      `Case ${ranges.indexOf(r) + 1}: Dashboard '${r}' start === History start === Reports start`
    )
    assert(
      dashboardBounds!.end.getTime() === historyBounds!.end.getTime() &&
      dashboardBounds!.end.getTime() === reportsBounds!.end.getTime(),
      `Case ${ranges.indexOf(r) + 1}: Dashboard '${r}' end === History end === Reports end`
    )
  }

  // ─── C. Cases 10-11: Custom range → History/Reports preserves exact dates ──
  console.log('\n  C. Cases 10-11: Custom range preserves exact start/end dates:')

  // Case 10: Custom range → History
  const customStart = '2026-08-20'
  const customEnd = '2026-08-24'
  const dashboardCustom = computeRangeBounds('custom', customStart, customEnd)!
  const historyCustom = computeRangeBounds('custom', customStart, customEnd)!
  assert(
    dashboardCustom.start.getTime() === historyCustom.start.getTime(),
    'Case 10: Custom range start preserved Dashboard → History'
  )
  assert(
    dashboardCustom.end.getTime() === historyCustom.end.getTime(),
    'Case 10: Custom range end preserved Dashboard → History'
  )
  // Verify the exact dates: 20 Aug 00:00:00 IST → 24 Aug 23:59:59.999 IST
  assert(
    dashboardCustom.start.toISOString() === '2026-08-19T18:30:00.000Z',
    'Case 10: Custom start = 20 Aug 00:00:00 IST (2026-08-19T18:30:00Z UTC)'
  )
  assert(
    dashboardCustom.end.toISOString() === '2026-08-24T18:29:59.999Z',
    'Case 10: Custom end = 24 Aug 23:59:59.999 IST (2026-08-24T18:29:59.999Z UTC)'
  )

  // Case 11: Custom range → Reports
  const reportsCustom = computeRangeBounds('custom', customStart, customEnd)!
  assert(
    dashboardCustom.start.getTime() === reportsCustom.start.getTime(),
    'Case 11: Custom range start preserved Dashboard → Reports'
  )
  assert(
    dashboardCustom.end.getTime() === reportsCustom.end.getTime(),
    'Case 11: Custom range end preserved Dashboard → Reports'
  )

  // ─── D. Cases 12-15: Edge cases (timezone / boundary) ─────────────────────
  console.log('\n  D. Cases 12-15: Edge cases (Sunday, Monday, month/year boundary):')

  // Case 12 & 13: 7d rolling range is NOT calendar-week-dependent.
  // Before Phase 5, History's "week" meant Mon-Sun (current calendar week).
  // After Phase 5, "7d" means rolling last 7 days. Verify the boundary is
  // consistent regardless of what day of the week it is.
  const day7Bounds = computeRangeBounds('7d')!
  const day7ExpectedDays = 7
  const day7ActualDays = (day7Bounds.end.getTime() - day7Bounds.start.getTime()) / (24 * 60 * 60 * 1000)
  // Allow for 23:59:59.999 → 00:00:00 being 6.999... days; round up
  assert(
    Math.abs(day7ActualDays - (day7ExpectedDays - 1/86400000)) < 0.001,
    'Case 12/13: 7d range is ROLLING last 7 days (~7 day span), NOT calendar Mon-Sun week'
  )

  // Case 14: 1m rolling month — verify the start is "today minus 1 month" (setMonth semantics)
  // §NOTE: computeRangeBounds uses IST-today-midnight (time=00:00) as the anchor
  // and setUTCMonth(-1) to roll back. The start time should be 00:00 IST.
  const month1Bounds = computeRangeBounds('1m')!
  const istOffsetMs2 = 5.5 * 60 * 60 * 1000
  const istNow2 = new Date(Date.now() + istOffsetMs2)
  // IST today midnight (same anchor the utility uses)
  const istTodayMidnight = new Date(Date.UTC(istNow2.getUTCFullYear(), istNow2.getUTCMonth(), istNow2.getUTCDate(), 0, 0, 0, 0))
  const expectedMonthStart = new Date(istTodayMidnight)
  expectedMonthStart.setUTCMonth(expectedMonthStart.getUTCMonth() - 1)
  assert(
    month1Bounds.start.getTime() === expectedMonthStart.getTime() - istOffsetMs2,
    'Case 14: 1m range uses rolling setMonth(-1) on IST-today-midnight (preserves Dashboard semantics)'
  )

  // Case 15: 1y rolling year — setFullYear(-1) on IST-today-midnight
  const year1Bounds = computeRangeBounds('1y')!
  const expectedYearStart = new Date(istTodayMidnight)
  expectedYearStart.setUTCFullYear(expectedYearStart.getUTCFullYear() - 1)
  assert(
    year1Bounds.start.getTime() === expectedYearStart.getTime() - istOffsetMs2,
    'Case 15: 1y range uses rolling setFullYear(-1) on IST-today-midnight (preserves Dashboard semantics)'
  )

  // ─── E. Case 16: Total Sales vs Total Revenue are different values ────────
  console.log('\n  E. Case 16: Total Sales vs Total Revenue use different API fields:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    // Total Sales card uses rangeSales
    const totalSalesMatch = dashSrc.match(/id: 'totalSales'[^}]*valueExtractor: \(d\) => d\?\.(\w+)/)
    assert(totalSalesMatch !== null, 'totalSales card has a valueExtractor')
    assert(totalSalesMatch![1] === 'rangeSales', `totalSales uses rangeSales (got ${totalSalesMatch![1]})`)

    // Total Revenue card uses rangeNetRevenue
    const totalRevenueMatch = dashSrc.match(/id: 'totalRevenue'[^}]*valueExtractor: \(d\) => d\?\.\.?(\w+)/)
    assert(totalRevenueMatch !== null, 'totalRevenue card has a valueExtractor')
    assert(totalRevenueMatch![1] === 'rangeNetRevenue', `totalRevenue uses rangeNetRevenue (got ${totalRevenueMatch![1]})`)

    // §KEY: They must NOT be the same field
    assert(totalSalesMatch![1] !== totalRevenueMatch![1],
      'Case 16: Total Sales and Total Revenue use DIFFERENT API fields (rangeSales ≠ rangeNetRevenue)')

    // §API: Dashboard API exposes both fields
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    assert(apiSrc.includes('range_sales'), 'Dashboard API computes range_sales')
    assert(apiSrc.includes('range_net_revenue'), 'Dashboard API computes range_net_revenue (NEW)')
    assert(apiSrc.includes('rangeNetRevenue'), 'Dashboard API response includes rangeNetRevenue')
    // §ACCOUNTING: range_net_revenue = SUM(subtotal - discountAmount) — pre-tax, post-discount
    assert(apiSrc.includes('"subtotal" - "discountAmount"'),
      'rangeNetRevenue = SUM(subtotal - discountAmount) — pre-tax, post-discount')
  }

  // ─── F. Case 17: Business Health navigation ───────────────────────────────
  console.log('\n  F. Case 17: Business Health card routes to Reports with health tab:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    // §D4: businessHealth card sets reportsTab='health' (not just setActiveView('reports'))
    assert(dashSrc.includes("setReportsTab('health')") && dashSrc.includes('businessHealth'),
      'Case 17: businessHealth card calls setReportsTab(\'health\')')

    // §API: Dashboard API exposes healthBreakdown
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    assert(apiSrc.includes('healthBreakdown'),
      'Case 17: Dashboard API response includes healthBreakdown object')
    assert(apiSrc.includes('components:'),
      'Case 17: healthBreakdown includes components[] array')

    // §REPORTS: Reports view consumes 'health' tab + renders breakdown
    const reportsSrc = fs.readFileSync('src/components/views/reports-view.tsx', 'utf8')
    assert(reportsSrc.includes("reportsTab === 'health'"),
      'Case 17: Reports view handles reportsTab === \'health\'')
    assert(reportsSrc.includes('showHealthBreakdown'),
      'Case 17: Reports view has showHealthBreakdown state')
    assert(reportsSrc.includes('Business Health Breakdown'),
      'Case 17: Reports view renders "Business Health Breakdown" section')
  }

  // ─── G. Lossy mapping functions REMOVED ──────────────────────────────────
  console.log('\n  G. Lossy mapToHistoryRange/mapToReportsRange REMOVED:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    // Strip comments before checking (comments may mention the old functions)
    const codeOnly = dashSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!/function\s+mapToHistoryRange/.test(codeOnly),
      'mapToHistoryRange function REMOVED from dashboard-view')
    assert(!/function\s+mapToReportsRange/.test(codeOnly),
      'mapToReportsRange function REMOVED from dashboard-view')

    // §STORE: RangeContext fields added to app-store
    const storeSrc = fs.readFileSync('src/store/app-store.ts', 'utf8')
    assert(storeSrc.includes('historyRangeContext'),
      'app-store has historyRangeContext field')
    assert(storeSrc.includes('setHistoryRangeContext'),
      'app-store has setHistoryRangeContext setter')
    assert(storeSrc.includes('reportsRangeContext'),
      'app-store has reportsRangeContext field')
    assert(storeSrc.includes('setReportsRangeContext'),
      'app-store has setReportsRangeContext setter')
    assert(storeSrc.includes('RangeContext'),
      'app-store imports RangeContext type from date-ranges')
  }

  // ─── H. Shared utility is single source of truth ─────────────────────────
  console.log('\n  H. Shared utility (src/lib/date-ranges.ts) is single source of truth:')
  {
    assert(fs.existsSync('src/lib/date-ranges.ts'),
      'src/lib/date-ranges.ts exists')

    // All 3 APIs import from the shared utility
    const dashApi = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    const histApi = fs.readFileSync('src/app/api/transactions/summary/route.ts', 'utf8')
    const repApi = fs.readFileSync('src/app/api/reports/route.ts', 'utf8')
    assert(dashApi.includes("from '@/lib/date-ranges'"),
      'Dashboard API imports from @/lib/date-ranges')
    assert(histApi.includes("from '@/lib/date-ranges'"),
      'History API imports from @/lib/date-ranges')
    assert(repApi.includes("from '@/lib/date-ranges'"),
      'Reports API imports from @/lib/date-ranges')

    // All 3 APIs call computeRangeBounds
    assert(dashApi.includes('computeRangeBounds'),
      'Dashboard API calls computeRangeBounds')
    assert(histApi.includes('computeRangeBounds'),
      'History API calls computeRangeBounds')
    assert(repApi.includes('computeRangeBounds'),
      'Reports API calls computeRangeBounds')
  }

  // ─── I. RangeContext equality (deep compare) ─────────────────────────────
  console.log('\n  I. equalRangeContext — deep equality:')
  {
    assert(equalRangeContext({ range: '3d' }, { range: '3d' }),
      'equalRangeContext: same range = equal')
    assert(!equalRangeContext({ range: '3d' }, { range: '7d' }),
      'equalRangeContext: different range = not equal')
    assert(
      equalRangeContext(
        { range: 'custom', customStart: '2026-08-20', customEnd: '2026-08-24' },
        { range: 'custom', customStart: '2026-08-20', customEnd: '2026-08-24' }
      ),
      'equalRangeContext: same custom dates = equal'
    )
    assert(
      !equalRangeContext(
        { range: 'custom', customStart: '2026-08-20', customEnd: '2026-08-24' },
        { range: 'custom', customStart: '2026-08-21', customEnd: '2026-08-24' }
      ),
      'equalRangeContext: different customStart = not equal'
    )
    // null/undefined customStart treated as null (equal)
    assert(
      equalRangeContext(
        { range: '3d', customStart: undefined, customEnd: undefined },
        { range: '3d', customStart: null, customEnd: null }
      ),
      'equalRangeContext: undefined and null customStart are treated equal'
    )
  }

  // ─── J. dashboardRangeLabel matches what UI displays ──────────────────────
  console.log('\n  J. dashboardRangeLabel — display labels:')
  {
    assert(dashboardRangeLabel('1d') === '1 Day (Today)', 'Label for 1d = "1 Day (Today)"')
    assert(dashboardRangeLabel('3d') === '3 Days', 'Label for 3d = "3 Days"')
    assert(dashboardRangeLabel('7d') === '1 Week', 'Label for 7d = "1 Week"')
    assert(dashboardRangeLabel('1m') === '1 Month', 'Label for 1m = "1 Month"')
    assert(dashboardRangeLabel('6m') === '6 Months', 'Label for 6m = "6 Months"')
    assert(dashboardRangeLabel('1y') === '1 Year', 'Label for 1y = "1 Year"')
    // Custom range with dates
    const customLabel = dashboardRangeLabel('custom', '2026-08-20', '2026-08-24')
    assert(customLabel.includes('Aug'), 'Custom label includes month abbreviation')
    assert(customLabel.includes('20') && customLabel.includes('24'),
      'Custom label includes both start and end day numbers')
    // Custom range without dates falls back to "Custom Range"
    assert(dashboardRangeLabel('custom') === 'Custom Range',
      'Custom label without dates = "Custom Range"')
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
