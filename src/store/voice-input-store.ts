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
 * §2: Keyboard sync — keyboardActive tracks whether the soft keyboard is visible.
 * The mic shows ONLY when keyboardActive is true.
 */

interface VoiceInputState {
  // The callback the mic fires with transcribed text
  activeInputCallback: ((text: string) => void) | null
  // A ref to the actual DOM input element (for focus restoration)
  activeInputRef: { current: HTMLInputElement | HTMLTextAreaElement | null }
  // Whether keyboard is visible (mic shows only when true)
  keyboardActive: boolean
  // Register an input's callback (called on input focus)
  registerInput: (callback: (text: string) => void, inputEl: HTMLInputElement | HTMLTextAreaElement) => void
  // Unregister (called on input blur)
  unregisterInput: () => void
  // Set keyboard active state
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
      keyboardActive: true,
    })
  },

  unregisterInput: () => {
    set({
      activeInputCallback: null,
      activeInputRef: { current: null },
      keyboardActive: false,
    })
  },

  setKeyboardActive: (active) => set({ keyboardActive: active }),
}))
