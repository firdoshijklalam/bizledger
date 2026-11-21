/**
 * §P16-STEP2-VERIFY: Backfill Dry-Run (read-only, in-memory simulation).
 *
 * This script does NOT modify any database. It simulates the backfill
 * classification logic against realistic synthetic data to demonstrate
 * what the backfill WOULD produce on a production-like dataset.
 *
 * Run: bun run scripts/backfill-dry-run.ts
 *
 * The simulation uses the EXACT same classification rules as the real
 * backfill script (scripts/backfill-subtype.ts), but operates on an
 * in-memory array of mock transactions instead of querying the DB.
 */

// ─── Mock realistic transaction dataset ──────────────────────────────────
// These mirror the structure of real DB rows with invoice + party relations.
interface MockTxn {
  id: string
  type: 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'
  amount: number
  category: string | null
  invoiceId: string | null
  transactionSubtype: string | null
  source: string | null
  invoice: { type: string; status: string; paymentMode: string | null } | null
  party: { type: string; balance: number } | null
}

// 50 mock transactions representing realistic production data
const mockTxns: MockTxn[] = [
  // === Purchase invoices (8) ===
  // Cash purchase — paid in full
  { id: 't1', type: 'debit', amount: 4000, category: 'Purchase', invoiceId: 'inv-p1', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'cash' }, party: { type: 'supplier', balance: 0 } },
  // Credit purchase — unpaid
  { id: 't2', type: 'debit', amount: 15000, category: 'Purchase', invoiceId: 'inv-p2', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'supplier', balance: -15000 } },
  // Partial cash purchase — partially paid (THE BUG: partial payment)
  { id: 't3', type: 'debit', amount: 10000, category: 'Purchase', invoiceId: 'inv-p3', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'partial', paymentMode: 'cash' }, party: { type: 'supplier', balance: -5000 } },
  // UPI purchase — paid
  { id: 't4', type: 'debit', amount: 6000, category: 'Purchase', invoiceId: 'inv-p4', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'upi' }, party: { type: 'supplier', balance: 0 } },
  // Cheque purchase — paid
  { id: 't5', type: 'debit', amount: 25000, category: 'Purchase', invoiceId: 'inv-p5', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'cheque' }, party: { type: 'supplier', balance: 0 } },
  // Credit purchase with both party (supplier+customer)
  { id: 't6', type: 'debit', amount: 8000, category: 'Purchase', invoiceId: 'inv-p6', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'both', balance: -8000 } },
  // Already classified (idempotent skip)
  { id: 't7', type: 'debit', amount: 3000, category: 'Purchase', invoiceId: 'inv-p7', transactionSubtype: 'purchase_inventory_cash', source: 'invoice',
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'cash' }, party: { type: 'supplier', balance: 0 } },
  // Purchase with no paymentMode, unpaid
  { id: 't8', type: 'debit', amount: 12000, category: 'Purchase', invoiceId: 'inv-p8', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'unpaid', paymentMode: null }, party: { type: 'supplier', balance: -12000 } },

  // === Sale invoices (8) ===
  { id: 't9', type: 'sale', amount: 6000, category: 'Sale', invoiceId: 'inv-s1', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'paid', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  { id: 't10', type: 'sale', amount: 47000, category: 'Sale', invoiceId: 'inv-s2', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'customer', balance: 47000 } },
  { id: 't11', type: 'sale', amount: 2200, category: 'Sale', invoiceId: 'inv-s3', transactionSubtype: null, source: null,
    invoice: { type: 'retail', status: 'paid', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  // Partial cash sale (THE BUG: partial payment with paymentMode='credit')
  { id: 't12', type: 'sale', amount: 10000, category: 'Sale', invoiceId: 'inv-s4', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'partial', paymentMode: 'credit' }, party: { type: 'customer', balance: 5000 } },
  { id: 't13', type: 'sale', amount: 15000, category: 'Sale', invoiceId: 'inv-s5', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'paid', paymentMode: 'upi' }, party: { type: 'customer', balance: 0 } },
  { id: 't14', type: 'sale', amount: 8000, category: 'Sale', invoiceId: 'inv-s6', transactionSubtype: null, source: null,
    invoice: { type: 'retail', status: 'paid', paymentMode: 'cheque' }, party: { type: 'customer', balance: 0 } },
  { id: 't15', type: 'sale', amount: 5000, category: 'Sale', invoiceId: 'inv-s7', transactionSubtype: 'credit_sale', source: 'invoice',
    invoice: { type: 'sales', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'customer', balance: 5000 } },
  { id: 't16', type: 'sale', amount: 3000, category: 'Sale', invoiceId: 'inv-s8', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'paid', paymentMode: null }, party: { type: 'customer', balance: 0 } },

  // === Online orders (6) ===
  // COD orders
  { id: 't17', type: 'credit', amount: 2500, category: 'online-order', invoiceId: 'inv-o1', transactionSubtype: null, source: null,
    invoice: { type: 'retail', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'customer', balance: 2500 } },
  { id: 't18', type: 'credit', amount: 1800, category: 'online-order', invoiceId: 'inv-o2', transactionSubtype: null, source: 'online_order',
    invoice: { type: 'retail', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'customer', balance: 1800 } },
  // Prepaid orders
  { id: 't19', type: 'credit', amount: 3200, category: 'online-order', invoiceId: 'inv-o3', transactionSubtype: null, source: null,
    invoice: { type: 'retail', status: 'paid', paymentMode: 'upi' }, party: { type: 'customer', balance: 0 } },
  { id: 't20', type: 'credit', amount: 4500, category: 'online-order', invoiceId: 'inv-o4', transactionSubtype: null, source: 'online_order',
    invoice: { type: 'retail', status: 'paid', paymentMode: 'upi' }, party: { type: 'customer', balance: 0 } },
  // Already classified
  { id: 't21', type: 'credit', amount: 2000, category: 'online-order', invoiceId: 'inv-o5', transactionSubtype: 'online_order_cod', source: 'online_order',
    invoice: { type: 'retail', status: 'unpaid', paymentMode: 'credit' }, party: { type: 'customer', balance: 2000 } },
  { id: 't22', type: 'credit', amount: 1500, category: 'online-order', invoiceId: 'inv-o6', transactionSubtype: 'online_order_prepaid', source: 'online_order',
    invoice: { type: 'retail', status: 'paid', paymentMode: 'upi' }, party: { type: 'customer', balance: 0 } },

  // === Void reversals (4) ===
  { id: 't23', type: 'debit', amount: 5000, category: 'Invoice Voided', invoiceId: 'inv-v1', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'void', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  { id: 't24', type: 'debit', amount: 12000, category: 'Invoice Voided', invoiceId: 'inv-v2', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'void', paymentMode: 'credit' }, party: { type: 'supplier', balance: 0 } },
  { id: 't25', type: 'debit', amount: 3000, category: 'Invoice Voided', invoiceId: 'inv-v3', transactionSubtype: 'void_reversal', source: 'system',
    invoice: { type: 'retail', status: 'void', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  { id: 't26', type: 'debit', amount: 7000, category: 'Invoice Voided', invoiceId: 'inv-v4', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'void', paymentMode: null }, party: { type: 'customer', balance: 0 } },

  // === Manual khata transactions (12) ===
  // Customer collection (customer with existing receivable)
  { id: 't27', type: 'credit', amount: 5000, category: 'Payment In', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'customer', balance: 5000 } },
  // Customer advance (customer with no receivable — balance <= 0)
  { id: 't28', type: 'credit', amount: 2000, category: 'Payment In', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'customer', balance: 0 } },
  // Customer refund (debit to customer)
  { id: 't29', type: 'debit', amount: 1000, category: 'Payment Out', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'customer', balance: 0 } },
  // Supplier payment (supplier with existing payable — balance < 0)
  { id: 't30', type: 'debit', amount: 8000, category: 'Payment Out', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'supplier', balance: -8000 } },
  // Ambiguous supplier debit (supplier with NO payable — balance >= 0)
  { id: 't31', type: 'debit', amount: 3000, category: 'Payment Out', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'supplier', balance: 0 } },
  // Ambiguous credit to supplier
  { id: 't32', type: 'credit', amount: 2000, category: 'Payment In', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'supplier', balance: -2000 } },
  // No-party credit (manual_cash_in)
  { id: 't33', type: 'credit', amount: 1500, category: 'Sale', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  // No-party debit (AMBIGUOUS — rent/salary/drawing)
  { id: 't34', type: 'debit', amount: 5000, category: 'Office rent', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't35', type: 'debit', amount: 12000, category: 'Salary', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't36', type: 'debit', amount: 800, category: 'Electricity bill', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't37', type: 'debit', amount: 2000, category: 'Owner drawing', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  // OCR purchase (source='ocr')
  { id: 't38', type: 'debit', amount: 4500, category: 'Purchase', invoiceId: null, transactionSubtype: null, source: 'ocr',
    invoice: null, party: { type: 'supplier', balance: 0 } },

  // === Both-party transactions (4) ===
  { id: 't39', type: 'debit', amount: 6000, category: 'Payment Out', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'both', balance: -6000 } },
  { id: 't40', type: 'credit', amount: 4000, category: 'Payment In', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'both', balance: 4000 } },
  { id: 't41', type: 'debit', amount: 2000, category: 'Payment Out', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'both', balance: 0 } },
  { id: 't42', type: 'credit', amount: 3000, category: 'Payment In', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'both', balance: -3000 } },

  // === Legacy/dead types (4) ===
  { id: 't43', type: 'sale', amount: 1000, category: 'Sale', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't44', type: 'purchase', amount: 2000, category: 'Purchase', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't45', type: 'expense', amount: 500, category: 'Misc', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: null },
  { id: 't46', type: 'debit', amount: 999, category: 'Unknown', invoiceId: null, transactionSubtype: null, source: null,
    invoice: null, party: { type: 'customer', balance: 999 } },

  // === Edge cases (4) ===
  // Unusual: debit linked to sale invoice (customer refund via invoice)
  { id: 't47', type: 'debit', amount: 1500, category: 'Refund', invoiceId: 'inv-r1', transactionSubtype: null, source: null,
    invoice: { type: 'sales', status: 'paid', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  // Unusual: credit linked to purchase invoice
  { id: 't48', type: 'credit', amount: 2000, category: 'Refund', invoiceId: 'inv-r2', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'cash' }, party: { type: 'supplier', balance: 0 } },
  // Challan-linked (unusual)
  { id: 't49', type: 'debit', amount: 500, category: 'Challan', invoiceId: 'inv-c1', transactionSubtype: null, source: null,
    invoice: { type: 'challan', status: 'paid', paymentMode: 'cash' }, party: { type: 'customer', balance: 0 } },
  // Unhandled combo
  { id: 't50', type: 'sale', amount: 5000, category: 'Sale', invoiceId: 'inv-u1', transactionSubtype: null, source: null,
    invoice: { type: 'purchase', status: 'paid', paymentMode: 'cash' }, party: { type: 'supplier', balance: 0 } },
]

