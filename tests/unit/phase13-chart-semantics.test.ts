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
    // §P16-STEP3: Default is now daily-only (monthly has its own handler)
    assert(src.includes('Default: daily bucket'),
      'Non-hourly buckets use default date-only formatting')
    assert(src.includes('isMonthly'),
      '§P16-STEP3: Monthly bucket handler added (shows Month Year)')
  }

  // ─── Fix 3: Profit → Net Cash Flow label ─────────────────────────────────
  console.log('\n  Fix 3 — Profit → Net Cash Flow:')
  {
    assert(src.includes("label: 'Net Cash Flow'"),
      "Chart option label is 'Net Cash Flow' (not 'Profit vs Loss')")
    assert(src.includes("§FIX-3"),
      '§FIX-3 comment documents the rename')
    // §P16-STEP3: 'profit' mode keeps 'Net'/'Outflow' labels (cash-flow proxy)
    assert(src.includes('name="Net"'),
      'Profit chart (cash-flow proxy) series name is "Net"')
    assert(src.includes('name="Outflow"'),
      'Loss chart (cash-flow proxy) series name is "Outflow"')
    // §P16-STEP3: NEW 'profitLoss' mode uses 'Profit'/'Loss' labels (true accounting)
    assert(src.includes("label: 'Profit vs Loss'"),
      '§P16-STEP3: Profit vs Loss chart mode restored with true accounting')
    assert(src.includes('name="Profit"'),
      '§P16-STEP3: profitLoss chart series name is "Profit"')
    assert(src.includes('name="Loss"'),
      '§P16-STEP3: profitLoss chart series name is "Loss"')
  }

  // ─── Fix 4: Inventory chart mode removed (§P16-STEP3) ────────────────────
  console.log('\n  Fix 4 — Inventory chart mode removed (Step 3):')
  {
    // §P16-STEP3: The misleading 'inventory' chart mode was REMOVED.
    // It used revenue data (SUM of all sales), not inventory-specific data.
    assert(!src.includes("id: 'inventory'"),
      '§P16-STEP3: inventory chart mode removed from chartOptions')
    assert(src.includes('§P16-STEP3: Removed misleading'),
      '§P16-STEP3: removal documented in source')
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
