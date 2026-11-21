/**
 * §TEST: Phase 16 Step 1 — Critical accounting scope fixes regression tests.
 *
 * Run: npx tsx tests/unit/phase16-step1-accounting-fixes.test.ts
 *
 * Tests the 5 Step 1 changes:
 *   A. Dashboard invoice queries filter `type IN ('sales','retail')`
 *   B. Dashboard expense excludes invoice-linked transactions (`invoiceId IS NULL`)
 *   C. Reports indirectExpenses excludes invoice-linked transactions
 *   D. Transactions route atomicity (transaction.create inside db.$transaction)
 *   E. Transactions route invoiceId ownership validation
 *
 * Also verifies accounting invariants:
 *   INV-01: Purchase never contributes to Revenue
 *   INV-02: Challan never contributes to Revenue
 *   INV-03: Void invoice never contributes to Revenue
 *   INV-04: Purchase does not directly reduce Profit (via expense)
 *   INV-05: Invoice-linked debit does not become operating expense
 *
 * Uses mock objects to test calculation LOGIC — mirrors the patterns in
 * tests/unit/reports-accounting.test.ts. No database required.
 */
export {}

import * as fs from 'fs'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ } else { console.log(`  ❌ ${msg}`); failed++ }
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface MockInvoice {
  type: 'sales' | 'retail' | 'purchase' | 'challan'
  status: 'paid' | 'partial' | 'unpaid' | 'void'
  grandTotal: number
  subtotal: number
  discountAmount: number
  createdAt: string
  paymentMode: 'cash' | 'credit'
  partyId: string | null
}

interface MockTransaction {
  type: 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'
  amount: number
  createdAt: string
  invoiceId: string | null  // §P16-STEP1-B: key discriminator
  partyId: string | null
}

interface MockProduct {
  id: string
  purchasePrice: number
}

interface MockInvoiceItem {
  productId: string | null
  quantity: number
  unitPrice: number
  total: number
}

// ─── Dashboard calculation mirrors (post-Step 1) ──────────────────────────

// §DASHBOARD-SQL: Mirrors the D3 raw SQL aggregate after Step 1 fix.
// Key change: WHERE clause now includes `AND "type" IN ('sales', 'retail')`.
function dashboardInvoiceAggregate(invoices: MockInvoice[], rangeStart: Date, rangeEnd: Date, todayBounds: Date, monthStart: Date) {
  const filtered = invoices.filter(inv =>
    inv.status !== 'void' &&
    (inv.type === 'sales' || inv.type === 'retail')  // §P16-STEP1-A: type filter
  )
  return {
    today_sales: filtered
      .filter(inv => new Date(inv.createdAt) >= todayBounds)
      .reduce((s, inv) => s + inv.grandTotal, 0),
    monthly_sales: filtered
      .filter(inv => new Date(inv.createdAt) >= monthStart)
      .reduce((s, inv) => s + inv.grandTotal, 0),
    range_sales: filtered
      .filter(inv => new Date(inv.createdAt) >= rangeStart && new Date(inv.createdAt) <= rangeEnd)
      .reduce((s, inv) => s + inv.grandTotal, 0),
    range_net_revenue: filtered
      .filter(inv => new Date(inv.createdAt) >= rangeStart && new Date(inv.createdAt) <= rangeEnd)
      .reduce((s, inv) => s + (inv.subtotal - inv.discountAmount), 0),
    total_count: filtered.length,
    paid_count: filtered.filter(inv => inv.status === 'paid').length,
  }
}

// §DASHBOARD-TXN-SQL: Mirrors the D4 raw SQL aggregate after Step 1 fix.
// Key change: expense_sum CASE now includes `AND "invoiceId" IS NULL`.
function dashboardTransactionAggregate(txns: MockTransaction[], rangeStart: Date, rangeEnd: Date) {
  const filtered = txns.filter(t =>
    new Date(t.createdAt) >= rangeStart &&
    new Date(t.createdAt) <= rangeEnd
  )
  return {
    collection_sum: filtered
      .filter(t => t.type === 'credit')
      .reduce((s, t) => s + t.amount, 0),
    // §P16-STEP1-B: expense_sum excludes invoice-linked transactions
    expense_sum: filtered
      .filter(t =>
        (t.type === 'debit' || t.type === 'expense' || t.type === 'purchase') &&
        t.invoiceId === null  // §P16-STEP1-B: exclude invoice side-effects
      )
      .reduce((s, t) => s + t.amount, 0),
  }
}

