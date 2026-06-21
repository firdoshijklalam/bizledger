'use client'

import { useEffect, useCallback, useRef } from 'react'

/**
 * Scroll Position Retention Engine (PRD Part 7 §3).
 * Saves scroll position before opening a modal/sub-view, restores it on close/back.
 * Prevents the screen from jumping to top when returning from a modal.
 */
export function useScrollRetention() {
  const scrollPos = useRef<number>(0)
  const scrollElement = useRef<HTMLElement | null>(null)

  // Save current scroll position
  const saveScroll = useCallback(() => {
    // Find the main scrollable container
    const main = document.querySelector('main')
    if (main) {
      scrollPos.current = main.scrollTop
      scrollElement.current = main
    } else {
      scrollPos.current = window.scrollY
    }
  }, [])

  // Restore scroll position
  const restoreScroll = useCallback(() => {
    requestAnimationFrame(() => {
      if (scrollElement.current) {
        scrollElement.current.scrollTop = scrollPos.current
      } else {
        window.scrollTo(0, scrollPos.current)
      }
    })
  }, [])

  return { saveScroll, restoreScroll }
}
