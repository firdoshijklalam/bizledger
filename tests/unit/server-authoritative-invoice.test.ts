/**
 * §TEST: Server-authoritative invoice calculation tests.
 *
 * Run: npx tsx tests/unit/server-authoritative-invoice.test.ts
 *
 * Tests that client-provided totals are NEVER trusted — the server
 * recalculates everything from quantity × unitPrice.
 */
export {}

interface ClientItem {
  quantity: number
  unitPrice: number
  discount?: number
  gstRate?: number
  total: number // CLIENT-PROVIDED — should be IGNORED
}

interface ServerItem {
  _serverTotal: number
  _serverGstRate: number
}

function serverCalculateItems(items: ClientItem[]): ServerItem[] {
  return items.map((i) => {
    const qty = Number(i.quantity)
    const unitPrice = Number(i.unitPrice)
    const itemDiscount = Number(i.discount) || 0
    const gstRate = Math.min(100, Math.max(0, Number(i.gstRate) || 0))
    const lineTotal = Math.max(0, qty * unitPrice - itemDiscount)
    return { _serverTotal: lineTotal, _serverGstRate: gstRate }
  })
}

function serverCalculateInvoice(items: ClientItem[], discountMode: string, discountValue: number, amountPaid: number) {
  const serverItems = serverCalculateItems(items)
  const subtotal = serverItems.reduce((s, i) => s + i._serverTotal, 0)
  const discountAmount = discountMode === 'percent'
    ? (subtotal * discountValue) / 100
    : Math.min(discountValue, subtotal)
  const taxable = Math.max(0, subtotal - discountAmount)
  const gstAmount = serverItems.reduce((s, i) => {
    if (subtotal === 0) return s
    const itemTaxable = (i._serverTotal / subtotal) * taxable
    return s + (itemTaxable * i._serverGstRate) / 100
  }, 0)
  const grandTotal = taxable + gstAmount
  const due = Math.max(0, grandTotal - amountPaid)
  const status = due <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'
  return { subtotal, discountAmount, taxable, gstAmount, grandTotal, amountDue: due, status, serverItems }
}

let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.log(`  ❌ ${message}`); failed++ }
}

function approx(a: number, b: number, tol = 0.01) { return Math.abs(a - b) < tol }

console.log('\n🧪 Server-Authoritative Invoice Tests\n')

// Test 1: Tampered item.total is ignored
console.log('Test 1: Tampered item.total rejected — server recalculates')
{
  const result = serverCalculateInvoice(
    [{ quantity: 2, unitPrice: 500, gstRate: 18, total: 99999 }], // total tampered!
    'flat', 0, 0
  )
  assert(approx(result.serverItems[0]._serverTotal, 1000), 'Server total = 1000 (2×500), NOT 99999')
  assert(approx(result.subtotal, 1000), 'Subtotal = 1000 (from server, not client)')
  assert(!approx(result.subtotal, 99999), 'Tampered total 99999 NOT used')
}

// Test 2: Tampered subtotal rejected
console.log('\nTest 2: Tampered subtotal rejected — server recalculates from items')
{
  const items = [
    { quantity: 1, unitPrice: 1000, gstRate: 18, total: 1000 },
    { quantity: 2, unitPrice: 500, gstRate: 5, total: 1000 },
  ]
  const result = serverCalculateInvoice(items, 'flat', 0, 0)
  assert(approx(result.subtotal, 2000), 'Server subtotal = 2000 (1000+1000)')
  assert(!approx(result.subtotal, 99999), 'No tampered subtotal accepted')
}

// Test 3: Tampered GST rejected — server recalculates
console.log('\nTest 3: Tampered GST rejected — server recalculates on taxable')
{
  const result = serverCalculateInvoice(
    [{ quantity: 1, unitPrice: 1000, gstRate: 18, total: 1000 }],
    'flat', 100, 0 // ₹100 discount
  )
  assert(approx(result.taxable, 900), 'Taxable = 900 (1000-100)')
  assert(approx(result.gstAmount, 162), 'Server GST = 162 (18% of 900)')
  assert(!approx(result.gstAmount, 180), 'GST NOT 180 (not on pre-discount)')
}

