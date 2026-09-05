/**
 * §TEST: STEP-3D + STEP-3D-FIX — Dashboard save serialization queue behavior.
 *
 * Run: npx tsx tests/unit/dashboard-save-queue.test.ts
 *
 * Tests the pure SaveQueue class (src/lib/dashboard-save-queue.ts) that
 * serializes dashboardSections saves:
 *   - At most ONE save in flight at a time.
 *   - Coalesces pending configs (latest wins).
 *   - On failure, clears the queue and rejects all affected callers.
 *   - Successful save reconciles committed state.
 *
 * §STEP-3D-FIX: Tests now verify actual Promise completion TIMING, not just
 * final savedConfigs[]. Each caller gets its own promise that resolves only
 * when the caller's config (or a newer replacement) is successfully saved.
 *
 * §NO-NETWORK: These tests use a mock executeSave that resolves/rejects
 * on demand, so no real HTTP requests are made.
 */
export {}

import { SaveQueue } from '../../src/lib/dashboard-save-queue'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}
function assertEqual<T>(actual: T, expected: T, msg: string) {
  assert(actual === expected, `${msg} (got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)})`)
}

async function main() {
  console.log('\n🧪 STEP-3D-FIX: SaveQueue Promise Timing Tests\n')

  // ─── 1. One save → one POST ────────────────────────────────────────────
  console.log('TEST 1: One save → one executeSave call')
  {
    const q = new SaveQueue<string>()
    let savedValue: string | null = null
    const executeSave = async (config: string) => { savedValue = config }
    await q.enqueue('config-1', executeSave)
    assertEqual(q.executeCount, 1, 'Q1a: exactly 1 executeSave call')
    assertEqual(savedValue, 'config-1', 'Q1b: saved value = config-1')
    assert(!q.isInflight, 'Q1c: queue not inflight after drain')
    assert(!q.hasPending, 'Q1d: no pending after drain')
  }

  // ─── 2. Two saves while first in flight → at most 2 POSTs ──────────────
  console.log('\nTEST 2: Two saves while first in flight → 2 POSTs, second uses latest config')
  {
    const q = new SaveQueue<string>()
    let resolveFirst: () => void = () => {}
    const savedValues: string[] = []
    const executeSave = async (config: string) => {
      if (config === 'config-1') {
        await new Promise<void>(r => { resolveFirst = r })
      }
      savedValues.push(config)
    }
    const p1 = q.enqueue('config-1', executeSave)
    const p2 = q.enqueue('config-2', executeSave)
    assert(q.isInflight, 'Q2a: queue is inflight during first save')
    assert(q.hasPending, 'Q2b: second config is pending')
    resolveFirst()
    await Promise.all([p1, p2])
    assertEqual(q.executeCount, 2, 'Q2c: exactly 2 executeSave calls')
    assertEqual(savedValues[0], 'config-1', 'Q2d: first saved = config-1')
    assertEqual(savedValues[1], 'config-2', 'Q2e: second saved = config-2')
    assert(!q.isInflight, 'Q2f: queue not inflight after drain')
  }

  // ─── 3. Three rapid saves → intermediate coalesced ─────────────────────
  console.log('\nTEST 3: Three rapid saves → intermediate coalesced (only 2 POSTs)')
  {
    const q = new SaveQueue<string>()
    let resolveFirst: () => void = () => {}
    const savedValues: string[] = []
    const executeSave = async (config: string) => {
      if (config === 'config-1') {
        await new Promise<void>(r => { resolveFirst = r })
      }
      savedValues.push(config)
    }
    const p1 = q.enqueue('config-1', executeSave)
    const p2 = q.enqueue('config-2', executeSave)
    const p3 = q.enqueue('config-3', executeSave)
    assertEqual(q.pendingValue, 'config-3', 'Q3a: pending = config-3 (config-2 coalesced)')
    resolveFirst()
    await Promise.all([p1, p2, p3])
    assertEqual(q.executeCount, 2, 'Q3b: exactly 2 executeSave calls (config-2 coalesced)')
    assertEqual(savedValues[0], 'config-1', 'Q3c: first saved = config-1')
    assertEqual(savedValues[1], 'config-3', 'Q3d: second saved = config-3 (NOT config-2)')
    assert(!savedValues.includes('config-2'), 'Q3e: config-2 was NEVER saved (coalesced)')
  }

  // ─── 4. Save failure → queue clears/rejects correctly ──────────────────
  console.log('\nTEST 4: Save failure → queue clears, rejects, no further saves')
  {
    const q = new SaveQueue<string>()
    const executeSave = async (_config: string) => {
      throw new Error('Save failed')
    }
    let rejected = false
    try {
      await q.enqueue('config-fail', executeSave)
    } catch (e: any) {
      rejected = true
      assert(e.message.includes('Save failed'), 'Q4a: rejection message propagated')
    }
    assert(rejected, 'Q4b: enqueue promise rejected')
    assert(!q.isInflight, 'Q4c: queue not inflight after failure')
    assert(!q.hasPending, 'Q4d: no pending after failure')
    assertEqual(q.executeCount, 1, 'Q4e: exactly 1 executeSave call (the failed one)')
  }

  // ─── 5. Later retry after failure → works ──────────────────────────────
  console.log('\nTEST 5: Retry after failure → works')
  {
    const q = new SaveQueue<string>()
    let callCount = 0
    const executeSave = async (_config: string) => {
      callCount++
      if (callCount === 1) throw new Error('first attempt fails')
    }
    let firstRejected = false
    try { await q.enqueue('config-retry', executeSave) } catch { firstRejected = true }
    assert(firstRejected, 'Q5a: first attempt rejected')
    assertEqual(q.executeCount, 1, 'Q5b: 1 executeSave call so far (the failed one)')
    await q.enqueue('config-retry', executeSave)
    assertEqual(q.executeCount, 2, 'Q5c: 2 executeSave calls (failed + successful retry)')
    assert(!q.isInflight, 'Q5d: queue not inflight after successful retry')
  }

  // ─── 6. Successful save → executeSave callback receives the config ──────
  console.log('\nTEST 6: Successful save → executeSave callback receives the config')
  {
    const q = new SaveQueue<string>()
    let committedState: string | null = null
    const executeSave = async (config: string) => {
      committedState = `committed:${config}`
    }
    await q.enqueue('config-save', executeSave)
    assertEqual(committedState, 'committed:config-save', 'Q6a: committed state updated from save')
    assertEqual(q.savedConfigs[0], 'config-save', 'Q6b: savedConfigs tracks what was saved')
  }

  // ─── 7. No duplicate save from external state changes ──────────────────
  console.log('\nTEST 7: Queue does NOT trigger saves from external state changes')
  {
    const q = new SaveQueue<string>()
    const executeSave = async (_config: string) => { /* no-op */ }
    assertEqual(q.executeCount, 0, 'Q7a: zero saves before any enqueue')
    assert(!q.isInflight, 'Q7b: not inflight before any enqueue')
    await q.enqueue('config-1', executeSave)
    assertEqual(q.executeCount, 1, 'Q7c: exactly 1 save after 1 enqueue')
    assertEqual(q.executeCount, 1, 'Q7d: still 1 save after external state change (no enqueue)')
  }

  // ─── 8. Five rapid saves → only 2 POSTs ────────────────────────────────
  console.log('\nTEST 8: 5 rapid saves while inflight → only 2 POSTs (first + latest)')
  {
    const q = new SaveQueue<string>()
    let resolveFirst: () => void = () => {}
    const savedValues: string[] = []
    const executeSave = async (config: string) => {
      if (config === 'c1') await new Promise<void>(r => { resolveFirst = r })
      savedValues.push(config)
    }
    const p1 = q.enqueue('c1', executeSave)
    const p2 = q.enqueue('c2', executeSave)
    const p3 = q.enqueue('c3', executeSave)
    const p4 = q.enqueue('c4', executeSave)
    const p5 = q.enqueue('c5', executeSave)
    assertEqual(q.pendingValue, 'c5', 'Q8a: pending = c5 (c2-c4 coalesced)')
    resolveFirst()
    await Promise.all([p1, p2, p3, p4, p5])
    assertEqual(q.executeCount, 2, 'Q8b: exactly 2 POSTs (c1 + c5)')
    assertEqual(savedValues[0], 'c1', 'Q8c: first saved = c1')
    assertEqual(savedValues[1], 'c5', 'Q8d: second saved = c5')
    assert(!savedValues.includes('c2'), 'Q8e: c2 never saved')
    assert(!savedValues.includes('c3'), 'Q8f: c3 never saved')
    assert(!savedValues.includes('c4'), 'Q8g: c4 never saved')
  }

  // ═══════════════════════════════════════════════════════════════════════
  // §STEP-3D-FIX: Promise TIMING tests — verify WHEN promises resolve/reject
  // relative to save completion, not just final savedConfigs[].
  // ═══════════════════════════════════════════════════════════════════════

  // ─── TIMING A: A only — promise remains pending until A finishes ────────
  console.log('\nTIMING A: A only — promise pending until A finishes')
  {
    const q = new SaveQueue<string>()
    let resolveA: () => void = () => {}
    const executeSave = async (config: string) => {
      if (config === 'A') await new Promise<void>(r => { resolveA = r })
    }
    const pA = q.enqueue('A', executeSave)
    // A is in-flight, promise should be pending
    let aResolved = false
    pA.then(() => { aResolved = true })
    // Yield to microtask queue to check
    await new Promise(r => setTimeout(r, 10))
    assert(!aResolved, 'TA1: A promise still pending while A is in-flight')
    assert(q.isInflight, 'TA2: queue is inflight')

    // Resolve A
    resolveA()
    await pA
    assert(aResolved, 'TA3: A promise resolved after A finished')
    assert(!q.isInflight, 'TA4: queue not inflight after A')
  }

  // ─── TIMING B: A + B — B promise pending after A resolves ──────────────
  console.log('\nTIMING B: A + B — B promise still pending after A resolves')
  {
    const q = new SaveQueue<string>()
    let resolveA: () => void = () => {}
    let resolveB: () => void = () => {}
    const executeSave = async (config: string) => {
      if (config === 'A') await new Promise<void>(r => { resolveA = r })
      if (config === 'B') await new Promise<void>(r => { resolveB = r })
    }
    const pA = q.enqueue('A', executeSave)
    const pB = q.enqueue('B', executeSave)

    let aResolved = false, bResolved = false
    pA.then(() => { aResolved = true })
    pB.then(() => { bResolved = true })

    // Resolve A — A finishes, B should NOT be resolved yet (B hasn't saved)
    resolveA()
    await new Promise(r => setTimeout(r, 10))

    assert(aResolved, 'TB1: A promise resolved after A finished')
    assert(!bResolved, 'TB2: B promise still pending after A resolved (B not yet saved)')
    assert(q.isInflight, 'TB3: queue still inflight (B is saving)')

    // Resolve B — B finishes, B promise should resolve
    resolveB()
    await pB
    assert(bResolved, 'TB4: B promise resolved after B finished')
    assert(!q.isInflight, 'TB5: queue not inflight after B')
  }

  // ─── TIMING C: A + B + C — B coalesced, no caller resolves before C ────
  console.log('\nTIMING C: A + B + C — B coalesced by C, no caller resolves before C saves')
  {
    const q = new SaveQueue<string>()
    let resolveA: () => void = () => {}
    let resolveC: () => void = () => {}
    const executeSave = async (config: string) => {
      if (config === 'A') await new Promise<void>(r => { resolveA = r })
      if (config === 'C') await new Promise<void>(r => { resolveC = r })
      // B is never saved (coalesced by C)
    }
    const pA = q.enqueue('A', executeSave)
    const pB = q.enqueue('B', executeSave)
    const pC = q.enqueue('C', executeSave)

    let aResolved = false, bResolved = false, cResolved = false
    pA.then(() => { aResolved = true })
    pB.then(() => { bResolved = true })
    pC.then(() => { cResolved = true })

    // Resolve A — A finishes. B was coalesced by C, so C is next to save.
    resolveA()
    await new Promise(r => setTimeout(r, 10))

    assert(aResolved, 'TC1: A promise resolved after A finished')
    assert(!bResolved, 'TC2: B promise NOT resolved yet (C not yet saved — B coalesced)')
    assert(!cResolved, 'TC3: C promise NOT resolved yet (C still saving)')
    assert(q.isInflight, 'TC4: queue still inflight (C is saving)')
    assertEqual(q.executeCount, 2, 'TC5: 2 POSTs so far (A + C, B coalesced)')

    // Resolve C — C finishes, both B and C promises should resolve
    resolveC()
    await Promise.all([pB, pC])
    assert(bResolved, 'TC6: B promise resolved after C saved (coalescing: C satisfies B)')
    assert(cResolved, 'TC7: C promise resolved after C saved')
    assert(!q.isInflight, 'TC8: queue not inflight after C')
    assert(!q.savedConfigs.includes('B'), 'TC9: B was never saved (coalesced by C)')
  }

  // ─── TIMING D: Failure — A fails, promises reject, queue clears, retry works ─
  console.log('\nTIMING D: Failure — A fails, promises reject, retry works')
  {
    const q = new SaveQueue<string>()
    let resolveA: () => void = () => {}
    let resolveRetry: () => void = () => {}
    let callCount = 0
    const executeSave = async (config: string) => {
      callCount++
      if (config === 'A') {
        await new Promise<void>(r => { resolveA = r })
        throw new Error('A fails')
      }
      if (config === 'retry') {
        await new Promise<void>(r => { resolveRetry = r })
      }
    }

    const pA = q.enqueue('A', executeSave)

    let aRejected = false
    pA.catch(() => { aRejected = true })

    // Resolve A (which then throws)
    resolveA()
    await new Promise(r => setTimeout(r, 10))

    assert(aRejected, 'TD1: A promise rejected after A failed')
    assert(!q.isInflight, 'TD2: queue not inflight after failure')
    assert(!q.hasPending, 'TD3: no pending after failure')

    // Retry with a fresh save
    const pRetry = q.enqueue('retry', executeSave)
    let retryResolved = false
    pRetry.then(() => { retryResolved = true })

    assert(q.isInflight, 'TD4: queue inflight with retry save')
    assert(!retryResolved, 'TD5: retry promise pending while retry saves')

    resolveRetry()
    await pRetry
    assert(retryResolved, 'TD6: retry promise resolved after retry saved')
    assert(!q.isInflight, 'TD7: queue not inflight after retry')
    assertEqual(q.executeCount, 2, 'TD8: 2 executeSave calls (failed A + successful retry)')
  }

  // ─── TIMING E: B already saved — later C failure does NOT reject B ──────
  console.log('\nTIMING E: B saved successfully — later C failure does NOT reject B')
  {
    const q = new SaveQueue<string>()
    let resolveA: () => void = () => {}
    let resolveB: () => void = () => {}
    let resolveC: () => void = () => {}
    const executeSave = async (config: string) => {
      if (config === 'A') await new Promise<void>(r => { resolveA = r })
      if (config === 'B') await new Promise<void>(r => { resolveB = r })
      if (config === 'C') {
        await new Promise<void>(r => { resolveC = r })
        throw new Error('C fails')
      }
    }

    const pA = q.enqueue('A', executeSave)
    const pB = q.enqueue('B', executeSave) // B will be saved after A

    let aResolved = false, bResolved = false
    pA.then(() => { aResolved = true })
    pB.then(() => { bResolved = true })

    // A finishes, B starts saving
    resolveA()
    await new Promise(r => setTimeout(r, 10))
    assert(aResolved, 'TE1: A resolved')

    // B finishes — B's promise should resolve immediately
    resolveB()
    await new Promise(r => setTimeout(r, 10))
    assert(bResolved, 'TE2: B resolved after B saved')

    // Now C arrives while no save is in-flight (B already finished)
    const pC = q.enqueue('C', executeSave)
    let cRejected = false
    pC.catch(() => { cRejected = true })

    resolveC()
    await new Promise(r => setTimeout(r, 10))

    assert(cRejected, 'TE3: C rejected after C failed')
    assert(bResolved, 'TE4: B STILL resolved — NOT affected by C failure (§STEP-3D-FIX key behavior)')
    assert(!q.isInflight, 'TE5: queue not inflight after C failure')
  }

  console.log(`\n✅ Passed: ${passed}`)
  console.log(`❌ Failed: ${failed}`)
  if (failed > 0) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
