'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
