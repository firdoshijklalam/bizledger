'use client'

import { useVoiceSettings } from '@/store/voice-settings-store'
import { useTapToVoice } from '@/hooks/use-tap-to-voice'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, X, CheckCircle2 } from 'lucide-react'
import { useRef, useState, useEffect, useCallback } from 'react'
import { toast } from 'sonner'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  inputClassName?: string
  type?: 'text' | 'number' | 'search'
  inputMode?: 'text' | 'numeric' | 'decimal'
  autoFocus?: boolean
  list?: string
  step?: string
}

/**
 * PRD Part 26 §2: Smart Input Field with single-tap voice / double-tap keyboard
 * - Single tap → voice listening animation + speech-to-text
 * - Double tap → native keyboard
 * - Respects voice settings from Settings panel
 */
export function SmartInput({
  value, onChange, placeholder, className = '', inputClassName = '',
  type = 'text', inputMode, autoFocus, list, step,
}: Props) {
  const { voiceEnabled, shouldUseVoice, startListening, stopListening, listening, transcript, interimTranscript, reset } = useTapToVoice()
  const inputRef = useRef<HTMLInputElement>(null)
  const tapCountRef = useRef(0)
  const tapTimerRef = useRef<NodeJS.Timeout | null>(null)
  const keyboardModeRef = useRef(false)
  const [showVoiceAnim, setShowVoiceAnim] = useState(false)

  // When transcript changes, update the input value
  const prevTranscript = useRef('')
  useEffect(() => {
    if (transcript && transcript !== prevTranscript.current) {
      prevTranscript.current = transcript
      onChange(transcript)
      setTimeout(() => setShowVoiceAnim(false), 0)
    }
  }, [transcript, onChange])

  // Show interim transcript live
  const displayValue = listening && interimTranscript ? interimTranscript : value

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    if (!shouldUseVoice()) {
      // Voice disabled — use normal keyboard
      keyboardModeRef.current = true
      return
    }

    tapCountRef.current += 1

    if (tapTimerRef.current) clearTimeout(tapTimerRef.current)

    if (tapCountRef.current === 1) {
      // Single tap — start voice, blur input to prevent keyboard
      e.target.blur()
      setShowVoiceAnim(true)
      startListening()
      // Wait for potential double tap
      tapTimerRef.current = setTimeout(() => {
        tapCountRef.current = 0
      }, 300)
    } else if (tapCountRef.current >= 2) {
      // Double tap — stop voice, open keyboard
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current)
      tapCountRef.current = 0
      stopListening()
      setShowVoiceAnim(false)
      keyboardModeRef.current = true
      // Refocus to open keyboard
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  const handleCloseVoice = () => {
    stopListening()
    setShowVoiceAnim(false)
    reset()
  }

  return (
    <>
      <div className={`relative ${className}`}>
        <input
          ref={inputRef}
          type={type}
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          onFocus={handleFocus}
          placeholder={placeholder}
          className={inputClassName}
          inputMode={inputMode}
          autoFocus={autoFocus}
          list={list}
          step={step}
        />
        {/* Voice listening indicator */}
        {listening && (
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <motion.span
              animate={{ scale: [1, 1.3, 1] }}
              transition={{ duration: 0.8, repeat: Infinity }}
              className="w-2 h-2 rounded-full bg-red-500"
            />
          </div>
        )}
      </div>

      {/* PRD Part 26 §2: Voice listening animation overlay */}
      <AnimatePresence>
        {showVoiceAnim && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={handleCloseVoice}
          >
            <motion.div
              initial={{ scale: 0.8, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.8, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-3xl p-8 w-full max-w-xs text-center"
            >
              {/* Mic animation */}
              <motion.div
                animate={{ scale: [1, 1.15, 1] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
                className="w-20 h-20 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4"
              >
                <div className="w-14 h-14 rounded-full bg-red-500/30 flex items-center justify-center">
                  <Mic className="w-7 h-7 text-red-500" />
                </div>
              </motion.div>

              {/* Pulsing rings */}
              <motion.div
                animate={{ scale: [1, 1.5], opacity: [0.5, 0] }}
                transition={{ duration: 1.5, repeat: Infinity, ease: 'easeOut' }}
                className="absolute w-20 h-20 rounded-full border-2 border-red-500/50 mx-auto"
                style={{ left: '50%', transform: 'translateX(-50%)', top: '32px' }}
              />

              <p className="text-sm font-semibold text-foreground mb-1">বলুন…</p>
              <p className="text-[10px] text-muted-foreground mb-3">Speak now (Double-tap for keyboard)</p>

              {/* Live transcript */}
              {interimTranscript && (
                <div className="p-2 rounded-xl bg-muted/50 mb-3">
                  <p className="text-xs text-foreground">{interimTranscript}</p>
                </div>
              )}

              <button
                onClick={handleCloseVoice}
                className="w-full h-10 rounded-xl bg-muted text-sm font-medium flex items-center justify-center gap-1.5"
              >
                <X className="w-3.5 h-3.5" /> বন্ধ করুন
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
