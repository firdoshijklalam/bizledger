'use client'

/**
 * §NOTIFICATION-FOUNDATION: API-backed notification hook (FIXED).
 *
 * Fixes applied:
 *   1. Initial unreadTotal fetch uses useEffect (not render-time conditional)
 *   2. unreadTotal is shared via Zustand store (not local useState)
 *   3. Query keys match useFetch's actual key pattern
 *   4. markRead only decrements if the notification is actually unread
 *
 * §DATA-FLOW:
 *   DB Notification → /api/notifications → useNotifications hook
 *     → items (via useFetch/TanStack Query cache)
 *     → unreadTotal (via Zustand shared store — NOT local useState)
 *     → TopAppBar badge + NotificationsView header
 *
 * §SHARED-UNREAD: unreadTotal lives in useNotificationStore (Zustand), NOT
 * local useState. This ensures TopAppBar and NotificationsView always see
 * the same value. When markRead/markAllRead update the store, both consumers
 * re-render immediately.
 *
 * §QUERY-KEY: useFetch builds keys as [url, refreshKey, timeoutMs, ...deps].
 * We match this pattern for setQueryData/getQueryData so optimistic updates
 * target the correct cache entry.
 */

import { useFetch } from '@/hooks/use-fetch'
import { useQueryClient } from '@tanstack/react-query'
import { useNotificationStore } from '@/store/notification-store'
import { useAppStore } from '@/store/app-store'
import { useCallback, useRef } from 'react'

// §DB-NOTIFICATION: The shape returned by the API (matches Prisma model).
export interface DbNotification {
  id: string
  businessId: string
  type: string
  title: string
  body: string
  link: string | null
  isRead: boolean
  createdAt: string
}

// §API-RESPONSE: Full response shape from GET /api/notifications.
interface NotificationListResponse {
  items: DbNotification[]
  total: number
  hasMore: boolean
  unreadTotal: number
}

// §POST-RESPONSE: Response from markRead / markAllRead.
interface MarkReadResponse {
  ok: boolean
  unreadTotal: number
}

// §NOTIFICATION-ITEMS-URL: The canonical URL for fetching notification items.
// This MUST match the URL passed to useFetch below so query keys align.
const NOTIFICATIONS_URL = '/api/notifications?limit=50'