// ─── Backfill classification logic (mirrors scripts/backfill-subtype.ts) ────
function classify(t: MockTxn): { subtype: string | null; reason: string | null } {
  // Skip already-classified (idempotent)
  if (t.transactionSubtype != null) {
    return { subtype: t.transactionSubtype, reason: null }
  }

  // Rule 1: Invoice-linked
  if (t.invoiceId && t.invoice) {
    const inv = t.invoice
    if (t.type === 'debit' && inv.type === 'purchase') {
      if (inv.status === 'paid' || inv.paymentMode === 'cash' || inv.paymentMode === 'upi' || inv.paymentMode === 'cheque') {
        return { subtype: 'purchase_inventory_cash', reason: null }
      } else if (inv.paymentMode === 'credit' || inv.status === 'unpaid' || inv.status === 'partial') {
        return { subtype: 'purchase_inventory_credit', reason: null }
      }
      return { subtype: 'purchase_inventory_credit', reason: null }
    }
    if (t.type === 'debit' && inv.status === 'void') {
      return { subtype: 'void_reversal', reason: null }
    }
    if (t.type === 'sale' && (inv.type === 'sales' || inv.type === 'retail')) {
      if (inv.paymentMode === 'credit') return { subtype: 'credit_sale', reason: null }
      return { subtype: 'sale_invoice', reason: null }
    }
    if (t.type === 'credit' && (inv.type === 'sales' || inv.type === 'retail')) {
      if (t.source === 'online_order') {
        if (inv.paymentMode === 'prepaid' || inv.paymentMode === 'upi') return { subtype: 'online_order_prepaid', reason: null }
        if (inv.paymentMode === 'credit' || inv.paymentMode === 'cod') return { subtype: 'online_order_cod', reason: null }
        return { subtype: null, reason: 'online_order_no_payment_mode' }
      }
      return { subtype: null, reason: `credit_invoice_linked_legacy_${t.party?.type || 'no_party'}` }
    }
    if (t.type === 'debit' && (inv.type === 'sales' || inv.type === 'retail')) {
      if (t.party && t.party.type === 'customer') return { subtype: 'customer_refund', reason: null }
      return { subtype: null, reason: 'debit_linked_to_sale_no_customer_party' }
    }
    if (inv.type === 'challan') return { subtype: null, reason: 'challan_linked_transaction' }
    return { subtype: null, reason: `unhandled_invoice_linked_${t.type}_${inv.type}` }
  }

  // Rule 2: No invoice
  if (t.type === 'credit') {
    if (!t.party) return { subtype: 'manual_cash_in', reason: null }
    if (t.party.type === 'customer') {
      return { subtype: null, reason: 'credit_customer_legacy_cannot_determine_collection_vs_advance' }
    }
    return { subtype: null, reason: 'credit_supplier_or_both_legacy' }
  }
  if (t.type === 'debit') {
    if (!t.party) return { subtype: null, reason: 'debit_no_party_legacy_opex_vs_cashout_ambiguous' }
    if (t.party.type === 'customer') return { subtype: 'customer_refund', reason: null }
    if (t.party.type === 'supplier' || t.party.type === 'both') {
      const currentBalance = t.party.balance
      if (currentBalance <= 0) return { subtype: 'supplier_payment', reason: null }
      return { subtype: null, reason: 'debit_supplier_balance_positive_legacy_ambiguous' }
    }
    return { subtype: null, reason: `debit_unknown_party_type_${t.party.type}` }
  }
  if (t.type === 'sale') return { subtype: null, reason: 'sale_no_invoice_legacy' }
  if (t.type === 'purchase' || t.type === 'expense') return { subtype: null, reason: `dead_type_${t.type}_legacy` }
  return { subtype: null, reason: `unknown_type_${t.type}` }
}