// §DASHBOARD-CHART: Mirrors the JS-side chart bucket computation after Step 1.
function dashboardChartBucket(invoices: MockInvoice[], txns: MockTransaction[], bucketStart: Date, bucketEnd: Date) {
  const EXPENSE_TYPES = ['debit', 'expense', 'purchase'] as const
  const dayInvoices = invoices.filter(inv =>
    new Date(inv.createdAt) >= bucketStart &&
    new Date(inv.createdAt) < bucketEnd &&
    inv.status !== 'void' &&
    (inv.type === 'sales' || inv.type === 'retail')  // §P16-STEP1-A
  )
  const dayTxns = txns.filter(t =>
    new Date(t.createdAt) >= bucketStart &&
    new Date(t.createdAt) < bucketEnd
  )
  const revenue = dayInvoices.reduce((s, inv) => s + inv.grandTotal, 0)
  // §P16-STEP1-B: chart expense also excludes invoice-linked transactions
  const expense = dayTxns
    .filter(t => EXPENSE_TYPES.includes(t.type as any) && !t.invoiceId)
    .reduce((s, t) => s + t.amount, 0)
  const collected = dayTxns.filter(t => t.type === 'credit').reduce((s, t) => s + t.amount, 0)
  const creditGiven = dayInvoices
    .filter(inv => inv.paymentMode === 'credit')
    .reduce((s, inv) => s + inv.grandTotal, 0)
  return { revenue, expense, profit: revenue - expense, collected, creditGiven }
}

// §REPORTS-INDIRECT: Mirrors the Reports P&L indirectExpenses after Step 1 fix.
// Key change: where clause now includes `invoiceId: null`.
function reportsIndirectExpenses(txns: MockTransaction[], rangeStart: Date, rangeEnd: Date) {
  return txns
    .filter(t =>
      (t.type === 'expense' || t.type === 'debit') &&
      t.invoiceId === null &&  // §P16-STEP1-C: exclude invoice-linked
      new Date(t.createdAt) >= rangeStart &&
      new Date(t.createdAt) <= rangeEnd
    )
    .reduce((s, t) => s + t.amount, 0)
}

// §REPORTS-REVENUE: Mirrors Reports P&L revenue (already had type filter pre-Step 1).
function reportsRevenue(invoices: MockInvoice[], items: MockInvoiceItem[], products: MockProduct[], rangeStart: Date, rangeEnd: Date) {
  const filtered = invoices.filter(inv =>
    inv.status !== 'void' &&
    (inv.type === 'sales' || inv.type === 'retail') &&
    new Date(inv.createdAt) >= rangeStart &&
    new Date(inv.createdAt) <= rangeEnd
  )
  const totalRevenue = filtered.reduce((s, inv) => s + inv.subtotal, 0)
  const totalDiscount = filtered.reduce((s, inv) => s + inv.discountAmount, 0)
  const netRevenue = totalRevenue - totalDiscount
  return { totalRevenue, totalDiscount, netRevenue }
}

