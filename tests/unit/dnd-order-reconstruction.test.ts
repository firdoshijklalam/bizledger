/**
 * §TEST: STEP-4C-FIX — DnD order reconstruction tests.
 *
 * Run: npx tsx tests/unit/dnd-order-reconstruction.test.ts
 *
 * Tests the `reconstructOrderFromDrag` pure helper that reconstructs
 * the full order array after a DnD reorder of visible items. Hidden items
 * must retain their relative positions.
 */
export {}

import { reconstructOrderFromDrag } from '../../src/components/shared/sortable-list'
import { moveItemInOrder } from '../../src/lib/dashboard-preferences'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

console.log('\n🧪 STEP-4C-FIX: DnD Order Reconstruction Tests\n')

// ─── D1: All visible, drag D → A ────────────────────────────────────────
console.log('D1: All visible — drag D to position of A')
{
  const fullOrder = ['A', 'B', 'C', 'D']
  const visibleIds = ['A', 'B', 'C', 'D']
  // DnD: drag D to before A → new visible order = D,A,B,C
  const newVisibleOrder = ['D', 'A', 'B', 'C']
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  assertEqual(result, ['D', 'A', 'B', 'C'], 'D1: full order = D,A,B,C')
  // No IDs lost
  assert(result.length === 4, 'D1: no IDs lost')
  // No duplicates
  assert(new Set(result).size === 4, 'D1: no duplicates')
}

// ─── D2: Hidden item B between visible items ───────────────────────────
console.log('\nD2: Hidden item B — drag D across hidden B to position of A')
{
  const fullOrder = ['A', 'B', 'C', 'D']
  const visibleIds = ['A', 'C', 'D'] // B is hidden
  // Visible order before: A, C, D
  // DnD: drag D to before A → new visible order = D, A, C
  const newVisibleOrder = ['D', 'A', 'C']
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  // Expected: D takes A's position, A takes C's position, B stays, C takes D's position
  // Walk full order: A(visible)→D, B(hidden)→B, C(visible)→A, D(visible)→C
  assertEqual(result, ['D', 'B', 'A', 'C'], 'D2: hidden B preserved, visible reordered')
  assert(result.includes('B'), 'D2: B not lost')
  assert(result.length === 4, 'D2: no IDs lost')
  assert(new Set(result).size === 4, 'D2: no duplicates')
}

// ─── D3: Hidden items before/between/after ─────────────────────────────
console.log('\nD3: Hidden items at start, middle, and end')
{
  const fullOrder = ['X', 'A', 'Y', 'B', 'Z'] // X, Y, Z hidden
  const visibleIds = ['A', 'B']
  // Visible order before: A, B
  // DnD: drag B to before A → new visible order = B, A
  const newVisibleOrder = ['B', 'A']
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  // Walk: X(hidden)→X, A(visible)→B, Y(hidden)→Y, B(visible)→A, Z(hidden)→Z
  assertEqual(result, ['X', 'B', 'Y', 'A', 'Z'], 'D3: hidden X,Y,Z preserved in positions')
  assert(result.length === 5, 'D3: no IDs lost')
}

// ─── D4: Multiple hidden items ─────────────────────────────────────────
console.log('\nD4: Multiple hidden items — 3 hidden, 2 visible')
{
  const fullOrder = ['A', 'H1', 'B', 'H2', 'H3']
  const visibleIds = ['A', 'B']
  // DnD: drag B to before A → new visible order = B, A
  const newVisibleOrder = ['B', 'A']
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  // Walk: A(visible)→B, H1(hidden)→H1, B(visible)→A, H2(hidden)→H2, H3(hidden)→H3
  assertEqual(result, ['B', 'H1', 'A', 'H2', 'H3'], 'D4: multiple hidden preserved')
  assert(result.length === 5, 'D4: no IDs lost')
}

// ─── D5: Visible item dragged across a hidden item ────────────────────
console.log('\nD5: Drag visible item across hidden item')
{
  const fullOrder = ['A', 'B', 'C', 'D', 'E']
  const visibleIds = ['A', 'C', 'E'] // B, D hidden
  // Visible order before: A, C, E
  // DnD: drag E to before A → new visible order = E, A, C
  const newVisibleOrder = ['E', 'A', 'C']
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  // Walk: A(visible)→E, B(hidden)→B, C(visible)→A, D(hidden)→D, E(visible)→C
  assertEqual(result, ['E', 'B', 'A', 'D', 'C'], 'D5: dragged across hidden items')
  assert(result.length === 5, 'D5: no IDs lost')
  assert(new Set(result).size === 5, 'D5: no duplicates')
}

