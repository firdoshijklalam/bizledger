/**
 * §TEST: Reports + Export pages — CSV escape, BOM, Excel coverage, date filters.
 *
 * Run: npx tsx tests/unit/reports-export.test.ts
 *
 * Regression tests for the bugs found during the Reports/Export audit:
 *
 * BUG 1: Export Excel produced EMPTY CSV for GST Report, Stock Ageing, and
 *        Customer Quality tabs (exportExcel only handled P&L, Party Ledger,
 *        and Outstanding types).
 *
 * BUG 2: CSV export lacked a UTF-8 BOM. Bengali text (e.g., আব্দুল্লাহ) was
 *        present in the body but Excel mis-rendered it without the BOM.
 *
 * BUG 3: CSV export did not escape commas, double quotes, or newlines in
 *        values. A party name like "Sharma, Das & Sons" or "He said \"hi\""
 *        broke the CSV structure.
 *
 * BUG 4: /api/reports accepted no date-range query parameters. The P&L and
 *        GST date filter buttons (Today / Week / Month / 3 Months / Custom)
 *        in the UI were cosmetic — they did not actually filter the report
 *        data.
 *
 * These tests verify the FIX by reproducing the bugs at the function level.
 * They do NOT require a database — they exercise the pure functions that
 * the API routes and the UI delegate to.
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

// ─── Import the helpers under test ──────────────────────────────────────────
// These are the pure functions extracted from the API/UI for testability.
import {
  escapeCsvField,
  buildCsv,
  buildReportCsv,
  parseReportDateRange,
  filterInvoicesByRange,
  type ReportType,
} from '../../src/lib/reports-csv'

console.log('\n🧪 Reports + Export — CSV escape, BOM, Excel coverage, date filters\n')

// ─── BUG 3: CSV field escaping ──────────────────────────────────────────────

console.log('BUG 3: CSV field escaping — commas, quotes, newlines')
{
  // Plain value passes through
  assert(escapeCsvField('Firdosh Alam') === 'Firdosh Alam', 'plain value passes through')

  // Value with comma gets quoted
  assert(escapeCsvField('Sharma, Das & Sons') === '"Sharma, Das & Sons"', 'value with comma is quoted')

  // Value with double quote escapes the quote and wraps in quotes
  assert(
    escapeCsvField('He said "hi"') === '"He said ""hi"""',
    'value with double quote escapes quote and wraps in quotes'
  )

  // Value with newline gets quoted
  assert(
    escapeCsvField('line1\nline2') === '"line1\nline2"',
    'value with newline is quoted'
  )

  // Empty string passes through
  assert(escapeCsvField('') === '', 'empty string passes through')

  // Numeric value is converted to string
  assert(escapeCsvField(1000) === '1000', 'numeric value is stringified')

  // Bengali text passes through (no escape needed)
  assert(escapeCsvField('আব্দুল্লাহ') === 'আব্দুল্লাহ', 'Bengali text passes through')
}

// ─── BUG 2: UTF-8 BOM for Excel compatibility ──────────────────────────────

console.log('\nBUG 2: UTF-8 BOM for Excel compatibility with Bengali text')
{
  const csv = buildCsv([
    ['Date', 'Type', 'Party', 'Amount'],
    ['2026-08-21', 'credit', 'আব্দুল্লাহ', 500],
  ])
  // CSV must start with UTF-8 BOM (0xEF 0xBB 0xBF) for Excel to correctly
  // decode Bengali characters.
  const bomPresent = csv.charCodeAt(0) === 0xfeff
  assert(bomPresent, 'CSV starts with UTF-8 BOM (0xFEFF)')

  // CSV body still contains the Bengali text after the BOM
  assert(csv.includes('আব্দুল্লাহ'), 'CSV body contains Bengali text after BOM')
}

// ─── BUG 3 + BUG 2: Combined — Bengali + comma + BOM ──────────────────────

console.log('\nBUG 2 + 3: Combined — Bengali text with comma + BOM')
{
  const csv = buildCsv([
    ['Name', 'Amount'],
    ['মা, লক্ষ্মী', 1000],
  ])
  const bomPresent = csv.charCodeAt(0) === 0xfeff
  assert(bomPresent, 'CSV has BOM')
  // The Bengali name with comma is properly quoted
  assert(csv.includes('"মা, লক্ষ্মী"'), 'Bengali name with comma is quoted')
}

// ─── BUG 1: Export Excel produces non-empty CSV for all 6 report types ─────

console.log('\nBUG 1: Export Excel — non-empty CSV for all 6 report types')
{
  const mockData = {
    business: { name: 'Test Business', currency: 'INR' },
    profitLoss: {
      revenue: 9142, netRevenue: 9142, discount: 0, cogs: 0,
      grossProfit: 9142, indirectExpenses: 1000, expense: 1000,
      netProfit: 8142, gst: 0,
    },
    gst: {
      totalGst: 0,
      breakdown: [
        { rate: 5, taxable: 1000, gst: 50 },
        { rate: 18, taxable: 5000, gst: 900 },
      ],
    },
    partyLedger: [
      { id: 'p1', name: 'Firdosh Alam', type: 'customer', grade: 'A', balance: 1000, phone: '+91 98300 11111' },
      { id: 'p2', name: 'আব্দুল্লাহ', type: 'customer', grade: 'A', balance: 500, phone: null },
    ],
    outstanding: {
      totalReceivable: 1500,
      totalPayable: 0,
      receivables: [
        { name: 'Firdosh Alam', amount: 1000, grade: 'A' },
        { name: 'আব্দুল্লাহ', amount: 500, grade: 'A' },
      ],
      payables: [],
    },
    stockAgeing: [
      { name: 'Cement Bag 50kg', stock: 20, value: 6080, threshold: 5, status: 'good' },
      { name: 'Miniket Rice', stock: 2, value: 88, threshold: 5, status: 'low' },
    ],
    gradeDistribution: [
      { grade: 'A', count: 2, balance: 1500 },
      { grade: 'B', count: 1, balance: 0 },
      { grade: 'C', count: 0, balance: 0 },
      { grade: 'D', count: 0, balance: 0 },
      { grade: 'E', count: 0, balance: 0 },
    ],
    invoiceCount: 5,
    recentInvoices: [],
  }

  const types: ReportType[] = ['pl', 'gst', 'party', 'outstanding', 'stock', 'grade']
  for (const type of types) {
    const csv = buildReportCsv(type, mockData as any)
    const isEmpty = csv.replace(/\uFEFF/g, '').trim().length === 0
    assert(!isEmpty, `report type "${type}" produces non-empty CSV`)

    // Each CSV must have a header row
    const lines = csv.replace(/^\uFEFF/, '').split('\n').filter((l) => l.trim().length > 0)
    assert(lines.length >= 2, `report type "${type}" CSV has at least header + 1 data row (got ${lines.length})`)

    // Each CSV must have BOM
    const hasBom = csv.charCodeAt(0) === 0xfeff
    assert(hasBom, `report type "${type}" CSV has UTF-8 BOM`)
  }

  // Verify GST Report CSV contains the rate-wise breakdown rows
  const gstCsv = buildReportCsv('gst', mockData as any)
  assert(gstCsv.includes('5%'), 'GST CSV contains 5% rate row')
  assert(gstCsv.includes('18%'), 'GST CSV contains 18% rate row')

  // Verify Stock Ageing CSV contains the product names + statuses
  const stockCsv = buildReportCsv('stock', mockData as any)
  assert(stockCsv.includes('Cement Bag 50kg'), 'Stock CSV contains "Cement Bag 50kg"')
  assert(stockCsv.includes('good'), 'Stock CSV contains "good" status')
  assert(stockCsv.includes('low'), 'Stock CSV contains "low" status')

  // Verify Customer Quality CSV contains grade rows
  const gradeCsv = buildReportCsv('grade', mockData as any)
  assert(gradeCsv.includes('Grade A'), 'Grade CSV contains "Grade A"')
  assert(gradeCsv.includes('2'), 'Grade CSV contains count for Grade A')
}

// ─── BUG 1 (cont.): Bengali names in Party Ledger CSV are quoted+escaped ───

console.log('\nBUG 1+3: Party Ledger CSV — Bengali + comma-escape')
{
  const mockData = {
    partyLedger: [
      { id: 'p1', name: 'মা, লক্ষ্মী ভান্ডার', type: 'supplier', grade: 'C', balance: -500, phone: '+91 98300 22225' },
    ],
  }
  const csv = buildReportCsv('party', mockData as any)
  assert(csv.includes('"মা, লক্ষ্মী ভান্ডার"'), 'Party Ledger CSV quotes Bengali name with comma')
  assert(csv.includes('supplier'), 'Party Ledger CSV includes type column')
}

// ─── BUG 4: /api/reports date-range query parameter parsing ───────────────

console.log('\nBUG 4: /api/reports date-range query parameter parsing')
{
  // parseReportDateRange returns null for missing/invalid params
  // (the API then defaults to "all time" — backward-compatible).
  const noParams = parseReportDateRange(new URLSearchParams(''))
  assert(noParams === null, 'no params → null (default to all-time)')

  // Valid start+end
  const r1 = parseReportDateRange(new URLSearchParams('start=2026-08-01&end=2026-08-31'))
  assert(r1 !== null, 'valid start+end → range object')
  if (r1) {
    assert(r1.start.toISOString().startsWith('2026-08-01'), 'range.start = 2026-08-01')
    // §INCLUSIVE-END: end date should be end-of-day (23:59:59.999) for inclusive filtering
    assert(r1.end.toISOString().startsWith('2026-08-31'), 'range.end = 2026-08-31')
    assert(r1.end.toISOString().endsWith('23:59:59.999Z'), 'range.end is end-of-day (inclusive)')
  }

  // Start only (no end) → end defaults to now
  const r2 = parseReportDateRange(new URLSearchParams('start=2026-08-01'))
  assert(r2 !== null, 'start only → range object (end defaults to now)')
  if (r2) {
    assert(r2.start.toISOString().startsWith('2026-08-01'), 'start-only range.start = 2026-08-01')
  }

  // End only (no start) → start defaults to all-time (epoch)
  const r3 = parseReportDateRange(new URLSearchParams('end=2026-08-31'))
  assert(r3 !== null, 'end only → range object (start defaults to epoch)')
  if (r3) {
    assert(r3.end.toISOString().startsWith('2026-08-31'), 'end-only range.end = 2026-08-31')
  }

  // Invalid date format → null (API defaults to all-time, no crash)
  const r4 = parseReportDateRange(new URLSearchParams('start=not-a-date'))
  assert(r4 === null, 'invalid date → null (no crash, defaults to all-time)')

  // Empty string values → null
  const r5 = parseReportDateRange(new URLSearchParams('start=&end='))
  assert(r5 === null, 'empty string values → null')

  // ISO datetime strings (with time) → also accepted
  const r6 = parseReportDateRange(new URLSearchParams('start=2026-08-01T10:00:00Z&end=2026-08-31T23:59:59Z'))
  assert(r6 !== null, 'ISO datetime strings → range object')
  if (r6) {
    assert(r6.start.toISOString() === '2026-08-01T10:00:00.000Z', 'ISO start preserved')
  }
}

// ─── BUG 4 (cont.): Date-range filtering of invoices ──────────────────────

console.log('\nBUG 4: Date-range filtering of invoices')
{
  // Mock invoices at different timestamps
  const now = new Date('2026-08-21T12:00:00Z')
  const invoices = [
    { id: 'i1', type: 'sales', status: 'unpaid', isGst: false, subtotal: 1000, discountAmount: 0, gstAmount: 0, grandTotal: 1000, items: [], createdAt: new Date('2026-08-15T10:00:00Z') }, // in-range
    { id: 'i2', type: 'sales', status: 'unpaid', isGst: false, subtotal: 2000, discountAmount: 0, gstAmount: 0, grandTotal: 2000, items: [], createdAt: new Date('2026-07-15T10:00:00Z') }, // out-of-range (before)
    { id: 'i3', type: 'sales', status: 'unpaid', isGst: false, subtotal: 3000, discountAmount: 0, gstAmount: 0, grandTotal: 3000, items: [], createdAt: new Date('2026-09-15T10:00:00Z') }, // out-of-range (after)
    { id: 'i4', type: 'sales', status: 'void', isGst: false, subtotal: 9999, discountAmount: 0, gstAmount: 0, grandTotal: 9999, items: [], createdAt: new Date('2026-08-16T10:00:00Z') }, // voided — excluded
  ]

  const filtered = filterInvoicesByRange(invoices, {
    start: new Date('2026-08-01T00:00:00Z'),
    end: new Date('2026-08-31T23:59:59.999Z'),
  })

  assert(filtered.length === 1, `only 1 invoice in range (got ${filtered.length})`)
  assert(filtered[0]?.id === 'i1', 'in-range invoice i1 included')
  assert(!filtered.find((i) => i.id === 'i2'), 'before-range invoice i2 excluded')
  assert(!filtered.find((i) => i.id === 'i3'), 'after-range invoice i3 excluded')
  assert(!filtered.find((i) => i.id === 'i4'), 'voided invoice i4 excluded')

  // §INCLUSIVE-END: invoice exactly at end-of-day on the end date is included
  const edgeCase = filterInvoicesByRange(
    [{ id: 'edge', type: 'sales', status: 'unpaid', isGst: false, subtotal: 1, discountAmount: 0, gstAmount: 0, grandTotal: 1, items: [], createdAt: new Date('2026-08-31T23:59:59.999Z') }],
    { start: new Date('2026-08-01T00:00:00Z'), end: new Date('2026-08-31T23:59:59.999Z') }
  )
  assert(edgeCase.length === 1, 'invoice exactly at end-of-day boundary is included (inclusive)')

  // Empty range → all non-void invoices
  const noRange = filterInvoicesByRange(invoices, null)
  assert(noRange.length === 3, 'null range → all non-void invoices (got ' + noRange.length + ')')
}

// ─── Summary ──────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
