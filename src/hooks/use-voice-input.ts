'use client'

import { useCallback } from 'react'
import { useVoiceInputStore } from '@/store/voice-input-store'

/**
 * §3: useVoiceInput — a hook that any input can use to register itself with
 * the global mic. On focus, it sets the input's text-update callback in the
 * global store. On blur, it unregisters.
 *
 * Usage:
 *   const voiceProps = useVoiceInput<HTMLInputElement>((text) => {
 *     // Update your input value here
 *     setValue(text)
 *   })
 *   <input {...voiceProps} />
 *
 * The hook returns onFocus and onBlur props that should be spread onto the input.
 */

export function useVoiceInput<T extends HTMLInputElement | HTMLTextAreaElement>(
  onVoiceText: (text: string) => void
) {
  const registerInput = useVoiceInputStore((s) => s.registerInput)
  const unregisterInput = useVoiceInputStore((s) => s.unregisterInput)

  const handleFocus = useCallback((e: React.FocusEvent<T>) => {
    registerInput(onVoiceText, e.target)
  }, [onVoiceText, registerInput])

  const handleBlur = useCallback(() => {
    // Delay unregister to allow focus to transfer to mic or another input
    setTimeout(() => {
      const active = document.activeElement
      if (!active || (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA')) {
        unregisterInput()
      }
    }, 150)
  }, [unregisterInput])

  return {
    onFocus: handleFocus,
    onBlur: handleBlur,
  }
}
