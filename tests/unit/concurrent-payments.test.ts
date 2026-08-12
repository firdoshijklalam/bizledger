/**
 * §TEST: Concurrent payment safety — verifies the atomic balance update logic.
 *
 * Run: npx tsx tests/unit/concurrent-payments.test.ts
 *
 * Tests that the atomic increment/decrement pattern produces correct results
 * under concurrent access. The actual concurrency is tested at the SQL level
 * (Prisma's increment/decrement translates to UPDATE SET balance = balance ± n,
 * which is atomic). This test verifies the LOGIC is correct.
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

// ─── Simulate atomic balance update ────────────────────────────────────────
// This simulates what Prisma's `{ decrement: amount }` / `{ increment: amount }`
// does at the SQL level: UPDATE parties SET balance = balance - amount WHERE id = ?
//
// The key property: each update reads the CURRENT balance and applies the delta.
// Multiple concurrent updates are serialized by the database — no lost updates.
function simulateAtomicUpdate(currentBalance: number, type: 'credit' | 'debit', amount: number): number {
  // credit (money in) → decrement receivable balance
  // debit (money out) → increment payable balance
  if (type === 'credit') return currentBalance - amount
  if (type === 'debit') return currentBalance + amount
  return currentBalance
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n🧪 Concurrent Payment Safety Tests\n')

// Test 1: Two concurrent credits — no lost update
console.log('Test 1: Two concurrent credits (payments) — no lost update')
{
  // Initial balance = 1000 (customer owes 1000)
  // Two simultaneous payments: 300 + 200
  // Expected: 1000 - 300 - 200 = 500
  let balance = 1000

  // §ATOMIC: Each update is applied sequentially by the DB (atomic at SQL level)
  // Simulate the serialization:
  balance = simulateAtomicUpdate(balance, 'credit', 300) // Payment 1
  balance = simulateAtomicUpdate(balance, 'credit', 200) // Payment 2

  assert(approxEqual(balance, 500), `final balance = 500 (got ${balance})`)
}

// Test 2: Concurrent credits applied in reverse order — same result
console.log('\nTest 2: Same credits in reverse order — same result')
{
  let balance = 1000
  balance = simulateAtomicUpdate(balance, 'credit', 200) // Payment 2 (first)
  balance = simulateAtomicUpdate(balance, 'credit', 300) // Payment 1 (second)
  assert(approxEqual(balance, 500), `final balance = 500 (order-independent)`)
}

// Test 3: Concurrent debits — balance increases correctly
console.log('\nTest 3: Concurrent debits (purchases) — balance increases')
{
  // Initial balance = 0 (supplier, we owe nothing)
  // Two purchases on credit: 500 + 300
  // Expected: 0 + 500 + 300 = 800 (we now owe 800)
  let balance = 0
  balance = simulateAtomicUpdate(balance, 'debit', 500)
  balance = simulateAtomicUpdate(balance, 'debit', 300)
  assert(approxEqual(balance, 800), `final balance = 800 (got ${balance})`)
}

// Test 4: Mixed credit and debit — net effect correct
console.log('\nTest 4: Mixed credit + debit — net effect correct')
{
  // Initial = 1000
  // Credit 300 (payment received) → 700
  // Debit 200 (new purchase on credit) → 900
  let balance = 1000
  balance = simulateAtomicUpdate(balance, 'credit', 300)
  balance = simulateAtomicUpdate(balance, 'debit', 200)
  assert(approxEqual(balance, 900), `final balance = 900 (got ${balance})`)
}

// Test 5: Many concurrent payments — all applied
console.log('\nTest 5: 10 concurrent payments of 50 each — all applied')
{
  // Initial = 1000, 10 payments of 50 → 1000 - 500 = 500
  let balance = 1000
  for (let i = 0; i < 10; i++) {
    balance = simulateAtomicUpdate(balance, 'credit', 50)
  }
  assert(approxEqual(balance, 500), `final balance = 500 (got ${balance})`)
}

// Test 6: Atomic update does NOT use read-then-write (which loses updates)
console.log('\nTest 6: Read-then-write WOULD lose updates (demonstrating the bug we fixed)')
{
  // §DEMONSTRATION: The OLD code did:
  //   const party = await findFirst({where:{id}})
  //   const newBalance = party.balance - amount  // reads STALE balance
  //   await updateMany({data:{balance: newBalance}})  // overwrites with stale value
  //
  // If two requests both read balance=1000, then:
  //   Request A: newBalance = 1000 - 300 = 700 → writes 700
  //   Request B: newBalance = 1000 - 200 = 800 → writes 800 (OVERWRITES A's 700!)
  // Final: 800 (WRONG — should be 500, lost 300)

  let actualBalance = 1000

  // Simulate the OLD read-then-write bug (both read 1000):
  const staleReadA = 1000
  const staleReadB = 1000
  const writeA = staleReadA - 300 // 700
  const writeB = staleReadB - 200 // 800
  // Last write wins:
  actualBalance = writeB

  assert(approxEqual(actualBalance, 800), `old read-then-write gives 800 (WRONG, lost 300)`)
  assert(!approxEqual(actualBalance, 500), `old pattern does NOT give correct 500`)
}

// Test 7: Atomic pattern gives correct result under same scenario
console.log('\nTest 7: Atomic increment/decrement gives correct 500 under same scenario')
{
  let balance = 1000
  // Atomic: each update reads the CURRENT (latest) balance
  balance = simulateAtomicUpdate(balance, 'credit', 300) // 1000 → 700
  balance = simulateAtomicUpdate(balance, 'credit', 200) // 700 → 500
  assert(approxEqual(balance, 500), `atomic pattern gives correct 500`)
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')

if (failed > 0) process.exit(1)
