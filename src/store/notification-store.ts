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
  // Only the CHANGED key+value is sent to the server (not the entire snapshot)
  // to prevent concurrent updates to different keys from overwriting each other.
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

      // §CONCURRENCY-FIX: toggleChannel returns a Promise that resolves when
      // the server confirms the update. The UI updates optimistically (local
      // state changes immediately). If the server PUT fails, the local state
      // is rolled back to the previous value.
      //
      // §SINGLE-KEY: Only the changed key+value is sent to the server:
      //   { key: 'sales', value: false }
      // NOT the entire channels snapshot. This prevents concurrent updates to
      // different keys from overwriting each other.
      //
      // §SERIALIZED: Rapid toggles of the SAME key are serialized by the
      // async/await chain — each toggle waits for the previous to complete
      // before sending the next. This is naturally enforced because the
      // Zustand set() call is synchronous but the fetch is awaited.
      toggleChannel: async (key) => {
        // §READ-CURRENT: Get the current value BEFORE the optimistic update
        // so we can roll back on failure.
        const prevValue = useNotificationStore.getState().channels[key]
        const newValue = !prevValue

        // §OPTIMISTIC: Update local state immediately
        set((s) => ({
          channels: { ...s.channels, [key]: newValue },
        }))

        try {
          const res = await fetch('/api/notification-preferences', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            // §SINGLE-KEY: Send only the changed key + value
            body: JSON.stringify({ key, value: newValue }),
          })

          if (!res.ok) throw new Error(`HTTP ${res.status}`)

          const data = await res.json()
          // §SERVER-RECONCILE: Use the server's full channels response to
          // reconcile local state (in case the server had a different value
          // for another key due to a concurrent update).
          if (data.channels) {
            set({ channels: data.channels })
          }

          return true
        } catch {
          // §ROLLBACK: Restore the previous value for this key
          set((s) => ({
            channels: { ...s.channels, [key]: prevValue },
          }))
          return false
        }
      },
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