// ─── Run dry-run ──────────────────────────────────────────────────────────
console.log('\n  §P16-STEP2-VERIFY: Backfill Dry-Run (read-only simulation)')
console.log('  ===========================================================')
console.log(`\n  Simulating against ${mockTxns.length} realistic mock transactions...`)

const stats = {
  total: mockTxns.length,
  alreadyClassified: 0,
  newlyClassified: 0,
  unclassified: 0,
  ambiguous: 0,
  bySubtype: {} as Record<string, { count: number; amount: number }>,
  bySource: {} as Record<string, { count: number; amount: number }>,
  nullSubtype: { count: 0, amount: 0 },
  reasons: {} as Record<string, number>,
}

for (const t of mockTxns) {
  const { subtype, reason } = classify(t)
  const amount = t.amount

  if (t.transactionSubtype != null) {
    stats.alreadyClassified++
  } else if (subtype) {
    stats.newlyClassified++
  } else {
    stats.unclassified++
    if (reason && (reason.includes('ambiguous') || reason.includes('legacy') || reason.includes('cannot_determine'))) {
      stats.ambiguous++
    }
  }

  const finalSubtype = subtype || t.transactionSubtype
  if (finalSubtype) {
    if (!stats.bySubtype[finalSubtype]) stats.bySubtype[finalSubtype] = { count: 0, amount: 0 }
    stats.bySubtype[finalSubtype].count++
    stats.bySubtype[finalSubtype].amount += amount
  } else {
    stats.nullSubtype.count++
    stats.nullSubtype.amount += amount
  }

  const finalSource = t.source || 'manual'
  if (!stats.bySource[finalSource]) stats.bySource[finalSource] = { count: 0, amount: 0 }
  stats.bySource[finalSource].count++
  stats.bySource[finalSource].amount += amount

  if (reason) {
    stats.reasons[reason] = (stats.reasons[reason] || 0) + 1
  }
}

