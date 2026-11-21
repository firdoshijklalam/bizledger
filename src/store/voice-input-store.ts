'use client'

import { create } from 'zustand'

/**
 * Global Voice Input Store
 *
 * §3: Universal Active Input Context — the global mic needs to know WHICH text
 * field to send transcribed text to. Any input that wants voice support registers
 * its text-update callback via useVoiceInputStore().registerInput() on focus,
 * and unregisters on blur.
 *
 * §GLOBAL-KEYBOARD-SYNC: keyboardActive is now managed by a GLOBAL focusin/
 * focusout listener (useKeyboardVisibility hook) — NOT by registerInput/
 * unregisterInput. This ensures the mic appears for ANY text input/textarea
 * that receives focus, even those that don't use the useVoiceInput hook.
 * registerInput/unregisterInput only manage the callback + element ref.
 */

interface VoiceInputState {
  // The callback the mic fires with transcribed text (for React state integration)
  activeInputCallback: ((text: string) => void) | null
  // A ref to the actual DOM input element (for focus restoration + native injection)
  activeInputRef: { current: HTMLInputElement | HTMLTextAreaElement | null }
  // Whether keyboard is visible (mic shows only when true).
  // §GLOBAL-KEYBOARD-SYNC: Set by useKeyboardVisibility hook, NOT by register/unregister.
  keyboardActive: boolean
  // Register an input's callback (called on input focus).
  // §NOTE: Does NOT set keyboardActive — that's handled by the global focus listener.
  registerInput: (callback: (text: string) => void, inputEl: HTMLInputElement | HTMLTextAreaElement) => void
  // Unregister (called on input blur).
  // §NOTE: Does NOT clear keyboardActive — that's handled by the global focus listener.
  unregisterInput: () => void
  // Set keyboard active state (called by useKeyboardVisibility hook)
  setKeyboardActive: (active: boolean) => void
}

export const useVoiceInputStore = create<VoiceInputState>((set) => ({
  activeInputCallback: null,
  activeInputRef: { current: null },
  keyboardActive: false,

  registerInput: (callback, inputEl) => {
    set({
      activeInputCallback: callback,
      activeInputRef: { current: inputEl },
    })
  },

  unregisterInput: () => {
    set({
      activeInputCallback: null,
      activeInputRef: { current: null },
    })
  },

  setKeyboardActive: (active) => set({ keyboardActive: active }),
}))
