'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAppStore } from '@/store/app-store'
import { useCallback } from 'react'

/**
 * §PERFORMANCE: TanStack Query-backed fetch hook.
 *
 * Replaces the old useState+useEffect approach with TanStack Query, which
 * caches responses at the app-root level (above the view tree). Benefits:
 *   - Stale-While-Revalidate: returning to a view shows cached data
 *     INSTANTLY (no loading screen) while revalidating in the background.
 *   - No re-fetch on rapid back-forth navigation (30s staleTime).
 *   - Cache survives view unmount (5min gcTime).
 *
 * API is unchanged from the old useFetch: returns { data, loading, error,
 * refetch, setData }. All existing components work without modification.
 *
 * §TIMEOUT:
 *   - Default timeout is 10s (sufficient for most CRUD API calls).
 *   - Callers that need a longer timeout (e.g. /api/reports which may take
 *     10-30s for large datasets) can pass `{ timeoutMs: 30000 }` as the
 *     third argument.
 *   - When the timeout fires, the AbortController aborts the fetch. TanStack
 *     Query catches the abort and sets `error` — the UI must check `error`
 *     BEFORE checking `loading || !data` to avoid getting stuck on
 *     "Loading…" forever.
 *   - AbortError is converted to a user-friendly message so the ErrorState
 *     UI shows "Request timed out" instead of a cryptic abort message.
 */
export interface UseFetchOptions {
  /** Timeout in milliseconds for the fetch request. Default: 10000 (10s). */
  timeoutMs?: number
}

export function useFetch<T>(url: string | null, deps: any[] = [], options?: UseFetchOptions) {
  const { refreshKey } = useAppStore()
  const queryClient = useQueryClient()

  // Build a stable query key: url + refreshKey + deps + timeoutMs
  // (timeoutMs is included so different timeouts create separate cache entries)
  const timeoutMs = options?.timeoutMs ?? 10000
  const queryKey = [url, refreshKey, timeoutMs, ...deps]

  const query = useQuery<T>({
    queryKey,
    queryFn: async () => {
      if (!url) return null as T
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      try {
        const res = await fetch(url, { signal: controller.signal })
        clearTimeout(timeout)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        let json: any
        try {
          json = await res.json()
        } catch {
          throw new Error('Invalid response from server')
        }
        // Extract paginated responses; single objects pass through
        let extracted: any
        if (Array.isArray(json)) {
          extracted = json
        } else if (json && typeof json === 'object' && 'items' in json && ('total' in json || 'hasMore' in json)) {
          extracted = json.items
        } else {
          extracted = json
        }
        // Scrub null/empty items so one bad row doesn't blank the list
        if (Array.isArray(extracted)) {
          extracted = extracted.filter((item, idx) => {
            if (item == null || (typeof item === 'object' && Object.keys(item).length === 0)) {
              console.warn(`[useFetch] Dropping empty/null item at index ${idx} from ${url}`)
              return false
            }
            return true
          })
        }
        return extracted as T
      } catch (e: any) {
        clearTimeout(timeout)
        // §ABORT-FRIENDLY: Convert AbortError to a user-friendly message so the
        // UI can display "Request timed out" instead of a cryptic error.
        if (e?.name === 'AbortError') {
          throw new Error('Request timed out. The server took too long to respond. Please try again.')
        }
        throw e
      }
    },
    enabled: !!url,
    // Don't show loading on refetch if we have cached data (stale-while-revalidate)
    placeholderData: (prev) => prev,
    // §RETRY: Disable TanStack Query's built-in retries for timed-out requests
    // — the user should see the error immediately and click "Retry" manually.
    // For other errors (HTTP 500, network failure), 1 retry is reasonable.
    retry: (failureCount, error: any) => {
      // Don't retry AbortError (timeout) — user should retry manually
      if (error?.message?.includes('timed out')) return false
      // Don't retry HTTP 4xx errors (client errors are not transient)
      if (error?.message?.includes('HTTP 4')) return false
      // Retry once for other errors (network blips, 5xx)
      return failureCount < 1
    },
  })

  const refetch = useCallback(async () => {
    await query.refetch()
  }, [query])

  // setData: imperatively update the cached data (for optimistic updates)
  const setData = useCallback(
    (updater: T | ((prev: T | null) => T)) => {
      queryClient.setQueryData<T>(queryKey, (prev) =>
        typeof updater === 'function' ? (updater as (prev: T | null) => T)(prev ?? null) : updater,
      )
    },
    [queryClient, queryKey],
  )

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.error ? (query.error instanceof Error ? query.error.message : String(query.error)) : null,
    refetch,
    setData,
  }
}

export async function apiPost(url: string, body: any) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function apiPut(url: string, body: any) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

export async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE' })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}