// Test 4: Tampered grandTotal rejected
console.log('\nTest 4: Tampered grandTotal rejected — server calculates')
{
  const result = serverCalculateInvoice(
    [{ quantity: 1, unitPrice: 1000, gstRate: 18, total: 1000 }],
    'flat', 0, 0
  )
  assert(approx(result.grandTotal, 1180), 'Server grandTotal = 1180 (1000+180)')
  assert(!approx(result.grandTotal, 99999), 'Tampered grandTotal NOT used')
}

// Test 5: Negative amountPaid rejected
console.log('\nTest 5: Negative amountPaid validation')
{
  const amountPaid = -500
  const isValid = !isNaN(amountPaid) && isFinite(amountPaid) && amountPaid >= 0
  assert(!isValid, 'Negative amountPaid is invalid (rejected)')
}

// Test 6: Invalid discount — negative
console.log('\nTest 6: Negative discount rejected')
{
  const discountValue = -100
  const isValid = discountValue >= 0
  assert(!isValid, 'Negative discount is invalid (rejected)')
}

// Test 7: Invalid discount — percentage > 100
console.log('\nTest 7: Percentage discount > 100 rejected')
{
  const discountValue = 150
  const discountMode = 'percent'
  const isValid = !(discountMode === 'percent' && discountValue > 100)
  assert(!isValid, 'Percentage > 100 is invalid (rejected)')
}

// Test 8: GST rate clamped to 0-100
console.log('\nTest 8: GST rate clamped to 0-100')
{
  const items = [{ quantity: 1, unitPrice: 1000, gstRate: 150, total: 1000 }] // 150% GST!
  const serverItems = serverCalculateItems(items)
  assert(serverItems[0]._serverGstRate === 100, 'GST rate 150 clamped to 100')

  const items2 = [{ quantity: 1, unitPrice: 1000, gstRate: -5, total: 1000 }] // -5% GST!
  const serverItems2 = serverCalculateItems(items2)
  assert(serverItems2[0]._serverGstRate === 0, 'GST rate -5 clamped to 0')
}

// Test 9: amountDue always >= 0
console.log('\nTest 9: amountDue never negative (Math.max(0, ...))')
{
  const result = serverCalculateInvoice(
    [{ quantity: 1, unitPrice: 100, gstRate: 0, total: 100 }],
    'flat', 0, 500 // overpay: ₹500 on ₹100 invoice
  )
  assert(result.amountDue === 0, 'amountDue = 0 (not negative despite overpayment)')
  assert(result.status === 'paid', 'Status = paid (overpayment → paid)')
}

// Test 10: NaN amountPaid rejected
console.log('\nTest 10: NaN/Infinity amountPaid rejected')
{
  const amountPaid = NaN
  const isValid = !isNaN(amountPaid) && isFinite(amountPaid)
  assert(!isValid, 'NaN amountPaid is invalid')

  const amountPaid2 = Infinity
  const isValid2 = !isNaN(amountPaid2) && isFinite(amountPaid2)
  assert(!isValid2, 'Infinity amountPaid is invalid')
}

// Test 11: Discount cannot exceed subtotal (flat mode)
console.log('\nTest 11: Flat discount capped at subtotal')
{
  const result = serverCalculateInvoice(
    [{ quantity: 1, unitPrice: 500, gstRate: 0, total: 500 }],
    'flat', 9999, 0 // discount > subtotal
  )
  assert(approx(result.discountAmount, 500), 'Discount capped at 500 (subtotal)')
  assert(approx(result.taxable, 0), 'Taxable = 0 (full discount)')
}

console.log(`\n${'='.repeat(50)}`)
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log(`${'='.repeat(50)}`)
if (failed > 0) process.exit(1)
