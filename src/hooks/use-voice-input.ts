'use client'

import { useCallback, useRef, useEffect } from 'react'
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
  const callbackRef = useRef(onVoiceText)
  useEffect(() => { callbackRef.current = onVoiceText }, [onVoiceText])

  // §FIX: Track the blur timeout so we can clean it up on unmount.
  const blurTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleFocus = useCallback((e: React.FocusEvent<T>) => {
    // Clear any pending blur timeout (e.g., rapid focus transfer)
    if (blurTimerRef.current) {
      clearTimeout(blurTimerRef.current)
      blurTimerRef.current = null
    }
    const stableCallback = (text: string) => {
      callbackRef.current(text)
    }
    registerInput(stableCallback, e.target)
  }, [registerInput])

  const handleBlur = useCallback(() => {
    // Delay unregister to allow focus to transfer to mic or another input
    if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    blurTimerRef.current = setTimeout(() => {
      blurTimerRef.current = null
      const active = document.activeElement
      // Don't unregister if focus moved to the mic button itself
      if (active && active.getAttribute('data-mic-button') === 'true') {
        return
      }
      if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
        unregisterInput()
      }
    }, 200)
  }, [unregisterInput])

  // §FIX: Clean up the blur timeout on unmount
  useEffect(() => {
    return () => {
      if (blurTimerRef.current) clearTimeout(blurTimerRef.current)
    }
  }, [])

  return {
    onFocus: handleFocus,
    onBlur: handleBlur,
  }
}