console.log('\n  ─── Summary ─────────────────────────────────────────────')
console.log(`  Total transactions:       ${stats.total}`)
console.log(`  Already classified:        ${stats.alreadyClassified}  (idempotent skip)`)
console.log(`  Newly classified:          ${stats.newlyClassified}`)
console.log(`  Unclassified (NULL):       ${stats.unclassified}`)
console.log(`    └ Ambiguous:             ${stats.ambiguous}`)
console.log(`    └ Other/unknown:         ${stats.unclassified - stats.ambiguous}`)

console.log('\n  ─── Per-Subtype Counts ──────────────────────────────────')
console.log(`  ${'Subtype'.padEnd(38)} ${'Count'.padStart(6)} ${'Amount (₹)'.padStart(15)}`)
console.log(`  ${'─'.repeat(38)} ${'─'.repeat(6)} ${'─'.repeat(15)}`)
const sortedSubtypes = Object.entries(stats.bySubtype).sort((a, b) => b[1].count - a[1].count)
for (const [subtype, data] of sortedSubtypes) {
  console.log(`  ${subtype.padEnd(38)} ${String(data.count).padStart(6)} ${data.amount.toFixed(2).padStart(15)}`)
}
console.log(`  ${'(NULL — unclassified)'.padEnd(38)} ${String(stats.nullSubtype.count).padStart(6)} ${stats.nullSubtype.amount.toFixed(2).padStart(15)}`)

