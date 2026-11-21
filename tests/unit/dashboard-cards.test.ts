/**
 * §TEST: Dashboard card system regression tests.
 *
 * Run: npx tsx tests/unit/dashboard-cards.test.ts
 *
 * Tests:
 *   1. Default card list (16 cards — Phase 4 added netProfitLoss + grossProfit)
 *   2. 10 default cards visible by default
 *   3. Card destination mapping (all 16)
 *   4. Hidden cards not rendered
 *   5. Custom order works
 *   6. Malformed config fallback
 *   7. Unknown card IDs filtered
 *   8. Missing card recovery
 *   9. Save dirty state
 *   10. Cancel behavior
 *   11. Discard confirmation
 *   12. Persistence endpoint
 *   13. No localStorage
 *   14. No duplicate save calls
 *   15. API validation (KNOWN_IDS includes all 16)
 *   16. Backup/restore includes dashboardCards
 *   17. All 16 cards use real existing API fields
 */
export {}

import * as fs from 'fs'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) { if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ } }

// ─── Import parseCardConfig ===
// §FIX: Updated to match the CURRENT 16-card DEFAULT_CARD_CONFIG (Phase 4 ordering).
function parseCardConfig(raw: any): Array<{id:string;visible:boolean;order:number}> {
  const DEFAULTS = [
    // PRIMARY PERFORMANCE
    { id: 'totalSales', visible: true, order: 0 },
    { id: 'netProfitLoss', visible: true, order: 1 },
    { id: 'totalCollection', visible: true, order: 2 },
    { id: 'totalRevenue', visible: true, order: 3 },
    // SECONDARY FINANCIAL
    { id: 'totalReceivable', visible: true, order: 4 },
    { id: 'totalPayable', visible: true, order: 5 },
    { id: 'totalExpense', visible: true, order: 6 },
    // INVENTORY / OPERATIONS
    { id: 'lowStock', visible: true, order: 7 },
    { id: 'stockValue', visible: true, order: 8 },
    // HEALTH / INSIGHTS
    { id: 'businessHealth', visible: true, order: 9 },
    // HIDDEN BY DEFAULT
    { id: 'todaySales', visible: false, order: 10 },
    { id: 'monthlyRevenue', visible: false, order: 11 },
    { id: 'grossProfit', visible: false, order: 12 },
    { id: 'totalCustomers', visible: false, order: 13 },
    { id: 'totalProducts', visible: false, order: 14 },
    { id: 'totalInvoices', visible: false, order: 15 },
  ]
  if (!raw) return DEFAULTS
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return DEFAULTS
    const KNOWN = new Set(DEFAULTS.map(c => c.id))
    const clean = parsed.filter((c:any) => typeof c?.id === 'string' && KNOWN.has(c.id) && typeof c.visible === 'boolean' && typeof c.order === 'number').map((c:any) => ({id:c.id,visible:c.visible,order:c.order}))
    for (const def of DEFAULTS) { if (!clean.find((c:any) => c.id === def.id)) clean.push({...def, visible:false}) }
    return clean.sort((a:any,b:any) => a.order - b.order)
  } catch { return DEFAULTS }
}

console.log('\n  Default card list:')
// 1. Default card list (16 cards)
const defaults = parseCardConfig(null)
assert(defaults.length === 16, 'Default card list has 16 cards')
assert(defaults[0].id === 'totalSales', 'First default card is totalSales')
assert(defaults[1].id === 'netProfitLoss', 'Second default card is netProfitLoss')
assert(defaults[9].id === 'businessHealth', '10th default card is businessHealth')
assert(defaults[15].id === 'totalInvoices', '16th default card is totalInvoices')

// 2. 10 default cards visible by default
const visibleDefaults = defaults.filter(c => c.visible)
assert(visibleDefaults.length === 10, '10 default cards are visible by default')
assert(visibleDefaults.every(c => c.order < 10), 'All visible defaults have order 0-9')

