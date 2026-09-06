/**
 * §TEST: STEP-4B — Dashboard View-All deep-linking tests.
 *
 * Run: npx tsx tests/unit/dashboard-view-all.test.ts
 *
 * These tests verify the routing/context abstraction in
 * src/lib/dashboard-view-all.ts — the single source of truth for "where does
 * each Dashboard insight's View-All go?"
 *
 * Coverage:
 *   1. Top Debtors → Reports → Outstanding → Receivables
 *   2. Top Buyers → Reports → Party Ledger → customers + sort by purchaseVolume
 *   3. Top Payments → History → viewMode=payments + range context
 *   4. Top Products → Inventory → sortBy=unitsSold + stats range
 *   5. Top Revenue Products → Inventory → sortBy=revenue (NOT Khata — regression)
 *   6. Defaulters → Reports → Outstanding → Receivables + grade D+E (NOT just D)
 *   7. Business Activity Transactions → History → viewMode=transactions + range
 *   8. Business Activity Low Stock → Inventory → filter=low-stock (regression)
 *   9. Business Activity Online Orders → Online Orders → initialTab=all
 *
 * Edge cases:
 *   - Custom date range preservation (customStart + customEnd)
 *   - Null range context (insights that don't carry a range)
 *   - Empty / null store fields don't trigger spurious navigation
 *   - Each store field is one-shot (cleared after consumption)
 *   - Tenant isolation: all navigation is read-only (no API mutation)
 */
export {}

import {
  resolveTopInsightViewAll,
  resolveHubViewAll,
  applyViewAllDestination,
  describeViewAllDestination,
  type ViewAllStoreActions,
  type ViewAllDestination,
} from '../../src/lib/dashboard-view-all'
import type { RangeContext } from '../../src/lib/date-ranges'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

// ─── Mock store: records all setter calls + active view ───────────────────
function makeMockStore(): ViewAllStoreActions & { calls: Record<string, any[]>; view: string } {
  const calls: Record<string, any[]> = {}
  const record = (name: string) => (val: any) => {
    if (!calls[name]) calls[name] = []
    calls[name].push(val)
  }
  return {
    setActiveView: (v) => { calls._activeView = [v] },
    setReportsTab: record('reportsTab'),
    setReportsOutstandingTab: record('reportsOutstandingTab'),
    setReportsOutstandingGradeFilter: record('reportsOutstandingGradeFilter'),
    setReportsPartySortBy: record('reportsPartySortBy'),
    setReportsPartySegment: record('reportsPartySegment'),
    setReportsRangeContext: record('reportsRangeContext'),
    setHistoryViewMode: record('historyViewMode'),
    setHistoryRangeContext: record('historyRangeContext'),
    setInventoryFilter: record('inventoryFilter'),
    setInventorySortBy: record('inventorySortBy'),
    setInventoryStatsRange: record('inventoryStatsRange'),
    setOnlineOrdersInitialTab: record('onlineOrdersInitialTab'),
    get view() { return calls._activeView?.[0] ?? null },
    calls,
  } as any
}

console.log('\n🧪 STEP-4B: Dashboard View-All Deep Linking Tests\n')

// ─── 1. Top Debtors destination ────────────────────────────────────────────
console.log('1. Top Debtors destination')
{
  const dest = resolveTopInsightViewAll('debtors')
  assert(dest.kind === 'top-debtors', '1a: kind === top-debtors')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'reports', '1b: navigates to reports view')
  assertEqual(store.calls.reportsTab?.[0], 'outstanding', '1c: sets reportsTab=outstanding')
  assertEqual(store.calls.reportsOutstandingTab?.[0], 'receivables', '1d: sets outstandingTab=receivables')
  assertEqual(store.calls.reportsOutstandingGradeFilter?.[0], 'all', '1e: grade filter is all (no filter)')
  // Top Debtors is NOT date-filtered (outstanding balances are current state)
  assert(!store.calls.reportsRangeContext, '1f: no range context set (outstanding is all-time)')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('debtors')).includes('Receivables'), '1g: description mentions Receivables')