console.log('\n  ─── Per-Source Counts ───────────────────────────────────')
console.log(`  ${'Source'.padEnd(38)} ${'Count'.padStart(6)} ${'Amount (₹)'.padStart(15)}`)
console.log(`  ${'─'.repeat(38)} ${'─'.repeat(6)} ${'─'.repeat(15)}`)
const sortedSources = Object.entries(stats.bySource).sort((a, b) => b[1].count - a[1].count)
for (const [source, data] of sortedSources) {
  console.log(`  ${source.padEnd(38)} ${String(data.count).padStart(6)} ${data.amount.toFixed(2).padStart(15)}`)
}

console.log('\n  ─── Reasons for Unclassified ────────────────────────────')
console.log(`  ${'Count'.padStart(6)}  Reason`)
console.log(`  ${'─'.repeat(6)}  ${'─'.repeat(60)}`)
const sortedReasons = Object.entries(stats.reasons).sort((a, b) => b[1] - a[1])
for (const [reason, count] of sortedReasons) {
  console.log(`  ${String(count).padStart(6)}  ${reason}`)
}

console.log('\n  ════════════════════════════════════════════════════════')
console.log(`  ✓ Dry-run complete. ${stats.newlyClassified} would be classified, ${stats.unclassified} would remain NULL.`)
console.log(`  ⚠ ${stats.ambiguous} ambiguous rows would remain NULL (per user decision).`)
console.log('')
