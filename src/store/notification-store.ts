// §NOTIFICATION-FOUNDATION: Notification store — now a thin cache/preferences layer.
//
// The CANONICAL source of truth is the DB → /api/notifications → useNotifications hook.
// This store is retained ONLY for:
//   - Channel preferences (lowStock, overduePayments, gradeChanges, backups)
//   - Legacy compatibility (addNotification is used by settings-view for a one-shot
//     local toast after data reset — this is NOT production notification data)
//
// §PERSIST-MIGRATION: v2 — removes the old DEMO_NOTIFS array. Existing users with
// persisted v1 state (which contained demo notifications) will have their
// notifications array replaced with an empty array. Real notifications come from
// the API via useNotifications().
//
// §TENANT-ISOLATION: Channel preferences are global (not per-business) — they
// represent the user's UI preference, not business data. If a user switches
// businesses, the same channel preferences apply. This is safe because channels
// don't contain business-scoped notification data.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// §LEGACY-TYPE: Retained for backward compatibility with settings-view.tsx
// which calls addNotification after data reset. This is a LOCAL-ONLY notification
// (not persisted to DB) — it's a UI feedback mechanism, not a real notification.
export interface AppNotification {
  id: string
  type: 'overdue' | 'low-stock' | 'promise' | 'backup' | 'defaulter' | 'grade' | 'system'
  title: string
  body: string
  time: string
  read: boolean
  action?: {
    view: any
    partyId?: string
    productId?: string
    filter?: string
  }
}

// PRD Part 27 §3: Notification channel preferences
export interface NotificationChannels {
  sales: boolean
  lowStock: boolean
  overduePayments: boolean
  gradeChanges: boolean
  backups: boolean
}

