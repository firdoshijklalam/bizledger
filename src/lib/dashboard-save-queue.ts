/**
 * §STEP-3D: Pure dashboardSections save serialization queue logic.
 * §STEP-3D-FIX: Fixed promise completion semantics — each caller now gets its
 *   own promise, resolved/rejected by the drain loop when the caller's config
 *   (or a newer replacement) has been persisted.
 *
 * This module extracts the queue behavior into a testable pure class, separate
 * from the React component. The component owns a `useRef<SaveQueue>` instance
 * and calls `enqueue()` on each save. The queue:
 *   - Allows at most ONE POST in flight at any time.
 *   - Coalesces pending configs (latest wins; older pending configs are discarded).
 *   - Drains the pending config after the in-flight POST finishes.
 *   - On failure, clears the pending queue and rejects all affected callers.
 *
 * §STEP-3D-FIX CONTRACT:
 *   Each `enqueue()` caller receives its OWN promise (not a shared drain-loop promise).
 *   The promise resolves ONLY when:
 *     - The caller's config is successfully saved, OR
 *     - A newer config supersedes it and that newer config is successfully saved.
 *   The promise rejects if:
 *     - The save that would have satisfied the caller fails.
 *   A caller whose config was already saved is NOT affected by a later failure.
 *
 * §DESIGN: The queue does NOT perform the fetch itself — it accepts an
 * `executeSave` callback (so it's testable with a mock). The reconciliation
 * (parsing the server response, updating React state, invalidating the cache)
 * is the caller's responsibility, performed inside `executeSave`.
 */

// §STEP-3D-FIX: Each pending caller has their own config + promise resolver/rejecter.
interface PendingCaller<T> {
  config: T
  resolve: () => void
  reject: (e: any) => void
}

export class SaveQueue<T> {
  private inflight: Promise<void> | null = null
  // §STEP-3D-FIX: Replaced single `pending: T | null` with a list of pending callers.
  // Each caller has their own promise. The LAST caller's config is what gets saved
  // (latest wins). Earlier callers' configs are coalesced (discarded), but their
  // promises wait for the latest config to be saved.
  private pendingCallers: PendingCaller<T>[] = []
  // §TRACKING: for tests — counts how many times executeSave was actually invoked.
  public executeCount = 0
  // §TRACKING: for tests — the sequence of configs actually passed to executeSave.
  public savedConfigs: T[] = []

  /**
   * §STEP-3D-FIX: Enqueue a config to be saved. Returns a promise that is
   * specific to THIS caller — it resolves only when the caller's config (or a
   * newer replacement) is successfully saved, and rejects if that save fails.
   *
   * §COALESCING CONTRACT:
   *   - If this config is the latest when the drain loop picks it up, it gets saved.
   *   - If a newer config arrives before the drain loop picks it up, this caller's
   *     config is discarded (coalesced), but this caller's promise waits for the
   *     newer config to be saved. If the newer config saves successfully, this
   *     caller's promise resolves (the newer config satisfies the older caller).
   *   - If the newer config fails, this caller's promise also rejects.
   */
  enqueue(config: T, executeSave: (config: T) => Promise<void>): Promise<void> {
    // §STEP-3D-FIX: Create a per-caller promise.
    let resolve!: () => void
    let reject!: (e: any) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    // Add this caller to the pending list. The caller's config will be saved if
    // it's the latest when the drain loop picks it up. If a newer config arrives
    // before then, this caller's config is coalesced (discarded), but this
    // caller's promise waits for the newer config to save.
    this.pendingCallers.push({ config, resolve, reject })

    if (this.inflight) {
      // A save is in-flight. This caller's promise resolves when:
      // - their config is saved (the drain loop will save it after the current POST), OR
      // - a newer config supersedes it and that newer config is saved.
      return promise
    }

    // No save in-flight — start the drain loop.
    this.inflight = this.drain(executeSave)
    return promise
  }

  /**
   * §DRAIN-LOOP: keep flushing the latest pending config until no callers remain.
   *
   * §STEP-3D-FIX: Each iteration:
   *   1. Picks the LAST pending caller's config (latest wins).
   *   2. Snapshots ALL pending callers (they'll be resolved/rejected after this save).
   *   3. Clears pendingCallers (so new callers arriving during the save go to the next iteration).
   *   4. Saves the latest config.
   *   5. On success: resolves ALL snapshot callers (the latest config satisfies all of them).
   *   6. On failure: rejects ALL snapshot callers + any new callers that arrived during the save.
   */
  private async drain(executeSave: (config: T) => Promise<void>): Promise<void> {
    try {
      while (this.pendingCallers.length > 0) {
        // The last pending caller has the latest config (latest wins).
        const latestCaller = this.pendingCallers[this.pendingCallers.length - 1]
        const configToSave = latestCaller.config

        // §SNAPSHOT: take all pending callers — they'll be resolved/rejected after this save.
        // New callers that arrive during the save will be in pendingCallers for the next iteration.
        const callersToResolve = [...this.pendingCallers]
        this.pendingCallers = []

        try {
          this.executeCount++
          this.savedConfigs.push(configToSave)
          await executeSave(configToSave)
          // §SUCCESS: resolve ALL callers in this batch — the latest config satisfies
          // all of them (coalescing: older callers' configs were superseded by this one).
          for (const c of callersToResolve) {
            c.resolve()
          }
        } catch (e) {
          // §FAILURE: reject all callers in this batch (their save failed).
          for (const c of callersToResolve) {
            c.reject(e)
          }
          // Also reject any new callers that arrived during the failed save
          // (they were waiting for this save to complete before their turn).
          for (const c of this.pendingCallers) {
            c.reject(e)
          }
          this.pendingCallers = []
          return // exit drain loop (inflight set to null in finally)
        }
      }
    } finally {
      this.inflight = null
    }
  }

  // §TEST-HELPERS: expose state for assertions
  get isInflight(): boolean {
    return this.inflight !== null
  }
  get hasPending(): boolean {
    return this.pendingCallers.length > 0
  }
  get pendingValue(): T | null {
    return this.pendingCallers.length > 0
      ? this.pendingCallers[this.pendingCallers.length - 1].config
      : null
  }
  reset(): void {
    this.inflight = null
    this.pendingCallers = []
    this.executeCount = 0
    this.savedConfigs = []
  }
}
