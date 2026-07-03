'use client'
import { create } from 'zustand'

interface ScrollState {
  positions: Record<string, number>
  save: (view: string) => void
  restore: (view: string) => void
  clear: (view: string) => void
}

function getScrollTop(): number {
  if (typeof window === 'undefined') return 0
  if (window.scrollY > 0) return window.scrollY
  if (window.pageYOffset > 0) return window.pageYOffset
  if (typeof document !== 'undefined') {
    if (document.documentElement.scrollTop > 0) return document.documentElement.scrollTop
    if (document.body.scrollTop > 0) return document.body.scrollTop
  }
  return 0
}

function setScrollTop(pos: number) {
  if (typeof window === 'undefined') return
  // PRD Part 38 §2: instant scroll to saved position — no smooth animation
  window.scrollTo({ top: pos, behavior: 'instant' as ScrollBehavior })
  // Force set on document elements too (some browsers need this)
  if (document.documentElement) document.documentElement.scrollTop = pos
  if (document.body) document.body.scrollTop = pos
}

export const useScrollStore = create<ScrollState>((set, get) => ({
  positions: {},
  save: (view: string) => {
    const pos = getScrollTop()
    if (pos > 0) {
      set((state) => ({ positions: { ...state.positions, [view]: pos } }))
      // Also save to sessionStorage as backup
      try {
        sessionStorage.setItem(`scroll-${view}`, String(pos))
      } catch {}
    }
  },
  restore: (view: string) => {
    let pos = get().positions[view]
    // Fallback to sessionStorage
    if (pos === undefined) {
      try {
        const stored = sessionStorage.getItem(`scroll-${view}`)
        if (stored) pos = Number(stored)
      } catch {}
    }
    if (pos === undefined || pos <= 0) return

    // PRD Part 38 §2: Multiple restore attempts to beat React's async rendering
    const restore = () => setScrollTop(pos)

    // Immediate
    restore()
    // After paint
    requestAnimationFrame(() => {
      restore()
      requestAnimationFrame(() => {
        restore()
        // After DOM settles
        setTimeout(restore, 50)
        setTimeout(restore, 100)
        setTimeout(restore, 200)
        setTimeout(restore, 300)
      })
    })
  },
  clear: (view: string) => {
    set((state) => {
      const newPositions = { ...state.positions }
      delete newPositions[view]
      return { positions: newPositions }
    })
    try {
      sessionStorage.removeItem(`scroll-${view}`)
    } catch {}
  },
}))
