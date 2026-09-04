/**
 * §STEP-3D: Pure dashboardSections save serialization queue logic.
 *
 * This module extracts the queue behavior into a testable pure class, separate
 * from the React component. The component owns a `useRef<SaveQueue>` instance
 * and calls `enqueue()` on each save. The queue:
 *   - Allows at most ONE POST in flight at any time.
 *   - Coalesces pending configs (latest wins; older pending is discarded).
 *   - Drains the pending config after the in-flight POST finishes.
 *   - On failure, clears the pending queue and rejects all chained callers.
 *
 * §DESIGN: The queue does NOT perform the fetch itself — it accepts an
 * `executeSave` callback (so it's testable with a mock). The reconciliation
 * (parsing the server response, updating React state, invalidating the cache)
 * is the caller's responsibility, performed inside `executeSave`.
 */

export interface SaveQueueState<T> {
  inflight: Promise<void> | null
  pending: T | null
}

export class SaveQueue<T> {
  private state: SaveQueueState<T> = { inflight: null, pending: null }
  // §TRACKING: for tests — counts how many times executeSave was actually invoked.
  // In production, this is unused (the component doesn't read it).
  public executeCount = 0
  // §TRACKING: for tests — the sequence of configs actually passed to executeSave.
  public savedConfigs: T[] = []

  /**
   * Enqueue a config to be saved. Returns a promise that:
   *   - resolves when the queue has fully drained (the config or a newer one was saved).
   *   - rejects if any save in the chain fails.
   *
   * If a save is already in flight, the config is retained as `pending` (replacing
   * any previous pending — coalescing). The drain loop will save it after the
   * current POST finishes.
   */
  enqueue(config: T, executeSave: (config: T) => Promise<void>): Promise<void> {
    // §COALESCE: always keep the latest config; older pending is discarded.
    this.state.pending = config

    if (this.state.inflight) {
      // §QUEUED: chain on the existing inflight. By the time it resolves, the
      // drain loop will have flushed the latest pending config.
      return this.state.inflight.then(
        () => {
          // Queue drained successfully. If a newer config replaced ours, ours
          // was coalesced away — which is correct.
        },
        (e) => {
          // Propagate rejection so this caller's .catch fires.
          throw e
        }
      )
    }

    // §START: no save in flight — start the drain loop.
    this.state.inflight = this.drain(executeSave)
    return this.state.inflight
  }

  /**
   * §DRAIN-LOOP: keep flushing the latest pending config until none remain.
   * On failure, clear the pending queue + inflight lock, then reject.
   */
  private async drain(executeSave: (config: T) => Promise<void>): Promise<void> {
    while (this.state.pending) {
      const configToSave = this.state.pending
      this.state.pending = null // clear before await so new pending can accumulate during the POST
      try {
        this.executeCount++
        this.savedConfigs.push(configToSave)
        await executeSave(configToSave)
      } catch (e) {
        // §STEP-3D: on failure, clear the pending queue (don't retry stale configs),
        // release the inflight lock, and reject so all chained callers' .catch fires.
        this.state.pending = null
        this.state.inflight = null
        throw e
      }
    }
    this.state.inflight = null
  }

  // §TEST-HELPERS: expose state for assertions
  get isInflight(): boolean {
    return this.state.inflight !== null
  }
  get hasPending(): boolean {
    return this.state.pending !== null
  }
  get pendingValue(): T | null {
    return this.state.pending
  }
  reset(): void {
    this.state = { inflight: null, pending: null }
    this.executeCount = 0
    this.savedConfigs = []
  }
}