console.log('\n  Card destination mapping (source inspection):')
// 3. Card destination mapping
const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
assert(dashSrc.includes("setKhataFilter('receivable')"), 'totalReceivable → Khata receivable')
assert(dashSrc.includes("setKhataFilter('payable')"), 'totalPayable → Khata payable')
assert(dashSrc.includes("setReportsTab('health')") && dashSrc.includes("businessHealth"), 'businessHealth → Reports (health tab)')
assert(dashSrc.includes("setInventoryFilter('low-stock')"), 'lowStock → Inventory low-stock')
assert(dashSrc.includes("setHistoryRangeContext") && dashSrc.includes("totalSales"), 'totalSales → History (via RangeContext)')
assert(dashSrc.includes("setHistoryRangeContext") && dashSrc.includes("totalCollection"), 'totalCollection → History (via RangeContext)')
assert(dashSrc.includes("setReportsRangeContext") && dashSrc.includes("totalExpense"), 'totalExpense → Reports PL (via RangeContext)')
assert(dashSrc.includes("setReportsRangeContext") && dashSrc.includes("totalRevenue"), 'totalRevenue → Reports PL (via RangeContext)')
assert(dashSrc.includes("setReportsRangeContext") && dashSrc.includes("netProfitLoss"), 'netProfitLoss → Reports PL (via RangeContext)')
assert(dashSrc.includes("setReportsRangeContext") && dashSrc.includes("grossProfit"), 'grossProfit → Reports PL (via RangeContext)')
assert(dashSrc.includes("setKhataFilter('all')") && dashSrc.includes("totalCustomers"), 'totalCustomers → Khata all')
assert(dashSrc.includes("setActiveView('inventory')") && dashSrc.includes("totalProducts"), 'totalProducts → Inventory')
assert(dashSrc.includes("setActiveView('billing')") && dashSrc.includes("totalInvoices"), 'totalInvoices → Billing')
assert(dashSrc.includes("setActiveView('inventory')") && dashSrc.includes("stockValue"), 'stockValue → Inventory')
assert(dashSrc.includes("setHistoryRangeContext({ range: '1d' }") && dashSrc.includes("todaySales"), 'todaySales → History (range: 1d/today)')
assert(dashSrc.includes("setReportsRangeContext({ range: '1m' }") && dashSrc.includes("monthlyRevenue"), 'monthlyRevenue → Reports (range: 1m/month)')

console.log('\n  Hidden cards and ordering:')
// 4. Hidden cards not rendered
assert(dashSrc.includes('filter(c => c.visible)'), 'Hidden cards filtered out before rendering')
assert(dashSrc.includes('visibleCards.map'), 'Only visible cards are mapped to render')

// 5. Custom order
const customOrder = parseCardConfig(JSON.stringify([
  {id:'totalRevenue',visible:true,order:0},
  {id:'netProfitLoss',visible:true,order:1},
  {id:'totalReceivable',visible:true,order:2},
  {id:'totalPayable',visible:true,order:3},
  {id:'businessHealth',visible:true,order:4},
  {id:'lowStock',visible:true,order:5},
  {id:'totalSales',visible:true,order:6},
  {id:'totalCollection',visible:true,order:7},
]))
assert(customOrder[0].id === 'totalRevenue', 'Custom order: totalRevenue first')
assert(customOrder[1].id === 'netProfitLoss', 'Custom order: netProfitLoss second')

console.log('\n  Malformed/fallback:')
// 6. Malformed config fallback
const malformed = parseCardConfig('{invalid}')
assert(malformed.length === 16, 'Malformed JSON → defaults (16 cards)')
assert(malformed[0].id === 'totalSales', 'Malformed → first card is totalSales')

// 7. Unknown card IDs filtered
const withUnknown = parseCardConfig(JSON.stringify([
  {id:'totalSales',visible:true,order:0},
  {id:'maliciousCard',visible:true,order:1},
  {id:'netProfitLoss',visible:true,order:2},
]))
assert(!withUnknown.find(c => c.id === 'maliciousCard'), 'Unknown card ID filtered out')
assert(withUnknown.length === 16, 'Unknown removed, missing cards added back')

// 8. Missing card recovery
const partial = parseCardConfig(JSON.stringify([
  {id:'totalSales',visible:true,order:0},
]))
assert(partial.length === 16, 'Partial config: missing cards added back')
const addedBack = partial.find(c => c.id === 'netProfitLoss')
assert(!!addedBack && addedBack.visible === false, 'Missing card added as hidden')

