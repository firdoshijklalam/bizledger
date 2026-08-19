/**
 * §TEST: POS cart calculation regression tests.
 *
 * Run: npx tsx tests/unit/pos-cart-calculations.test.ts
 *
 * These tests verify that cart calculations produce correct NUMERIC results
 * (not string concatenation) for the exact scenarios reported as bugs:
 *
 * CASE 1: ₹55 + ₹55, GST 5% → subtotal=110, GST=5.50, total=115.50
 * CASE 2: ₹1,250 + ₹1,280 → subtotal=2,530
 * CASE 3: ₹1000 - ₹100 + GST 18% → taxable=900, GST=162, total=1062
 * CASE 4: ₹1000 + ₹500, GST 5% → subtotal=1500, GST=75, total=1575
 * CASE 5: qty 10 × ₹55 → subtotal=550
 * CASE 6: qty 2 × ₹1,250 → subtotal=2500
 * CASE 7: ₹1000 - ₹100 + GST 18% → total=1062
 * CASE 8: Two items with MRP → selling subtotal=110, MRP total=125, discount=15
 *
 * §ROOT-CAUSE: Prisma Decimal fields serialize as strings. Without Number()
 * coercion, cart.reduce((s, i) => s + i.total, 0) does string concatenation:
 *   0 + "55" = "055"  →  "055" + "55" = "05555"  →  displayed as ₹55,555.5
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

// ─── Cart Types (mirrors sale-pad-view.tsx) ────────────────────────────────
interface CartItem {
  total: number | string  // §BUG: Could be string from Prisma Decimal
  price: number | string
  quantity: number
  gstRate: number | string
  mrp: number | string
  retailMrp: number | string
  itemGstRate: number | string
  itemGstEnabled: boolean
  itemGstManuallyDisabled: boolean
  itemMode: 'retail' | 'wholesale' | 'full'
}

// ─── Cart Calculation Logic (mirrors sale-pad-view.tsx with Number() fix) ──
function calculateSubtotal(cart: CartItem[]): number {
  // §FIX: Number() coercion prevents string concatenation
  return cart.reduce((s, i) => s + Number(i.total || 0), 0)
}

function calculateGstAmount(cart: CartItem[], globalGstRate: number, masterGstOn: boolean): number {
  const globalGstNum = Number(globalGstRate) || 0
  if (globalGstNum > 0) {
    return cart.reduce((s, i) => {
      if (i.itemGstManuallyDisabled) return s
      if (i.itemGstEnabled) return s + (Number(i.total || 0) * Number(i.itemGstRate || 0)) / 100
      if (!masterGstOn) return s
      return s + (Number(i.total || 0) * globalGstNum) / 100
    }, 0)
  }
  return cart.reduce((s, i) => {
    if (i.itemGstManuallyDisabled) return s
    if (i.itemGstEnabled) return s + (Number(i.total || 0) * Number(i.itemGstRate || 0)) / 100
    if (!masterGstOn) return s
    return s + (Number(i.total || 0) * Number(i.gstRate || 0)) / 100
  }, 0)
}

function calculateAutoDiscount(cart: CartItem[]): number {
  return cart.reduce((s, i) => {
    const effectiveMrp = Number(i.itemMode === 'retail' ? i.retailMrp : i.mrp) || 0
    const itemPrice = Number(i.price) || 0
    if (effectiveMrp > 0 && effectiveMrp > itemPrice) return s + (effectiveMrp - itemPrice) * Number(i.quantity || 0)
    return s
  }, 0)
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n🧪 POS Cart Calculation Regression Tests\n')

// TEST 1: ₹55 + ₹55, GST 5% → subtotal=110, GST=5.50, total=115.50
console.log('TEST 1: ₹55 + ₹55, GST 5%')
{
  // §BUG-REPRO: Simulate Prisma Decimal fields as strings
  const cart: CartItem[] = [
    { total: '55', price: '55', quantity: 1, gstRate: '5', mrp: '60', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: '55', price: '55', quantity: 1, gstRate: '5', mrp: '65', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  const gst = calculateGstAmount(cart, 5, true)
  const total = subtotal + gst
  assert(approxEqual(subtotal, 110), `subtotal = 110 (got ${subtotal})`)
  assert(approxEqual(gst, 5.50), `GST = 5.50 (got ${gst})`)
  assert(approxEqual(total, 115.50), `total = 115.50 (got ${total})`)
  assert(typeof subtotal === 'number', `subtotal is number (not string)`)
  assert(!String(subtotal).includes('5555'), `no string concatenation "5555"`)
}

// TEST 2: ₹1,250 + ₹1,280 → subtotal=2,530
console.log('\nTEST 2: ₹1,250 + ₹1,280')
{
  const cart: CartItem[] = [
    { total: '1250', price: '1250', quantity: 1, gstRate: '0', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: '1280', price: '1280', quantity: 1, gstRate: '0', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  assert(approxEqual(subtotal, 2530), `subtotal = 2530 (got ${subtotal})`)
  assert(!String(subtotal).includes('1,00,13,20'), `no concatenation "1,00,13,20..."`)
}

// TEST 3: ₹1000 - ₹100 + GST 18% → taxable=900, GST=162, total=1062
console.log('\nTEST 3: ₹1000 - ₹100 + GST 18%')
{
  const cart: CartItem[] = [
    { total: '1000', price: '100', quantity: 10, gstRate: '18', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  const discount = 100
  const taxable = Math.max(0, subtotal - discount)
  const gst = (taxable * 18) / 100
  const total = taxable + gst
  assert(approxEqual(subtotal, 1000), `subtotal = 1000 (got ${subtotal})`)
  assert(approxEqual(taxable, 900), `taxable = 900 (got ${taxable})`)
  assert(approxEqual(gst, 162), `GST = 162 (got ${gst})`)
  assert(approxEqual(total, 1062), `total = 1062 (got ${total})`)
}

// TEST 4: ₹1000 + ₹500, GST 5% → subtotal=1500, GST=75, total=1575
console.log('\nTEST 4: ₹1000 + ₹500, GST 5%')
{
  const cart: CartItem[] = [
    { total: '1000', price: '1000', quantity: 1, gstRate: '5', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: '500', price: '500', quantity: 1, gstRate: '5', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  const gst = calculateGstAmount(cart, 5, true)
  const total = subtotal + gst
  assert(approxEqual(subtotal, 1500), `subtotal = 1500 (got ${subtotal})`)
  assert(approxEqual(gst, 75), `GST = 75 (got ${gst})`)
  assert(approxEqual(total, 1575), `total = 1575 (got ${total})`)
}

// TEST 5: qty 10 × ₹55 → subtotal=550
console.log('\nTEST 5: qty 10 × ₹55')
{
  const cart: CartItem[] = [
    { total: '550', price: '55', quantity: 10, gstRate: '0', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  assert(approxEqual(subtotal, 550), `subtotal = 550 (got ${subtotal})`)
}

// TEST 6: qty 2 × ₹1,250 → subtotal=2500
console.log('\nTEST 6: qty 2 × ₹1,250')
{
  const cart: CartItem[] = [
    { total: '2500', price: '1250', quantity: 2, gstRate: '0', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  assert(approxEqual(subtotal, 2500), `subtotal = 2500 (got ${subtotal})`)
}

// TEST 7: ₹1000 - ₹100 + GST 18% → total=1062
console.log('\nTEST 7: ₹1000 - ₹100 + GST 18% → total=1062')
{
  const cart: CartItem[] = [
    { total: '1000', price: '100', quantity: 10, gstRate: '18', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  const discountAmount = 100
  const taxable = subtotal - discountAmount
  const gst = (taxable * 18) / 100
  const grandTotal = taxable + gst
  assert(approxEqual(grandTotal, 1062), `grandTotal = 1062 (got ${grandTotal})`)
}

// TEST 8: Two items with MRP → selling subtotal=110, MRP total=125, discount=15
console.log('\nTEST 8: MRP ₹60→₹55, MRP ₹65→₹55')
{
  const cart: CartItem[] = [
    { total: '55', price: '55', quantity: 1, gstRate: '0', mrp: '60', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: '55', price: '55', quantity: 1, gstRate: '0', mrp: '65', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const sellingSubtotal = calculateSubtotal(cart)
  const autoDiscount = calculateAutoDiscount(cart)
  // MRP total = 60 + 65 = 125
  // Auto discount = (60-55) + (65-55) = 5 + 10 = 15
  assert(approxEqual(sellingSubtotal, 110), `selling subtotal = 110 (got ${sellingSubtotal})`)
  assert(approxEqual(autoDiscount, 15), `auto discount = 15 (got ${autoDiscount})`)
}

// TEST 9: String concatenation bug repro (the ORIGINAL bug)
console.log('\nTEST 9: String concatenation bug repro (ORIGINAL bug)')
{
  // §BUG: Without Number(), reduce does string concatenation
  const cart: CartItem[] = [
    { total: '55' as any, price: '55', quantity: 1, gstRate: '5', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: '55' as any, price: '55', quantity: 1, gstRate: '5', mrp: '0', retailMrp: '0', itemGstRate: '0', itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]

  // §OLD-BEHAVIOR (bug): 0 + "55" = "055", "055" + "55" = "05555"
  const oldBugResult = cart.reduce((s: any, i) => s + i.total, 0)
  assert(typeof oldBugResult === 'string', `OLD behavior: string concatenation "05555"`)
  assert(oldBugResult === '05555', `OLD behavior produces "05555" (got ${oldBugResult})`)

  // §NEW-BEHAVIOR (fixed): 0 + 55 = 55, 55 + 55 = 110
  const newFixedResult = calculateSubtotal(cart)
  assert(typeof newFixedResult === 'number', `NEW behavior: numeric addition`)
  assert(approxEqual(newFixedResult, 110), `NEW behavior produces 110 (got ${newFixedResult})`)
}

// TEST 10: All numbers (no strings) — should still work
console.log('\nTEST 10: All numeric values (no strings)')
{
  const cart: CartItem[] = [
    { total: 55, price: 55, quantity: 1, gstRate: 5, mrp: 60, retailMrp: 0, itemGstRate: 0, itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
    { total: 55, price: 55, quantity: 1, gstRate: 5, mrp: 65, retailMrp: 0, itemGstRate: 0, itemGstEnabled: false, itemGstManuallyDisabled: false, itemMode: 'full' },
  ]
  const subtotal = calculateSubtotal(cart)
  const gst = calculateGstAmount(cart, 5, true)
  const total = subtotal + gst
  assert(approxEqual(subtotal, 110), `subtotal = 110 (got ${subtotal})`)
  assert(approxEqual(gst, 5.50), `GST = 5.50 (got ${gst})`)
  assert(approxEqual(total, 115.50), `total = 115.50 (got ${total})`)
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')

if (failed > 0) process.exit(1)
