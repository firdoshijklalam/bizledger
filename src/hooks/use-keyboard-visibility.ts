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

    const onFocusIn = (e: FocusEvent) => {
      // Cancel any pending hide (focus moved directly from one input to another)
      if (focusOutTimer) {
        clearTimeout(focusOutTimer)
        focusOutTimer = null
      }
      const target = e.target as Element
      if (isTextInput(target)) {
        setKeyboardActive(true)
        // §GLOBAL-BINDING: Update the active input ref to the newly focused input.
        // If it's a DIFFERENT input than what was previously registered, clear
        // any stale callback from the previous input.
        // (useVoiceInput's handleFocus will run AFTER this — React synthetic
        // events fire after DOM events — and will set the callback for inputs
        // that use the hook.)
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
      // (e.g., from an input to the mic button, or from input A to input B).
      if (focusOutTimer) clearTimeout(focusOutTimer)
      focusOutTimer = setTimeout(() => {
        const active = document.activeElement
        // §MIC-BUTTON: Don't hide if focus moved to the mic button itself
        // (the user tapped the mic to start voice input).
        if (active && active.getAttribute('data-mic-button') === 'true') return
        // §ANOTHER-INPUT: Don't hide if focus moved to another text input.
        if (isTextInput(active)) return
        // Focus is now on body / non-text element → keyboard is closed.
        setKeyboardActive(false)
        // Clear the active input ref + any stale callback.
        useVoiceInputStore.setState({
          activeInputCallback: null,
          activeInputRef: { current: null },
        })
      }, 150)
    }

    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)

    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
      if (focusOutTimer) clearTimeout(focusOutTimer)
    }
  }, [setKeyboardActive])
}
