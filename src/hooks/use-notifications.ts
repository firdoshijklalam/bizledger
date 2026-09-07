'use client'

/**
 * §NOTIFICATION-FOUNDATION: API-backed notification hook.
 *
 * This hook is the single entry point for notification data in the frontend.
 * It fetches from GET /api/notifications, manages the server-authoritative
 * unread count, and provides markRead / markAllRead mutations that POST
 * back to the server.
 *
 * §DATA-FLOW:
 *   DB Notification → /api/notifications → this hook → NotificationsView + badge
 *
 * §UNREAD-COUNT: The unreadTotal comes from the SERVER (not calculated locally).
 * This prevents the badge from showing a wrong count when pagination hasn't
 * loaded all items. The POST markRead/markAllRead response also includes the
 * updated unreadTotal so the badge updates immediately without a refetch.
 *
 * §OPTIMISTIC-UPDATES: markRead/markAllRead update the local items array
 * optimistically. If the POST fails, the items are rolled back to their
 * previous state.
 *
 * §TENANT-ISOLATION: The API is scoped via getCurrentBusiness() on the server.
 * The frontend never passes a businessId — the server derives it from the
 * session. This prevents cross-tenant notification leakage.
 */

import { useFetch } from '@/hooks/use-fetch'
import { useQueryClient } from '@tanstack/react-query'
import { useState, useCallback, useRef } from 'react'

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
// useFetch auto-extracts .items, so we fetch the full response separately
// to get unreadTotal.
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

export function useNotifications() {
  const queryClient = useQueryClient()
  const queryKey = ['/api/notifications']

  // §ITEMS: useFetch auto-extracts .items from the paginated response.
  const { data: items, loading, error, refetch } = useFetch<DbNotification[]>('/api/notifications?limit=50', [])

  // §UNREAD-TOTAL: Fetched separately because useFetch strips the wrapper.
  // We use a direct fetch + state to get the full response including unreadTotal.
  const [unreadTotal, setUnreadTotal] = useState<number>(0)
  const [unreadLoading, setUnreadLoading] = useState(true)
  const [unreadError, setUnreadError] = useState<string | null>(null)
  const fetchedUnreadRef = useRef(false)

  // §FETCH-UNREAD: Fetch the full API response to get unreadTotal.
  // This runs once on mount. Subsequent updates come from POST responses.
  const fetchUnread = useCallback(async () => {
    try {
      setUnreadLoading(true)
      setUnreadError(null)
      const res = await fetch('/api/notifications?limit=1')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: NotificationListResponse = await res.json()
      setUnreadTotal(data.unreadTotal ?? 0)
    } catch (e: any) {
      setUnreadError(e?.message || 'Failed to fetch unread count')
      // Don't reset unreadTotal to 0 on error — keep the last known value
    } finally {
      setUnreadLoading(false)
      fetchedUnreadRef.current = true
    }
  }, [])

  // §INITIAL-FETCH: Fetch unreadTotal on mount (once).
  // We use a ref to prevent duplicate fetches in React Strict Mode.
  if (!fetchedUnreadRef.current && !unreadLoading && !unreadError) {
    fetchUnread()
  }

  // §MARK-READ: Optimistically mark a single notification as read.
  // POST { id } to /api/notifications. On success, update unreadTotal from
  // the server response. On failure, rollback the optimistic update.
  const markRead = useCallback(async (id: string): Promise<boolean> => {
    // §OPTIMISTIC: Find the notification and mark it read locally.
    // We use queryClient.setQueryData to update the cached items.
    const queryKeyStr = JSON.stringify(queryKey)
    const prevData = queryClient.getQueryData<DbNotification[]>(queryKey)

    if (prevData) {
      const updated = prevData.map((n) => (n.id === id ? { ...n, isRead: true } : n))
      queryClient.setQueryData(queryKey, updated)
    }

    // §OPTIMISTIC-UNREAD: Decrement locally (will be corrected by server response)
    setUnreadTotal((prev) => Math.max(0, prev - 1))

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarkReadResponse = await res.json()
      // §SERVER-AUTHORITATIVE: Use the server's unreadTotal, not our optimistic decrement.
      setUnreadTotal(data.unreadTotal ?? 0)
      return true
    } catch {
      // §ROLLBACK: Restore the previous items + unread count.
      if (prevData) queryClient.setQueryData(queryKey, prevData)
      // Refetch unread to get the correct count
      fetchUnread()
      return false
    }
  }, [queryClient, fetchUnread])

  // §MARK-ALL-READ: Optimistically mark all as read.
  // POST { all: true } to /api/notifications. Double-click protection via
  // a ref that prevents concurrent calls.
  const markingAllRef = useRef(false)
  const markAllRead = useCallback(async (): Promise<boolean> => {
    if (markingAllRef.current) return false // §DOUBLE-CLICK-PROTECTION
    markingAllRef.current = true

    const prevData = queryClient.getQueryData<DbNotification[]>(queryKey)
    if (prevData) {
      const updated = prevData.map((n) => ({ ...n, isRead: true }))
      queryClient.setQueryData(queryKey, updated)
    }
    setUnreadTotal(0) // §OPTIMISTIC

    try {
      const res = await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: MarkReadResponse = await res.json()
      setUnreadTotal(data.unreadTotal ?? 0)
      // §CACHE-INVALIDATE: Invalidate so next mount refetches fresh data
      queryClient.invalidateQueries({ queryKey })
      return true
    } catch {
      // §ROLLBACK
      if (prevData) queryClient.setQueryData(queryKey, prevData)
      fetchUnread()
      return false
    } finally {
      markingAllRef.current = false
    }
  }, [queryClient, queryKey, fetchUnread])

  // §REFETCH: Refetch both items and unread count.
  const refetchAll = useCallback(async () => {
    await Promise.all([refetch(), fetchUnread()])
  }, [refetch, fetchUnread])

  return {
    items: items ?? [],
    loading,
    error,
    unreadTotal,
    unreadLoading,
    unreadError,
    markRead,
    markAllRead,
    refetch: refetchAll,
  }
}