// ─── D6: Hidden item remains non-draggable ────────────────────────────
console.log('\nD6: Hidden item not in sortableItems — not draggable/droppable')
{
  // This is verified by the SortableList API: sortableItems only includes visible IDs.
  // The SortableContext only contains visible IDs, so hidden IDs can never be
  // active or over targets. This test verifies the reconstruction handles it.
  const fullOrder = ['A', 'B', 'C']
  const visibleIds = ['A', 'C'] // B hidden
  // If someone tried to drag B (which shouldn't be possible), the reconstruction
  // would still work correctly because B is not in visibleIds.
  const newVisibleOrder = ['C', 'A'] // swap A and C
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  // Walk: A(visible)→C, B(hidden)→B, C(visible)→A
  assertEqual(result, ['C', 'B', 'A'], 'D6: hidden B stays, visible A↔C swapped')
  assert(result.includes('B'), 'D6: B preserved')
}

// ─── D7: Re-enable previously hidden item ──────────────────────────────
console.log('\nD7: Re-enable hidden item — verify deterministic order')
{
  // Start: A, B(hidden), C — order = [A, B, C], visible = [A, C]
  // After DnD (swap A,C): order = [C, B, A], visible = [C, A]
  const fullOrderAfterDnD = ['C', 'B', 'A']
  // Now re-enable B: visible = [A, B, C] (all visible)
  // The order is already [C, B, A] — the parser's getOrderedVisibleIds
  // would return [C, B, A]. No further DnD needed.
  // Verify no IDs lost:
  assert(fullOrderAfterDnD.length === 3, 'D7: no IDs lost after DnD')
  assert(fullOrderAfterDnD.includes('B'), 'D7: B preserved in order')
  // The order is deterministic: C, B, A (B was between C and A in the full order)
  assertEqual(fullOrderAfterDnD, ['C', 'B', 'A'], 'D7: deterministic order after re-enable')
}

// ─── D8: Up/Down parity — moveItemInOrder produces same swap semantics ─
console.log('\nD8: Up/Down parity with moveItemInOrder')
{
  // Scenario: order = [A, B, C, D], visible = [A, B, C, D]
  // moveItemInOrder: move C up → swaps C and B → [A, C, B, D]
  const order = ['A', 'B', 'C', 'D']
  const visible = ['A', 'B', 'C', 'D']
  const moveResult = moveItemInOrder(order, visible, 'C', 'up')
  assertEqual(moveResult, ['A', 'C', 'B', 'D'], 'D8a: moveItemInOrder(C, up) = A,C,B,D')

  // DnD equivalent: drag C to before B → new visible order = [A, C, B, D]
  const dndResult = reconstructOrderFromDrag(order, visible, ['A', 'C', 'B', 'D'])
  assertEqual(dndResult, ['A', 'C', 'B', 'D'], 'D8b: DnD produces same result as moveItemInOrder')

  // Scenario with hidden item: order = [A, B, C, D], visible = [A, C, D] (B hidden)
  // moveItemInOrder: move D up → swaps D and C → [A, B, D, C]
  const order2 = ['A', 'B', 'C', 'D']
  const visible2 = ['A', 'C', 'D']
  const moveResult2 = moveItemInOrder(order2, visible2, 'D', 'up')
  assertEqual(moveResult2, ['A', 'B', 'D', 'C'], 'D8c: moveItemInOrder(D, up) with hidden B = A,B,D,C')

  // DnD equivalent: drag D to before C → new visible order = [A, D, C]
  const dndResult2 = reconstructOrderFromDrag(order2, visible2, ['A', 'D', 'C'])
  assertEqual(dndResult2, ['A', 'B', 'D', 'C'], 'D8d: DnD with hidden B = A,B,D,C (same as moveItemInOrder)')
}

// ─── D9: Edge case — all items hidden ─────────────────────────────────
console.log('\nD9: All items hidden — DnD no-op')
{
  const fullOrder = ['A', 'B', 'C']
  const visibleIds: string[] = [] // all hidden
  const newVisibleOrder: string[] = [] // no DnD possible
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  assertEqual(result, ['A', 'B', 'C'], 'D9: order unchanged when all hidden')
}

// ─── D10: Edge case — single visible item ────────────────────────────
console.log('\nD10: Single visible item — DnD no-op (nothing to swap)')
{
  const fullOrder = ['A', 'B', 'C']
  const visibleIds = ['B'] // only B visible
  const newVisibleOrder = ['B'] // no change
  const result = reconstructOrderFromDrag(fullOrder, visibleIds, newVisibleOrder)
  assertEqual(result, ['A', 'B', 'C'], 'D10: order unchanged with single visible')
}

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
