'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface VoiceSettingsState {
  globalVoiceEnabled: boolean
  tapToVoiceEnabled: boolean
  soundBoxEnabled: boolean
  setGlobalVoice: (enabled: boolean) => void
  setTapToVoice: (enabled: boolean) => void
  setSoundBoxEnabled: (enabled: boolean) => void
}

export const useVoiceSettings = create<VoiceSettingsState>()(
  persist(
    (set) => ({
      globalVoiceEnabled: true,
      tapToVoiceEnabled: true,
      soundBoxEnabled: true,
      setGlobalVoice: (enabled) => set({ globalVoiceEnabled: enabled }),
      setTapToVoice: (enabled) => set({ tapToVoiceEnabled: enabled }),
      setSoundBoxEnabled: (enabled) => set({ soundBoxEnabled: enabled }),
    }),
    { name: 'bizledger-voice-settings' }
  )
)
