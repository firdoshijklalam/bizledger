'use client'

import { useCallback, useRef } from 'react'
import { useVoiceInputStore } from '@/store/voice-input-store'

/**
 * §3: useVoiceInput — a hook that any input can use to register itself with
 * the global mic. On focus, it sets the input's text-update callback in the
 * global store. On blur, it unregisters.
 *
 * CRITICAL: The callback is stored in a ref to prevent stale closures.
 * The ref is updated on every render with the latest setter function.
 * When the mic fires the callback, it reads from the store which holds
 * the ref's latest value.
 *
 * Usage:
 *   const voiceProps = useVoiceInput<HTMLInputElement>((text) => {
 *     setValue(text)
 *   })
 *   <input {...voiceProps} />
 */

export function useVoiceInput<T extends HTMLInputElement | HTMLTextAreaElement>(
  onVoiceText: (text: string) => void
) {
  const registerInput = useVoiceInputStore((s) => s.registerInput)
  const unregisterInput = useVoiceInputStore((s) => s.unregisterInput)

  // §3: Store the LATEST callback in a ref so it never goes stale.
  // The callback passed to useVoiceInput changes on every render (it's a new
  // arrow function), but the ref always points to the latest one.
  const callbackRef = useRef(onVoiceText)
  callbackRef.current = onVoiceText

  const handleFocus = useCallback((e: React.FocusEvent<T>) => {
    // §3: Register a STABLE wrapper function that reads from the ref.
    // This ensures the mic always calls the LATEST setter, not a stale one.
    const stableCallback = (text: string) => {
      callbackRef.current(text)
    }
    registerInput(stableCallback, e.target)
  }, [registerInput])

  const handleBlur = useCallback(() => {
    // Delay unregister to allow focus to transfer to mic or another input
    setTimeout(() => {
      const active = document.activeElement
      // §3: Don't unregister if focus moved to the mic button itself
      if (active && active.getAttribute('data-mic-button') === 'true') {
        return
      }
      if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
        unregisterInput()
      }
    }, 200)
  }, [unregisterInput])

  return {
    onFocus: handleFocus,
    onBlur: handleBlur,
  }
}