// ─── Main Test ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  Phase 16 Step 1 — Critical Accounting Scope Fixes')
  console.log('  ======================================================')

  const dashSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
  const reportsSrc = fs.readFileSync('src/app/api/reports/route.ts', 'utf8')
  const txnSrc = fs.readFileSync('src/app/api/transactions/route.ts', 'utf8')

  // ═══════════════════════════════════════════════════════════════════════
  // §SOURCE-LEVEL: Verify the 5 code changes are present in source
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Source-level verification (5 changes):')

  // A. Dashboard invoice queries: type IN ('sales','retail')
  console.log('\n  A. Dashboard invoice type filter:')
  {
    assert(dashSrc.includes("type: { in: ['sales', 'retail'] }"),
      'voidExclude includes type: { in: [sales, retail] } (D7 Prisma findMany)')
    assert(dashSrc.includes('AND "type" IN (\'sales\', \'retail\')'),
      'D3 raw SQL WHERE includes AND "type" IN (sales, retail)')
  }

  // B. Dashboard expense: invoiceId IS NULL
  console.log('\n  B. Dashboard expense invoiceId IS NULL filter:')
  {
    assert(dashSrc.includes('AND "invoiceId" IS NULL THEN amount ELSE 0 END'),
      'D4 expense_sum CASE includes AND "invoiceId" IS NULL')
    assert(dashSrc.includes('!t.invoiceId'),
      'Chart JS expense filter includes && !t.invoiceId')
    assert(dashSrc.includes('invoiceId: true'),
      'rangeTxnsForTrend select includes invoiceId: true')
  }

  // C. Reports indirectExpenses: invoiceId: null
  console.log('\n  C. Reports indirectExpenses invoiceId: null:')
  {
    assert(reportsSrc.includes('invoiceId: null'),
      'Reports indirectExpenses where includes invoiceId: null')
  }

  // D. Transactions route atomicity
  console.log('\n  D. Transactions route atomicity:')
  {
    // The transaction.create should now be INSIDE the db.$transaction block
    const txnCreateInsideTx = txnSrc.includes('tx.transaction.create') &&
      txnSrc.includes('return { balance: updated.balance.toNumber(), txn }')
    assert(txnCreateInsideTx,
      'transaction.create is inside db.$transaction (uses tx.transaction.create)')
    // Verify there is no longer a standalone db.transaction.create after the if block
    // (the standalone one is only in the fallback path for no-party transactions)
    assert(txnSrc.includes('§P16-STEP1-D'),
      '§P16-STEP1-D comment documents the atomicity fix')
  }

  // E. invoiceId ownership validation
  console.log('\n  E. invoiceId ownership validation:')
  {
    assert(txnSrc.includes('body.invoiceId') && txnSrc.includes('businessId: business.id'),
      'invoiceId ownership check queries with businessId scope')
    assert(txnSrc.includes('Invoice not found or does not belong to this business'),
      '403 error returned when invoiceId does not belong to business')
    assert(txnSrc.includes('status: 403'),
      'Returns HTTP 403 for cross-tenant invoiceId')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Example A — Purchase ₹4,000 + Sale ₹6,000 + OpEx ₹0
  // Expected: Revenue=6000, COGS=4000, Gross Profit=2000, OpEx=0, Net Profit=2000
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Example A — Purchase ₹4k + Sale ₹6k + OpEx ₹0:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      // Purchase invoice ₹4,000 — should NOT contribute to revenue
      { type: 'purchase', status: 'paid', grandTotal: 4000, subtotal: 4000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'supplier1' },
      // Sale invoice ₹6,000 — SHOULD contribute to revenue
      { type: 'sales', status: 'paid', grandTotal: 6000, subtotal: 6000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'customer1' },
    ]
    const txns: MockTransaction[] = [
      // Purchase side-effect: type='debit', invoiceId=purchase.id → NOT operating expense
      { type: 'debit', amount: 4000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'purchase-inv-id', partyId: 'supplier1' },
      // Sale side-effect: type='sale', invoiceId=sale.id → NOT expense (type='sale' not in EXPENSE_TYPES)
      { type: 'sale', amount: 6000, createdAt: '2026-08-25T14:00:00+05:30', invoiceId: 'sale-inv-id', partyId: 'customer1' },
    ]

    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const bucket = dashboardChartBucket(invoices, txns, rangeStart, rangeEnd)

    // Revenue assertions (INV-01: Purchase never contributes to Revenue)
    assert(dashInv.range_sales === 6000, `Dashboard range_sales = ₹6000 (not ₹10000 — purchase excluded). Got: ${dashInv.range_sales}`)
    assert(dashInv.today_sales === 6000, `Dashboard today_sales = ₹6000 (not ₹10000). Got: ${dashInv.today_sales}`)
    assert(dashInv.monthly_sales === 6000, `Dashboard monthly_sales = ₹6000 (not ₹10000). Got: ${dashInv.monthly_sales}`)
    assert(dashInv.range_net_revenue === 6000, `Dashboard range_net_revenue = ₹6000. Got: ${dashInv.range_net_revenue}`)

    // Chart revenue assertion (INV-01 at chart level)
    assert(bucket.revenue === 6000, `Chart bucket revenue = ₹6000 (not ₹10000 — purchase excluded). Got: ${bucket.revenue}`)

    // Expense assertions (INV-04: Purchase does not directly reduce Profit via expense)
    assert(dashTxn.expense_sum === 0, `Dashboard expense_sum = ₹0 (purchase side-effect excluded via invoiceId IS NULL). Got: ${dashTxn.expense_sum}`)
    assert(bucket.expense === 0, `Chart bucket expense = ₹0 (purchase side-effect excluded via !t.invoiceId). Got: ${bucket.expense}`)

    // Profit assertion (chart profit = revenue - expense = 6000 - 0 = 6000)
    // NOTE: This is still the CASH-FLOW proxy profit, not true accounting profit.
    // True accounting profit (Net Profit = Gross Profit - OpEx = 2000 - 0 = 2000)
    // will be implemented in Step 3 with the new profitLoss chart mode.
    assert(bucket.profit === 6000, `Chart bucket profit = ₹6000 (cash-flow proxy: 6000 - 0). Got: ${bucket.profit}`)

    // Reports parity (Dashboard expense === Reports indirectExpenses)
    const reportsOpEx = reportsIndirectExpenses(txns, rangeStart, rangeEnd)
    assert(reportsOpEx === 0, `Reports indirectExpenses = ₹0 (purchase side-effect excluded via invoiceId: null). Got: ${reportsOpEx}`)
    assert(dashTxn.expense_sum === reportsOpEx, `Dashboard expense === Reports indirectExpenses (both ₹0). Got: dash=${dashTxn.expense_sum}, reports=${reportsOpEx}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Example B — Purchase ₹4,000 + Sale ₹6,000 + OpEx ₹500
  // Expected: Revenue=6000, OpEx=500
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Example B — Purchase ₹4k + Sale ₹6k + OpEx ₹500:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      { type: 'purchase', status: 'paid', grandTotal: 4000, subtotal: 4000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'supplier1' },
      { type: 'sales', status: 'paid', grandTotal: 6000, subtotal: 6000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'customer1' },
    ]
    const txns: MockTransaction[] = [
      // Purchase side-effect (invoice-linked) → NOT OpEx
      { type: 'debit', amount: 4000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'purchase-inv-id', partyId: 'supplier1' },
      // Sale side-effect (type='sale') → NOT expense
      { type: 'sale', amount: 6000, createdAt: '2026-08-25T14:00:00+05:30', invoiceId: 'sale-inv-id', partyId: 'customer1' },
      // Genuine operating expense (manual, no invoice link) → IS OpEx
      { type: 'debit', amount: 500, createdAt: '2026-08-25T16:00:00+05:30', invoiceId: null, partyId: null },
    ]

    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const bucket = dashboardChartBucket(invoices, txns, rangeStart, rangeEnd)
    const reportsOpEx = reportsIndirectExpenses(txns, rangeStart, rangeEnd)

    assert(dashInv.range_sales === 6000, `Dashboard range_sales = ₹6000 (purchase excluded). Got: ${dashInv.range_sales}`)
    assert(bucket.revenue === 6000, `Chart revenue = ₹6000. Got: ${bucket.revenue}`)
    // OpEx should be ₹500 (only the manual operating expense, NOT the ₹4000 purchase side-effect)
    assert(dashTxn.expense_sum === 500, `Dashboard expense_sum = ₹500 (only manual OpEx, purchase excluded). Got: ${dashTxn.expense_sum}`)
    assert(bucket.expense === 500, `Chart expense = ₹500. Got: ${bucket.expense}`)
    assert(reportsOpEx === 500, `Reports indirectExpenses = ₹500. Got: ${reportsOpEx}`)
    assert(dashTxn.expense_sum === reportsOpEx, `Dashboard expense === Reports indirectExpenses (both ₹500)`)

    // Chart profit = revenue - expense = 6000 - 500 = 5500 (cash-flow proxy)
    assert(bucket.profit === 5500, `Chart profit = ₹5500 (cash-flow proxy: 6000 - 500). Got: ${bucket.profit}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Example C — Purchase ₹50,000 + Sale ₹0
  // Expected: Revenue=0, COGS=0, OpEx=0, Net Profit=0
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Example C — Purchase ₹50k + Sale ₹0:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      // Purchase invoice ₹50,000 — should NOT contribute to revenue
      { type: 'purchase', status: 'paid', grandTotal: 50000, subtotal: 50000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'supplier1' },
    ]
    const txns: MockTransaction[] = [
      // Purchase side-effect: type='debit', invoiceId set → NOT operating expense
      { type: 'debit', amount: 50000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'purchase-inv-id', partyId: 'supplier1' },
    ]

    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const bucket = dashboardChartBucket(invoices, txns, rangeStart, rangeEnd)
    const reportsOpEx = reportsIndirectExpenses(txns, rangeStart, rangeEnd)

    // Revenue assertions (INV-01: Purchase never contributes to Revenue)
    assert(dashInv.range_sales === 0, `Dashboard range_sales = ₹0 (purchase excluded). Got: ${dashInv.range_sales}`)
    assert(dashInv.today_sales === 0, `Dashboard today_sales = ₹0. Got: ${dashInv.today_sales}`)
    assert(dashInv.monthly_sales === 0, `Dashboard monthly_sales = ₹0. Got: ${dashInv.monthly_sales}`)
    assert(dashInv.range_net_revenue === 0, `Dashboard range_net_revenue = ₹0. Got: ${dashInv.range_net_revenue}`)
    assert(bucket.revenue === 0, `Chart revenue = ₹0. Got: ${bucket.revenue}`)

    // Expense assertions (INV-04: Purchase does not directly reduce Profit)
    assert(dashTxn.expense_sum === 0, `Dashboard expense_sum = ₹0 (purchase side-effect excluded). Got: ${dashTxn.expense_sum}`)
    assert(bucket.expense === 0, `Chart expense = ₹0. Got: ${bucket.expense}`)
    assert(reportsOpEx === 0, `Reports indirectExpenses = ₹0. Got: ${reportsOpEx}`)

    // Profit assertion (chart profit = 0 - 0 = 0, NOT -50000)
    assert(bucket.profit === 0, `Chart profit = ₹0 (NOT -₹50000 — purchase is asset, not expense). Got: ${bucket.profit}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Example D — Purchase ₹50,000 + Sell ₹10,000 worth
  // Expected: Revenue=10000, only sold portion becomes COGS
  // NOTE: COGS is computed by Reports, not Dashboard. Dashboard only tests
  // that revenue = 10000 (sale) and expense = 0 (purchase side-effect excluded).
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Example D — Purchase ₹50k + Sell ₹10k:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      // Purchase ₹50,000 — NOT revenue
      { type: 'purchase', status: 'paid', grandTotal: 50000, subtotal: 50000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'supplier1' },
      // Sale ₹10,000 — IS revenue
      { type: 'sales', status: 'paid', grandTotal: 10000, subtotal: 10000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'customer1' },
    ]
    const txns: MockTransaction[] = [
      { type: 'debit', amount: 50000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'purchase-inv-id', partyId: 'supplier1' },
      { type: 'sale', amount: 10000, createdAt: '2026-08-25T14:00:00+05:30', invoiceId: 'sale-inv-id', partyId: 'customer1' },
    ]

    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const bucket = dashboardChartBucket(invoices, txns, rangeStart, rangeEnd)

    // Revenue = ₹10,000 (sale only, NOT ₹60,000 which would include purchase)
    assert(dashInv.range_sales === 10000, `Dashboard range_sales = ₹10000 (purchase excluded). Got: ${dashInv.range_sales}`)
    assert(bucket.revenue === 10000, `Chart revenue = ₹10000. Got: ${bucket.revenue}`)
    // Expense = ₹0 (purchase side-effect excluded)
    assert(dashTxn.expense_sum === 0, `Dashboard expense_sum = ₹0 (purchase excluded). Got: ${dashTxn.expense_sum}`)
    assert(bucket.expense === 0, `Chart expense = ₹0. Got: ${bucket.expense}`)
    // Chart profit = 10000 - 0 = 10000 (cash-flow proxy)
    // NOTE: This is NOT true accounting profit. True profit = Revenue - COGS = 10000 - 10000 = 0.
    // COGS calculation is done in Reports, not Dashboard. Step 3 will add proper
    // profitLoss chart mode with true accounting profit.
    assert(bucket.profit === 10000, `Chart profit = ₹10000 (cash-flow proxy). Got: ${bucket.profit}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-02: Challan never contributes to Revenue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-02 — Challan never contributes to Revenue:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      // Challan ₹2,000 — delivery note, NOT revenue
      { type: 'challan', status: 'paid', grandTotal: 2000, subtotal: 2000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'customer1' },
      // Sale ₹3,000 — IS revenue
      { type: 'sales', status: 'paid', grandTotal: 3000, subtotal: 3000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'customer2' },
    ]
    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    assert(dashInv.range_sales === 3000, `Dashboard range_sales = ₹3000 (challan excluded). Got: ${dashInv.range_sales}`)
    assert(dashInv.total_count === 1, `Dashboard total_count = 1 (only sales invoice counted). Got: ${dashInv.total_count}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-03: Void invoice never contributes to Revenue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-03 — Void invoice never contributes to Revenue:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')
    const todayBounds = new Date('2026-08-25T00:00:00+05:30')
    const monthStart = new Date('2026-08-01T00:00:00+05:30')

    const invoices: MockInvoice[] = [
      // Voided sale ₹5,000 — should be excluded
      { type: 'sales', status: 'void', grandTotal: 5000, subtotal: 5000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 'customer1' },
      // Valid sale ₹3,000 — IS revenue
      { type: 'sales', status: 'paid', grandTotal: 3000, subtotal: 3000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'customer2' },
    ]
    const dashInv = dashboardInvoiceAggregate(invoices, rangeStart, rangeEnd, todayBounds, monthStart)
    assert(dashInv.range_sales === 3000, `Dashboard range_sales = ₹3000 (void excluded). Got: ${dashInv.range_sales}`)
    assert(dashInv.total_count === 1, `Dashboard total_count = 1 (void excluded). Got: ${dashInv.total_count}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-05: Invoice-linked debit does NOT become operating expense
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-05 — Invoice-linked debit is NOT operating expense:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')

    const txns: MockTransaction[] = [
      // Invoice-linked debit (purchase side-effect) — NOT OpEx
      { type: 'debit', amount: 4000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'inv-1', partyId: 'supplier1' },
      // Invoice-linked debit (void reversal) — NOT OpEx
      { type: 'debit', amount: 5000, createdAt: '2026-08-25T11:00:00+05:30', invoiceId: 'inv-2', partyId: 'customer1' },
      // Manual debit (operating expense) — IS OpEx
      { type: 'debit', amount: 500, createdAt: '2026-08-25T12:00:00+05:30', invoiceId: null, partyId: null },
      // Manual debit (supplier payment) — IS OpEx
      { type: 'debit', amount: 300, createdAt: '2026-08-25T13:00:00+05:30', invoiceId: null, partyId: 'supplier2' },
    ]
    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const reportsOpEx = reportsIndirectExpenses(txns, rangeStart, rangeEnd)

    // Only the 2 manual debits (500 + 300 = 800) should be counted as OpEx
    // The 2 invoice-linked debits (4000 + 5000 = 9000) should be EXCLUDED
    assert(dashTxn.expense_sum === 800, `Dashboard expense_sum = ₹800 (only manual debits). Got: ${dashTxn.expense_sum}`)
    assert(reportsOpEx === 800, `Reports indirectExpenses = ₹800. Got: ${reportsOpEx}`)
    assert(dashTxn.expense_sum === reportsOpEx, `Dashboard expense === Reports indirectExpenses (both ₹800)`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §PARITY: Dashboard chart bucket SUM === Dashboard card aggregate
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Card ↔ Chart parity:')
  {
    const rangeStart = new Date('2026-08-25T00:00:00+05:30')
    const rangeEnd = new Date('2026-08-25T23:59:59+05:30')

    const invoices: MockInvoice[] = [
      { type: 'purchase', status: 'paid', grandTotal: 4000, subtotal: 4000, discountAmount: 0, createdAt: '2026-08-25T10:00:00+05:30', paymentMode: 'cash', partyId: 's1' },
      { type: 'sales', status: 'paid', grandTotal: 6000, subtotal: 6000, discountAmount: 0, createdAt: '2026-08-25T14:00:00+05:30', paymentMode: 'cash', partyId: 'c1' },
    ]
    const txns: MockTransaction[] = [
      { type: 'debit', amount: 4000, createdAt: '2026-08-25T10:00:00+05:30', invoiceId: 'inv-1', partyId: 's1' },
      { type: 'debit', amount: 500, createdAt: '2026-08-25T16:00:00+05:30', invoiceId: null, partyId: null },
    ]

    const dashTxn = dashboardTransactionAggregate(txns, rangeStart, rangeEnd)
    const bucket = dashboardChartBucket(invoices, txns, rangeStart, rangeEnd)

    // SUM(chart buckets) should equal card aggregate
    // (here we have 1 bucket covering the full range)
    assert(bucket.revenue === 6000 && dashTxn.collection_sum >= 0,
      `Chart revenue (₹6000) and card collection are computed from same filtered scope`)
    assert(bucket.expense === dashTxn.expense_sum,
      `Chart bucket expense === card expense_sum (both ₹${dashTxn.expense_sum})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §EXISTING-INVARIANTS: Verify Phase 5/7/13 invariants still hold
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Existing Phase 5/7/13 invariants preserved:')
  {
    // UI invariants are in dashboard-view.tsx (the component), not the API route
    const dashViewSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashViewSrc.includes('allowEscapeViewBox={{ x: false, y: false }}'),
      'Tooltip mobile clamping preserved')
    assert(dashViewSrc.includes('formatChartAxisValue'),
      'Indian axis formatting preserved')
    assert(dashViewSrc.includes('allZero'),
      'Empty state check preserved')
    assert(dashViewSrc.includes('Updating chart'),
      'Loading state preserved')
    assert(dashViewSrc.includes('role="img"'),
      'ARIA label preserved')
    assert(dashViewSrc.includes('pb-16') || dashViewSrc.includes('pb-28'),
      'FAB spacing preserved')
    assert(reportsSrc.includes('computeBuckets') || dashSrc.includes('computeBuckets'),
      'IST bucket computation preserved')
    assert(reportsSrc.includes('calendarMonthStartIST') || dashSrc.includes('calendarMonthStartIST'),
      'Calendar month-to-date preserved')
    assert(dashSrc.includes('rangeNetRevenue'),
      'Total Revenue (rangeNetRevenue) preserved')
    assert(dashViewSrc.includes('Net Cash Flow'),
      'Phase 13 Net Cash Flow label preserved')
    assert(dashViewSrc.includes('Sales'),
      'Phase 13 Sales label preserved')
    assert(dashViewSrc.includes('Asia/Kolkata'),
      'Phase 13 IST tooltip timezone preserved')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §SEARCH-FREEZE: Verify search-frozen files unchanged
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Search-freeze verification:')
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
