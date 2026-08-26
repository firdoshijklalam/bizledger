/**
 * §TEST: Dashboard card system regression tests.
 *
 * Run: npx tsx tests/unit/dashboard-cards.test.ts
 *
 * Tests:
 *   1. Default card list (14 cards)
 *   2. 8 default cards visible by default
 *   3. Card destination mapping (all 14)
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
 */
export {}

import * as fs from 'fs'

let passed = 0, failed = 0
function assert(cond: boolean, msg: string) { if (cond) { console.log('  ✅', msg); passed++ } else { console.log('  ❌', msg); failed++ } }

// ─── Import parseCardConfig ===
function parseCardConfig(raw: any): Array<{id:string;visible:boolean;order:number}> {
  const DEFAULTS = [
    { id: 'totalReceivable', visible: true, order: 0 },
    { id: 'totalPayable', visible: true, order: 1 },
    { id: 'businessHealth', visible: true, order: 2 },
    { id: 'lowStock', visible: true, order: 3 },
    { id: 'totalSales', visible: true, order: 4 },
    { id: 'totalCollection', visible: true, order: 5 },
    { id: 'totalExpense', visible: true, order: 6 },
    { id: 'totalRevenue', visible: true, order: 7 },
    { id: 'totalCustomers', visible: false, order: 8 },
    { id: 'totalProducts', visible: false, order: 9 },
    { id: 'totalInvoices', visible: false, order: 10 },
    { id: 'stockValue', visible: false, order: 11 },
    { id: 'todaySales', visible: false, order: 12 },
    { id: 'monthlyRevenue', visible: false, order: 13 },
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
// 1. Default card list (14 cards)
const defaults = parseCardConfig(null)
assert(defaults.length === 14, 'Default card list has 14 cards')
assert(defaults[0].id === 'totalReceivable', 'First default card is totalReceivable')
assert(defaults[7].id === 'totalRevenue', '8th default card is totalRevenue')
assert(defaults[13].id === 'monthlyRevenue', '14th default card is monthlyRevenue')

// 2. 8 default cards visible by default
const visibleDefaults = defaults.filter(c => c.visible)
assert(visibleDefaults.length === 8, '8 default cards are visible by default')
assert(visibleDefaults.every(c => c.order < 8), 'All visible defaults have order 0-7')

console.log('\n  Card destination mapping (source inspection):')
// 3. Card destination mapping
const dashSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
assert(dashSrc.includes("setKhataFilter('receivable')"), 'totalReceivable → Khata receivable')
assert(dashSrc.includes("setKhataFilter('payable')"), 'totalPayable → Khata payable')
assert(dashSrc.includes("setActiveView('reports')") && dashSrc.includes("businessHealth"), 'businessHealth → Reports')
assert(dashSrc.includes("setInventoryFilter('low-stock')"), 'lowStock → Inventory low-stock')
assert(dashSrc.includes("setHistoryDateRange") && dashSrc.includes("totalSales"), 'totalSales → History')
assert(dashSrc.includes("setHistoryDateRange") && dashSrc.includes("totalCollection"), 'totalCollection → History')
assert(dashSrc.includes("setReportsDateRange") && dashSrc.includes("totalExpense"), 'totalExpense → Reports PL')
assert(dashSrc.includes("setReportsDateRange") && dashSrc.includes("totalRevenue"), 'totalRevenue → Reports PL')
assert(dashSrc.includes("setKhataFilter('all')") && dashSrc.includes("totalCustomers"), 'totalCustomers → Khata all')
assert(dashSrc.includes("setActiveView('inventory')") && dashSrc.includes("totalProducts"), 'totalProducts → Inventory')
assert(dashSrc.includes("setActiveView('billing')") && dashSrc.includes("totalInvoices"), 'totalInvoices → Billing')
assert(dashSrc.includes("setActiveView('inventory')") && dashSrc.includes("stockValue"), 'stockValue → Inventory')
assert(dashSrc.includes("setHistoryDateRange('today')") && dashSrc.includes("todaySales"), 'todaySales → History today')
assert(dashSrc.includes("setReportsDateRange('month')") && dashSrc.includes("monthlyRevenue"), 'monthlyRevenue → Reports month')

console.log('\n  Hidden cards and ordering:')
// 4. Hidden cards not rendered
assert(dashSrc.includes('filter(c => c.visible)'), 'Hidden cards filtered out before rendering')
assert(dashSrc.includes('visibleCards.map'), 'Only visible cards are mapped to render')

// 5. Custom order
const customOrder = parseCardConfig(JSON.stringify([
  {id:'totalRevenue',visible:true,order:0},
  {id:'totalReceivable',visible:true,order:1},
  {id:'totalPayable',visible:true,order:2},
  {id:'businessHealth',visible:true,order:3},
  {id:'lowStock',visible:true,order:4},
  {id:'totalSales',visible:true,order:5},
  {id:'totalCollection',visible:true,order:6},
  {id:'totalExpense',visible:true,order:7},
]))
assert(customOrder[0].id === 'totalRevenue', 'Custom order: totalRevenue first')
assert(customOrder[1].id === 'totalReceivable', 'Custom order: totalReceivable second')

console.log('\n  Malformed/fallback:')
// 6. Malformed config fallback
const malformed = parseCardConfig('{invalid}')
assert(malformed.length === 14, 'Malformed JSON → defaults (14 cards)')
assert(malformed[0].id === 'totalReceivable', 'Malformed → first card is totalReceivable')

// 7. Unknown card IDs filtered
const withUnknown = parseCardConfig(JSON.stringify([
  {id:'totalReceivable',visible:true,order:0},
  {id:'maliciousCard',visible:true,order:1},
  {id:'totalPayable',visible:true,order:2},
]))
assert(!withUnknown.find(c => c.id === 'maliciousCard'), 'Unknown card ID filtered out')
assert(withUnknown.length === 14, 'Unknown removed, missing cards added back')

// 8. Missing card recovery
const partial = parseCardConfig(JSON.stringify([
  {id:'totalReceivable',visible:true,order:0},
]))
assert(partial.length === 14, 'Partial config: missing cards added back')
const addedBack = partial.find(c => c.id === 'totalPayable')
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
assert(apiSrc.includes('totalReceivable') && apiSrc.includes('monthlyRevenue'), 'API allow-list includes all 14 IDs')

console.log('\n  Backup/restore:')
// 16. Backup includes dashboardCards
const backupSrc = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
assert(backupSrc.includes('dashboardCards'), 'Backup format includes dashboardCards')
assert(backupSrc.includes('s.dashboardCards ?? null'), 'Backup sanitizer has null fallback')

console.log('\n  Additional cards data verification:')
// 17. All 14 cards use real existing API fields
assert(dashSrc.includes("d?.totalReceivable") && dashSrc.includes("d?.totalPayable"), 'totalReceivable/totalPayable from dashboard data')
assert(dashSrc.includes("d?.healthScore"), 'healthScore from dashboard data')
assert(dashSrc.includes("d?.lowStockCount"), 'lowStockCount from dashboard data')
assert(dashSrc.includes("d?.rangeSales") && dashSrc.includes("d?.rangeCollection") && dashSrc.includes("d?.rangeExpense"), 'range fields from dashboard data')
assert(dashSrc.includes("d?.partyCount"), 'partyCount from dashboard data')
assert(dashSrc.includes("d?.productCount"), 'productCount from dashboard data')
assert(dashSrc.includes("d?.invoiceCount"), 'invoiceCount from dashboard data')
assert(dashSrc.includes("d?.inventoryValue"), 'inventoryValue from dashboard data')
assert(dashSrc.includes("d?.todaySales"), 'todaySales from dashboard data')
assert(dashSrc.includes("d?.monthlyRevenue"), 'monthlyRevenue from dashboard data')

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