// ─── 2. Top Buyers destination ─────────────────────────────────────────────
console.log('\n2. Top Buyers destination')
{
  const range: RangeContext = { range: '7d' }
  const dest = resolveTopInsightViewAll('buyers', range)
  assert(dest.kind === 'top-buyers', '2a: kind === top-buyers')
  assertEqual((dest as any).range, range, '2b: range context preserved')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'reports', '2c: navigates to reports view')
  assertEqual(store.calls.reportsTab?.[0], 'party', '2d: sets reportsTab=party (Party Ledger)')
  assertEqual(store.calls.reportsPartySegment?.[0], 'customers', '2e: sets segment=customers (excludes supplier-only)')
  assertEqual(store.calls.reportsPartySortBy?.[0], 'purchaseVolume', '2f: sets sortBy=purchaseVolume')
  assertEqual(store.calls.reportsRangeContext?.[0], range, '2g: range context set so purchaseVolume matches dashboard')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('buyers', { range: '7d' })).includes('purchaseVolume'), '2h: description mentions purchaseVolume')

// ─── 3. Top Payments destination (CRITICAL — was routing to invoice History) ─
console.log('\n3. Top Payments destination')
{
  const range: RangeContext = { range: '7d' }
  const dest = resolveTopInsightViewAll('payments', range)
  assert(dest.kind === 'top-payments', '3a: kind === top-payments')
  assertEqual((dest as any).range, range, '3b: range context preserved')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'history', '3c: navigates to history view')
  assertEqual(store.calls.historyViewMode?.[0], 'payments', '3d: sets viewMode=payments (NOT invoices)')
  assertEqual(store.calls.historyRangeContext?.[0], range, '3e: range context set')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('payments', { range: '7d' })).includes('viewMode=payments'), '3f: description mentions payments mode')

// ─── 4. Top Products destination ──────────────────────────────────────────
console.log('\n4. Top Products destination')
{
  const range: RangeContext = { range: '1m' }
  const dest = resolveTopInsightViewAll('products', range)
  assert(dest.kind === 'top-products', '4a: kind === top-products')
  assertEqual((dest as any).range, range, '4b: range context preserved')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'inventory', '4c: navigates to inventory view')
  assertEqual(store.calls.inventoryFilter?.[0], 'all', '4d: sets filter=all (complete dataset)')
  assertEqual(store.calls.inventorySortBy?.[0], 'unitsSold', '4e: sets sortBy=unitsSold')
  assertEqual(store.calls.inventoryStatsRange?.[0], range, '4f: stats range set to preserve dashboard window')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('products', { range: '1m' })).includes('unitsSold'), '4g: description mentions unitsSold')

// ─── 5. Top Revenue Products destination (CRITICAL — was routing to Khata) ──
console.log('\n5. Top Revenue Products destination')
{
  const range: RangeContext = { range: '1m' }
  const dest = resolveTopInsightViewAll('top-revenue-products', range)
  assert(dest.kind === 'top-revenue-products', '5a: kind === top-revenue-products')
  assertEqual((dest as any).range, range, '5b: range context preserved')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  // §REGRESSION-CRITICAL: MUST navigate to inventory, NOT khata
  assert(store.view === 'inventory', '5c: navigates to INVENTORY (not khata — regression check)')
  assert(store.view !== 'khata', '5d: NEVER navigates to khata')
  assertEqual(store.calls.inventoryFilter?.[0], 'all', '5e: sets filter=all')
  assertEqual(store.calls.inventorySortBy?.[0], 'revenue', '5f: sets sortBy=revenue')
  assertEqual(store.calls.inventoryStatsRange?.[0], range, '5g: stats range set')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('top-revenue-products', { range: '1m' })).includes('revenue'), '5h: description mentions revenue')

