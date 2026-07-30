'use client'

/**
 * §GLOBAL-KEYBOARD-SYNC: useKeyboardVisibility
 *
 * STRICT mic & keyboard visibility sync — the floating mic icon's visibility
 * mirrors the virtual keyboard's visibility:
 *   - When ANY text input/textarea receives focus → keyboard OPEN → SHOW mic.
 *   - When all inputs lose focus → keyboard CLOSED → HIDE mic completely.
 *
 * §GLOBAL-BINDING: Also tracks the currently focused input element in the
 * voice-input store's activeInputRef. This ensures the mic knows WHICH input
 * to inject text into, even for inputs that don't use the useVoiceInput hook.
 * When focus moves to a different input, any stale callback from a previous
 * input is cleared (the mic checks registeredEl === targetEl before calling
 * the callback, so a stale callback is never called for the wrong input).
 *
 * Implementation: listens to global `focusin` and `focusout` events on the
 * document. This catches ALL inputs — even those that don't use the
 * useVoiceInput hook (e.g., native HTML inputs, third-party components).
 *
 * Called once at the app-shell level.
 */

import { useEffect } from 'react'
import { useVoiceInputStore } from '@/store/voice-input-store'

// Input types that trigger the soft keyboard on mobile.
// Excludes: button, checkbox, radio, submit, reset, image, file, hidden, range, color.
const TEXT_INPUT_TYPES = new Set([
  'text', 'email', 'tel', 'number', 'password', 'search', 'url', '', 'date', 'datetime-local', 'month', 'time', 'week',
])

function isTextInput(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement {
  if (!el) return false
  if (el.tagName === 'TEXTAREA') return true
  if (el.tagName === 'INPUT') {
    return TEXT_INPUT_TYPES.has((el as HTMLInputElement).type.toLowerCase())
  }
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function useKeyboardVisibility() {
  const setKeyboardActive = useVoiceInputStore((s) => s.setKeyboardActive)

  useEffect(() => {
    let focusOutTimer: ReturnType<typeof setTimeout> | null = null
    // §VIEWPORT-RESIZE: Track the previous visualViewport height to detect
    // keyboard open/close. When the keyboard opens, vv.height shrinks.
    // When it closes (even without a focusout event — e.g., user dismisses
    // via system gesture), vv.height grows back. We detect this growth
    // and hide the mic.
    let prevVvHeight = window.visualViewport?.height ?? window.innerHeight
    let keyboardWasOpen = false

    const onFocusIn = (e: FocusEvent) => {
      // Cancel any pending hide (focus moved directly from one input to another)
      if (focusOutTimer) {
        clearTimeout(focusOutTimer)
        focusOutTimer = null
      }
      const target = e.target as Element
      if (isTextInput(target)) {
        setKeyboardActive(true)
        keyboardWasOpen = true
        // §GLOBAL-BINDING: Update the active input ref to the newly focused input.
        const store = useVoiceInputStore.getState()
        const targetEl = target as HTMLInputElement | HTMLTextAreaElement
        if (store.activeInputRef.current !== targetEl) {
          useVoiceInputStore.setState({
            activeInputCallback: null,
            activeInputRef: { current: targetEl },
          })
        } else if (!store.activeInputRef.current) {
          useVoiceInputStore.setState({
            activeInputRef: { current: targetEl },
          })
        }
      }
    }

    const onFocusOut = () => {
      // Delay the check to allow focus to transfer to the next element
      if (focusOutTimer) clearTimeout(focusOutTimer)
      focusOutTimer = setTimeout(() => {
        const active = document.activeElement
        if (active && active.getAttribute('data-mic-button') === 'true') return
        if (isTextInput(active)) return
        // Focus is now on body / non-text element → keyboard is closed.
        setKeyboardActive(false)
        keyboardWasOpen = false
        useVoiceInputStore.setState({
          activeInputCallback: null,
          activeInputRef: { current: null },
        })
      }, 150)
    }

    // §VIEWPORT-RESIZE: Detect keyboard close via visualViewport.
    // On mobile, when the user dismisses the keyboard via system gesture
    // (swipe down, back button), the visualViewport resizes (grows) but
    // no focusout event fires. This listener catches that case.
    const onVVResize = () => {
      const vv = window.visualViewport
      if (!vv) return
      const currentHeight = vv.height
      // If the viewport GREW significantly (>100px) and we had the keyboard
      // open, the keyboard just closed → hide the mic.
      if (keyboardWasOpen && currentHeight > prevVvHeight + 100) {
        // Verify no text input is still focused (user might have switched apps)
        const active = document.activeElement
        if (!isTextInput(active)) {
          setKeyboardActive(false)
          keyboardWasOpen = false
          useVoiceInputStore.setState({
            activeInputCallback: null,
            activeInputRef: { current: null },
          })
        }
      }
      // If the viewport SHRANK significantly, the keyboard opened
      if (currentHeight < prevVvHeight - 100) {
        keyboardWasOpen = true
      }
      prevVvHeight = currentHeight
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    window.visualViewport?.addEventListener('resize', onVVResize)

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      window.visualViewport?.removeEventListener('resize', onVVResize)
      if (focusOutTimer) clearTimeout(focusOutTimer)
    }
  }, [setKeyboardActive])
}
