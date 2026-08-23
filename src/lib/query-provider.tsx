'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

/**
 * §PERFORMANCE: TanStack Query provider.
 * Caches all API responses at the app-root level (above the view tree).
 * When a view unmounts and re-mounts (tab switch), it INSTANTLY shows
 * cached data (stale) while silently revalidating in the background.
 * This eliminates the full-page-reload UX and loading screens on back-nav.
 *
 * staleTime: 30s — data is considered fresh for 30s, so rapid back-forth
 *   navigation doesn't even trigger a refetch.
 * gcTime: 5min — cached data is kept for 5min after the last component
 *   using it unmounts, so returning to a view within 5min is instant.
 * refetchOnWindowFocus: false — avoids refetches when the user switches
 *   browser tabs (not needed for this app).
 *
 * §CACHE-SHARING: The QueryClient is exposed on `window.__queryClient` so
 * the AppShell bootstrap can pre-populate the cache (e.g. app-settings
 * fetched during bootstrap is shared with all `useFetch('/api/app-settings')`
 * consumers, eliminating duplicate requests).
 */
export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s fresh
            gcTime: 5 * 60_000, // 5min cache retention
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  )

  // Expose the client on window so the bootstrap effect can pre-populate cache.
  useEffect(() => {
    if (typeof window !== 'undefined') {
      ;(window as any).__queryClient = client
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete (window as any).__queryClient
      }
    }
  }, [client])

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