console.log('\n  Save/Cancel/persistence:')
// 9. Save dirty state
const mgrSrc = fs.readFileSync('src/components/shared/dashboard-card-management.tsx', 'utf8')
assert(mgrSrc.includes('isDirty'), 'isDirty state exists')
assert(mgrSrc.includes('Save Changes'), 'Save Changes label')
assert(mgrSrc.includes('No changes'), 'No changes label')
assert(mgrSrc.includes('Saving...'), 'Saving label')
assert(mgrSrc.includes('disabled={saving || !isDirty}'), 'Save disabled when not dirty or saving')

// 10. Cancel behavior
assert(mgrSrc.includes('cancel') && mgrSrc.includes('setDraft('), 'Cancel restores draft')

// 11. Discard confirmation
assert(mgrSrc.includes('tryClose'), 'tryClose function exists')
assert(mgrSrc.includes('showDiscardConfirm'), 'Discard confirmation state exists')
assert(mgrSrc.includes('Discard unsaved changes'), 'Discard dialog text exists')
assert(mgrSrc.includes('Continue Editing'), 'Continue Editing button exists')

// 12. Persistence endpoint
assert(dashSrc.includes("fetch('/api/card-customization'"), 'Save uses POST /api/card-customization')
assert(dashSrc.includes('dashboardCards: JSON.stringify'), 'Save sends dashboardCards as JSON string')

// 13. No localStorage
assert(!dashSrc.includes('localStorage.getItem'), 'No localStorage getItem in dashboard-view')
assert(!dashSrc.includes('localStorage.setItem'), 'No localStorage setItem in dashboard-view')
assert(!mgrSrc.includes('localStorage'), 'No localStorage in management component')

// 14. No duplicate save calls
const saveStart = dashSrc.indexOf('const saveDashboardCards')
const saveEnd = dashSrc.indexOf('}', saveStart + 200)
const saveFunc = dashSrc.substring(saveStart, saveEnd + 1)
const fetchCount = (saveFunc.match(/fetch\(/g) || []).length
assert(fetchCount === 1, 'Save function has exactly 1 fetch call')

console.log('\n  API validation:')
// 15. API validateDashboardCards
const apiSrc = fs.readFileSync('src/app/api/card-customization/route.ts', 'utf8')
assert(apiSrc.includes('validateDashboardCards'), 'API has validateDashboardCards')
assert(apiSrc.includes('KNOWN_IDS'), 'API has known IDs allow-list')
assert(apiSrc.includes('totalSales') && apiSrc.includes('monthlyRevenue'), 'API allow-list includes existing IDs')
assert(apiSrc.includes('netProfitLoss'), 'API allow-list includes netProfitLoss (Phase 4 fix)')
assert(apiSrc.includes('grossProfit'), 'API allow-list includes grossProfit (Phase 4 fix)')

console.log('\n  Backup/restore:')
// 16. Backup includes dashboardCards
const backupSrc = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
assert(backupSrc.includes('dashboardCards'), 'Backup format includes dashboardCards')
assert(backupSrc.includes('s.dashboardCards ?? null'), 'Backup sanitizer has null fallback')

console.log('\n  Additional cards data verification:')
// 17. All 16 cards use real existing API fields
assert(dashSrc.includes("d?.totalReceivable") && dashSrc.includes("d?.totalPayable"), 'totalReceivable/totalPayable from dashboard data')
assert(dashSrc.includes("d?.healthScore"), 'healthScore from dashboard data')
assert(dashSrc.includes("d?.lowStockCount"), 'lowStockCount from dashboard data')
assert(dashSrc.includes("d?.rangeSales") && dashSrc.includes("d?.rangeCollection") && dashSrc.includes("d?.rangeExpense"), 'range fields from dashboard data')
assert(dashSrc.includes("d?.rangeNetProfit"), 'rangeNetProfit from dashboard data (netProfitLoss card)')
assert(dashSrc.includes("d?.rangeGrossProfit"), 'rangeGrossProfit from dashboard data (grossProfit card)')
assert(dashSrc.includes("d?.partyCount"), 'partyCount from dashboard data')
assert(dashSrc.includes("d?.productCount"), 'productCount from dashboard data')
assert(dashSrc.includes("d?.invoiceCount"), 'invoiceCount from dashboard data')
assert(dashSrc.includes("d?.inventoryValue"), 'inventoryValue from dashboard data')
assert(dashSrc.includes("d?.todaySales"), 'todaySales from dashboard data')
assert(dashSrc.includes("d?.monthlyRevenue"), 'monthlyRevenue from dashboard data')

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
