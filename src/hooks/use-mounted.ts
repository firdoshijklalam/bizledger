'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/** Returns false during SSR/first render, true after hydration on the client. */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false // server snapshot
  )
}
