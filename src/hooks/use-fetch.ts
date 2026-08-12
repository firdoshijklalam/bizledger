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
 * Also preserves the old hook's defensive features:
 *   - 10s timeout via AbortController
 *   - JSON parse isolation
 *   - Paginated response extraction ({ items, total, hasMore } → items)
 *   - Per-item null/empty scrubbing
 */
export function useFetch<T>(url: string | null, deps: any[] = []) {
  const { refreshKey } = useAppStore()
  const queryClient = useQueryClient()

  // Build a stable query key: url + refreshKey + deps
  const queryKey = [url, refreshKey, ...deps]

  const query = useQuery<T>({
    queryKey,
    queryFn: async () => {
      if (!url) return null as T
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
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
        throw e
      }
    },
    enabled: !!url,
    // Don't show loading on refetch if we have cached data (stale-while-revalidate)
    placeholderData: (prev) => prev,
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
