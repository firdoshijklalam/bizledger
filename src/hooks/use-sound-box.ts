'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { useVoiceSettings } from '@/store/voice-settings-store'
import { useI18n } from '@/store/i18n-store'

/**
 * PRD Part 37 — Sound Box: Payment Announcement Engine
 *
 * Uses the browser's built-in Web Speech API (speechSynthesis) to announce
 * payment amounts out loud — like Paytm/PhonePe sound box devices.
 *
 * Supports Bengali, English, and Hindi voices.
 * Respects the soundBoxEnabled toggle in voice settings.
 */

interface SpeakOptions {
  amount?: number
  currency?: string
  customerName?: string
  customText?: string
  lang?: string
}

export function useSoundBox() {
  const { soundBoxEnabled, setSoundBoxEnabled } = useVoiceSettings()
  const { language } = useI18n()
  const [speaking, setSpeaking] = useState(false)
  const [supported, setSupported] = useState(false)
  const voicesRef = useRef<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      // Use a flag ref instead of setState in effect to avoid cascading renders
      const synth = window.speechSynthesis
      const loadVoices = () => {
        voicesRef.current = synth.getVoices()
      }
      loadVoices()
      synth.onvoiceschanged = loadVoices
      // Mark as supported after first render cycle
      const timer = setTimeout(() => setSupported(true), 0)
      return () => {
        synth.onvoiceschanged = null
        clearTimeout(timer)
      }
    }
  }, [])

  const getLangCode = (lang: string): string => {
    switch (lang) {
      case 'bn': return 'bn-IN'
      case 'hi': return 'hi-IN'
      default: return 'en-IN'
    }
  }

  const buildAnnouncementText = (options: SpeakOptions): string => {
    const lang = options.lang || language
    const amount = options.amount || 0
    const formattedAmount = formatAmountSpeech(amount, lang)
    const customerPart = options.customerName ? ` ${options.customerName} থেকে` : ''

    if (options.customText) return options.customText

    switch (lang) {
      case 'bn':
        return `নিশ্চিত ভুক্তি। ${formattedAmount}${customerPart} প্রাপ্ত হয়েছে।`
      case 'hi':
        return `भुगतान प्राप्त। ${formattedAmount}${customerPart} प्राप्त हुए।`
      default:
        return `Payment received. ${formattedAmount}${customerPart} has been received.`
    }
  }

  const formatAmountSpeech = (amount: number, lang: string): string => {
    const rounded = Math.round(amount)
    if (lang === 'bn') {
      return `${numberToBengali(rounded)} টাকা`
    } else if (lang === 'hi') {
      return `${rounded} रुपये`
    }
    return `${rounded} rupees`
  }

  const numberToBengali = (num: number): string => {
    const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']
    return String(num).replace(/\d/g, (d) => bengaliDigits[parseInt(d)])
  }

  const speak = useCallback((options: SpeakOptions) => {
    if (!soundBoxEnabled) return
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    // Build announcement text inline (avoids dependency issues)
    const lang = options.lang || language
    const amount = options.amount || 0
    const rounded = Math.round(amount)
    const bengaliDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯']
    const bengaliAmount = String(rounded).replace(/\d/g, (d) => bengaliDigits[parseInt(d)])
    const customerPart = options.customerName ? ` ${options.customerName} থেকে` : ''
    const text = options.customText || (
      lang === 'bn' ? `নিশ্চিত ভুক্তি। ${bengaliAmount} টাকা${customerPart} প্রাপ্ত হয়েছে।` :
      lang === 'hi' ? `भुगतान प्राप्त। ${rounded} रुपये${customerPart} प्राप्त हुए।` :
      `Payment received. ${rounded} rupees${customerPart} has been received.`
    )
    const langCode = lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-IN'

    const utterance = new SpeechSynthesisUtterance(text)
    utterance.lang = langCode
    utterance.rate = 0.9
    utterance.pitch = 1.0
    utterance.volume = 1.0

    // Try to find a voice matching the language
    const voice = voicesRef.current.find(
      (v) => v.lang === langCode || v.lang.startsWith(langCode.split('-')[0])
    )
    if (voice) utterance.voice = voice

    utterance.onstart = () => setSpeaking(true)
    utterance.onend = () => setSpeaking(false)
    utterance.onerror = () => setSpeaking(false)

    window.speechSynthesis.speak(utterance)
  }, [soundBoxEnabled, language])

  const stop = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel()
      setSpeaking(false)
    }
  }, [])

  const test = useCallback(() => {
    speak({ amount: 500, customerName: 'রাজু' })
  }, [speak])

  return {
    speak,
    stop,
    test,
    speaking,
    supported,
    soundBoxEnabled,
    setSoundBoxEnabled,
  }
}
