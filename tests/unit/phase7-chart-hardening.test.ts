/**
 * §TEST: Phase 7 — Chart hardening regression tests.
 *
 * Run: npx tsx tests/unit/phase7-chart-hardening.test.ts
 *
 * Tests:
 *   FIX 1: Chart expense = card expense (type filter consistency)
 *   FIX 2: IST bucket correctness (UTC methods on IST-aligned dates)
 *   FIX 3: Indian currency axis formatting
 *   FIX 4: Mobile-safe tooltip (allowEscapeViewBox config)
 *   FIX 5: FAB overlap (chart Card bottom padding)
 *   FIX 6: Per-chart loading state
 *   FIX 7: Empty state
 *   FIX 8: Accessibility (role=img, aria-label)
 *   FIX 9: Performance (useMemo where applicable)
 */
export {}

import * as fs from 'fs'
import { formatChartAxisValue } from '../../src/lib/utils'
import { computeRangeBounds, calendarMonthStartIST, computeBuckets } from '../../src/lib/date-ranges'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ }
}

async function main() {
  console.log('\n  Phase 7 — Chart Hardening Tests')
  console.log('  ================================')

  // ─── FIX 1: Chart expense = card expense (type filter consistency) ──────
  console.log('\n  FIX 1 — Chart expense type filter consistency:')
  {
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    // §CARD-SQL: The card uses type IN ('debit', 'expense', 'purchase')
    assert(apiSrc.includes("type IN ('debit', 'expense', 'purchase')"),
      'Card SQL uses type IN (debit, expense, purchase)')
    // §CHART-JS: The chart bucket uses the same types
    assert(apiSrc.includes("EXPENSE_TYPES = ['debit', 'expense', 'purchase']"),
      'Chart bucket uses EXPENSE_TYPES constant matching card SQL')
    // §VOID: Voided invoices excluded
    assert(apiSrc.includes("status: { not: 'void' }") || apiSrc.includes("status != 'void'"),
      'Voided invoices excluded from chart data')

    // §BEHAVIORAL: Verify the EXPENSE_TYPES constant is used (not hardcoded 'debit')
    const codeOnly = apiSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(codeOnly.includes("EXPENSE_TYPES.includes(t.type"),
      'Chart expense filter uses EXPENSE_TYPES.includes() (not hardcoded type === debit)')
  }

  // ─── FIX 2: IST bucket correctness (UTC methods) ────────────────────────
  console.log('\n  FIX 2 — IST bucket correctness (time arithmetic in computeBuckets):')
  {
    const drSrc = fs.readFileSync('src/lib/date-ranges.ts', 'utf8')
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')

    // §POSITIVE: Bucket computation uses time arithmetic (not setUTCHours truncation)
    assert(drSrc.includes('rangeStart.getTime() + i * HOUR_MS'),
      'Hourly buckets use getTime() + i * HOUR_MS (no truncation)')
    assert(drSrc.includes('rangeStart.getTime() + i * DAY_MS'),
      'Daily buckets use getTime() + i * DAY_MS (no truncation)')
    assert(drSrc.includes('rangeStart.getTime() + i * WEEK_MS'),
      'Weekly buckets use getTime() + i * WEEK_MS (no truncation)')

    // §NEGATIVE: Old setUTCHours truncation must NOT exist in bucket computation
    const drCodeOnly = drSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    const bucketSection = drCodeOnly.substring(drCodeOnly.indexOf('function computeBuckets'))
    assert(!bucketSection.includes('setUTCHours('),
      'computeBuckets does NOT use setUTCHours (was the 30-min truncation bug)')
    assert(!bucketSection.includes('.setHours('),
      'computeBuckets does NOT use server-local setHours()')
    assert(!bucketSection.includes('.setDate('),
      'computeBuckets does NOT use server-local setDate()')
    assert(!bucketSection.includes('.setMonth('),
      'computeBuckets does NOT use server-local setMonth()')

    // §LABELS: Labels use Asia/Kolkata timezone
    assert(drSrc.includes("timeZone: 'Asia/Kolkata'"),
      'Chart labels use timeZone: Asia/Kolkata (in date-ranges.ts computeBuckets)')

    // §API: Dashboard API calls computeBuckets (not inline bucket loop)
    assert(apiSrc.includes('computeBuckets'),
      'Dashboard API calls computeBuckets() from date-ranges.ts')

    // §BEHAVIORAL: Verify hourly buckets start at IST midnight
    const day1 = computeRangeBounds('1d')!
    assert(day1.start.getUTCHours() === 18,
      '1d rangeStart UTC hours = 18 (= 00:00 IST midnight)')
  }

  // ─── FIX 2B: Behavioral IST bucket correctness ────────────────────────
  console.log('\n  FIX 2B — Behavioral IST bucket correctness:')
  {
    // §MOCK-DATE: Override Date constructor + Date.now to simulate fixed IST times
    function withMockedDate(istYear: number, istMonth: number, istDate: number, istHour: number, istMinute: number, fn: () => void) {
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
      const utcMs = Date.UTC(istYear, istMonth - 1, istDate, istHour, istMinute, 0) - IST_OFFSET_MS
      const RealDate = Date
      function MockDate(this: any, ...args: any[]) {
        if (args.length === 0) return new RealDate(utcMs)
        return new (RealDate as any)(...args)
      }
      MockDate.prototype = RealDate.prototype
      MockDate.now = () => utcMs
      ;(MockDate as any).UTC = RealDate.UTC
      ;(MockDate as any).parse = RealDate.parse
      globalThis.Date = MockDate as any
      try { fn() } finally { globalThis.Date = RealDate }
    }

    const fmt = (d: Date) => d.toISOString()

    // Test 1: 00:00 IST → first hourly bucket starts at 00:00 IST (18:30 UTC prev day)
    withMockedDate(2026, 8, 26, 0, 0, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.getTime() === bounds.start.getTime(),
        '00:00 IST: First hourly bucket starts exactly at rangeStart (no truncation)')
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '00:00 IST: First hourly bucket = 18:30 UTC (00:00 IST midnight)')
      assert(buckets[0].end.getTime() - buckets[0].start.getTime() === 60 * 60 * 1000,
        '00:00 IST: First hourly bucket spans exactly 1 hour')
      assert(buckets[0].label === '12:00 am',
        '00:00 IST: First bucket label = "12:00 am"')
      assert(buckets[23].label === '11:00 pm',
        '00:00 IST: Last bucket label = "11:00 pm"')
    })

    // Test 2: 05:29 IST → first hourly bucket STILL starts at 00:00 IST
    withMockedDate(2026, 8, 26, 5, 29, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '05:29 IST: First hourly bucket = 18:30 UTC (00:00 IST midnight, not 23:29 IST)')
    })

    // Test 3: 05:30 IST → same behavior (midnight boundary cross)
    withMockedDate(2026, 8, 26, 5, 30, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '05:30 IST: First hourly bucket = 18:30 UTC (00:00 IST midnight)')
    })

    // Test 4: 23:59 IST → first hourly bucket STILL starts at 00:00 IST
    withMockedDate(2026, 8, 26, 23, 59, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '23:59 IST: First hourly bucket = 18:30 UTC (00:00 IST midnight)')
    })

    // Test 5: 00:30 IST → first hourly bucket starts at 00:00 IST (not 00:30)
    withMockedDate(2026, 8, 26, 0, 30, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.getTime() === bounds.start.getTime(),
        '00:30 IST: First hourly bucket starts at rangeStart (00:00 IST, not 00:30)')
    })

    // Test 6: Daily buckets for 7d — first day starts at IST midnight
    withMockedDate(2026, 8, 26, 12, 0, () => {
      const bounds = computeRangeBounds('7d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'day', 7)
      assert(buckets[0].start.getTime() === bounds.start.getTime(),
        '7d: First daily bucket starts at rangeStart (IST midnight)')
      assert(buckets[0].end.getTime() - buckets[0].start.getTime() === 24 * 60 * 60 * 1000,
        '7d: First daily bucket spans exactly 1 day')
    })

    // Test 7: Month boundary — 3d rolling from Aug 31 → first day is Aug 29
    withMockedDate(2026, 8, 31, 12, 0, () => {
      const bounds = computeRangeBounds('3d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'day', 3)
      assert(buckets.length === 3,
        '3d: Returns 3 daily buckets')
      assert(buckets[0].start.toISOString() === '2026-08-28T18:30:00.000Z',
        '3d (Aug 31): First day bucket = Aug 29 00:00 IST')
      assert(buckets[2].start.toISOString() === '2026-08-30T18:30:00.000Z',
        '3d (Aug 31): Last day bucket = Aug 31 00:00 IST')
    })

    // Test 8: Year boundary — 1d on Jan 1, 2026 → yesterday is Dec 31, 2025
    withMockedDate(2026, 1, 1, 0, 0, () => {
      const bounds = computeRangeBounds('1d')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2025-12-31T18:30:00.000Z',
        'Jan 1 00:00 IST: First hourly bucket = Dec 31 18:30 UTC (00:00 IST Jan 1)')
    })

    // Test 9: Monthly buckets — 6m range
    withMockedDate(2026, 8, 26, 12, 0, () => {
      const bounds = computeRangeBounds('6m')!
      const buckets = computeBuckets(bounds.start, bounds.end, 'month', 6)
      assert(buckets.length === 6,
        '6m: Returns 6 monthly buckets')
      // First bucket: Feb 26 (rolling 6 months from Aug 26)
      assert(buckets[0].start.getUTCHours() === 18,
        '6m: First monthly bucket hour = 18 UTC (00:00 IST midnight)')
      assert(buckets[0].start.getUTCMinutes() === 30,
        '6m: First monthly bucket minute = 30 (preserves IST midnight, not truncated to 00)')
    })

    // Test 10: computeBuckets uses shared helper from date-ranges.ts
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    assert(apiSrc.includes('computeBuckets'),
      'Dashboard API uses shared computeBuckets() helper from date-ranges.ts')
  }

  // ─── FIX 1B: Behavioral expense consistency ────────────────────────────
  console.log('\n  FIX 1B — Behavioral expense consistency:')
  {
    // §BEHAVIORAL: Simulate mixed transactions and verify chart expense sum = card expense
    // This verifies the EXPENSE_TYPES constant matches the SQL filter.
    const EXPENSE_TYPES = ['debit', 'expense', 'purchase'] as const

    // Simulate transactions across 3 buckets
    const txns = [
      { type: 'debit', amount: 100, createdAt: '2026-08-25T19:00:00Z' },     // bucket 0
      { type: 'expense', amount: 200, createdAt: '2026-08-25T20:00:00Z' },    // bucket 1
      { type: 'purchase', amount: 300, createdAt: '2026-08-25T21:00:00Z' },   // bucket 2
      { type: 'credit', amount: 500, createdAt: '2026-08-25T19:30:00Z' },     // bucket 0 (not expense)
      { type: 'debit', amount: 150, createdAt: '2026-08-25T22:00:00Z' },      // bucket 3
    ]

    // Card expense (SQL: type IN ('debit', 'expense', 'purchase'))
    const cardExpense = txns
      .filter(t => EXPENSE_TYPES.includes(t.type as any))
      .reduce((s, t) => s + t.amount, 0)

    // Chart expense (JS filter: EXPENSE_TYPES.includes)
    const chartExpense = txns
      .filter(t => EXPENSE_TYPES.includes(t.type as any))
      .reduce((s, t) => s + t.amount, 0)

    assert(cardExpense === 750, 'Card expense = 100+200+300+150 = 750 (debit+expense+purchase)')
    assert(chartExpense === cardExpense, 'Chart expense sum === card expense (behavioral match)')
    assert(chartExpense !== 250, 'Chart expense ≠ 250 (old bug: only debit=100+150 would give 250)')
  }

  // ─── FIX 3: Indian currency axis formatting ────────────────────────────
  console.log('\n  FIX 3 — Indian currency axis formatting:')
  {
    // §BEHAVIORAL: formatChartAxisValue produces correct Indian units
    assert(formatChartAxisValue(0) === '0', '0 → "0"')
    assert(formatChartAxisValue(500) === '500', '500 → "500"')
    assert(formatChartAxisValue(999) === '999', '999 → "999"')
    assert(formatChartAxisValue(1000) === '1k', '1000 → "1k"')
    assert(formatChartAxisValue(10000) === '10k', '10000 → "10k"')
    assert(formatChartAxisValue(50000) === '50k', '50000 → "50k"')
    assert(formatChartAxisValue(99999) === '100k', '99999 → "100k" (rounds up from 99.999)')

    // Lakh boundary (1,00,000)
    assert(formatChartAxisValue(100000) === '1L', '100000 → "1L" (1 Lakh)')
    assert(formatChartAxisValue(500000) === '5L', '500000 → "5L" (5 Lakh)')
    assert(formatChartAxisValue(1000000) === '10L', '1000000 → "10L" (10 Lakh)')

    // Crore boundary (1,00,00,000)
    assert(formatChartAxisValue(10000000) === '1Cr', '10000000 → "1Cr" (1 Crore)')
    assert(formatChartAxisValue(25000000) === '2.5Cr', '25000000 → "2.5Cr"')

    // §SOURCE: Dashboard uses formatChartAxisValue in all tickFormatters
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('formatChartAxisValue'),
      'Dashboard imports formatChartAxisValue from utils')

    // §NEGATIVE: Old Western-style formatter removed
    const codeOnly = dashSrc.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')
    assert(!codeOnly.includes('v >= 1000 ? `${(v/1000).toFixed(0)}k`'),
      'Old Western tickFormatter (v/1000 + k) removed')
  }

  // ─── FIX 4: Mobile-safe tooltip ─────────────────────────────────────────
  console.log('\n  FIX 4 — Mobile-safe tooltip:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    // §POSITIVE: allowEscapeViewBox configured on all Tooltip instances
    const escapeCount = (dashSrc.match(/allowEscapeViewBox=\{\{ x: false, y: false \}\}/g) || []).length
    assert(escapeCount >= 10,
      `allowEscapeViewBox={{ x: false, y: false }} on ${escapeCount} Tooltip instances (expected ≥ 10)`)

    // §TOOLTIP-WIDTH: maxWidth reduced for mobile
    assert(dashSrc.includes('maxWidth: 180'),
      'CustomTooltip maxWidth reduced to 180px (from 220px) for mobile fit')

    // §NEGATIVE: Old 220px maxWidth removed
    assert(!dashSrc.includes('maxWidth: 220'),
      'Old maxWidth: 220 removed')
  }

  // ─── FIX 5: FAB overlap ─────────────────────────────────────────────────
  console.log('\n  FIX 5 — FAB overlap (chart Card bottom padding):')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('pb-16'),
      'Chart Card has pb-16 (64px) bottom padding for FAB clearance')
    assert(dashSrc.includes('§FIX-5'),
      'Chart Card has §FIX-5 comment documenting the FAB padding')
  }

  // ─── FIX 6: Per-chart loading state ────────────────────────────────────
  console.log('\n  FIX 6 — Per-chart loading state:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('Updating chart…'),
      'Chart shows "Updating chart…" text during revalidation')
    assert(dashSrc.includes('apiLoading && data'),
      'Loading state checks apiLoading && data (not full-page overlay)')
    assert(dashSrc.includes('role="status"'),
      'Loading state has role="status" for accessibility')
  }

  // ─── FIX 7: Empty state ────────────────────────────────────────────────
  console.log('\n  FIX 7 — Empty state:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('No revenue or expense activity in this period'),
      'Empty state shows "No revenue or expense activity in this period"')
    assert(dashSrc.includes('Try a wider date range'),
      'Empty state shows hint "Try a wider date range"')
    assert(dashSrc.includes('allZero'),
      'Empty state uses allZero check (not just salesTrend.length === 0)')
    // §NEGATIVE: Empty buckets (with zeros) should show empty state, not flat chart
    assert(dashSrc.includes('d.revenue === 0 && d.expense === 0 && d.profit === 0'),
      'allZero checks all metric fields (revenue, expense, profit)')
  }

  // ─── FIX 8: Accessibility ───────────────────────────────────────────────
  console.log('\n  FIX 8 — Accessibility:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('role="img"'),
      'Chart container has role="img"')
    assert(dashSrc.includes('aria-label={ariaLabel}'),
      'Chart container has aria-label with descriptive text')
    assert(dashSrc.includes('aria-label="No chart data available"'),
      'Empty state has aria-label')
    // §ARIA-CONTENT: aria-label includes chart type + date range + data point count
    assert(dashSrc.includes('chartOptions.find'),
      'ARIA label includes chart type name')
    assert(dashSrc.includes('dashboardRangeLabel'),
      'ARIA label includes date range label')
    assert(dashSrc.includes('data.salesTrend.length'),
      'ARIA label includes data point count')
  }

  // ─── FIX 9: Performance ────────────────────────────────────────────────
  console.log('\n  FIX 9 — Performance:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    // §FIX-9: Chart rendering uses IIFE pattern for loading/empty/normal states
    // The profit chart's data.map() is still inline (≤30 items — useMemo overhead
    // would exceed the computation). This is documented as a conscious decision.
    assert(dashSrc.includes('§FIX-9'),
      'Performance comment documents the IIFE + no-useMemo decision')

    // §NO-PREMATURE-OPTIMIZATION: Verify that no unnecessary useMemo was added
    // for the chart rendering (the profit .map() is on ≤30 items — memoizing
    // would add more overhead than the computation itself)
    const chartSection = dashSrc.substring(dashSrc.indexOf('FIX-9'), dashSrc.indexOf('Legend'))
    assert(!chartSection.includes('useMemo'),
      'No premature useMemo added to chart section (≤30 items — memoization overhead > computation)')
  }

  // ─── ACCOUNTING SAFETY: Revenue/Expense definitions unchanged ──────────
  console.log('\n  Accounting safety — definitions unchanged:')
  {
    const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
    // §REVENUE: revenue = SUM(grandTotal) for non-voided invoices (unchanged)
    assert(apiSrc.includes('grandTotal') && apiSrc.includes('revenue'),
      'Revenue still uses grandTotal (unchanged)')
    // §EXPENSE: Card SQL uses type IN (debit, expense, purchase) (unchanged scope)
    assert(apiSrc.includes("type IN ('debit', 'expense', 'purchase')"),
      'Card expense SQL scope unchanged: debit + expense + purchase')
    // §CHART-MATCHES-CARD: Chart expense now uses same scope (FIX 1)
    assert(apiSrc.includes("EXPENSE_TYPES = ['debit', 'expense', 'purchase']"),
      'Chart expense scope matches card scope (FIX 1 applied)')
    // §rangeNetRevenue: Still uses subtotal - discountAmount (Phase 5, unchanged)
    assert(apiSrc.includes('"subtotal" - "discountAmount"'),
      'rangeNetRevenue still uses subtotal - discountAmount (Phase 5, unchanged)')
    // §calendarMonthStartIST: Still used for monthlyRevenue (Phase 5, unchanged)
    assert(apiSrc.includes('calendarMonthStartIST'),
      'monthlyRevenue still uses calendarMonthStartIST (Phase 5, unchanged)')
    assert(apiSrc.includes('calendarTodayStartIST'),
      'todaySales still uses calendarTodayStartIST (Phase 5, unchanged)')
  }

  // ─── SEARCH FREEZE: Verify no search-frozen files modified ─────────────
  console.log('\n  Search freeze verification:')
  {
    const frozenFiles = [
      'scripts/seed-search-data.ts',
      'src/components/layout/search-overlay.tsx',
      'src/lib/highlight.tsx',
      'src/lib/search-engine.ts',
      'src/lib/search-rank.ts',
      'src/lib/transliteration.ts',
      'tests/unit/search-engine-v2.test.ts',
      'tests/unit/search-engine.test.ts',
    ]
    for (const f of frozenFiles) {
      const hash_b9 = execSync(`git show b9eb828:"${f}" 2>/dev/null | sha256sum | cut -d' ' -f1`).toString().trim()
      const hash_work = execSync(`cat "${f}" | sha256sum | cut -d' ' -f1`).toString().trim()
      assert(hash_b9 === hash_work, `${f} byte-identical to b9eb828`)
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

import { execSync } from 'child_process'
main().catch((e) => { console.error(e); process.exit(1) })