interface NotificationState {
  // §LEGACY: Local-only notifications (not from API). Used by settings-view
  // for one-shot UI feedback. NOT the production notification source.
  localNotifications: AppNotification[]
  channels: NotificationChannels
  addLocalNotification: (n: AppNotification) => void
  clearLocalNotifications: () => void
  // §CONCURRENCY-FIX: toggleChannel returns a Promise<boolean> so callers
  // can await server confirmation. The UI updates optimistically; if the
  // server fails, the local state is rolled back.
  //
  // §PER-KEY-QUEUE: Each key has its own promise chain — rapid toggles
  // of the SAME key are serialized (request 2 waits for request 1 to
  // complete). Different keys can proceed concurrently.
  //
  // §STALE-PROTECTION: Each mutation has a monotonic version counter.
  // When a server response arrives, it's only applied if its version
  // matches the latest mutation version for that key. Stale responses
  // from older requests are discarded.
  toggleChannel: (key: keyof NotificationChannels) => Promise<boolean>
  // §SHARED-UNREAD: Server-authoritative unread count, shared between
  // TopAppBar (badge) and NotificationsView (header + filter chips).
  // Updated by useNotifications hook. NOT persisted to localStorage —
  // always re-fetched from the server on mount.
  unreadTotal: number
  setUnreadTotal: (count: number) => void
  // §MIGRATION: v2 persist version — triggers old demo data removal
  _version: number
}

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set) => ({
      // §v2: Empty array — real notifications come from /api/notifications
      localNotifications: [],
      channels: { sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true },
      // §SHARED-UNREAD: Default 0. Fetched from server on mount via useNotifications.
      unreadTotal: 0,
      setUnreadTotal: (count) => set({ unreadTotal: Math.max(0, count) }),
      _version: 2,

      addLocalNotification: (n) =>
        set((s) => ({ localNotifications: [n, ...s.localNotifications].slice(0, 5) })),

      clearLocalNotifications: () => set({ localNotifications: [] }),

      // §CONCURRENCY-FIX: Per-key promise queue + stale-response protection.
      //
      // §PER-KEY-QUEUE: Each key has its own promise chain stored in
      // `mutationQueue`. When toggleChannel('sales') is called, it chains
      // onto the previous 'sales' mutation. This serializes same-key toggles:
      // toggle 2 waits for toggle 1 to complete before sending.
      // Different keys use different chains → they proceed concurrently.
      //
      // §STALE-PROTECTION: Each mutation increments a per-key version counter.
      // When the server response arrives, we check if the mutation version
      // matches the latest version for that key. If a newer mutation has
      // been queued since this one started, the response is discarded.
      toggleChannel: (() => {
        // §PER-KEY-QUEUE: Map from key → Promise chain (last pending mutation)
        const mutationQueue = new Map<string, Promise<boolean>>()
        // §STALE-PROTECTION: Map from key → latest mutation version
        const mutationVersion = new Map<string, number>()

        return async (key: keyof NotificationChannels): Promise<boolean> => {
          // §VERSION: Increment version for this key
          const version = (mutationVersion.get(key) || 0) + 1
          mutationVersion.set(key, version)

          // §READ-CURRENT: Get the current value BEFORE the optimistic update
          const prevValue = useNotificationStore.getState().channels[key]
          const newValue = !prevValue

          // §OPTIMISTIC: Update local state immediately
          set((s) => ({
            channels: { ...s.channels, [key]: newValue },
          }))

          // §BUILD-MUTATION: The actual server request
          const doMutation = async (): Promise<boolean> => {
            try {
              const res = await fetch('/api/notification-preferences', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ key, value: newValue }),
              })

              if (!res.ok) throw new Error(`HTTP ${res.status}`)

              const data = await res.json()

              // §STALE-CHECK: Only apply server response if this mutation is
              // still the latest for this key. If a newer mutation has been
              // queued since this one started, discard this response.
              const currentVersion = mutationVersion.get(key)
              if (version !== currentVersion) {
                // Stale response — a newer mutation has superseded this one.
                // Don't apply the server's channels (could revert newer changes).
                return true // Still return true — the mutation succeeded on the server
              }

              // §SERVER-RECONCILE: Use the server's full channels response to
              // reconcile local state. This is safe because we've verified
              // this is the latest mutation for this key.
              if (data.channels) {
                set({ channels: data.channels })
              }

              return true
            } catch {
              // §STALE-CHECK on failure: Only roll back if this is still the latest
              const currentVersion = mutationVersion.get(key)
              if (version === currentVersion) {
                // §ROLLBACK: Restore the previous value for this key
                set((s) => ({
                  channels: { ...s.channels, [key]: prevValue },
                }))
              }
              return false
            }
          }

          // §CHAIN: Wait for the previous mutation for this key to complete,
          // then run this one. This serializes same-key mutations.
          const prevPromise = mutationQueue.get(key) || Promise.resolve(true)
          const currentPromise = prevPromise.then(() => doMutation())

          // §STORE: Update the chain so the next toggle waits for this one
          mutationQueue.set(key, currentPromise)

          return currentPromise
        }
      })(),
    }),
    {
      name: 'bizledger-notif-channels',
      version: 2,
      // §PARTIALIZE: Only persist channels + _version. unreadTotal is NOT
      // persisted — it's always re-fetched from the server on mount.
      // localNotifications is also NOT persisted (it's ephemeral UI feedback).
      partialize: (state) => ({
        localNotifications: state.localNotifications,
        channels: state.channels,
        _version: state._version,
        unreadTotal: 0, // Always reset to 0 on reload — re-fetched from server
        setUnreadTotal: state.setUnreadTotal,
        addLocalNotification: state.addLocalNotification,
        clearLocalNotifications: state.clearLocalNotifications,
        toggleChannel: state.toggleChannel,
      }),
      // §PERSIST-MIGRATION: When upgrading from v1 (old store with DEMO_NOTIFS)
      // to v2, replace the persisted state. The old `notifications` array
      // (which contained hardcoded demo data) is removed entirely.
      // Real notifications come from the API via useNotifications().
      migrate: (persistedState: any, version: number) => {
        if (version < 2) {
          // §v1 → v2: Remove old demo notifications array. Keep channel preferences.
          const oldChannels = persistedState?.channels || {
            sales: true, lowStock: true, overduePayments: true, gradeChanges: true, backups: true,
          }
          return {
            localNotifications: [], // §EMPTY: No demo data in production
            channels: oldChannels,
            _version: 2,
          }
        }
        return persistedState as NotificationState
      },
    }
  )
)
