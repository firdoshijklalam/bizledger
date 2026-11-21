'use client'

/**
 * §QUICK-ACTIONS-CONFIG-HOOK: Shared hook for reading + saving the Quick Actions
 * dashboard configuration. Used by both:
 *   - DashboardView (renders the Quick Actions section card)
 *   - SideDrawerFab (renders the floating Quick Actions menu)
 *
 * §PERSISTENCE: Uses the EXISTING /api/app-settings + /api/card-customization
 * infrastructure. No parallel persistence mechanism. The config is stored in
 * AppSettings.dashboardSections (JSON string) and parsed via
 * parseDashboardSectionConfig.
 *
 * §CACHE-SHARING: Both consumers use the SAME TanStack Query cache key
 * ['/api/app-settings'], so when one consumer saves, the other sees the
 * updated config automatically (via invalidateQueries).
 */

import { useFetch } from '@/hooks/use-fetch'
import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useRef } from 'react'
import {
  parseDashboardSectionConfig,
  type DashboardSectionConfig,
} from '@/lib/dashboard-preferences'
import { SaveQueue } from '@/lib/dashboard-save-queue'

interface AppSettingsResponse {
  dashboardSections?: string | null
}

/**
 * Read the dashboard section config from /api/app-settings + provide a
 * save function that POSTs to /api/card-customization.
 *
 * Returns:
 *   - config: the parsed DashboardSectionConfig (or DEFAULT if loading/missing)
 *   - loading: true while the initial fetch is in flight
 *   - saveConfig: (newConfig) => Promise<void> — persists via POST + reconciles
 *   - refresh: () => void — refetch from server
 */
export function useQuickActionsConfig() {
  const queryClient = useQueryClient()
  const { data: raw, loading, refetch } = useFetch<AppSettingsResponse>('/api/app-settings', [])
  const saveQueueRef = useRef<SaveQueue<DashboardSectionConfig> | null>(null)
  if (saveQueueRef.current == null) {
    saveQueueRef.current = new SaveQueue<DashboardSectionConfig>()
  }

  // §PARSE: Defensive parse — falls back to DEFAULT_DASHBOARD_CONFIG if the
  // raw value is missing/invalid. Same parser the dashboard uses.
  const config = parseDashboardSectionConfig(raw?.dashboardSections)

  // §SAVE: Single-flight save executor. POSTs to /api/card-customization,
  // reconciles from the server response, invalidates the /api/app-settings
  // cache so all consumers (dashboard + FAB) see the updated config.
  const executeSave = useCallback(async (newConfig: DashboardSectionConfig): Promise<void> => {
    const res = await fetch('/api/card-customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboardSections: JSON.stringify(newConfig) }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
    // §CACHE-INVALIDATE: The POST response includes the full AppSettings row.
    // Invalidate the /api/app-settings cache so the next read fetches fresh
    // server state. Both dashboard-view + SideDrawerFab use the same cache key.
    queryClient.invalidateQueries({ queryKey: ['/api/app-settings'] })
  }, [queryClient])

  const saveConfig = useCallback((newConfig: DashboardSectionConfig): Promise<void> => {
    return saveQueueRef.current!.enqueue(newConfig, executeSave)
  }, [executeSave, saveQueueRef])

  return { config, loading, saveConfig, refresh: refetch }
}
