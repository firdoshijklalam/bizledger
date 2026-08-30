/**
 * §TEST: Phase 16 Step 2 — Accounting subtype + historical COGS snapshot.
 *
 * Run: npx tsx tests/unit/phase16-step2-accounting-subtype.test.ts
 *
 * Tests:
 *   - Schema additive migration (3 new nullable fields)
 *   - Transaction creation paths set subtype + source correctly
 *   - InvoiceItem creation captures purchasePriceSnapshot
 *   - Historical COGS uses snapshot (not current product price)
 *   - Legacy fallback works when snapshot is NULL
 *   - Backup/restore preserves new fields
 *   - Old backup imports without new fields (backward compat)
 *   - Cross-tenant invoiceId rejected
 *   - Accounting invariants INV-18 through INV-28
 *
 * Uses mock objects to test calculation LOGIC — no database required.
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
  paymentMode: 'cash' | 'upi' | 'credit' | 'cheque' | null
  grandTotal: number
  subtotal: number
  discountAmount: number
  partyId: string | null
}

interface MockTransaction {
  type: 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'
  amount: number
  invoiceId: string | null
  partyId: string | null
  transactionSubtype: string | null
  source: string | null
}

interface MockProduct {
  id: string
  purchasePrice: number  // current (mutable)
}

interface MockInvoiceItem {
  productId: string | null
  quantity: number
  unitPrice: number
  total: number
  purchasePriceSnapshot: number | null  // §P16-STEP2: captured at sale time
}

interface MockParty {
  id: string
  type: 'customer' | 'supplier' | 'both'
  balance: number  // +ve = receivable, -ve = payable
}

// ─── Mirrors of server-side classification logic ───────────────────────────

// §T1-PATH: Mirrors transactions/route.ts subtype classification for party-linked path.
function classifyT1Subtype(
  txnType: 'credit' | 'debit' | 'sale',
  party: MockParty | null,
  source: string | null
): string | null {
  if (!party) return null
  const partyType = party.type
  // §P16-STEP2: balance is read BEFORE the update (balanceBefore)
  const balanceBefore = party.balance
  if (txnType === 'credit') {
    if (partyType === 'customer') {
      return balanceBefore > 0 ? 'customer_collection' : 'customer_advance'
    }
    // §AMBIGUITY-2: credit to supplier/both — leave NULL
    return null
  }
  if (txnType === 'debit') {
    if (partyType === 'customer') return 'customer_refund'
    // supplier or both
    if (balanceBefore < 0) return 'supplier_payment'
    // §AMBIGUITY-1: supplier debit with no payable — leave NULL
    return null
  }
  return null
}

// §T2-PATH: Mirrors transactions/route.ts subtype classification for no-party fallback.
function classifyT2Subtype(txnType: 'credit' | 'debit' | 'sale'): string | null {
  if (txnType === 'credit') return 'manual_cash_in'
  // §AMBIGUITY-3: debit with no party — leave NULL (opex vs manual_cash_out)
  return null
}

// §T3-PATH: Mirrors invoices/route.ts subtype classification for invoice side-effect.
function classifyT3Subtype(
  isPurchase: boolean,
  invoiceStatus: 'paid' | 'partial' | 'unpaid' | 'void',
  invoicePaymentMode: 'cash' | 'upi' | 'credit' | 'cheque' | null
): string {
  if (isPurchase) {
    if (invoiceStatus === 'paid') return 'purchase_inventory_cash'
    if (invoicePaymentMode === 'credit') return 'purchase_inventory_credit'
    // Default to credit if not fully paid
    return 'purchase_inventory_credit'
  }
  // Sale invoice
  if (invoicePaymentMode === 'credit') return 'credit_sale'
  return 'sale_invoice'
}

// §REPORTS-COGS: Mirrors reports/route.ts COGS calculation after Step 2.
function computeCogs(
  items: MockInvoiceItem[],
  products: MockProduct[]
): { cogs: number; snapshotCount: number; legacyCount: number } {
  const productCostMap = new Map(products.map((p) => [p.id, p.purchasePrice]))
  let cogs = 0
  let snapshotCount = 0
  let legacyCount = 0
  for (const it of items) {
    const snapshot = it.purchasePriceSnapshot
    let costPerUnit: number
    if (snapshot != null && !Number.isNaN(snapshot)) {
      costPerUnit = snapshot
      snapshotCount++
    } else if (it.productId) {
      // LEGACY FALLBACK: use current product.purchasePrice (approximate)
      costPerUnit = productCostMap.get(it.productId) ?? 0
      legacyCount++
    } else {
      costPerUnit = 0
    }
    cogs += it.quantity * costPerUnit
  }
  return { cogs, snapshotCount, legacyCount }
}

// ─── Main Test ────────────────────────────────────────────────────────────
async function main() {
  console.log('\n  Phase 16 Step 2 — Accounting Subtype + Historical COGS')
  console.log('  =========================================================')

  const dashSrc = fs.readFileSync('src/app/api/dashboard/route.ts', 'utf8')
  const reportsSrc = fs.readFileSync('src/app/api/reports/route.ts', 'utf8')
  const txnSrc = fs.readFileSync('src/app/api/transactions/route.ts', 'utf8')
  const invoicesSrc = fs.readFileSync('src/app/api/invoices/route.ts', 'utf8')
  const invoicesIdSrc = fs.readFileSync('src/app/api/invoices/[id]/route.ts', 'utf8')
  const customerOrdersSrc = fs.readFileSync('src/app/api/customer-orders/[id]/status/route.ts', 'utf8')
  const dataImportSrc = fs.readFileSync('src/app/api/data-import/route.ts', 'utf8')
  const backupFormatSrc = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
  const ocrSrc = fs.readFileSync('src/components/views/ai/ocr-scanner-view.tsx', 'utf8')
  const resetSrc = fs.readFileSync('src/app/api/reset/route.ts', 'utf8')
  const schemaSrc = fs.readFileSync('prisma/schema.prisma', 'utf8')
  const schemaDevSrc = fs.readFileSync('prisma/schema.dev.prisma', 'utf8')

  // ═══════════════════════════════════════════════════════════════════════
  // §SCHEMA: Verify additive migration (3 new nullable fields)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Schema verification (additive nullable fields):')
  {
    assert(schemaSrc.includes('transactionSubtype String?'),
      'schema.prisma: Transaction.transactionSubtype is nullable String?')
    assert(schemaSrc.includes('source             String?'),
      'schema.prisma: Transaction.source is nullable String?')
    assert(schemaSrc.includes('purchasePriceSnapshot Decimal? @db.Decimal(18, 2)'),
      'schema.prisma: InvoiceItem.purchasePriceSnapshot is nullable Decimal?')
    assert(schemaDevSrc.includes('transactionSubtype String?'),
      'schema.dev.prisma: Transaction.transactionSubtype is nullable String?')
    assert(schemaDevSrc.includes('source              String?'),
      'schema.dev.prisma: Transaction.source is nullable String?')
    assert(schemaDevSrc.includes('purchasePriceSnapshot Decimal?'),
      'schema.dev.prisma: InvoiceItem.purchasePriceSnapshot is nullable Decimal?')
    // Verify migration SQL exists
    const migrationSql = fs.readFileSync('prisma/migrations/20260830000000_add_accounting_subtype_snapshot/migration.sql', 'utf8')
    assert(migrationSql.includes('ALTER TABLE "Transaction" ADD COLUMN "transactionSubtype" TEXT'),
      'Migration SQL: ADD COLUMN transactionSubtype TEXT')
    assert(migrationSql.includes('ALTER TABLE "Transaction" ADD COLUMN "source" TEXT'),
      'Migration SQL: ADD COLUMN source TEXT')
    assert(migrationSql.includes('ALTER TABLE "InvoiceItem" ADD COLUMN "purchasePriceSnapshot" DECIMAL(18,2)'),
      'Migration SQL: ADD COLUMN purchasePriceSnapshot DECIMAL(18,2)')
    // Verify NO DROP / NOT NULL / destructive in the ALTER statements
    assert(!migrationSql.includes('DROP'),
      'Migration SQL: no DROP statements')
    assert(!migrationSql.includes('DELETE'),
      'Migration SQL: no DELETE statements')
    assert(!migrationSql.includes('TRUNCATE'),
      'Migration SQL: no TRUNCATE statements')
    // The migration SQL comment contains "no NOT NULL" as documentation.
    // The actual ALTER statements must not contain NOT NULL — verify that:
    const alterLines = migrationSql.split('\n').filter(l => l.trim().startsWith('ALTER TABLE'))
    const hasNotNull = alterLines.some(l => l.toUpperCase().includes('NOT NULL'))
    assert(!hasNotNull,
      'Migration SQL: ALTER TABLE statements do not contain NOT NULL')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §TRANSACTION-WRITES: Verify all 8 transaction creation paths set subtype + source
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Transaction write paths (8 sites):')
  {
    // T1+T2: transactions/route.ts
    assert(txnSrc.includes('transactionSubtype: resolvedSubtype'),
      'T1 (party-linked): sets transactionSubtype = resolvedSubtype')
    assert(txnSrc.includes("source: sourceFromClient || 'manual'"),
      'T1+T2: source = body.source || manual')
    assert(txnSrc.includes('transactionSubtype: fallbackSubtype'),
      'T2 (no-party fallback): sets transactionSubtype = fallbackSubtype')
    assert(txnSrc.includes("'customer_collection'") && txnSrc.includes("'customer_advance'"),
      'T1: distinguishes customer_collection vs customer_advance via balance')
    assert(txnSrc.includes("'customer_refund'"),
      'T1: classifies customer debit as customer_refund')
    assert(txnSrc.includes("'supplier_payment'"),
      'T1: classifies supplier debit with payable as supplier_payment')
    assert(txnSrc.includes('§AMBIGUITY-1'),
      'T1: Ambiguity 1 documented (supplier debit no payable → NULL)')
    assert(txnSrc.includes('§AMBIGUITY-2'),
      'T1: Ambiguity 2 documented (credit to supplier → NULL)')

    // T3: invoices/route.ts
    assert(invoicesSrc.includes("'purchase_inventory_cash'"),
      'T3: classifies cash purchase as purchase_inventory_cash')
    assert(invoicesSrc.includes("'purchase_inventory_credit'"),
      'T3: classifies credit purchase as purchase_inventory_credit')
    assert(invoicesSrc.includes("'sale_invoice'"),
      'T3: classifies cash sale as sale_invoice')
    assert(invoicesSrc.includes("'credit_sale'"),
      'T3: classifies credit sale as credit_sale')
    assert(invoicesSrc.includes("source: 'invoice'"),
      'T3: sets source = invoice')

    // T4: invoices/[id]/route.ts (void reversal)
    assert(invoicesIdSrc.includes("transactionSubtype: 'void_reversal'"),
      'T4: void reversal sets transactionSubtype = void_reversal')
    assert(invoicesIdSrc.includes("source: 'system'"),
      'T4: void reversal sets source = system')

    // T5: customer-orders/[id]/status/route.ts
    assert(customerOrdersSrc.includes("'online_order_prepaid'") && customerOrdersSrc.includes("'online_order_cod'"),
      'T5: classifies online order as online_order_prepaid vs online_order_cod')
    assert(customerOrdersSrc.includes("source: 'online_order'"),
      'T5: sets source = online_order')

    // T6: reset/route.ts (seed — prod blocked)
    assert(resetSrc.includes("transactionSubtype: null"),
      'T6: seed leaves subtype NULL (ambiguous synthetic data)')
    assert(resetSrc.includes("source: 'system'"),
      'T6: seed sets source = system')

    // T7+T8: data-import/route.ts
    assert(dataImportSrc.includes('transactionSubtype: t.transactionSubtype ?? null'),
      'T7+T8: restore preserves transactionSubtype (nullable for legacy)')
    assert(dataImportSrc.includes("source: t.source ?? 'restore'"),
      'T7+T8: restore preserves source (defaults to restore)')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INVOICEITEM-WRITES: Verify snapshot capture
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  InvoiceItem write paths (snapshot capture):')
  {
    // I1: invoices/route.ts
    assert(invoicesSrc.includes('purchasePrice: true'),
      'I1: invoices route fetches product.purchasePrice')
    assert(invoicesSrc.includes('productPurchasePriceMap'),
      'I1: invoices route builds productPurchasePriceMap')
    assert(invoicesSrc.includes('purchasePriceSnapshot: i.productId'),
      'I1: invoices route sets purchasePriceSnapshot on InvoiceItem create')

    // I2: customer-orders/[id]/status/route.ts
    assert(customerOrdersSrc.includes('_productsForSnapshot'),
      'I2: customer-orders route pre-fetches products for snapshot')
    assert(customerOrdersSrc.includes('productPurchasePriceMap[item.productId]'),
      'I2: customer-orders route sets purchasePriceSnapshot on InvoiceItem create')

    // I3+I4: data-import/route.ts
    assert(dataImportSrc.includes('purchasePriceSnapshot: it.purchasePriceSnapshot ?? null'),
      'I3+I4: restore preserves purchasePriceSnapshot (nullable for legacy)')

    // I5: reset/route.ts (dev seed)
    assert(resetSrc.includes('purchasePriceSnapshot: Number(products'),
      'I5: reset route sets purchasePriceSnapshot from products array')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §OCR-CLIENT: Verify OCR scanner sends source='ocr'
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  OCR scanner client (Ambiguity 4 — Option A):')
  {
    assert(ocrSrc.includes("source: 'ocr'"),
      'OCR scanner sends source: ocr in POST body')
    assert(txnSrc.includes("sourceFromClient === 'ocr'"),
      'Server reads body.source and uses it for OCR classification')
    assert(txnSrc.includes("resolvedSubtype = 'ocr_purchase'"),
      'Server classifies OCR debit to supplier as ocr_purchase')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BACKUP-RESTORE: Verify new fields survive backup/restore
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Backup/restore compatibility:')
  {
    assert(backupFormatSrc.includes('purchasePriceSnapshot?: number | null'),
      'SanitizedInvoiceItem includes purchasePriceSnapshot (optional)')
    assert(backupFormatSrc.includes('transactionSubtype?: string | null'),
      'SanitizedTransaction includes transactionSubtype (optional)')
    assert(backupFormatSrc.includes('source?: string | null'),
      'SanitizedTransaction includes source (optional)')
    assert(backupFormatSrc.includes('it.purchasePriceSnapshot != null ? toNum(it.purchasePriceSnapshot) : null'),
      'sanitizeInvoiceItem preserves purchasePriceSnapshot')
    assert(backupFormatSrc.includes('t.transactionSubtype ?? null'),
      'sanitizeTransaction preserves transactionSubtype')
    assert(backupFormatSrc.includes('t.source ?? null'),
      'sanitizeTransaction preserves source')
    // Old backup compat: fields are optional (?:) so old backups without them still parse
    assert(backupFormatSrc.includes('purchasePriceSnapshot?:') && backupFormatSrc.includes('transactionSubtype?:'),
      'Fields are optional (?:) — old backups without them still import')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §DASHBOARD-REPORTS-FILTERS: Verify subtype-based hybrid filter
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Dashboard/Reports hybrid subtype filter:')
  {
    // Dashboard SQL
    assert(dashSrc.includes('"transactionSubtype" = \'operating_expense\' THEN amount'),
      'Dashboard SQL: subtype=operating_expense → counted as OpEx')
    assert(dashSrc.includes('"transactionSubtype" IS NOT NULL THEN 0'),
      'Dashboard SQL: any other non-null subtype → excluded from OpEx')
    assert(dashSrc.includes('type IN (\'debit\', \'expense\', \'purchase\') AND "invoiceId" IS NULL'),
      'Dashboard SQL: legacy NULL-subtype rows use Step 1 heuristic (invoiceId IS NULL)')
    // Dashboard JS chart
    assert(dashSrc.includes('isOperatingExpense') && dashSrc.includes('t.transactionSubtype === \'operating_expense\''),
      'Dashboard JS: isOperatingExpense function uses hybrid logic')
    // Reports indirectExpenses
    assert(reportsSrc.includes('transactionSubtype: \'operating_expense\''),
      'Reports: OR clause includes subtype=operating_expense')
    assert(reportsSrc.includes('transactionSubtype: null') && reportsSrc.includes('invoiceId: null'),
      'Reports: OR clause includes legacy NULL-subtype + invoiceId IS NULL fallback')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §COGS-SNAPSHOT: Verify historical COGS uses snapshot
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Historical COGS snapshot:')
  {
    assert(reportsSrc.includes('purchasePriceSnapshot: true'),
      'Reports cogsItems select includes purchasePriceSnapshot')
    assert(reportsSrc.includes('it.purchasePriceSnapshot?.toNumber()'),
      'Reports COGS reads purchasePriceSnapshot')
    assert(reportsSrc.includes('legacyCogsCount'),
      'Reports COGS tracks legacyCogsCount for fallback disclosure')
    assert(reportsSrc.includes('snapshotCogsCount'),
      'Reports COGS tracks snapshotCogsCount for authoritative count')
    assert(reportsSrc.includes('cogsAccuracy'),
      'Reports response includes cogsAccuracy disclosure')
    assert(reportsSrc.includes('isApproximate: legacyCogsCount > 0'),
      'Reports cogsAccuracy.isApproximate = true when any legacy fallback used')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §SECURITY: invoiceId ownership validation (from Step 1, must remain)
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Security — invoiceId ownership validation:')
  {
    assert(txnSrc.includes('§P16-STEP1-E') || txnSrc.includes('invoiceId ownership'),
      'Step 1 invoiceId ownership validation preserved')
    assert(txnSrc.includes('Invoice not found or does not belong to this business'),
      'Step 1 403 error message preserved')
    assert(txnSrc.includes('status: 403'),
      'Step 1 HTTP 403 response preserved')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Subtype classification — Examples A/B/C/D
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Subtype classification (Examples A/B/C/D):')

  // Example A: Purchase ₹4,000 + Sale ₹6,000 + OpEx ₹0
  console.log('\n  Example A — Purchase ₹4k + Sale ₹6k + OpEx ₹0:')
  {
    // Purchase invoice side-effect (T3): purchase + status=paid → purchase_inventory_cash
    const purchaseSubtype = classifyT3Subtype(true, 'paid', 'cash')
    assert(purchaseSubtype === 'purchase_inventory_cash',
      `T3 purchase+paid → purchase_inventory_cash (got: ${purchaseSubtype})`)
    // Sale invoice side-effect (T3): sale + paymentMode=cash → sale_invoice
    const saleSubtype = classifyT3Subtype(false, 'paid', 'cash')
    assert(saleSubtype === 'sale_invoice',
      `T3 sale+cash → sale_invoice (got: ${saleSubtype})`)
  }

  // Example B: Same as A + OpEx ₹500 (manual, no party)
  console.log('\n  Example B — + OpEx ₹500 (manual, no party):')
  {
    // T2 fallback: debit + no party → NULL (Ambiguity 3 — leave NULL)
    const opexSubtype = classifyT2Subtype('debit')
    assert(opexSubtype === null,
      `T2 debit+no party → NULL (Ambiguity 3, got: ${opexSubtype})`)
    // The OpEx ₹500 row will be counted in Dashboard expense via legacy fallback
    // (subtype IS NULL + type=debit + invoiceId IS NULL → counted as OpEx)
  }

  // Example C: Purchase ₹50,000 + Sale ₹0
  console.log('\n  Example C — Purchase ₹50k + Sale ₹0:')
  {
    // Purchase invoice side-effect: purchase + status=paid → purchase_inventory_cash
    const purchaseSubtype = classifyT3Subtype(true, 'paid', 'cash')
    assert(purchaseSubtype === 'purchase_inventory_cash',
      `T3 purchase → purchase_inventory_cash (NOT operating_expense, got: ${purchaseSubtype})`)
    // This transaction will be EXCLUDED from OpEx because subtype is non-null and != 'operating_expense'
  }

  // Example D: Purchase ₹50k + Sell ₹10k worth
  console.log('\n  Example D — Purchase ₹50k + Sell ₹10k:')
  {
    // Purchase side-effect: purchase_inventory_cash (NOT OpEx)
    const purchaseSubtype = classifyT3Subtype(true, 'paid', 'cash')
    assert(purchaseSubtype === 'purchase_inventory_cash',
      `T3 purchase → purchase_inventory_cash (got: ${purchaseSubtype})`)
    // Sale side-effect: sale_invoice
    const saleSubtype = classifyT3Subtype(false, 'paid', 'cash')
    assert(saleSubtype === 'sale_invoice',
      `T3 sale → sale_invoice (got: ${saleSubtype})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Historical COGS snapshot test
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Historical COGS snapshot:')
  {
    // Scenario: Product purchasePrice = ₹400 at sale time. Snapshot captured.
    // Later, product.purchasePrice updated to ₹500.
    // Historical COGS MUST remain ₹400 (use snapshot, not current).
    const product: MockProduct = { id: 'p1', purchasePrice: 500 }  // CURRENT price (updated)
    const item: MockInvoiceItem = {
      productId: 'p1',
      quantity: 10,
      unitPrice: 600,
      total: 6000,
      purchasePriceSnapshot: 400,  // captured at sale time when price was ₹400
    }
    const { cogs, snapshotCount, legacyCount } = computeCogs([item], [product])
    assert(cogs === 4000, `COGS uses snapshot (10 × ₹400 = ₹4000, NOT 10 × ₹500 = ₹5000). Got: ${cogs}`)
    assert(snapshotCount === 1, `snapshotCount = 1 (used authoritative snapshot). Got: ${snapshotCount}`)
    assert(legacyCount === 0, `legacyCount = 0 (no fallback used). Got: ${legacyCount}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Legacy COGS fallback test
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Legacy COGS fallback:')
  {
    // Scenario: Legacy InvoiceItem with purchasePriceSnapshot = NULL.
    // Should fall back to current product.purchasePrice.
    const product: MockProduct = { id: 'p1', purchasePrice: 500 }
    const legacyItem: MockInvoiceItem = {
      productId: 'p1',
      quantity: 10,
      unitPrice: 600,
      total: 6000,
      purchasePriceSnapshot: null,  // legacy — no snapshot
    }
    const { cogs, snapshotCount, legacyCount } = computeCogs([legacyItem], [product])
    assert(cogs === 5000, `Legacy COGS uses current price (10 × ₹500 = ₹5000). Got: ${cogs}`)
    assert(snapshotCount === 0, `snapshotCount = 0 (no snapshot available). Got: ${snapshotCount}`)
    assert(legacyCount === 1, `legacyCount = 1 (used LEGACY FALLBACK). Got: ${legacyCount}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Mixed snapshot + legacy items
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Mixed snapshot + legacy items:')
  {
    const products: MockProduct[] = [
      { id: 'p1', purchasePrice: 500 },  // current price (updated)
      { id: 'p2', purchasePrice: 200 },  // current price
    ]
    const items: MockInvoiceItem[] = [
      // New sale (has snapshot): 10 units × ₹400 snapshot = ₹4000
      { productId: 'p1', quantity: 10, unitPrice: 600, total: 6000, purchasePriceSnapshot: 400 },
      // Legacy sale (no snapshot): 5 units × ₹200 current = ₹1000
      { productId: 'p2', quantity: 5, unitPrice: 250, total: 1250, purchasePriceSnapshot: null },
      // Ad-hoc item (no productId): 0 cost
      { productId: null, quantity: 1, unitPrice: 100, total: 100, purchasePriceSnapshot: null },
    ]
    const { cogs, snapshotCount, legacyCount } = computeCogs(items, products)
    assert(cogs === 5000, `Mixed COGS = ₹4000 (snapshot) + ₹1000 (legacy) + ₹0 (ad-hoc) = ₹5000. Got: ${cogs}`)
    assert(snapshotCount === 1, `snapshotCount = 1. Got: ${snapshotCount}`)
    assert(legacyCount === 1, `legacyCount = 1 (only legacy item with productId). Got: ${legacyCount}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Subtype classification for customer scenarios
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Customer scenario subtypes:')
  {
    // Customer with existing receivable (balance > 0) + credit → customer_collection
    const collectionSubtype = classifyT1Subtype('credit', { id: 'c1', type: 'customer', balance: 1000 }, null)
    assert(collectionSubtype === 'customer_collection',
      `Customer credit + balance>0 → customer_collection (got: ${collectionSubtype})`)
    // Customer with no receivable (balance <= 0) + credit → customer_advance
    const advanceSubtype = classifyT1Subtype('credit', { id: 'c2', type: 'customer', balance: 0 }, null)
    assert(advanceSubtype === 'customer_advance',
      `Customer credit + balance<=0 → customer_advance (got: ${advanceSubtype})`)
    // Customer debit → customer_refund
    const refundSubtype = classifyT1Subtype('debit', { id: 'c3', type: 'customer', balance: 0 }, null)
    assert(refundSubtype === 'customer_refund',
      `Customer debit → customer_refund (got: ${refundSubtype})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: Supplier scenario subtypes
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — Supplier scenario subtypes:')
  {
    // Supplier with existing payable (balance < 0) + debit → supplier_payment
    const paymentSubtype = classifyT1Subtype('debit', { id: 's1', type: 'supplier', balance: -1000 }, null)
    assert(paymentSubtype === 'supplier_payment',
      `Supplier debit + payable (balance<0) → supplier_payment (got: ${paymentSubtype})`)
    // Supplier with no payable (balance >= 0) + debit → NULL (Ambiguity 1)
    const ambiguousSubtype = classifyT1Subtype('debit', { id: 's2', type: 'supplier', balance: 0 }, null)
    assert(ambiguousSubtype === null,
      `Supplier debit + no payable → NULL (Ambiguity 1, got: ${ambiguousSubtype})`)
    // Credit to supplier → NULL (Ambiguity 2)
    const supplierCreditSubtype = classifyT1Subtype('credit', { id: 's3', type: 'supplier', balance: -1000 }, null)
    assert(supplierCreditSubtype === null,
      `Credit to supplier → NULL (Ambiguity 2, got: ${supplierCreditSubtype})`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BEHAVIORAL: OCR scanner classification
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Behavioral — OCR scanner classification:')
  {
    // OCR scanner sends source='ocr' + type='debit' + supplier party
    // Server classifies as ocr_purchase (overrides the NULL from Ambiguity 1)
    // Simulate: supplier with no payable + debit + source='ocr' → ocr_purchase
    const party: MockParty = { id: 's1', type: 'supplier', balance: 0 }  // no payable
    // Without source='ocr', this would be NULL (Ambiguity 1)
    const noOcrSubtype = classifyT1Subtype('debit', party, null)
    assert(noOcrSubtype === null,
      `Supplier debit no payable + no source → NULL (got: ${noOcrSubtype})`)
    // With source='ocr', server overrides to ocr_purchase
    // (This override happens in transactions/route.ts, not in classifyT1Subtype mirror)
    // We verify the override logic exists in source:
    assert(txnSrc.includes("sourceFromClient === 'ocr' && body.type === 'debit'"),
      'Server has OCR override logic for supplier debit')
    assert(txnSrc.includes("resolvedSubtype = 'ocr_purchase'"),
      'Server sets resolvedSubtype = ocr_purchase for OCR debits')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-18: Purchase invoice never contributes to Revenue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-18 — Purchase invoice never contributes to Revenue:')
  {
    // Dashboard invoice SQL filters type IN ('sales','retail') — purchase excluded
    assert(dashSrc.includes('AND "type" IN (\'sales\', \'retail\')'),
      'Dashboard SQL excludes purchase invoices from revenue (Step 1, preserved)')
    assert(dashSrc.includes("type: { in: ['sales', 'retail'] }"),
      'Dashboard Prisma query excludes purchase (Step 1, preserved)')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-19: Purchase invoice never contributes to Operating Expense
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-19 — Purchase invoice never contributes to OpEx:')
  {
    // Purchase side-effect has subtype=purchase_inventory_cash OR purchase_inventory_credit
    // Both are non-null and != 'operating_expense' → excluded from OpEx
    assert(dashSrc.includes('"transactionSubtype" IS NOT NULL THEN 0'),
      'Dashboard SQL excludes any non-null subtype that isnt operating_expense')
    assert(reportsSrc.includes('transactionSubtype: \'operating_expense\''),
      'Reports only counts operating_expense subtype as OpEx')
    // Verify purchase_inventory_* are NOT counted as OpEx
    const purchaseSubtypes = ['purchase_inventory_cash', 'purchase_inventory_credit']
    for (const st of purchaseSubtypes) {
      assert(!dashSrc.includes(`'${st}' THEN amount`) && !reportsSrc.includes(`'${st}' THEN amount`),
        `${st} is NOT counted as OpEx in Dashboard or Reports`)
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-20: Only sold inventory contributes to COGS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-20 — Only sold inventory contributes to COGS:')
  {
    // Reports cogsItems query filters invoice.type IN ('sales','retail') — purchase excluded
    assert(reportsSrc.includes("type: { in: ['sales', 'retail'] }"),
      'Reports COGS only includes items from sales/retail invoices')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-21: COGS uses historical snapshot when available
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-21 — COGS uses historical snapshot when available:')
  {
    assert(reportsSrc.includes('it.purchasePriceSnapshot?.toNumber()'),
      'Reports COGS reads purchasePriceSnapshot first')
    assert(reportsSrc.includes('snapshot != null') && reportsSrc.includes('!Number.isNaN(snapshot)'),
      'Reports COGS checks snapshot is not null/NaN before using it')
    assert(reportsSrc.includes('costPerUnit = snapshot'),
      'Reports COGS uses snapshot as costPerUnit when available')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-22: Product price changes do not change historical COGS
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-22 — Product price changes do not change historical COGS:')
  {
    // Simulate: sale at ₹400 cost, then product price changed to ₹500
    const productAfter: MockProduct = { id: 'p1', purchasePrice: 500 }
    const itemWithSnapshot: MockInvoiceItem = {
      productId: 'p1', quantity: 10, unitPrice: 600, total: 6000,
      purchasePriceSnapshot: 400,  // captured when price was ₹400
    }
    const { cogs } = computeCogs([itemWithSnapshot], [productAfter])
    assert(cogs === 4000, `Historical COGS = ₹4000 (uses snapshot, not current ₹500). Got: ${cogs}`)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-23: Credit sale does not create Cash In
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-23 — Credit sale does not create Cash In:')
  {
    // Credit sale side-effect: subtype=credit_sale (NOT manual_cash_in or customer_collection)
    const creditSaleSubtype = classifyT3Subtype(false, 'unpaid', 'credit')
    assert(creditSaleSubtype === 'credit_sale',
      `Credit sale → credit_sale subtype (NOT cash-in, got: ${creditSaleSubtype})`)
    // credit_sale is non-null and != operating_expense → excluded from OpEx
    // credit_sale is also NOT customer_collection → not counted as Cash In
    // (Cash In classification will be implemented in Step 3 chart; for now subtype is set correctly)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-24: Customer collection does not create additional Revenue
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-24 — Customer collection does not create additional Revenue:')
  {
    // Customer collection: T1 credit + customer + balance>0 → customer_collection
    const collectionSubtype = classifyT1Subtype('credit', { id: 'c1', type: 'customer', balance: 1000 }, null)
    assert(collectionSubtype === 'customer_collection',
      `Customer collection → customer_collection subtype (got: ${collectionSubtype})`)
    // customer_collection is NOT an invoice type → does NOT contribute to Revenue
    // (Revenue comes from Invoice grandTotal, not from Transaction rows)
    // This is preserved by the Dashboard type filter (sales/retail only)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-25: Inventory purchase can create Cash Out but does not reduce Profit
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-25 — Inventory purchase: Cash Out yes, Profit no:')
  {
    // Cash purchase: subtype=purchase_inventory_cash
    const cashPurchaseSubtype = classifyT3Subtype(true, 'paid', 'cash')
    assert(cashPurchaseSubtype === 'purchase_inventory_cash',
      `Cash purchase → purchase_inventory_cash (got: ${cashPurchaseSubtype})`)
    // Credit purchase: subtype=purchase_inventory_credit
    const creditPurchaseSubtype = classifyT3Subtype(true, 'unpaid', 'credit')
    assert(creditPurchaseSubtype === 'purchase_inventory_credit',
      `Credit purchase → purchase_inventory_credit (got: ${creditPurchaseSubtype})`)
    // Both subtypes are non-null and != 'operating_expense' → excluded from OpEx
    // (Profit is NOT reduced by inventory purchase — only by operating_expense)
    // Cash purchase WILL be counted as Cash Out in Step 3 (subtype indicates cash movement)
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-26: Operating expense reduces Net Profit
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-26 — Operating expense reduces Net Profit:')
  {
    // operating_expense subtype is counted in Dashboard expense and Reports indirectExpenses
    assert(dashSrc.includes('"transactionSubtype" = \'operating_expense\' THEN amount'),
      'Dashboard SQL counts operating_expense subtype as OpEx')
    assert(reportsSrc.includes("transactionSubtype: 'operating_expense'"),
      'Reports indirectExpenses counts operating_expense subtype')
    // Reports: netProfit = grossProfit - indirectExpenses (indirectExpenses includes operating_expense)
    assert(reportsSrc.includes('netProfit = grossProfit - indirectExpenses'),
      'Reports: netProfit = grossProfit - indirectExpenses (includes operating_expense)')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-27: Void reversal is excluded from P&L
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-27 — Void reversal is excluded from P&L:')
  {
    // Void reversal: subtype=void_reversal
    assert(invoicesIdSrc.includes("transactionSubtype: 'void_reversal'"),
      'Void reversal sets transactionSubtype = void_reversal')
    // void_reversal is non-null and != 'operating_expense' → excluded from OpEx
    assert(dashSrc.includes('"transactionSubtype" IS NOT NULL THEN 0'),
      'Dashboard SQL excludes void_reversal from OpEx (any non-null non-opex subtype → 0)')
    // Void invoice is also excluded from Revenue via status != 'void' filter
    assert(dashSrc.includes("status != 'void'"),
      'Dashboard SQL excludes void invoices from revenue')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §INV-28: Cross-tenant invoice association is rejected
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  INV-28 — Cross-tenant invoice association is rejected:')
  {
    // Step 1 invoiceId ownership validation is preserved
    assert(txnSrc.includes('db.invoice.findFirst'),
      'Step 1 ownership check queries db.invoice.findFirst')
    assert(txnSrc.includes('businessId: business.id'),
      'Step 1 ownership check scopes by businessId')
    assert(txnSrc.includes('status: 403'),
      'Step 1 returns HTTP 403 for cross-tenant invoiceId')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §BACKFILL: Verify backfill script exists and is conservative
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Backfill script verification:')
  {
    const backfillExists = fs.existsSync('scripts/backfill-subtype.ts')
    assert(backfillExists, 'scripts/backfill-subtype.ts exists')
    if (backfillExists) {
      const backfillSrc = fs.readFileSync('scripts/backfill-subtype.ts', 'utf8')
      assert(backfillSrc.includes('Idempotent'),
        'Backfill: documented as idempotent')
      assert(backfillSrc.includes('t.transactionSubtype != null') || backfillSrc.includes('alreadyClassified'),
        'Backfill: skips already-classified rows (idempotent)')
      assert(backfillSrc.includes('AMBIGUOUS') || backfillSrc.includes('ambiguous'),
        'Backfill: documents ambiguous handling')
      assert(backfillSrc.includes('purchase_inventory_cash'),
        'Backfill: classifies purchase_inventory_cash')
      assert(backfillSrc.includes('void_reversal'),
        'Backfill: classifies void_reversal')
      assert(backfillSrc.includes('sale_invoice') && backfillSrc.includes('credit_sale'),
        'Backfill: classifies sale_invoice + credit_sale')
      assert(backfillSrc.includes('manual_cash_in'),
        'Backfill: classifies manual_cash_in (T2 credit no party)')
      assert(backfillSrc.includes('supplier_payment'),
        'Backfill: classifies supplier_payment (with balance check)')
      assert(backfillSrc.includes('customer_refund'),
        'Backfill: classifies customer_refund')
      // Verify backfill does NOT guess ambiguous rows
      assert(backfillSrc.includes('reason:'),
        'Backfill: records reasons for unclassified rows')
      assert(backfillSrc.includes('ambiguous') || backfillSrc.includes('NULL'),
        'Backfill: leaves ambiguous rows NULL')
      // Verify backfill reports counts
      assert(backfillSrc.includes('total') && backfillSrc.includes('classified') && backfillSrc.includes('unclassified'),
        'Backfill: reports total/classified/unclassified counts')
    }
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

  // ═══════════════════════════════════════════════════════════════════════
  // §EXISTING-INVARIANTS: Phase 5/7/13/16-Step1 invariants preserved
  // ═══════════════════════════════════════════════════════════════════════
  console.log('\n  Phase 5/7/13/16-Step1 invariants preserved:')
  {
    const dashViewSrc = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
    assert(dashViewSrc.includes('allowEscapeViewBox={{ x: false, y: false }}'),
      'Tooltip mobile clamping preserved')
    assert(dashViewSrc.includes('formatChartAxisValue'),
      'Indian axis formatting preserved')
    assert(dashViewSrc.includes('Net Cash Flow'),
      'Phase 13 Net Cash Flow label preserved')
    assert(dashViewSrc.includes('Sales'),
      'Phase 13 Sales label preserved')
    assert(dashViewSrc.includes('Asia/Kolkata'),
      'Phase 13 IST tooltip timezone preserved')
    assert(dashSrc.includes('rangeNetRevenue'),
      'Total Revenue (rangeNetRevenue) preserved')
    assert(dashSrc.includes('P16-STEP1-A'),
      'Step 1 invoice type filter preserved')
    assert(reportsSrc.includes('P16-STEP1-C') || reportsSrc.includes('Step 1'),
      'Step 1 Reports indirectExpenses filter preserved')
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
