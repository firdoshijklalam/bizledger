/**
 * §TEST: Reports accounting correctness — voided invoice exclusion + COGS.
 *
 * Run: npx tsx tests/unit/reports-accounting.test.ts
 *
 * Tests:
 * 1. Voided invoices excluded from revenue, GST, and profit
 * 2. COGS calculated from actual purchase price data (not 0)
 * 3. Formula: Revenue − COGS = Gross Profit; Gross Profit − Expenses = Net Profit
 *
 * These tests verify the report CALCULATION LOGIC without a database — they
 * test the mathematical formulas directly using the same patterns as the
 * reports route.
 */
export {}

// ─── Test Runner ───────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

function approxEqual(a: number, b: number, tolerance = 0.01): boolean {
  return Math.abs(a - b) < tolerance
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface MockInvoice {
  type: 'sales' | 'retail' | 'purchase'
  status: 'paid' | 'partial' | 'unpaid' | 'void'
  isGst: boolean
  subtotal: number
  discountAmount: number
  gstAmount: number
  grandTotal: number
  items: MockInvoiceItem[]
}

interface MockInvoiceItem {
  productId: string | null
  quantity: number
  unitPrice: number
  total: number
  gstRate: number
}

interface MockProduct {
  id: string
  purchasePrice: number
}

interface MockTransaction {
  type: 'sale' | 'debit' | 'expense' | 'credit'
  amount: number
}

// ─── Report Calculation Logic (mirrors src/app/api/reports/route.ts) ──────
function calculateReports(
  invoices: MockInvoice[],
  products: MockProduct[],
  transactions: MockTransaction[]
) {
  // §VOID-EXCLUSION: Only non-voided invoices
  const nonVoidedInvoices = invoices.filter((i) => i.status !== 'void')
  const salesInvoices = nonVoidedInvoices.filter((i) => i.type === 'sales' || i.type === 'retail')

  const totalRevenue = salesInvoices.reduce((s, i) => s + i.subtotal, 0)
  const totalGst = salesInvoices.reduce((s, i) => s + i.gstAmount, 0)
  const totalDiscount = salesInvoices.reduce((s, i) => s + i.discountAmount, 0)
  const netRevenue = totalRevenue - totalDiscount

  // §COGS: sum of (item.quantity × product.purchasePrice) for sales invoices
  const productCostMap = new Map(products.map((p) => [p.id, p.purchasePrice]))
  const cogs = salesInvoices.reduce((s, inv) => {
    return s + inv.items.reduce((itemSum, it) => {
      const costPerUnit = it.productId ? (productCostMap.get(it.productId) ?? 0) : 0
      return itemSum + (it.quantity * costPerUnit)
    }, 0)
  }, 0)

  const indirectExpenses = transactions
    .filter((t) => t.type === 'expense' || t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0)
  const totalExpense = cogs + indirectExpenses

  const grossProfit = netRevenue - cogs
  const netProfit = grossProfit - indirectExpenses

  return { totalRevenue, totalGst, totalDiscount, netRevenue, cogs, indirectExpenses, totalExpense, grossProfit, netProfit }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n🧪 Reports Accounting Tests\n')

// Test 1: Voided invoice excluded from revenue
console.log('Test 1: Voided invoice excluded from revenue')
{
  const invoices: MockInvoice[] = [
    { type: 'sales', status: 'paid', isGst: false, subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000, items: [] },
    { type: 'sales', status: 'void', isGst: false, subtotal: 500, discountAmount: 0, gstAmount: 0, grandTotal: 500, items: [] },
  ]
  const products: MockProduct[] = []
  const transactions: MockTransaction[] = []

  const r = calculateReports(invoices, products, transactions)
  assert(approxEqual(r.totalRevenue, 1000), 'totalRevenue = 1000 (voided 500 excluded)')
  assert(approxEqual(r.totalGst, 0), 'totalGst = 0')
  assert(approxEqual(r.grossProfit, 1000), 'grossProfit = 1000 (no COGS)')
}

// Test 2: Voided invoice excluded from GST
console.log('\nTest 2: Voided invoice excluded from GST')
{
  const invoices: MockInvoice[] = [
    { type: 'sales', status: 'paid', isGst: true, subtotal: 1000, discountAmount: 0, gstAmount: 180, grandTotal: 1180, items: [] },
    { type: 'sales', status: 'void', isGst: true, subtotal: 500, discountAmount: 0, gstAmount: 90, grandTotal: 590, items: [] },
  ]
  const r = calculateReports(invoices, [], [])
  assert(approxEqual(r.totalGst, 180), 'totalGst = 180 (voided 90 excluded)')
}

// Test 3: COGS calculated from purchase price
console.log('\nTest 3: COGS = quantity × purchasePrice')
{
  // Product: purchasePrice ₹60
  // Sale: 10 qty × ₹100 = ₹1000 revenue
  // Expected COGS = 10 × ₹60 = ₹600
  // Gross Profit = ₹1000 − ₹600 = ₹400
  const invoices: MockInvoice[] = [
    {
      type: 'sales', status: 'paid', isGst: false,
      subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000,
      items: [{ productId: 'p1', quantity: 10, unitPrice: 100, total: 1000, gstRate: 0 }],
    },
  ]
  const products: MockProduct[] = [{ id: 'p1', purchasePrice: 60 }]
  const r = calculateReports(invoices, products, [])
  assert(approxEqual(r.totalRevenue, 1000), 'revenue = 1000')
  assert(approxEqual(r.cogs, 600), 'COGS = 600 (10 × ₹60)')
  assert(approxEqual(r.grossProfit, 400), 'grossProfit = 400 (1000 − 600)')
}

// Test 4: COGS with discount (net revenue basis)
console.log('\nTest 4: COGS with discount — gross profit on net revenue')
{
  // Product: purchasePrice ₹60
  // Sale: 10 qty × ₹100 = ₹1000, discount ₹100 → net revenue ₹900
  // COGS = 10 × ₹60 = ₹600
  // Gross Profit = ₹900 − ₹600 = ₹300
  const invoices: MockInvoice[] = [
    {
      type: 'sales', status: 'paid', isGst: false,
      subtotal: 1000, discountAmount: 100, gstAmount: 0, grandTotal: 900,
      items: [{ productId: 'p1', quantity: 10, unitPrice: 100, total: 1000, gstRate: 0 }],
    },
  ]
  const products: MockProduct[] = [{ id: 'p1', purchasePrice: 60 }]
  const r = calculateReports(invoices, products, [])
  assert(approxEqual(r.netRevenue, 900), 'netRevenue = 900 (after discount)')
  assert(approxEqual(r.cogs, 600), 'COGS = 600')
  assert(approxEqual(r.grossProfit, 300), 'grossProfit = 300 (900 − 600)')
}

// Test 5: Net profit = gross profit − indirect expenses
console.log('\nTest 5: Net profit = gross profit − indirect expenses')
{
  const invoices: MockInvoice[] = [
    {
      type: 'sales', status: 'paid', isGst: false,
      subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000,
      items: [{ productId: 'p1', quantity: 10, unitPrice: 100, total: 1000, gstRate: 0 }],
    },
  ]
  const products: MockProduct[] = [{ id: 'p1', purchasePrice: 60 }]
  const transactions: MockTransaction[] = [
    { type: 'expense', amount: 50 },  // rent
    { type: 'debit', amount: 30 },    // electricity
  ]
  const r = calculateReports(invoices, products, transactions)
  assert(approxEqual(r.cogs, 600), 'COGS = 600')
  assert(approxEqual(r.indirectExpenses, 80), 'indirectExpenses = 80 (50 + 30)')
  assert(approxEqual(r.grossProfit, 400), 'grossProfit = 400')
  assert(approxEqual(r.netProfit, 320), 'netProfit = 320 (400 − 80)')
}

// Test 6: Purchase invoices do NOT contribute to sales revenue
console.log('\nTest 6: Purchase invoices excluded from sales revenue')
{
  const invoices: MockInvoice[] = [
    { type: 'sales', status: 'paid', isGst: false, subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000, items: [] },
    { type: 'purchase', status: 'paid', isGst: false, subtotal: 600, discountAmount: 0, gstAmount: 0, grandTotal: 600, items: [] },
  ]
  const r = calculateReports(invoices, [], [])
  assert(approxEqual(r.totalRevenue, 1000), 'revenue = 1000 (purchase 600 excluded)')
}

// Test 7: Multiple products with different costs
console.log('\nTest 7: Multiple products — COGS sums correctly')
{
  const invoices: MockInvoice[] = [
    {
      type: 'sales', status: 'paid', isGst: false,
      subtotal: 2000, discountAmount: 0, gstAmount: 0, grandTotal: 2000,
      items: [
        { productId: 'p1', quantity: 5, unitPrice: 100, total: 500, gstRate: 0 },
        { productId: 'p2', quantity: 10, unitPrice: 150, total: 1500, gstRate: 0 },
      ],
    },
  ]
  const products: MockProduct[] = [
    { id: 'p1', purchasePrice: 60 },
    { id: 'p2', purchasePrice: 100 },
  ]
  const r = calculateReports(invoices, products, [])
  // COGS = (5 × 60) + (10 × 100) = 300 + 1000 = 1300
  assert(approxEqual(r.cogs, 1300), 'COGS = 1300 (5×60 + 10×100)')
  assert(approxEqual(r.grossProfit, 700), 'grossProfit = 700 (2000 − 1300)')
}

// Test 8: All voided — revenue is 0
console.log('\nTest 8: All invoices voided — revenue is 0')
{
  const invoices: MockInvoice[] = [
    { type: 'sales', status: 'void', isGst: false, subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000, items: [] },
    { type: 'sales', status: 'void', isGst: false, subtotal: 500, discountAmount: 0, gstAmount: 0, grandTotal: 500, items: [] },
  ]
  const r = calculateReports(invoices, [], [])
  assert(approxEqual(r.totalRevenue, 0), 'revenue = 0 (all voided)')
  assert(approxEqual(r.totalGst, 0), 'GST = 0 (all voided)')
  assert(approxEqual(r.grossProfit, 0), 'grossProfit = 0')
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')

if (failed > 0) process.exit(1)
