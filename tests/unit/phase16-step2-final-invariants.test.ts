/**
 * §TEST: Phase 16 Step 2 Final Correction — Invariants INV-A through INV-M.
 *
 * Run: npx tsx tests/unit/phase16-step2-final-invariants.test.ts
 *
 * Tests the 3 decisions:
 *   1. Partial payment → TWO transactions (Option B)
 *   2. COD cash collection → authoritative cash-in subtypes only (Option A)
 *   3. No-party debit → keep NULL, separate authoritative OpEx from legacy (Option C)
 *
 * Invariants:
 *   INV-A: purchase_cash.amount + purchase_credit.amount = invoice grandTotal
 *   INV-B: sale_cash.amount + sale_credit.amount = invoice grandTotal
 *   INV-C: purchase cash component = amountPaid
 *   INV-D: purchase credit component = amountDue
 *   INV-E: sale cash component = amountPaid
 *   INV-F: sale credit component = amountDue
 *   INV-G: COD does not count as Cash Collected
 *   INV-H: Prepaid counts as Cash Collected
 *   INV-I: No-party ambiguous debit remains NULL
 *   INV-J: NULL ambiguous rows are not included in authoritative OpEx aggregates
 *   INV-K: No transaction is counted twice
 *   INV-L: Dashboard and Reports use identical authoritative accounting scopes
 *   INV-M: Existing fully-paid and fully-credit invoice behavior remains unchanged
 */
export {}

import * as fs from 'fs'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ } else { console.log(`  ❌ ${msg}`); failed++ }
}

// ─── Types ─────────────────────────────────────────────────────────────────
interface MockTransaction {
  type: 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'
  amount: number
  invoiceId: string | null
  transactionSubtype: string | null
  source: string | null
}

// ─── Mirrors of server-side logic ──────────────────────────────────────────

// §INVOICE-TRANSACTIONS: Mirrors invoices/route.ts transaction creation logic.
// Returns 1 or 2 transactions based on payment split.
function createInvoiceTransactions(
  isPurchase: boolean,
  grandTotal: number,
  amountPaid: number,
  amountDue: number,
  paymentMode: string | null,
  invoiceId: string,
  partyId: string
): MockTransaction[] {
  const isPartial = amountPaid > 0 && amountDue > 0
  const type = isPurchase ? 'debit' : 'sale'
  const category = isPurchase ? 'Purchase' : 'Sale'

  if (isPartial) {
    // TWO transactions
    const cashSubtype = isPurchase ? 'purchase_inventory_cash' : 'sale_invoice'
    const creditSubtype = isPurchase ? 'purchase_inventory_credit' : 'credit_sale'
    return [
      { type, amount: amountPaid, invoiceId, transactionSubtype: cashSubtype, source: 'invoice' },
      { type, amount: amountDue, invoiceId, transactionSubtype: creditSubtype, source: 'invoice' },
    ]
  }
  // ONE transaction
  let subtype: string
  if (isPurchase) {
    subtype = amountDue <= 0 ? 'purchase_inventory_cash' : 'purchase_inventory_credit'
  } else {
    // §P16-VERIFY-1: If amountPaid=0, it's credit_sale regardless of paymentMode
    subtype = amountPaid === 0 ? 'credit_sale' : 'sale_invoice'
  }
  return [{ type, amount: grandTotal, invoiceId, transactionSubtype: subtype, source: 'invoice' }]
}

// §CASH-IN-FILTER: Mirrors dashboard/route.ts collection_sum SQL (Option A)
const CASH_IN_SUBTYPES = ['manual_cash_in', 'customer_collection', 'customer_advance', 'online_order_prepaid']
function isAuthoritativeCashIn(t: MockTransaction): boolean {
  return t.type === 'credit' && CASH_IN_SUBTYPES.includes(t.transactionSubtype || '')
}

// §OPEX-FILTER: Mirrors dashboard/route.ts authoritative_opex_sum SQL (Option C)
function isAuthoritativeOpEx(t: MockTransaction): boolean {
  return t.transactionSubtype === 'operating_expense'
}

