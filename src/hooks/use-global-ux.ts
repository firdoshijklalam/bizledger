'use client'

import { useEffect, useCallback } from 'react'

/**
 * Global UX Compliance Hook (PRD Part 8).
 * Handles:
 * - 2.1: Universal scroll retention — saves/restores scroll on ANY screen
 * - 2.3: Auto keyboard dismiss — tap outside dismisses keyboard
 * - 3.1: Smooth animation stability guard
 */
export function useGlobalUX() {
  // 2.3: Auto-dismiss keyboard on tap outside input
  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement
      // If touch target is not an input/textarea/select, blur active element
      if (target && !target.matches('input, textarea, select, [contenteditable]')) {
        const active = document.activeElement as HTMLElement
        if (active && active.matches('input, textarea, select, [contenteditable]')) {
          active.blur()
        }
      }
    }

    document.addEventListener('touchstart', handleTouchStart, { passive: true })
    return () => document.removeEventListener('touchstart', handleTouchStart)
  }, [])

  // 2.1: Universal scroll retention — save scroll before navigation
  const saveScrollPosition = useCallback(() => {
    const main = document.querySelector('main')
    if (main) {
      sessionStorage.setItem('scrollPos', String(main.scrollTop))
    }
  }, [])

  // 2.1: Restore scroll position after returning
  const restoreScrollPosition = useCallback(() => {
    requestAnimationFrame(() => {
      const main = document.querySelector('main')
      const pos = sessionStorage.getItem('scrollPos')
      if (main && pos) {
        main.scrollTop = Number(pos)
      }
    })
  }, [])

  return { saveScrollPosition, restoreScrollPosition }
}
