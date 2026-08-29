/**
 * §TEST: Phase 13 — Chart semantic + tooltip fixes regression tests.
 *
 * Run: npx tsx tests/unit/phase13-chart-semantics.test.ts
 *
 * Tests:
 *   Fix 1: Tooltip uses timeZone: 'Asia/Kolkata'
 *   Fix 2: Hourly bucket tooltip shows time range
 *   Fix 3: Profit chart renamed to 'Net Cash Flow' (not true accounting profit)
 *   Fix 4: Inventory chart label is 'Sales' (not 'Inventory Sales')
 *   Fix 5: Weekly tooltip shows date range (not just 'W1')
 */
export {}

import * as fs from 'fs'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ }
}

async function main() {
  console.log('\n  Phase 13 — Chart Semantic + Tooltip Fixes')
  console.log('  ===========================================')

  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  const apiSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')

  // ─── Fix 1: Tooltip timezone ─────────────────────────────────────────────
  console.log('\n  Fix 1 — Tooltip timezone (Asia/Kolkata):')
  {
    assert(src.includes("const IST_TZ = 'Asia/Kolkata'"),
      'CustomTooltip defines IST_TZ constant')
    assert(src.includes('timeZone: IST_TZ'),
      'CustomTooltip uses IST_TZ in date formatting')
    // §NEGATIVE: Old code without timeZone removed
    const tooltipSection = src.substring(src.indexOf('function CustomTooltip'), src.indexOf('function LowStockList'))
    assert(!tooltipSection.includes("toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })"),
      'Old formatFullDate without timeZone removed from CustomTooltip')
    assert(!tooltipSection.includes("toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })\n    } catch"),
      'No bare toLocaleDateString without timeZone in tooltip')
  }

  // ─── Fix 2: Hourly bucket tooltip time range ─────────────────────────────
  console.log('\n  Fix 2 — Hourly bucket tooltip time range:')
  {
    assert(src.includes('isHourly'),
      'CustomTooltip detects hourly buckets via isHourly variable')
    assert(src.includes('/^\\d{1,2}:\\d{2}\\s*[ap]m$/i'),
      'Hourly detection regex matches time labels like "12:00 am"')
    assert(src.includes('startTime') && src.includes('endTime'),
      'Hourly tooltip includes startTime and endTime')
    assert(src.includes('60 * 60 * 1000'),
      'Hourly tooltip computes end time as start + 1 hour')
    assert(src.includes('whiteSpace: \'pre-line\''),
      'Tooltip header supports multi-line (whiteSpace: pre-line) for time display')
    // §NEGATIVE: Daily/weekly/monthly buckets should NOT show time
    assert(src.includes('Default: daily/monthly bucket'),
      'Non-hourly buckets use default date-only formatting')
  }

  // ─── Fix 3: Profit → Net Cash Flow label ─────────────────────────────────
  console.log('\n  Fix 3 — Profit → Net Cash Flow:')
  {
    assert(src.includes("label: 'Net Cash Flow'"),
      "Chart option label is 'Net Cash Flow' (not 'Profit vs Loss')")
    assert(src.includes("§FIX-3"),
      '§FIX-3 comment documents the rename')
    // Series names
    assert(src.includes('name="Net"') && !src.includes('name="Profit"'),
      'Profit chart series renamed from "Profit" to "Net"')
    assert(src.includes('name="Outflow"') && !src.includes('name="Loss"'),
      'Loss chart series renamed from "Loss" to "Outflow"')
    // Legend labels
    assert(src.includes('>Net<') && !src.includes('>Profit<'),
      'Legend label is "Net" (not "Profit")')
    assert(src.includes('>Outflow<') && !src.includes('>Loss<'),
      'Legend label is "Outflow" (not "Loss")')
  }

  // ─── Fix 4: Inventory → Sales label ──────────────────────────────────────
  console.log('\n  Fix 4 — Inventory → Sales label:')
  {
    assert(src.includes('name="Sales"') && !src.includes('name="Inventory Sales"'),
      'Inventory chart series renamed from "Inventory Sales" to "Sales"')
    assert(src.includes('§FIX-4'),
      '§FIX-4 comment documents the label change')
  }

  // ─── Fix 5: Weekly tooltip date range ───────────────────────────────────
  console.log('\n  Fix 5 — Weekly tooltip date range:')
  {
    assert(src.includes('isWeekly'),
      'CustomTooltip detects weekly buckets via isWeekly variable')
    assert(src.includes('/^W\\d+$/i'),
      'Weekly detection regex matches "W1", "W2", etc.')
    assert(src.includes('7 * 24 * 60 * 60 * 1000'),
      'Weekly tooltip computes end date as start + 7 days')
    assert(src.includes('startStr') && src.includes('endStr'),
      'Weekly tooltip includes startStr and endStr for date range')
    assert(src.includes('–'),
      'Weekly tooltip uses en-dash separator for date range')
  }

  // ─── Existing invariants preserved ───────────────────────────────────────
  console.log('\n  Existing invariants preserved:')
  {
    assert(src.includes('allowEscapeViewBox={{ x: false, y: false }}'),
      'Tooltip mobile clamping (allowEscapeViewBox) preserved')
    assert(src.includes('formatChartAxisValue'),
      'Indian axis formatting preserved')
    assert(src.includes('maxWidth: 180'),
      'Tooltip maxWidth preserved')
    assert(src.includes('allZero'),
      'Empty state check preserved')
    assert(src.includes('Updating chart…'),
      'Loading state preserved')
    assert(src.includes('role="img"'),
      'Accessibility ARIA label preserved')
    assert(src.includes('pb-16'),
      'FAB spacing preserved')
    assert(src.includes('EXPENSE_TYPES') || apiSrc.includes('EXPENSE_TYPES'),
      'Expense type consistency preserved in dashboard API')
    assert(src.includes('computeBuckets') || apiSrc.includes('computeBuckets'),
      'IST bucket computation preserved')
    assert(apiSrc.includes('calendarMonthStartIST'),
      'Calendar month-to-date for monthlyRevenue preserved')
    assert(src.includes('rangeNetRevenue'),
      'Total Revenue (rangeNetRevenue) preserved')
  }

  // ─── Search freeze ───────────────────────────────────────────────────────
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
