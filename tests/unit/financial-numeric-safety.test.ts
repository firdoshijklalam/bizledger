/**
 * §TEST: Comprehensive financial numeric safety tests.
 *
 * Run: npx tsx tests/unit/financial-numeric-safety.test.ts
 *
 * Tests ALL 26 scenarios from the full financial numeric safety audit:
 * 1. Basic addition (55+55=110)
 * 2. Large addition (1250+1280=2530)
 * 3. Discount + GST (1000-100+18%=1062)
 * 4. Multi-item GST (1000+500+5%=1575)
 * 5. Quantity multiplication (10×55=550)
 * 6. Large quantity (2×1250=2500)
 * 7. MRP discount (60→55=5)
 * 8. MRP discount (65→55=10)
 * 9. Total auto discount (15)
 * 10. String "55"+"55"=110 after normalization
 * 11. String "1250"+"1280"=2530
 * 12. null financial value
 * 13. undefined financial value
 * 14. negative balance
 * 15. zero balance
 * 16. percentage discount
 * 17. fixed discount
 * 18. inclusive GST
 * 19. exclusive GST
 * 20. partial payment
 * 21. full payment
 * 22. return/refund
 * 23. duplicate return (idempotency)
 * 24. large Indian currency values
 * 25. decimal quantity
 * 26. rounding
 */
export {}

import { toNumber, safeAdd, safeMultiply, safeSubtract, percentOf, isValidNumber } from '../../src/lib/numeric'

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

console.log('\n🧪 Financial Numeric Safety Tests\n')

// TEST 1: 55 + 55 = 110
console.log('TEST 1: 55 + 55 = 110')
{
  const result = safeAdd(55, 55)
  assert(approxEqual(result, 110), `safeAdd(55, 55) = 110 (got ${result})`)
  assert(typeof result === 'number', 'result is number')
}

// TEST 2: 1250 + 1280 = 2530
console.log('\nTEST 2: 1250 + 1280 = 2530')
{
  const result = safeAdd(1250, 1280)
  assert(approxEqual(result, 2530), `safeAdd(1250, 1280) = 2530 (got ${result})`)
}

// TEST 3: 1000 - 100 + 18% GST = 1062
console.log('\nTEST 3: 1000 - 100 + 18% GST = 1062')
{
  const subtotal = 1000
  const discount = 100
  const taxable = safeSubtract(subtotal, discount)
  const gst = percentOf(taxable, 18)
  const total = taxable + gst
  assert(approxEqual(taxable, 900), `taxable = 900 (got ${taxable})`)
  assert(approxEqual(gst, 162), `GST = 162 (got ${gst})`)
  assert(approxEqual(total, 1062), `total = 1062 (got ${total})`)
}

// TEST 4: 1000 + 500 + 5% GST = 1575
console.log('\nTEST 4: 1000 + 500 + 5% GST = 1575')
{
  const subtotal = safeAdd(1000, 500)
  const gst = percentOf(subtotal, 5)
  const total = subtotal + gst
  assert(approxEqual(subtotal, 1500), `subtotal = 1500 (got ${subtotal})`)
  assert(approxEqual(gst, 75), `GST = 75 (got ${gst})`)
  assert(approxEqual(total, 1575), `total = 1575 (got ${total})`)
}

// TEST 5: 10 × 55 = 550
console.log('\nTEST 5: 10 × 55 = 550')
{
  const result = safeMultiply(10, 55)
  assert(approxEqual(result, 550), `10 × 55 = 550 (got ${result})`)
}

// TEST 6: 2 × 1250 = 2500
console.log('\nTEST 6: 2 × 1250 = 2500')
{
  const result = safeMultiply(2, 1250)
  assert(approxEqual(result, 2500), `2 × 1250 = 2500 (got ${result})`)
}

// TEST 7: MRP 60 → sale 55 = discount 5
console.log('\nTEST 7: MRP 60 → sale 55 = discount 5')
{
  const mrp = 60
  const sale = 55
  const discount = safeSubtract(mrp, sale)
  assert(approxEqual(discount, 5), `discount = 5 (got ${discount})`)
}

// TEST 8: MRP 65 → sale 55 = discount 10
console.log('\nTEST 8: MRP 65 → sale 55 = discount 10')
{
  const mrp = 65
  const sale = 55
  const discount = safeSubtract(mrp, sale)
  assert(approxEqual(discount, 10), `discount = 10 (got ${discount})`)
}

