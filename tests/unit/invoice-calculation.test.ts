/**
 * §TEST: Invoice calculation tests — GST, discount, taxable amount.
 *
 * Run: npx tsx tests/unit/invoice-calculation.test.ts
 *
 * These tests verify the invoice calculation logic WITHOUT a database
 * connection — they test the mathematical formulas directly.
 */

interface InvoiceItem {
  total: number
  gstRate: number
}

interface InvoiceCalc {
  subtotal: number
  discountAmount: number
  taxable: number
  gstAmount: number
  grandTotal: number
}

/**
 * Replicates the invoice calculation from src/app/api/invoices/route.ts
 */
function calculateInvoice(items: InvoiceItem[], discountMode: string, discountValue: number): InvoiceCalc {
  const subtotal = items.reduce((s, i) => s + i.total, 0)
  const discountAmount = discountMode === 'percent' ? (subtotal * discountValue) / 100 : discountValue
  const taxable = Math.max(0, subtotal - discountAmount)

  // GST on taxable (after discount) — proportionally allocated per item
  const gstAmount = items.reduce((s, i) => {
    if (subtotal === 0) return s
    const itemTaxable = (i.total / subtotal) * taxable
    return s + (itemTaxable * i.gstRate) / 100
  }, 0)

  const grandTotal = taxable + gstAmount
  return { subtotal, discountAmount, taxable, gstAmount, grandTotal }
}

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

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n🧪 Invoice Calculation Tests\n')

// Test 1: No discount
console.log('Test 1: No discount')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 18 }],
    'flat', 0
  )
  assert(approxEqual(result.subtotal, 1000), 'subtotal = 1000')
  assert(approxEqual(result.discountAmount, 0), 'discount = 0')
  assert(approxEqual(result.taxable, 1000), 'taxable = 1000')
  assert(approxEqual(result.gstAmount, 180), 'GST = 180 (18% of 1000)')
  assert(approxEqual(result.grandTotal, 1180), 'grand total = 1180')
}

// Test 2: Fixed discount
console.log('\nTest 2: Fixed discount (₹100 off ₹1000)')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 18 }],
    'flat', 100
  )
  assert(approxEqual(result.subtotal, 1000), 'subtotal = 1000')
  assert(approxEqual(result.discountAmount, 100), 'discount = 100')
  assert(approxEqual(result.taxable, 900), 'taxable = 900 (after discount)')
  assert(approxEqual(result.gstAmount, 162), 'GST = 162 (18% of 900, NOT 180)')
  assert(approxEqual(result.grandTotal, 1062), 'grand total = 1062')
}

// Test 3: Percentage discount
console.log('\nTest 3: Percentage discount (10% off ₹1000)')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 18 }],
    'percent', 10
  )
  assert(approxEqual(result.discountAmount, 100), 'discount = 100 (10% of 1000)')
  assert(approxEqual(result.taxable, 900), 'taxable = 900')
  assert(approxEqual(result.gstAmount, 162), 'GST = 162 (18% of 900)')
  assert(approxEqual(result.grandTotal, 1062), 'grand total = 1062')
}

// Test 4: GST 0%
console.log('\nTest 4: GST 0%')
{
  const result = calculateInvoice(
    [{ total: 500, gstRate: 0 }],
    'flat', 0
  )
  assert(approxEqual(result.gstAmount, 0), 'GST = 0')
  assert(approxEqual(result.grandTotal, 500), 'grand total = 500')
}

// Test 5: GST 5%
console.log('\nTest 5: GST 5%')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 5 }],
    'flat', 0
  )
  assert(approxEqual(result.gstAmount, 50), 'GST = 50 (5% of 1000)')
  assert(approxEqual(result.grandTotal, 1050), 'grand total = 1050')
}

// Test 6: GST 12%
console.log('\nTest 6: GST 12%')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 12 }],
    'flat', 0
  )
  assert(approxEqual(result.gstAmount, 120), 'GST = 120 (12% of 1000)')
  assert(approxEqual(result.grandTotal, 1120), 'grand total = 1120')
}

// Test 7: GST 18% (standard)
console.log('\nTest 7: GST 18% (standard)')
{
  const result = calculateInvoice(
    [{ total: 1000, gstRate: 18 }],
    'flat', 0
  )
  assert(approxEqual(result.gstAmount, 180), 'GST = 180 (18% of 1000)')
  assert(approxEqual(result.grandTotal, 1180), 'grand total = 1180')
}

// Test 8: Multiple line items
console.log('\nTest 8: Multiple line items (₹1000 @ 18% + ₹2000 @ 5%)')
{
  const result = calculateInvoice(
    [
      { total: 1000, gstRate: 18 },
      { total: 2000, gstRate: 5 },
    ],
    'flat', 0
  )
  assert(approxEqual(result.subtotal, 3000), 'subtotal = 3000')
  assert(approxEqual(result.taxable, 3000), 'taxable = 3000 (no discount)')
  // GST = (1000 * 0.18) + (2000 * 0.05) = 180 + 100 = 280
  assert(approxEqual(result.gstAmount, 280), 'GST = 280 (180 + 100)')
  assert(approxEqual(result.grandTotal, 3280), 'grand total = 3280')
}

// Test 9: Discount + multiple items
console.log('\nTest 9: Discount + multiple items (₹3000 total, ₹300 discount)')
{
  const result = calculateInvoice(
    [
      { total: 1000, gstRate: 18 },
      { total: 2000, gstRate: 5 },
    ],
    'flat', 300
  )
  assert(approxEqual(result.subtotal, 3000), 'subtotal = 3000')
  assert(approxEqual(result.discountAmount, 300), 'discount = 300')
  assert(approxEqual(result.taxable, 2700), 'taxable = 2700 (3000 - 300)')
  // GST on taxable (proportional):
  // Item 1: (1000/3000) * 2700 * 18% = 900 * 0.18 = 162
  // Item 2: (2000/3000) * 2700 * 5% = 1800 * 0.05 = 90
  // Total GST = 162 + 90 = 252
  assert(approxEqual(result.gstAmount, 252), 'GST = 252 (162 + 90, after discount)')
  assert(approxEqual(result.grandTotal, 2952), 'grand total = 2952 (2700 + 252)')
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`)
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log(`${'='.repeat(50)}`)

if (failed > 0) {
  process.exit(1)
}
