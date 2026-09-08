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
  toggleChannel: (key: keyof NotificationChannels) => void
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

      toggleChannel: (key) =>
        set((s) => ({
          channels: { ...s.channels, [key]: !s.channels[key] },
        })),
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