export function useNotifications() {
  const queryClient = useQueryClient()
  const { refreshKey } = useAppStore()

  // §SHARED-UNREAD: Read/write the unread count from the SHARED Zustand store.
  // This is the single source of truth for the badge — TopAppBar and
  // NotificationsView both see the same value. The initial fetch is done
  // in app-shell.tsx on mount, so the badge is populated before the user
  // opens NotificationsView.
  const unreadTotal = useNotificationStore((s) => s.unreadTotal)
  const setUnreadTotal = useNotificationStore((s) => s.setUnreadTotal)

  // §ITEMS: useFetch auto-extracts .items from the paginated response.
  // The query key is [url, refreshKey, timeoutMs, ...deps] = [url, refreshKey, 10000].
  const { data: items, loading, error, refetch } = useFetch<DbNotification[]>(NOTIFICATIONS_URL, [])

  // §QUERY-KEY: Match useFetch's key pattern so setQueryData targets the
  // correct cache entry. useFetch builds: [url, refreshKey, timeoutMs, ...deps].
  // deps = [] (our useFetch call passes []), timeoutMs = 10000 (default).
  const itemsQueryKey = [NOTIFICATIONS_URL, refreshKey, 10000]

  // §FETCH-UNREAD: Re-fetch the full API response to get unreadTotal.
  // Used after markRead/markAllRead failures to restore the correct count.
  // The INITIAL fetch is done in app-shell.tsx — this is only for refetch.
  const fetchUnread = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=1')
      if (!res.ok) return
      const data: NotificationListResponse = await res.json()
      setUnreadTotal(data.unreadTotal ?? 0)
    } catch {
      // Non-fatal — keep the last known value
    }
  }, [setUnreadTotal])

  // §MARK-READ: Optimistically mark a single notification as read.
  // POST { id } to /api/notifications. On success, update unreadTotal from
  // the server response. On failure, rollback the optimistic update.
  const markRead = useCallback(async (id: string): Promise<boolean> => {
    // §FIX-4: Only decrement if the notification is ACTUALLY unread.
    // The old code always decremented, even for already-read notifications.
    const prevData = queryClient.getQueryData<DbNotification[]>(itemsQueryKey)
    const targetNotif = prevData?.find((n) => n.id === id)
    const wasUnread = targetNotif ? !targetNotif.isRead : false

    // §OPTIMISTIC: Update items cache
    if (prevData) {
      const updated = prevData.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      queryClient.setQueryData(itemsQueryKey, updated)
    }

    // §OPTIMISTIC-UNREAD: Only decrement if the notification was actually unread
    if (wasUnread) {
      setUnreadTotal(unreadTotal - 1)
    }

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarkReadResponse = await res.json()
      // §SERVER-AUTHORITATIVE: Use the server's unreadTotal, not our optimistic value.
      setUnreadTotal(data.unreadTotal ?? 0)
      return true
    } catch {
      // §ROLLBACK: Restore the previous items + unread count.
      if (prevData) queryClient.setQueryData(itemsQueryKey, prevData)
      if (wasUnread) {
        // Re-fetch to get the correct count (server is authoritative)
        fetchUnread()
      }
      return false
    }
  }, [queryClient, itemsQueryKey, setUnreadTotal, unreadTotal, fetchUnread])

  // §MARK-ALL-READ: Optimistically mark all as read.
  // POST { all: true } to /api/notifications. Double-click protection via ref.
  const markingAllRef = useRef(false)
  const markAllRead = useCallback(async (): Promise<boolean> => {
    if (markingAllRef.current) return false // §DOUBLE-CLICK-PROTECTION
    markingAllRef.current = true

    const prevData = queryClient.getQueryData<DbNotification[]>(itemsQueryKey)
    if (prevData) {
      const updated = prevData.map((n) => ({ ...n, isRead: true }))
      queryClient.setQueryData(itemsQueryKey, updated)
    }
    // §OPTIMISTIC: Set shared unread to 0
    setUnreadTotal(0)

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarkReadResponse = await res.json()
      // §SERVER-AUTHORITATIVE: Use the server's unreadTotal (should be 0)
      setUnreadTotal(data.unreadTotal ?? 0)
      // §CACHE-INVALIDATE: Invalidate items so next mount refetches fresh data
      queryClient.invalidateQueries({ queryKey: itemsQueryKey })
      return true
    } catch {
      // §ROLLBACK
      if (prevData) queryClient.setQueryData(itemsQueryKey, prevData)
      fetchUnread()
      return false
    } finally {
      markingAllRef.current = false
    }
  }, [queryClient, itemsQueryKey, setUnreadTotal, fetchUnread])

  // §DISMISS: Permanently delete a notification via DELETE /api/notifications.
  // §SWIPE-TO-DISMISS: Used by the swipe-to-dismiss UX.
  // Optimistically removes the notification from the items cache + decrements
  // unreadTotal if the notification was unread. On failure, restores.
  // Double-click protection via ref.
  const dismissingRef = useRef<Set<string>>(new Set())
  const dismiss = useCallback(async (id: string): Promise<boolean> => {
    if (dismissingRef.current.has(id)) return false // §DOUBLE-CLICK-PROTECTION
    dismissingRef.current.add(id)

    const prevData = queryClient.getQueryData<DbNotification[]>(itemsQueryKey)
    const targetNotif = prevData?.find((n) => n.id === id)
    const wasUnread = targetNotif ? !targetNotif.isRead : false

    // §OPTIMISTIC: Remove from items cache
    if (prevData) {
      const updated = prevData.filter((n) => n.id !== id)
      queryClient.setQueryData(itemsQueryKey, updated)
    }

    // §OPTIMISTIC-UNREAD: Only decrement if the notification was actually unread
    if (wasUnread) {
      setUnreadTotal(unreadTotal - 1)
    }

    try {
      const res = await fetch('/api/notifications', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarkReadResponse = await res.json()
      // §SERVER-AUTHORITATIVE: Use the server's unreadTotal
      setUnreadTotal(data.unreadTotal ?? 0)
      return true
    } catch {
      // §ROLLBACK: Restore the previous items + unread count.
      if (prevData) queryClient.setQueryData(itemsQueryKey, prevData)
      if (wasUnread) {
        fetchUnread()
      }
      return false
    } finally {
      dismissingRef.current.delete(id)
    }
  }, [queryClient, itemsQueryKey, setUnreadTotal, unreadTotal, fetchUnread])

  // §REFETCH: Refetch both items and unread count.
  const refetchAll = useCallback(async () => {
    await Promise.all([refetch(), fetchUnread()])
  }, [refetch, fetchUnread])

  return {
    items: items ?? [],
    loading,
    error,
    unreadTotal,
    markRead,
    markAllRead,
    dismiss,
    refetch: refetchAll,
  }
}
