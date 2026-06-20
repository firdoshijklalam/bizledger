'use client'

import { useRef, useState, useCallback, useEffect } from 'react'
import { useI18n } from '@/store/i18n-store'
import { parseVoiceEntities, type ParsedVoiceEntities } from '@/lib/voice-parser'
import { toast } from 'sonner'

// Web Speech API type declarations (minimal)
interface SpeechRecognitionResult {
  0: { transcript: string }
  isFinal: boolean
}
interface SpeechRecognitionEvent {
  results: { length: number; [index: number]: SpeechRecognitionResult }
}
interface SpeechRecognitionInstance {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: SpeechRecognitionEvent) => void) | null
  onerror: ((e: any) => void) | null
  onend: (() => void) | null
}

export function useVoiceInput() {
  const { language } = useI18n()
  const [listening, setListening] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [parsed, setParsed] = useState<ParsedVoiceEntities | null>(null)
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null)

  const isSupported = typeof window !== 'undefined' &&
    (('SpeechRecognition' in window) || ('webkitSpeechRecognition' in window))

  const start = useCallback(() => {
    if (!isSupported) {
      toast.error('Voice input not supported in this browser')
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const recognition = new SR() as SpeechRecognitionInstance
    recognition.lang = language === 'bn' ? 'bn-BD' : 'en-IN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (e: SpeechRecognitionEvent) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript
      }
      setTranscript(text)
      // Parse on final result
      const lastResult = e.results[e.results.length - 1]
      if (lastResult?.isFinal) {
        const entities = parseVoiceEntities(text)
        setParsed(entities)
        toast.success(`Heard: "${text.substring(0, 40)}${text.length > 40 ? '…' : ''}"`)
      }
    }

    recognition.onerror = (e: any) => {
      toast.error('Voice error: ' + (e.error || 'unknown'))
      setListening(false)
    }

    recognition.onend = () => {
      setListening(false)
    }

    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    setTranscript('')
    setParsed(null)
    toast.info(language === 'bn' ? 'বলুন… (Speak now)' : 'Speak now…')
  }, [isSupported, language])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  const reset = useCallback(() => {
    setTranscript('')
    setParsed(null)
  }, [])

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort()
    }
  }, [])

  return { listening, transcript, parsed, start, stop, reset, isSupported }
}
