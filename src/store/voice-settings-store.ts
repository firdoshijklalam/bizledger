'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VoiceSettingsState {
  globalVoiceEnabled: boolean
  tapToVoiceEnabled: boolean
  setGlobalVoice: (enabled: boolean) => void
  setTapToVoice: (enabled: boolean) => void
}

export const useVoiceSettings = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      globalVoiceEnabled: true,
      tapToVoiceEnabled: true,
      setGlobalVoice: (enabled) => set({ globalVoiceEnabled: enabled }),
      setTapToVoice: (enabled) => set({ tapToVoiceEnabled: enabled }),
    }),
    { name: 'bizledger-voice-settings' }
  )
)