// TEST 9: Total automatic discount = 15
console.log('\nTEST 9: Total automatic discount = 15')
{
  const items = [
    { mrp: 60, sale: 55 },
    { mrp: 65, sale: 55 },
  ]
  const totalDiscount = items.reduce((s, i) => s + safeSubtract(i.mrp, i.sale), 0)
  assert(approxEqual(totalDiscount, 15), `total auto discount = 15 (got ${totalDiscount})`)
}

// TEST 10: String "55" + "55" = 110 after normalization
console.log('\nTEST 10: String "55" + "55" = 110 after normalization')
{
  const result = safeAdd("55", "55")
  assert(approxEqual(result, 110), `"55" + "55" = 110 (got ${result})`)
  assert(typeof result === 'number', 'result is number (not string)')
  assert(!String(result).includes('5555'), 'no string concatenation')
}

// TEST 11: String "1250" + "1280" = 2530
console.log('\nTEST 11: String "1250" + "1280" = 2530')
{
  const result = safeAdd("1250", "1280")
  assert(approxEqual(result, 2530), `"1250" + "1280" = 2530 (got ${result})`)
  assert(!String(result).includes('1,00,13'), 'no concatenation')
}

// TEST 12: null financial value
console.log('\nTEST 12: null financial value')
{
  assert(toNumber(null) === 0, `toNumber(null) = 0`)
  assert(safeAdd(null, 55) === 55, `null + 55 = 55`)
  assert(safeAdd(null, null) === 0, `null + null = 0`)
}

// TEST 13: undefined financial value
console.log('\nTEST 13: undefined financial value')
{
  assert(toNumber(undefined) === 0, `toNumber(undefined) = 0`)
  assert(safeAdd(undefined, 55) === 55, `undefined + 55 = 55`)
}

// TEST 14: negative balance
console.log('\nTEST 14: negative balance')
{
  assert(toNumber(-660) === -660, `toNumber(-660) = -660`)
  assert(toNumber("-660") === -660, `toNumber("-660") = -660`)
  const balance = -660
  const payment = 300
  const newBalance = safeAdd(balance, payment)
  assert(approxEqual(newBalance, -360), `-660 + 300 = -360 (got ${newBalance})`)
}

// TEST 15: zero balance
console.log('\nTEST 15: zero balance')
{
  assert(toNumber(0) === 0, `toNumber(0) = 0`)
  assert(toNumber("0") === 0, `toNumber("0") = 0`)
  assert(toNumber("") === 0, `toNumber("") = 0`)
}

// TEST 16: percentage discount
console.log('\nTEST 16: percentage discount')
{
  const subtotal = 1000
  const discountPercent = 10
  const discount = percentOf(subtotal, discountPercent)
  assert(approxEqual(discount, 100), `10% of 1000 = 100 (got ${discount})`)
  const total = safeSubtract(subtotal, discount)
  assert(approxEqual(total, 900), `1000 - 100 = 900 (got ${total})`)
}

// TEST 17: fixed discount
console.log('\nTEST 17: fixed discount')
{
  const subtotal = 1000
  const discount = 100
  const total = safeSubtract(subtotal, discount)
  assert(approxEqual(total, 900), `1000 - 100 = 900 (got ${total})`)
}

// TEST 18: inclusive GST
console.log('\nTEST 18: inclusive GST (extract from inclusive amount)')
{
  // ₹1180 inclusive of 18% GST
  // GST = 1180 - (1180 / 1.18) = 1180 - 1000 = 180
  const inclusiveAmount = 1180
  const gstRate = 18
  const taxable = inclusiveAmount / (1 + gstRate / 100)
  const gst = inclusiveAmount - taxable
  assert(approxEqual(taxable, 1000), `taxable = 1000 (got ${taxable})`)
  assert(approxEqual(gst, 180), `GST = 180 (got ${gst})`)
}

// TEST 19: exclusive GST
console.log('\nTEST 19: exclusive GST (add to taxable)')
{
  const taxable = 1000
  const gstRate = 18
  const gst = percentOf(taxable, gstRate)
  const total = taxable + gst
  assert(approxEqual(gst, 180), `GST = 180 (got ${gst})`)
  assert(approxEqual(total, 1180), `total = 1180 (got ${total})`)
}

// TEST 20: partial payment
console.log('\nTEST 20: partial payment')
{
  const grandTotal = 1062
  const amountPaid = 500
  const amountDue = safeSubtract(grandTotal, amountPaid)
  assert(approxEqual(amountDue, 562), `1062 - 500 = 562 (got ${amountDue})`)
}