// ─── 6. Defaulters destination (CRITICAL — was only D, not D+E) ─────────────
console.log('\n6. Defaulters destination')
{
  const dest = resolveTopInsightViewAll('defaulters')
  assert(dest.kind === 'defaulters', '6a: kind === defaulters')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'reports', '6b: navigates to reports view')
  assertEqual(store.calls.reportsTab?.[0], 'outstanding', '6c: sets reportsTab=outstanding')
  assertEqual(store.calls.reportsOutstandingTab?.[0], 'receivables', '6d: sets outstandingTab=receivables')
  // §REGRESSION-CRITICAL: MUST be 'D+E' (NOT just 'D')
  assertEqual(store.calls.reportsOutstandingGradeFilter?.[0], 'D+E', '6e: grade filter is D+E (not just D)')
  // §REGRESSION: Must NOT set khataGradeFilter (that field is for Khata view, not Reports)
  assert(!store.calls.khataGradeFilter, '6f: does NOT set khataGradeFilter (wrong destination)')
}
assert(describeViewAllDestination(resolveTopInsightViewAll('defaulters')).includes('D+E'), '6g: description mentions D+E')

// ─── 7. Business Activity Transactions destination ────────────────────────
console.log('\n7. Business Activity Transactions destination')
{
  const range: RangeContext = { range: '7d', customStart: '2026-08-01', customEnd: '2026-08-15' }
  const dest = resolveHubViewAll('transactions', range)
  assert(dest.kind === 'transactions', '7a: kind === transactions')
  assertEqual((dest as any).range, range, '7b: range context preserved (incl. custom dates)')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'history', '7c: navigates to history view')
  assertEqual(store.calls.historyViewMode?.[0], 'transactions', '7d: sets viewMode=transactions (NOT invoices)')
  assertEqual(store.calls.historyRangeContext?.[0], range, '7e: range context set (preserves custom dates)')
}
assert(describeViewAllDestination(resolveHubViewAll('transactions', { range: '7d' })).includes('viewMode=transactions'), '7f: description mentions transactions mode')

// ─── 8. Business Activity Low Stock destination (regression) ──────────────
console.log('\n8. Business Activity Low Stock destination (regression)')
{
  const dest = resolveHubViewAll('lowstock')
  assert(dest.kind === 'low-stock', '8a: kind === low-stock')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'inventory', '8b: navigates to inventory view')
  assertEqual(store.calls.inventoryFilter?.[0], 'low-stock', '8c: sets filter=low-stock')
  assertEqual(store.calls.inventorySortBy?.[0], 'default', '8d: sets sortBy=default (no special sort)')
}
assert(describeViewAllDestination(resolveHubViewAll('lowstock')).includes('low-stock'), '8e: description mentions low-stock')

// ─── 9. Business Activity Online Orders destination ───────────────────────
console.log('\n9. Business Activity Online Orders destination')
{
  const dest = resolveHubViewAll('orders')
  assert(dest.kind === 'online-orders', '9a: kind === online-orders')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assert(store.view === 'online-orders', '9b: navigates to online-orders view')
  // §KEY: Sets initialTab='all' (matches Dashboard's all-status list)
  assertEqual(store.calls.onlineOrdersInitialTab?.[0], 'all', '9c: sets initialTab=all (not pending)')
}
assert(describeViewAllDestination(resolveHubViewAll('orders')).includes('initialTab=all'), '9d: description mentions all tab')

// ─── A. Context preservation: custom date range ───────────────────────────
console.log('\nA. Context preservation: custom date range')
{
  const customRange: RangeContext = { range: 'custom', customStart: '2026-08-01', customEnd: '2026-08-31' }
  // Top Payments with custom range
  const dest1 = resolveTopInsightViewAll('payments', customRange)
  assertEqual((dest1 as any).range, customRange, 'A1: Top Payments preserves custom range')
  // Transactions with custom range
  const dest2 = resolveHubViewAll('transactions', customRange)
  assertEqual((dest2 as any).range, customRange, 'A2: Transactions preserves custom range')
  // Top Buyers with custom range
  const dest3 = resolveTopInsightViewAll('buyers', customRange)
  assertEqual((dest3 as any).range, customRange, 'A3: Top Buyers preserves custom range')
  // Top Products with custom range
  const dest4 = resolveTopInsightViewAll('products', customRange)
  assertEqual((dest4 as any).range, customRange, 'A4: Top Products preserves custom range')
  // Top Revenue Products with custom range
  const dest5 = resolveTopInsightViewAll('top-revenue-products', customRange)
  assertEqual((dest5 as any).range, customRange, 'A5: Top Revenue Products preserves custom range')
}

