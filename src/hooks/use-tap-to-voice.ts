'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useVoiceSettings } from '@/store/voice-settings-store'
import { toast } from 'sonner'

interface TapToVoiceResult {
  transcript: string
  interimTranscript: string
  listening: boolean
  error: string | null
}

/**
 * PRD Part 26 §2: Hybrid Input Hook
 * - Single tap on input → voice listening starts
 * - Double tap → keyboard (native input focus, no voice)
 * - Respects voice settings (globalVoiceEnabled + tapToVoiceEnabled)
 */
export function useTapToVoice() {
  const { globalVoiceEnabled, tapToVoiceEnabled } = useVoiceSettings()
  const [state, setState] = useState<TapToVoiceResult>({
    transcript: '',
    interimTranscript: '',
    listening: false,
    error: null,
  })
  const recognitionRef = useRef<any>(null)
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null)

  const isSupported = typeof window !== 'undefined' &&
    (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window))

  const startListening = useCallback(() => {
    if (!isSupported) return
    if (!globalVoiceEnabled || !tapToVoiceEnabled) return

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) return

    // Stop existing
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'bn-BD'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let interim = ''
      let final = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript
        if (event.results[i].isFinal) {
          final += transcript
        } else {
          interim += transcript
        }
      }
      setState((prev) => ({
        ...prev,
        transcript: final || prev.transcript,
        interimTranscript: interim,
      }))
    }

    recognition.onerror = (event: any) => {
      setState((prev) => ({ ...prev, error: event.error, listening: false }))
    }

    recognition.onend = () => {
      setState((prev) => ({ ...prev, listening: false }))
    }

    recognitionRef.current = recognition
    recognition.start()
    setState((prev) => ({ ...prev, listening: true, error: null, transcript: '', interimTranscript: '' }))
  }, [isSupported, globalVoiceEnabled, tapToVoiceEnabled])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
    }
    setState((prev) => ({ ...prev, listening: false }))
  }, [])

  const reset = useCallback(() => {
    setState({ transcript: '', interimTranscript: '', listening: false, error: null })
  }, [])

  /**
   * PRD Part 26 §2: Handle input tap — single tap = voice, double tap = keyboard
   * Returns 'voice' if voice should start, 'keyboard' if native keyboard should open
   */
  const handleInputTap = useCallback((): 'voice' | 'keyboard' | 'none' => {
    // If voice settings are off, always use keyboard
    if (!globalVoiceEnabled || !tapToVoiceEnabled) return 'keyboard'
    if (!isSupported) return 'keyboard'

    tapCountRef.current += 1

    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)

    if (tapCountRef.current === 1) {
      // Single tap — wait to see if double tap follows
      return new Promise<'voice' | 'keyboard'>((resolve) => {
        tapTimerRef.current = setTimeout(() => {
          // Single tap confirmed — start voice
          tapCountRef.current = 0
          resolve('voice')
        }, 280)
      }) as any // Will be resolved by the timer
    } else if (tapCountRef.current >= 2) {
      // Double tap — use keyboard
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
      tapCountRef.current = 0
      return 'keyboard'
    }
    return 'none'
  }, [isSupported, globalVoiceEnabled, tapToVoiceEnabled])

  /**
   * Simplified version: returns true if voice should be used (single tap)
   * The caller manages the tap counting
   */
  const shouldUseVoice = useCallback(() => {
    return globalVoiceEnabled && tapToVoiceEnabled && isSupported
  }, [isSupported, globalVoiceEnabled, tapToVoiceEnabled])

  // Cleanup
  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch {}
      }
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
    }
  }, [])

  return {
    ...state,
    isSupported,
    startListening,
    stopListening,
    reset,
    shouldUseVoice,
    voiceEnabled: globalVoiceEnabled && tapToVoiceEnabled,
  }
}