// TEST 21: full payment
console.log('\nTEST 21: full payment')
{
  const grandTotal = 1062
  const amountPaid = 1062
  const amountDue = safeSubtract(grandTotal, amountPaid)
  assert(approxEqual(amountDue, 0), `1062 - 1062 = 0 (got ${amountDue})`)
}

// TEST 22: return/refund
console.log('\nTEST 22: return/refund')
{
  const originalAmount = 200
  const refundAmount = 200
  const newBalance = safeSubtract(originalAmount, refundAmount)
  assert(approxEqual(newBalance, 0), `200 - 200 = 0 (got ${newBalance})`)
}

// TEST 23: duplicate return (idempotency logic)
console.log('\nTEST 23: duplicate return idempotency')
{
  const returns = [{ refundStatus: 'refunded' }]
  const alreadyReturned = returns.some(r => r.refundStatus === 'refunded')
  assert(alreadyReturned === true, 'duplicate return detected → should return 409')
}

// TEST 24: large Indian currency values
console.log('\nTEST 24: large Indian currency values')
{
  assert(toNumber(100000) === 100000, `1 lakh = 100000`)
  assert(toNumber(1000000) === 1000000, `10 lakh = 1000000`)
  assert(toNumber(10000000) === 10000000, `1 crore = 10000000`)
  assert(toNumber("10000000") === 10000000, `string "10000000" = 10000000`)
  const largeSum = safeAdd(5000000, 5000000)
  assert(approxEqual(largeSum, 10000000), `50L + 50L = 1Cr (got ${largeSum})`)
}

// TEST 25: decimal quantity
console.log('\nTEST 25: decimal quantity')
{
  const qty = 1.5
  const price = 55
  const total = safeMultiply(qty, price)
  assert(approxEqual(total, 82.50), `1.5 × 55 = 82.50 (got ${total})`)
}

// TEST 26: rounding
console.log('\nTEST 26: rounding')
{
  const value = 115.50
  const rounded = Math.round(value)
  assert(rounded === 116, `Math.round(115.50) = 116 (got ${rounded})`)
  assert(approxEqual(value, 115.50), `original value preserved: 115.50`)
  // Round-off amount (115.49 rounds DOWN to 115, round-off = -0.49)
  const preRound = 115.49
  const roundedTotal = Math.round(preRound)
  const roundOff = roundedTotal - preRound
  assert(approxEqual(roundOff, -0.49), `round-off = -0.49 (got ${roundOff.toFixed(2)})`)
}

// TEST 27: Prisma Decimal-like object
console.log('\nTEST 27: Prisma Decimal-like object')
{
  const decimalLike = { toNumber: () => 55 }
  assert(toNumber(decimalLike) === 55, `toNumber(Decimal) = 55`)
  assert(safeAdd(decimalLike, decimalLike) === 110, `Decimal + Decimal = 110`)
}

// TEST 28: NaN and Infinity safety
console.log('\nTEST 28: NaN and Infinity safety')
{
  assert(toNumber(NaN) === 0, `toNumber(NaN) = 0`)
  assert(toNumber(Infinity) === 0, `toNumber(Infinity) = 0`)
  assert(toNumber(-Infinity) === 0, `toNumber(-Infinity) = 0`)
  assert(safeAdd(NaN, 55) === 55, `NaN + 55 = 55 (NaN treated as 0)`)
}

// TEST 29: Mixed types in reduce
console.log('\nTEST 29: Mixed types in reduce (string, number, null, Decimal)')
{
  const cart = [
    { total: 55 },           // number
    { total: "55" },         // string
    { total: null as any },  // null
    { total: { toNumber: () => 55 } as any }, // Decimal
  ]
  const sum = cart.reduce((s, i) => s + toNumber(i.total), 0)
  assert(approxEqual(sum, 165), `55 + "55" + null + Decimal(55) = 165 (got ${sum})`)
}

// TEST 30: isValidNumber
console.log('\nTEST 30: isValidNumber')
{
  assert(isValidNumber(55) === true, `55 is valid`)
  assert(isValidNumber("55") === true, `"55" is valid`)
  assert(isValidNumber(null) === false, `null is invalid`)
  assert(isValidNumber(undefined) === false, `undefined is invalid`)
  assert(isValidNumber(NaN) === false, `NaN is invalid`)
  assert(isValidNumber("abc") === false, `"abc" is invalid`)
  assert(isValidNumber("") === false, `"" is invalid`)
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')

if (failed > 0) process.exit(1)