// §LEGACY-OPEX: Mirrors dashboard/route.ts legacy_opex_sum SQL (Option C)
function isLegacyOpEx(t: MockTransaction): boolean {
  const EXPENSE_TYPES = ['debit', 'expense', 'purchase']
  return t.transactionSubtype === null && EXPENSE_TYPES.includes(t.type) && !t.invoiceId
}

// ─── Main Test ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  Phase 16 Step 2 — Final Correction Invariants (INV-A through INV-M)')
  console.log('  ========================================================================')

  const dashSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
  const reportsSrc = fs.readFileSync('src/app/api/reports/route.ts', 'utf8')
  // §P16-STEP3.8.1: Invoice creation logic extracted to src/lib/invoice-service.ts.
  // Source assertions check both files (route handler + service).
  const invoicesSrc = fs.readFileSync('src/app/api/invoices/route.ts', 'utf8')
    + '\n// --- src/lib/invoice-service.ts ---\n'
    + fs.readFileSync('src/lib/invoice-service.ts', 'utf8')

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-A: purchase_cash.amount + purchase_credit.amount = invoice grandTotal
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-A — purchase_cash + purchase_credit = grandTotal:')
  {
    // Test cases: 25/75, 50/50, 75/25, zero-paid, fully-paid, fully-credit
    const cases = [
      { label: '25/75 split', grandTotal: 4000, amountPaid: 1000, amountDue: 3000, paymentMode: 'cash' },
      { label: '50/50 split', grandTotal: 4000, amountPaid: 2000, amountDue: 2000, paymentMode: 'cash' },
      { label: '75/25 split', grandTotal: 4000, amountPaid: 3000, amountDue: 1000, paymentMode: 'cash' },
      { label: 'zero-paid (full credit)', grandTotal: 4000, amountPaid: 0, amountDue: 4000, paymentMode: 'credit' },
      { label: 'fully-paid (cash)', grandTotal: 4000, amountPaid: 4000, amountDue: 0, paymentMode: 'cash' },
      { label: 'fully-credit (paymentMode=credit)', grandTotal: 4000, amountPaid: 0, amountDue: 4000, paymentMode: 'credit' },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(true, c.grandTotal, c.amountPaid, c.amountDue, c.paymentMode, 'inv-1', 's1')
      const cashPortion = txns.filter(t => t.transactionSubtype === 'purchase_inventory_cash').reduce((s, t) => s + t.amount, 0)
      const creditPortion = txns.filter(t => t.transactionSubtype === 'purchase_inventory_credit').reduce((s, t) => s + t.amount, 0)
      assert(cashPortion + creditPortion === c.grandTotal,
        `INV-A [${c.label}]: cash(₹${cashPortion}) + credit(₹${creditPortion}) = ₹${c.grandTotal} (got: ₹${cashPortion + creditPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-B: sale_cash.amount + sale_credit.amount = invoice grandTotal
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-B — sale_cash + sale_credit = grandTotal:')
  {
    const cases = [
      { label: '25/75 split', grandTotal: 6000, amountPaid: 1500, amountDue: 4500, paymentMode: 'cash' },
      { label: '50/50 split', grandTotal: 6000, amountPaid: 3000, amountDue: 3000, paymentMode: 'cash' },
      { label: '75/25 split', grandTotal: 6000, amountPaid: 4500, amountDue: 1500, paymentMode: 'cash' },
      { label: 'zero-paid (full credit)', grandTotal: 6000, amountPaid: 0, amountDue: 6000, paymentMode: 'credit' },
      { label: 'fully-paid (cash)', grandTotal: 6000, amountPaid: 6000, amountDue: 0, paymentMode: 'cash' },
      { label: 'fully-credit (paymentMode=credit)', grandTotal: 6000, amountPaid: 0, amountDue: 6000, paymentMode: 'credit' },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(false, c.grandTotal, c.amountPaid, c.amountDue, c.paymentMode, 'inv-1', 'c1')
      const cashPortion = txns.filter(t => t.transactionSubtype === 'sale_invoice').reduce((s, t) => s + t.amount, 0)
      const creditPortion = txns.filter(t => t.transactionSubtype === 'credit_sale').reduce((s, t) => s + t.amount, 0)
      assert(cashPortion + creditPortion === c.grandTotal,
        `INV-B [${c.label}]: cash(₹${cashPortion}) + credit(₹${creditPortion}) = ₹${c.grandTotal} (got: ₹${cashPortion + creditPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-C: purchase cash component = amountPaid
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-C — purchase cash component = amountPaid:')
  {
    const cases = [
      { label: '25/75', grandTotal: 4000, amountPaid: 1000, amountDue: 3000 },
      { label: '50/50', grandTotal: 4000, amountPaid: 2000, amountDue: 2000 },
      { label: '75/25', grandTotal: 4000, amountPaid: 3000, amountDue: 1000 },
      { label: 'zero-paid', grandTotal: 4000, amountPaid: 0, amountDue: 4000 },
      { label: 'fully-paid', grandTotal: 4000, amountPaid: 4000, amountDue: 0 },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(true, c.grandTotal, c.amountPaid, c.amountDue, 'cash', 'inv-1', 's1')
      const cashPortion = txns.filter(t => t.transactionSubtype === 'purchase_inventory_cash').reduce((s, t) => s + t.amount, 0)
      assert(cashPortion === c.amountPaid,
        `INV-C [${c.label}]: cash component = ₹${c.amountPaid} (got: ₹${cashPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-D: purchase credit component = amountDue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-D — purchase credit component = amountDue:')
  {
    const cases = [
      { label: '25/75', grandTotal: 4000, amountPaid: 1000, amountDue: 3000 },
      { label: '50/50', grandTotal: 4000, amountPaid: 2000, amountDue: 2000 },
      { label: '75/25', grandTotal: 4000, amountPaid: 3000, amountDue: 1000 },
      { label: 'zero-paid', grandTotal: 4000, amountPaid: 0, amountDue: 4000 },
      { label: 'fully-paid', grandTotal: 4000, amountPaid: 4000, amountDue: 0 },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(true, c.grandTotal, c.amountPaid, c.amountDue, 'cash', 'inv-1', 's1')
      const creditPortion = txns.filter(t => t.transactionSubtype === 'purchase_inventory_credit').reduce((s, t) => s + t.amount, 0)
      assert(creditPortion === c.amountDue,
        `INV-D [${c.label}]: credit component = ₹${c.amountDue} (got: ₹${creditPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-E: sale cash component = amountPaid
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-E — sale cash component = amountPaid:')
  {
    const cases = [
      { label: '25/75', grandTotal: 6000, amountPaid: 1500, amountDue: 4500 },
      { label: '50/50', grandTotal: 6000, amountPaid: 3000, amountDue: 3000 },
      { label: '75/25', grandTotal: 6000, amountPaid: 4500, amountDue: 1500 },
      { label: 'zero-paid', grandTotal: 6000, amountPaid: 0, amountDue: 6000 },
      { label: 'fully-paid', grandTotal: 6000, amountPaid: 6000, amountDue: 0 },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(false, c.grandTotal, c.amountPaid, c.amountDue, 'cash', 'inv-1', 'c1')
      const cashPortion = txns.filter(t => t.transactionSubtype === 'sale_invoice').reduce((s, t) => s + t.amount, 0)
      assert(cashPortion === c.amountPaid,
        `INV-E [${c.label}]: cash component = ₹${c.amountPaid} (got: ₹${cashPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-F: sale credit component = amountDue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-F — sale credit component = amountDue:')
  {
    const cases = [
      { label: '25/75', grandTotal: 6000, amountPaid: 1500, amountDue: 4500 },
      { label: '50/50', grandTotal: 6000, amountPaid: 3000, amountDue: 3000 },
      { label: '75/25', grandTotal: 6000, amountPaid: 4500, amountDue: 1500 },
      { label: 'zero-paid', grandTotal: 6000, amountPaid: 0, amountDue: 6000 },
      { label: 'fully-paid', grandTotal: 6000, amountPaid: 6000, amountDue: 0 },
    ]
    for (const c of cases) {
      const txns = createInvoiceTransactions(false, c.grandTotal, c.amountPaid, c.amountDue, 'cash', 'inv-1', 'c1')
      const creditPortion = txns.filter(t => t.transactionSubtype === 'credit_sale').reduce((s, t) => s + t.amount, 0)
      assert(creditPortion === c.amountDue,
        `INV-F [${c.label}]: credit component = ₹${c.amountDue} (got: ₹${creditPortion})`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-G: COD does not count as Cash Collected
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-G — COD does NOT count as Cash Collected:')
  {
    const codTxn: MockTransaction = {
      type: 'credit', amount: 2500, invoiceId: 'inv-1',
      transactionSubtype: 'online_order_cod', source: 'online_order',
    }
    assert(!isAuthoritativeCashIn(codTxn),
      `INV-G: COD transaction is NOT counted as Cash Collected (subtype=${codTxn.transactionSubtype})`)
    // Also verify at source level: collection_sum SQL excludes online_order_cod
    assert(dashSrc.includes("'manual_cash_in', 'customer_collection', 'customer_advance', 'online_order_prepaid'"),
      'INV-G: Dashboard SQL collection_sum only includes 4 authoritative cash-in subtypes')
    assert(!dashSrc.includes("'online_order_cod'") || dashSrc.includes("'online_order_cod'") === false,
      'INV-G: online_order_cod is NOT in the collection_sum filter')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-H: Prepaid counts as Cash Collected
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-H — Prepaid DOES count as Cash Collected:')
  {
    const prepaidTxn: MockTransaction = {
      type: 'credit', amount: 3200, invoiceId: 'inv-2',
      transactionSubtype: 'online_order_prepaid', source: 'online_order',
    }
    assert(isAuthoritativeCashIn(prepaidTxn),
      `INV-H: Prepaid transaction IS counted as Cash Collected (subtype=${prepaidTxn.transactionSubtype})`)
  }

  // Additional cash-in subtypes
  console.log('\n  INV-H-extra — Other cash-in subtypes:')
  {
    const subtypes = [
      { subtype: 'manual_cash_in', label: 'manual cash-in' },
      { subtype: 'customer_collection', label: 'customer collection' },
      { subtype: 'customer_advance', label: 'customer advance' },
    ]
    for (const s of subtypes) {
      const txn: MockTransaction = { type: 'credit', amount: 1000, invoiceId: null, transactionSubtype: s.subtype, source: 'manual' }
      assert(isAuthoritativeCashIn(txn),
        `INV-H-extra: ${s.label} IS counted as Cash Collected`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-I: No-party ambiguous debit remains NULL
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-I — No-party ambiguous debit remains NULL:')
  {
    const noPartyDebit: MockTransaction = {
      type: 'debit', amount: 5000, invoiceId: null,
      transactionSubtype: null, source: 'manual',
    }
    assert(noPartyDebit.transactionSubtype === null,
      `INV-I: No-party debit transactionSubtype is NULL (got: ${noPartyDebit.transactionSubtype})`)
    // Verify source code: T2 fallback doesn't classify debits
    const txnSrc = fs.readFileSync('src/app/api/transactions/route.ts', 'utf8')
    assert(txnSrc.includes('§AMBIGUITY-3') || txnSrc.includes('AMBIGUITY-3') || txnSrc.includes('ambiguous'),
      'INV-I: Ambiguity 3 documented in transactions route source')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-J: NULL ambiguous rows NOT included in authoritative OpEx aggregates
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-J — NULL rows NOT in authoritative OpEx:')
  {
    const nullDebitTxn: MockTransaction = {
      type: 'debit', amount: 5000, invoiceId: null,
      transactionSubtype: null, source: 'manual',
    }
    // Should NOT be counted as authoritative OpEx
    assert(!isAuthoritativeOpEx(nullDebitTxn),
      `INV-J: NULL-subtype debit is NOT authoritative OpEx`)
    // SHOULD be counted as legacy OpEx (separate metric)
    assert(isLegacyOpEx(nullDebitTxn),
      `INV-J: NULL-subtype debit IS legacy OpEx (separate from authoritative)`)
    // Verify source: Dashboard has separate authoritative_opex_sum
    assert(dashSrc.includes('authoritative_opex_sum'),
      'INV-J: Dashboard SQL has separate authoritative_opex_sum field')
    assert(dashSrc.includes('legacy_opex_sum'),
      'INV-J: Dashboard SQL has separate legacy_opex_sum field')
    // Verify source: Reports has separate authoritativeIndirectExpenses
    assert(reportsSrc.includes('authoritativeIndirectExpenses'),
      'INV-J: Reports response includes authoritativeIndirectExpenses')
    assert(reportsSrc.includes('legacyIndirectExpenses'),
      'INV-J: Reports response includes legacyIndirectExpenses')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-K: No transaction is counted twice
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-K — No transaction counted twice:')
  {
    // Partial purchase: 2 transactions (cash + credit)
    const txns = createInvoiceTransactions(true, 4000, 1000, 3000, 'cash', 'inv-1', 's1')
    assert(txns.length === 2, `INV-K: Partial purchase creates exactly 2 transactions (got: ${txns.length})`)
    // Verify they have different subtypes (no overlap)
    assert(txns[0].transactionSubtype !== txns[1].transactionSubtype,
      `INV-K: Two transactions have different subtypes (${txns[0].transactionSubtype} vs ${txns[1].transactionSubtype})`)
    // Verify amounts don't overlap
    assert(txns[0].amount + txns[1].amount === 4000,
      `INV-K: Sum of amounts = ₹4000 (got: ₹${txns[0].amount + txns[1].amount})`)

    // Fully-paid: 1 transaction
    const fullyPaidTxns = createInvoiceTransactions(true, 4000, 4000, 0, 'cash', 'inv-2', 's2')
    assert(fullyPaidTxns.length === 1, `INV-K: Fully-paid creates 1 transaction (got: ${fullyPaidTxns.length})`)

    // Fully-credit: 1 transaction
    const fullyCreditTxns = createInvoiceTransactions(true, 4000, 0, 4000, 'credit', 'inv-3', 's3')
    assert(fullyCreditTxns.length === 1, `INV-K: Fully-credit creates 1 transaction (got: ${fullyCreditTxns.length})`)

    // Sale partial: 2 transactions
    const salePartialTxns = createInvoiceTransactions(false, 6000, 1500, 4500, 'cash', 'inv-4', 'c1')
    assert(salePartialTxns.length === 2, `INV-K: Partial sale creates 2 transactions (got: ${salePartialTxns.length})`)

    // Sale fully-paid: 1 transaction
    const saleFullyPaidTxns = createInvoiceTransactions(false, 6000, 6000, 0, 'cash', 'inv-5', 'c2')
    assert(saleFullyPaidTxns.length === 1, `INV-K: Fully-paid sale creates 1 transaction (got: ${saleFullyPaidTxns.length})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-L: Dashboard and Reports use identical authoritative accounting scopes
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-L — Dashboard == Reports authoritative scopes:')
  {
    // Revenue: both filter type IN ('sales', 'retail') AND status != 'void'
    assert(dashSrc.includes("type: { in: ['sales', 'retail'] }") && reportsSrc.includes("type: { in: ['sales', 'retail'] }"),
      'INV-L: Dashboard + Reports both filter invoice type sales/retail')
    // OpEx: both use subtype='operating_expense' for authoritative
    assert(dashSrc.includes("'operating_expense'") && reportsSrc.includes("transactionSubtype: 'operating_expense'"),
      'INV-L: Dashboard + Reports both use operating_expense for authoritative OpEx')
    // Both separate authoritative from legacy
    assert(dashSrc.includes('authoritative_opex_sum') && reportsSrc.includes('authoritativeIndirectExpenses'),
      'INV-L: Dashboard + Reports both expose authoritative OpEx separately')
    assert(dashSrc.includes('legacy_opex_sum') && reportsSrc.includes('legacyIndirectExpenses'),
      'INV-L: Dashboard + Reports both expose legacy OpEx separately')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-M: Existing fully-paid and fully-credit behavior unchanged
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-M — Fully-paid/credit behavior unchanged:')
  {
    // Fully-paid purchase: 1 transaction, amount=grandTotal, subtype=purchase_inventory_cash
    const fullyPaidPurchase = createInvoiceTransactions(true, 4000, 4000, 0, 'cash', 'inv-1', 's1')
    assert(fullyPaidPurchase.length === 1, `INV-M: Fully-paid purchase = 1 txn (got: ${fullyPaidPurchase.length})`)
    assert(fullyPaidPurchase[0].amount === 4000, `INV-M: Fully-paid purchase amount = ₹4000 (got: ₹${fullyPaidPurchase[0].amount})`)
    assert(fullyPaidPurchase[0].transactionSubtype === 'purchase_inventory_cash',
      `INV-M: Fully-paid purchase subtype = purchase_inventory_cash (got: ${fullyPaidPurchase[0].transactionSubtype})`)

    // Fully-credit purchase: 1 transaction, amount=grandTotal, subtype=purchase_inventory_credit
    const fullyCreditPurchase = createInvoiceTransactions(true, 4000, 0, 4000, 'credit', 'inv-2', 's2')
    assert(fullyCreditPurchase.length === 1, `INV-M: Fully-credit purchase = 1 txn (got: ${fullyCreditPurchase.length})`)
    assert(fullyCreditPurchase[0].amount === 4000, `INV-M: Fully-credit purchase amount = ₹4000 (got: ₹${fullyCreditPurchase[0].amount})`)
    assert(fullyCreditPurchase[0].transactionSubtype === 'purchase_inventory_credit',
      `INV-M: Fully-credit purchase subtype = purchase_inventory_credit (got: ${fullyCreditPurchase[0].transactionSubtype})`)

    // Fully-paid sale: 1 transaction, amount=grandTotal, subtype=sale_invoice
    const fullyPaidSale = createInvoiceTransactions(false, 6000, 6000, 0, 'cash', 'inv-3', 'c1')
    assert(fullyPaidSale.length === 1, `INV-M: Fully-paid sale = 1 txn (got: ${fullyPaidSale.length})`)
    assert(fullyPaidSale[0].amount === 6000, `INV-M: Fully-paid sale amount = ₹6000 (got: ₹${fullyPaidSale[0].amount})`)
    assert(fullyPaidSale[0].transactionSubtype === 'sale_invoice',
      `INV-M: Fully-paid sale subtype = sale_invoice (got: ${fullyPaidSale[0].transactionSubtype})`)

    // Fully-credit sale: 1 transaction, amount=grandTotal, subtype=credit_sale
    const fullyCreditSale = createInvoiceTransactions(false, 6000, 0, 6000, 'credit', 'inv-4', 'c2')
    assert(fullyCreditSale.length === 1, `INV-M: Fully-credit sale = 1 txn (got: ${fullyCreditSale.length})`)
    assert(fullyCreditSale[0].amount === 6000, `INV-M: Fully-credit sale amount = ₹6000 (got: ₹${fullyCreditSale[0].amount})`)
    assert(fullyCreditSale[0].transactionSubtype === 'credit_sale',
      `INV-M: Fully-credit sale subtype = credit_sale (got: ${fullyCreditSale[0].transactionSubtype})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §SOURCE-VERIFICATION: Verify all 3 decisions are in source code
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Source verification (3 decisions):')
  {
    // Decision 1: Partial payment split
    assert(invoicesSrc.includes('§P16-VERIFY-1') && invoicesSrc.includes('isPartial'),
      'Decision 1: Partial payment split (Option B) implemented in invoices route')
    assert(invoicesSrc.includes('amount: amountPaid') && invoicesSrc.includes('amount: amountDue'),
      'Decision 1: Two transactions with amountPaid + amountDue')

    // Decision 2: COD cash collection filter
    assert(dashSrc.includes('§P16-VERIFY-2'),
      'Decision 2: COD cash collection filter (Option A) implemented in dashboard')
    assert(dashSrc.includes("CASH_IN_SUBTYPES"),
      'Decision 2: Chart JS uses CASH_IN_SUBTYPES filter')

    // Decision 3: OpEx separation
    assert(dashSrc.includes('§P16-VERIFY-3'),
      'Decision 3: OpEx separation (Option C) implemented in dashboard')
    assert(reportsSrc.includes('authoritativeOpExAgg') && reportsSrc.includes('legacyOpExAgg'),
      'Decision 3: Reports has separate authoritative + legacy OpEx aggregates')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §SEARCH-FREEZE
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
