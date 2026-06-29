'use client'
import { create } from 'zustand'
interface ScrollState {
  positions: Record<string, number>
  save: (view: string) => void
  restore: (view: string) => void
  clear: (view: string) => void
}
function getScrollTop(): number {
  if (typeof window !== 'undefined') {
    if (window.scrollY > 0) return window.scrollY
    if (window.pageYOffset > 0) return window.pageYOffset
  }
  if (typeof document !== 'undefined') {
    if (document.documentElement.scrollTop > 0) return document.documentElement.scrollTop
    if (document.body.scrollTop > 0) return document.body.scrollTop
  }
  return 0
}
function setScrollTop(pos: number) {
  if (typeof window === 'undefined') return
  window.scrollTo({ top: pos, behavior: 'instant' as ScrollBehavior })
  if (document.documentElement) document.documentElement.scrollTop = pos
  if (document.body) document.body.scrollTop = pos
}
export const useScrollStore = create<ScrollState>((set, get) => ({
  positions: {},
  save: (view: string) => {
    const pos = getScrollTop()
    set((state) => ({ positions: { ...state.positions, [view]: pos } }))
  },
  restore: (view: string) => {
    const pos = get().positions[view]
    if (pos === undefined) return
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        setTimeout(() => {
          setScrollTop(pos)
          setTimeout(() => setScrollTop(pos), 150)
          setTimeout(() => setScrollTop(pos), 300)
        }, 50)
      })
    })
  },
  clear: (view: string) => {
    set((state) => {
      const newPositions = { ...state.positions }
      delete newPositions[view]
      return { positions: newPositions }
    })
  },
}))