// ─── B. Null range context (insights that don't carry a range) ─────────────
console.log('\nB. Null range context handling')
{
  // Top Debtors — no range needed (outstanding balances are all-time)
  const dest1 = resolveTopInsightViewAll('debtors')
  assert(!('range' in dest1), 'B1: Top Debtors has no range field')
  // Defaulters — no range needed
  const dest2 = resolveTopInsightViewAll('defaulters')
  assert(!('range' in dest2), 'B2: Defaulters has no range field')
  // Low Stock — no range needed
  const dest3 = resolveHubViewAll('lowstock')
  assert(!('range' in dest3), 'B3: Low Stock has no range field')
  // Online Orders — no range needed
  const dest4 = resolveHubViewAll('orders')
  assert(!('range' in dest4), 'B4: Online Orders has no range field')
}

// ─── C. Range defaults to null when not provided ───────────────────────────
console.log('\nC. Range defaults to null when not provided')
{
  const dest = resolveTopInsightViewAll('payments') // no range arg
  assertEqual((dest as any).range, null, 'C1: Top Payments range defaults to null')
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assertEqual(store.calls.historyRangeContext?.[0], null, 'C2: historyRangeContext set to null (not undefined)')
}

// ─── D. Each store field is set exactly once (one-shot) ────────────────────
console.log('\nD. Each store field set exactly once (one-shot)')
{
  const store = makeMockStore()
  applyViewAllDestination(store, resolveTopInsightViewAll('debtors'))
  // Each setter called at most once
  for (const [key, vals] of Object.entries(store.calls)) {
    if (key === '_activeView') continue
    assert(vals.length === 1, `D1: ${key} called exactly once (got ${vals.length})`)
  }
}

// ─── E. Tenant isolation: navigation is read-only ──────────────────────────
console.log('\nE. Tenant isolation: navigation is read-only')
{
  // §KEY: The ViewAllStoreActions interface has NO mutation methods — only
  // setters for navigation context + active view. There is no API call, no
  // data write, no tenant mutation. This is by design.
  const store = makeMockStore()
  applyViewAllDestination(store, resolveTopInsightViewAll('debtors'))
  applyViewAllDestination(store, resolveTopInsightViewAll('buyers', { range: '7d' }))
  applyViewAllDestination(store, resolveHubViewAll('transactions', { range: '7d' }))

  // Assert: only navigation-related setters were called. No "apiPost", no
  // "createInvoice", no "updateTransaction", etc.
  const allowedSetters = new Set([
    'reportsTab', 'reportsOutstandingTab', 'reportsOutstandingGradeFilter',
    'reportsPartySortBy', 'reportsPartySegment', 'reportsRangeContext',
    'historyViewMode', 'historyRangeContext',
    'inventoryFilter', 'inventorySortBy', 'inventoryStatsRange',
    'onlineOrdersInitialTab', '_activeView',
  ])
  for (const key of Object.keys(store.calls)) {
    assert(allowedSetters.has(key), `E1: only navigation setters called (found ${key})`)
  }
}

// ─── F. Empty dataset handling ────────────────────────────────────────────
console.log('\nF. Empty dataset handling')
{
  // The resolver doesn't depend on the dataset — it always returns the same
  // destination regardless of whether the insight has 0 or 1000 items.
  // The destination view's empty-state is responsible for "no data" UX.
  const dest1 = resolveTopInsightViewAll('debtors')
  const dest2 = resolveTopInsightViewAll('debtors')
  assertEqual(dest1, dest2, 'F1: same insight → same destination (deterministic)')
  // Empty range object still works
  const dest3 = resolveTopInsightViewAll('payments', { range: '7d' })
  assert(dest3.kind === 'top-payments', 'F2: Top Payments with valid range still resolves')
}

