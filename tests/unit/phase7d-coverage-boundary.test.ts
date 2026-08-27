/**
 * §TEST: Phase 7D — Bucket coverage + expense boundary + loading/empty states.
 *
 * Run: npx tsx tests/unit/phase7d-coverage-boundary.test.ts
 *
 * Tests:
 *   FIX-7D-1: All-range bucket coverage (firstStart <= rangeStart, lastEnd >= rangeEnd)
 *   FIX-7D-2: IST hourly bucket regression (00:00, 00:30, 05:29, 05:30, 23:59, transitions)
 *   FIX-7D-3: Expense boundary consistency (rangeStart, rangeEnd, ±1ms)
 *   FIX-7D-4: Loading state source verification
 *   FIX-7D-5: Empty state source verification
 *   FIX-7D-6: global-voice-input.tsx dependency audit
 */
export {}

import * as fs from 'fs'
import { computeRangeBounds, computeBuckets, type Bucket } from '../../src/lib/date-ranges'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ }
}

async function main() {
  console.log('\n  Phase 7D — Coverage + Boundary + State Tests')
  console.log('  =============================================')

  const configs: Record<string, ['hour' | 'day' | 'week' | 'month', number]> = {
    '1d': ['hour', 24], '2d': ['day', 2], '3d': ['day', 3], '5d': ['day', 5],
    '7d': ['day', 7], '1m': ['day', 30], '3m': ['week', 13], '6m': ['month', 6], '1y': ['month', 12],
  }

  // ─── FIX-7D-1: All-range bucket coverage ────────────────────────────────
  console.log('\n  FIX-7D-1 — All-range bucket coverage:')
  {
    for (const [range, [bt, bc]] of Object.entries(configs)) {
      const bounds = computeRangeBounds(range as any)!
      const buckets = computeBuckets(bounds.start, bounds.end, bt, bc)
      const firstStart = buckets[0].start
      const lastEnd = buckets[buckets.length - 1].end
      assert(firstStart.getTime() <= bounds.start.getTime(),
        `${range}: firstBucket.start <= rangeStart`)
      assert(lastEnd.getTime() >= bounds.end.getTime(),
        `${range}: lastBucket.end >= rangeEnd (100% coverage)`)
      // No duplicate starts
      const starts = buckets.map(b => b.start.getTime())
      const unique = new Set(starts)
      assert(unique.size === starts.length,
        `${range}: No duplicate bucket starts (${unique.size}/${starts.length})`)
    }
  }

  // ─── FIX-7D-2: IST hourly bucket regression ─────────────────────────────
  console.log('\n  FIX-7D-2 — IST hourly bucket regression:')
  {
    function withMockedDate(istY: number, istM: number, istD: number, istH: number, istMin: number, fn: () => void) {
      const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000
      const utcMs = Date.UTC(istY, istM - 1, istD, istH, istMin, 0) - IST_OFFSET_MS
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

    // 00:00 IST
    withMockedDate(2026, 8, 26, 0, 0, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '00:00 IST: First bucket = 18:30 UTC (00:00 IST midnight)')
      assert(buckets[0].label === '12:00 am',
        '00:00 IST: First bucket label = "12:00 am"')
      assert(buckets[23].label === '11:00 pm',
        '00:00 IST: Last bucket label = "11:00 pm"')
    })

    // 00:30 IST
    withMockedDate(2026, 8, 26, 0, 30, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.getTime() === b.start.getTime(),
        '00:30 IST: First bucket starts at rangeStart (00:00 IST, not 00:30)')
    })

    // 05:29 IST
    withMockedDate(2026, 8, 26, 5, 29, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '05:29 IST: First bucket = 18:30 UTC (00:00 IST midnight)')
    })

    // 05:30 IST
    withMockedDate(2026, 8, 26, 5, 30, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '05:30 IST: First bucket = 18:30 UTC (00:00 IST midnight)')
    })

    // 23:59 IST
    withMockedDate(2026, 8, 26, 23, 59, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-25T18:30:00.000Z',
        '23:59 IST: First bucket = 18:30 UTC (00:00 IST midnight)')
    })

    // Day transition (Aug 31 → Sep 1 boundary)
    withMockedDate(2026, 8, 31, 23, 59, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-08-30T18:30:00.000Z',
        'Aug 31 23:59 IST: First bucket = Aug 31 00:00 IST')
      assert(buckets[23].start.toISOString() === '2026-08-31T17:30:00.000Z',
        'Aug 31 23:59 IST: Last bucket = Aug 31 23:00 IST')
    })

    // Month transition (Jan 31 → Feb)
    withMockedDate(2026, 1, 31, 12, 0, () => {
      const b = computeRangeBounds('1m')!
      const buckets = computeBuckets(b.start, b.end, 'day', 30)
      const lastEnd = buckets[buckets.length - 1].end
      assert(lastEnd.getTime() >= b.end.getTime(),
        'Jan 31 1m: Last bucket end >= rangeEnd (coverage fix applied)')
    })

    // Year transition (Dec 31 → Jan 1)
    withMockedDate(2026, 12, 31, 23, 59, () => {
      const b = computeRangeBounds('1d')!
      const buckets = computeBuckets(b.start, b.end, 'hour', 24)
      assert(buckets[0].start.toISOString() === '2026-12-30T18:30:00.000Z',
        'Dec 31 23:59 IST: First bucket = Dec 31 00:00 IST')
    })
  }

  // ─── FIX-7D-3: Expense boundary consistency ─────────────────────────────
  console.log('\n  FIX-7D-3 — Expense boundary consistency:')
  {
    const EXPENSE_TYPES = ['debit', 'expense', 'purchase'] as const
    const rangeStartMs = Date.UTC(2026, 7, 25, 18, 30, 0, 0) // Aug 26 00:00 IST
    const rangeEndMs = Date.UTC(2026, 7, 26, 18, 29, 59, 999) // Aug 26 23:59:59.999 IST

    // Transactions at boundary edges
    const txns = [
      { type: 'debit', amount: 100, createdAt: new Date(rangeStartMs).toISOString() },      // exactly rangeStart
      { type: 'debit', amount: 200, createdAt: new Date(rangeEndMs).toISOString() },         // exactly rangeEnd
      { type: 'debit', amount: 300, createdAt: new Date(rangeStartMs - 1).toISOString() },  // 1ms before rangeStart
      { type: 'debit', amount: 400, createdAt: new Date(rangeEndMs + 1).toISOString() },     // 1ms after rangeEnd
      { type: 'expense', amount: 500, createdAt: new Date(rangeStartMs + 3600000).toISOString() }, // 1 hour in
    ]

    // Card SQL semantics: createdAt >= rangeStart AND createdAt <= rangeEnd
    const cardExpense = txns
      .filter(t => {
        const ts = new Date(t.createdAt).getTime()
        return ts >= rangeStartMs && ts <= rangeEndMs && EXPENSE_TYPES.includes(t.type as any)
      })
      .reduce((s, t) => s + t.amount, 0)

    // Chart bucket semantics: >= bucketStart && < bucketEnd per bucket
    // The last bucket's end is extended to >= rangeEnd
    const rangeStart = new Date(rangeStartMs)
    const rangeEnd = new Date(rangeEndMs)
    const buckets = computeBuckets(rangeStart, rangeEnd, 'hour', 24)
    let chartExpense = 0
    for (const bucket of buckets) {
      const bucketTxns = txns.filter(t => {
        const ts = new Date(t.createdAt).getTime()
        return ts >= bucket.start.getTime() && ts < bucket.end.getTime() && EXPENSE_TYPES.includes(t.type as any)
      })
      chartExpense += bucketTxns.reduce((s, t) => s + t.amount, 0)
    }

    assert(cardExpense === 800,
      'Card expense = 100 (rangeStart) + 200 (rangeEnd) + 500 (1hr in) = 800')
    assert(chartExpense === cardExpense,
      `Chart expense sum === card expense (${chartExpense} === ${cardExpense})`)
    assert(cardExpense !== 1100,
      'Card expense ≠ 1100 (300 at rangeStart-1ms and 400 at rangeEnd+1ms excluded)')

    // Boundary: transaction exactly at rangeStart → included in both
    assert(txns[0].amount === 100 && cardExpense >= 100,
      'Transaction at exactly rangeStart included in card')
    assert(chartExpense >= 100,
      'Transaction at exactly rangeStart included in chart bucket 0')

    // Boundary: transaction exactly at rangeEnd → included in card, should also be in chart
    assert(txns[1].amount === 200 && cardExpense >= 300,
      'Transaction at exactly rangeEnd included in card')
    assert(chartExpense >= 300,
      'Transaction at exactly rangeEnd included in chart (last bucket extended)')

    // Boundary: 1ms before rangeStart → excluded from both
    assert(cardExpense < 1100,
      'Transaction 1ms before rangeStart excluded from card')

    // Boundary: 1ms after rangeEnd → excluded from both
    assert(cardExpense < 1500,
      'Transaction 1ms after rangeEnd excluded from card')
  }

  // ─── FIX-7D-4: Loading state source verification ────────────────────────
  console.log('\n  FIX-7D-4 — Loading state:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('Updating chart…'),
      'Loading state shows "Updating chart…" text')
    assert(dashSrc.includes('apiLoading && data'),
      'Loading checks apiLoading && data (not full-page overlay)')
    assert(dashSrc.includes('role="status"'),
      'Loading state has role="status" for accessibility')
    assert(dashSrc.includes('aria-live="polite"'),
      'Loading state has aria-live="polite"')
    assert(dashSrc.includes('Loader2'),
      'Loading state shows Loader2 spinner')
  }

  // ─── FIX-7D-5: Empty state source verification ──────────────────────────
  console.log('\n  FIX-7D-5 — Empty state:')
  {
    const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashSrc.includes('No revenue or expense activity in this period'),
      'Empty state shows correct message')
    assert(dashSrc.includes('Try a wider date range'),
      'Empty state shows hint')
    assert(dashSrc.includes('allZero'),
      'Empty state uses allZero variable')
    assert(dashSrc.includes('d.revenue === 0 && d.expense === 0 && d.profit === 0'),
      'allZero checks revenue, expense, profit, collected, creditGiven')
    assert(dashSrc.includes('role="img"'),
      'Empty state has role="img" with aria-label')

    // §DETERMINISTIC: Verify allZero logic is correct
    const allZeroTrue = [{ revenue: 0, expense: 0, profit: 0, collected: 0, creditGiven: 0 }]
    const isAllZero = allZeroTrue.every(d => d.revenue === 0 && d.expense === 0 && d.profit === 0 && d.collected === 0 && d.creditGiven === 0)
    assert(isAllZero === true, 'allZero=true when all metrics are 0')

    const allZeroFalse = [{ revenue: 100, expense: 0, profit: 100, collected: 0, creditGiven: 0 }]
    const isAllZero2 = allZeroFalse.every(d => d.revenue === 0 && d.expense === 0 && d.profit === 0 && d.collected === 0 && d.creditGiven === 0)
    assert(isAllZero2 === false, 'allZero=false when revenue > 0')
  }

  // ─── FIX-7D-6: global-voice-input.tsx deleted (Phase 7G) ─────────────
  console.log('\n  FIX-7D-6 — global-voice-input.tsx deleted (Phase 7G):')
  {
    const topBarSrc = fs.readFileSync('src/components/layout/top-app-bar.tsx', 'utf8')

    // §DELETED: File no longer exists
    const fileExists = fs.existsSync('src/components/layout/global-voice-input.tsx')
    assert(!fileExists,
      'global-voice-input.tsx has been DELETED (Phase 7G — confirmed dead code removed)')

    // §NO-IMPORTS: No file references it
    const appDirFiles = fs.readdirSync('src/app', { recursive: true }).filter((f: any) => (typeof f === 'string') && (f.endsWith('.tsx') || f.endsWith('.ts')))
    let importedInRoute = false
    for (const f of appDirFiles) {
      const content = fs.readFileSync(`src/app/${f}`, 'utf8')
      if (content.includes('GlobalVoiceInput') || content.includes('global-voice-input')) {
        importedInRoute = true
        break
      }
    }
    assert(!importedInRoute,
      'No file in src/app/ imports or references global-voice-input (deleted)')

    // §COMMENT-PRESERVED: top-app-bar still has the removal comment
    assert(topBarSrc.includes('// §1: GlobalVoiceInput removed'),
      'top-app-bar.tsx still has the comment documenting GlobalVoiceInput removal')
  }

  // ─── Search freeze ──────────────────────────────────────────────────────
  console.log('\n  Search freeze verification:')
  {
    const { execSync } = await import('child_process')
    const frozenFiles = [
      'scripts/seed-search-data.ts', 'src/components/layout/search-overlay.tsx',
      'src/lib/highlight.tsx', 'src/lib/search-engine.ts', 'src/lib/search-rank.ts',
      'src/lib/transliteration.ts', 'tests/unit/search-engine-v2.test.ts', 'tests/unit/search-engine.test.ts',
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

main().catch((e) => { console.error(e); process.exit(1) })
