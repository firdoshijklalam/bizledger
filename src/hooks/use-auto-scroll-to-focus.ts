'use client'

/**
 * §AUTO-SCROLL-TO-FOCUS: useAutoScrollToFocus
 *
 * When a user taps an input/textarea that is obscured by the virtual keyboard,
 * this hook automatically scrolls it into the center of the visible viewport
 * using `element.scrollIntoView({ behavior: 'smooth', block: 'center' })`.
 *
 * How it works:
 *   - Listens to global `focusin` events on the document.
 *   - When an input/textarea/contenteditable receives focus, waits a short
 *     delay (for the keyboard to open and the visualViewport to resize),
 *     then calls `scrollIntoView({ block: 'center' })`.
 *   - The delay is necessary because the keyboard opens asynchronously —
 *     if we scroll immediately, the visualViewport hasn't shrunk yet and
 *     we'd scroll to the wrong position.
 *   - Uses `block: 'center'` so the field sits in the middle of the visible
 *     area — above the keyboard but not at the very top edge.
 *
 * §SCROLL-CONTAINER-AWARE: The hook finds the nearest scrollable ancestor
 * of the focused element and scrolls THAT (not window). This is critical
 * for inputs inside scrollable dialogs (FormDialogContent) — scrolling
 * the window would do nothing because the dialog's content is the scroller.
 *
 * Called once at the app-shell level.
 */

import { useEffect } from 'react'

const TEXT_INPUT_TYPES = new Set([
  'text', 'email', 'tel', 'number', 'password', 'search', 'url', '',
  'date', 'datetime-local', 'month', 'time', 'week',
])

function isFocusableInput(el: Element | null): el is HTMLElement {
  if (!el) return false
  if (el.tagName === 'INPUT') {
    return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type.toLowerCase())
  }
  if (el.tagName === 'TEXTAREA') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

function findScrollableAncestor(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node && node !== document.body) {
    const style = getComputedStyle(node)
    const canScrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll')
      && node.scrollHeight > node.clientHeight
    if (canScrollY) return node
    node = node.parentElement
  }
  return null
}

export function useAutoScrollToFocus() {
  useEffect(() => {
    let scrollTimer: ReturnType<typeof setTimeout> | null = null
    let vvResizeTimer: ReturnType<typeof setTimeout> | null = null

    const scrollToCenter = (el: HTMLElement) => {
      // Find the nearest scrollable ancestor.
      const scroller = findScrollableAncestor(el)
      if (scroller) {
        // §SCROLL-CONTAINER: Scroll the dialog's content area.
        // Calculate the target scrollTop so the element is centered.
        const scrollerRect = scroller.getBoundingClientRect()
        const elRect = el.getBoundingClientRect()
        const elCenterInScroller = (elRect.top - scrollerRect.top) + (elRect.height / 2) + scroller.scrollTop
        const targetScrollTop = elCenterInScroller - (scroller.clientHeight / 2)
        scroller.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth',
        })
      } else {
        // §WINDOW: No scrollable ancestor — scroll the window.
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }

    const onFocusIn = (e: FocusEvent) => {
      const target = e.target as Element
      if (!isFocusableInput(target)) return

      // Clear any pending scroll from a previous focus.
      if (scrollTimer) clearTimeout(scrollTimer)
      if (vvResizeTimer) clearTimeout(vvResizeTimer)

      // §DELAY-1: Short delay so the focus event settles and the element's
      // position is stable (some inputs grow on focus, e.g. textarea).
      scrollTimer = setTimeout(() => {
        scrollToCenter(target as HTMLElement)
      }, 100)

      // §DELAY-2: After the keyboard opens (visualViewport resize), scroll
      // again. The keyboard opens asynchronously (~300ms on Android), and
      // the first scroll might land at the wrong position before the
      // visualViewport shrinks.
      const vv = window.visualViewport
      if (vv) {
        const onVVResize = () => {
          vvResizeTimer = setTimeout(() => {
            scrollToCenter(target as HTMLElement)
          }, 100)
          vv.removeEventListener('resize', onVVResize)
        }
        vv.addEventListener('resize', onVVResize)
        // Fallback: if visualViewport never fires (desktop), clean up.
        setTimeout(() => vv.removeEventListener('resize', onVVResize), 1000)
      }
    }

    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      if (scrollTimer) clearTimeout(scrollTimer)
      if (vvResizeTimer) clearTimeout(vvResizeTimer)
    }
  }, [])
}