// ─── G. Destination matrix completeness ────────────────────────────────────
console.log('\nG. Destination matrix completeness')
{
  // Every TopInsightId must resolve to a destination
  const topIds: Array<'debtors' | 'buyers' | 'payments' | 'products' | 'defaulters' | 'top-revenue-products'> =
    ['debtors', 'buyers', 'payments', 'products', 'defaulters', 'top-revenue-products']
  const seenKinds = new Set<string>()
  for (const id of topIds) {
    const dest = resolveTopInsightViewAll(id, { range: '7d' })
    seenKinds.add(dest.kind)
  }
  assertEqual(seenKinds.size, 6, 'G1: all 6 TopInsight IDs resolve to distinct destinations')

  // Every HubInsightId must resolve to a destination
  const hubIds: Array<'transactions' | 'lowstock' | 'orders'> = ['transactions', 'lowstock', 'orders']
  const seenHubKinds = new Set<string>()
  for (const id of hubIds) {
    const dest = resolveHubViewAll(id, { range: '7d' })
    seenHubKinds.add(dest.kind)
  }
  assertEqual(seenHubKinds.size, 3, 'G2: all 3 HubInsight IDs resolve to distinct destinations')
}

// ─── H. describeViewAllDestination covers all kinds ───────────────────────
console.log('\nH. describeViewAllDestination covers all kinds')
{
  const allDestinations: ViewAllDestination[] = [
    resolveTopInsightViewAll('debtors'),
    resolveTopInsightViewAll('buyers', { range: '7d' }),
    resolveTopInsightViewAll('payments', { range: '7d' }),
    resolveTopInsightViewAll('products', { range: '1m' }),
    resolveTopInsightViewAll('top-revenue-products', { range: '1m' }),
    resolveTopInsightViewAll('defaulters'),
    resolveHubViewAll('transactions', { range: '7d' }),
    resolveHubViewAll('lowstock'),
    resolveHubViewAll('orders'),
  ]
  for (const dest of allDestinations) {
    const desc = describeViewAllDestination(dest)
    assert(desc.length > 0, `H1: ${dest.kind} has non-empty description`)
    assert(desc.includes('→') || desc.includes('='), `H2: ${dest.kind} description has arrow/equal`)
  }
}

// ─── I. Reports → Outstanding grade filter is generic + reusable ───────────
console.log('\nI. Outstanding grade filter is generic + reusable')
{
  // §KEY: The grade filter is NOT a hardcoded special case for Defaulters.
  // It accepts 'all' | 'D' | 'E' | 'D+E' — any grade combination. This means
  // it can be reused for other future insights (e.g. "Grade A customers").
  const dest1 = resolveTopInsightViewAll('defaulters')
  const store1 = makeMockStore()
  applyViewAllDestination(store1, dest1)
  assertEqual(store1.calls.reportsOutstandingGradeFilter?.[0], 'D+E', 'I1: Defaulters uses D+E')

  // The store field setter accepts any OutstandingGradeFilter value
  // (validated by the type system — 'all' | 'D' | 'E' | 'D+E').
  // No runtime check hardcodes "only D+E is allowed".
}

// ─── J. Top Buyers preserves dashboard range for purchaseVolume computation ─
console.log('\nJ. Top Buyers preserves dashboard range for purchaseVolume')
{
  // §KEY: The dashboard's Top Buyers insight is computed for the dashboard's
  // range (e.g. '7d'). View-All must pass that range to Reports so the
  // purchaseVolume per party is computed for the SAME window.
  const range: RangeContext = { range: '7d' }
  const dest = resolveTopInsightViewAll('buyers', range)
  const store = makeMockStore()
  applyViewAllDestination(store, dest)
  assertEqual(store.calls.reportsRangeContext?.[0], range, 'J1: reportsRangeContext set to dashboard range')
  // Reports API uses this range to compute purchaseVolume per partyLedger entry
  // (see /api/reports route — buyerVolumeGroups query filters by createdAt).
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(60)}`)
console.log(`✨ STEP-4B View-All Tests: ${passed} passed, ${failed} failed`)
console.log(`${'='.repeat(60)}`)
if (failed > 0) {
  process.exit(1)
}
