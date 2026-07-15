'use client'

import { useEffect, useState, useCallback } from 'react'
import { useAppStore } from '@/store/app-store'

/**
 * Defensive fetch hook with 10s timeout, JSON parse isolation, and per-item
 * error scrubbing so a single corrupt row can't blank the entire list.
 *
 * - Network errors / timeouts → sets `error` (UI shows retry, not blank)
 * - JSON parse errors → caught, sets `error`
 * - Individual corrupt items in an array → filtered out with console.warn,
 *   so the rest of the list still renders (one bad row ≠ empty screen)
 * - If API returns { items, total, hasMore }, extracts `items`
 */
export function useFetch<T>(url: string | null, deps: any[] = []) {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(!!url)
  const [error, setError] = useState<string | null>(null)
  const { refreshKey } = useAppStore()

  const refetch = useCallback(async () => {
    if (!url) return
    setLoading(true)
    setError(null)
    try {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      const res = await fetch(url, { signal: controller.signal })
      clearTimeout(timeout)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      // §1: JSON parse isolation — a malformed body shouldn't crash the UI
      let json: any
      try {
        json = await res.json()
      } catch (parseErr) {
        throw new Error('Invalid response from server')
      }
      // §4: Backward compat — if API returns { items, total, hasMore }, extract items.
      // CRITICAL: Only extract if it's a paginated response (has total/hasMore).
      // Single-object responses (like /api/invoices/[id]) have an 'items' field
      // (invoice line items) — we must NOT extract that, we need the whole object.
      let extracted: any
      if (Array.isArray(json)) {
        extracted = json
      } else if (json && typeof json === 'object' && 'items' in json && ('total' in json || 'hasMore' in json)) {
        // Paginated list response: { items: [...], total: N, hasMore: bool }
        extracted = json.items
      } else {
        // Single object response (e.g., invoice detail with its own items array)
        extracted = json
      }
      // §2: Per-item error scrubbing — filter out corrupt rows so one bad item
      // doesn't blank the entire list. Only applies to arrays.
      if (Array.isArray(extracted)) {
        extracted = extracted.filter((item, idx) => {
          if (item == null || (typeof item === 'object' && Object.keys(item).length === 0)) {
            console.warn(`[useFetch] Dropping empty/null item at index ${idx} from ${url}`)
            return false
          }
          return true
        })
      }
      setData(extracted as T)
      setError(null)
    } catch (e: any) {
      const msg = e?.name === 'AbortError' ? 'Request timeout' : (e?.message || String(e))
      setError(msg)
      // §3: Keep previous data on refetch error so screen doesn't blank —
      // only clear data if this is the first load (data was null)
    } finally {
      setLoading(false)
    }
  }, [url])

  useEffect(() => {
    refetch()
  }, [url, refreshKey, ...deps])

  return { data, loading, error, refetch, setData }
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
