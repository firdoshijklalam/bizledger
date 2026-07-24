'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §FIX: Uses `bottom` instead of `top` for positioning. This is the KEY fix:
 * on mobile, when the keyboard opens, the visualViewport shrinks from the
 * bottom. `position: fixed; top: X` is relative to the viewport top — but
 * `position: fixed; bottom: X` is relative to the viewport bottom, which
 * automatically adjusts when the keyboard pushes the viewport up.
 *
 * The mic stays at `bottom: KEYBOARD_GAP` from the visible bottom edge —
 * always floating above the keyboard, never moving on scroll.
 */

import { motion, useAnimationControls } from 'framer-motion'
import { Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { useVoiceInputStore } from '@/store/voice-input-store'
import { useI18n } from '@/store/i18n-store'

const MIC_SIZE = 52
const EDGE_MARGIN = 12
const KEYBOARD_GAP = 20

export function FloatingKeyboardMic() {
  const { keyboardActive, activeInputRef, unregisterInput } = useVoiceInputStore()
  const { language } = useI18n()
  const languageRef = useRef(language)
  useEffect(() => { languageRef.current = language }, [language])

  // §FIX: Only track left/right position. Vertical position is ALWAYS
  // `bottom: KEYBOARD_GAP` — handled by CSS, not JS. This means the mic
  // stays fixed above the keyboard regardless of scroll, viewport changes,
  // or any other dynamic factor.
  const [posX, setPosX] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      const s = localStorage.getItem('bizledger-mic-x')
      if (s) {
        const x = parseInt(s, 10)
        if (x >= 0 && x <= window.innerWidth - MIC_SIZE) return x
      }
    } catch {}
    return window.innerWidth - MIC_SIZE - EDGE_MARGIN
  })
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startPosX: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setListening(false)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('ভয়েস ইনপুট এই ব্রাউজারে সাপোর্ট করে না')
      return
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }

    const currentCallback = useVoiceInputStore.getState().activeInputCallback
    if (!currentCallback) {
      toast.error('কোনো ইনপুট ফিল্ড নির্বাচিত নয়')
      return
    }

    const recognition = new SpeechRecognition()
    const lang = languageRef.current
    recognition.lang = lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-US'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const cb = useVoiceInputStore.getState().activeInputCallback
      if (cb) {
        cb(transcript)
        toast.success(`"${transcript.substring(0, 30)}" ইনজেক্ট হয়েছে`)
      } else {
        const activeEl = useVoiceInputStore.getState().activeInputRef.current
        if (activeEl) {
          const nativeSetter = Object.getOwnPropertyDescriptor(
            activeEl.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype,
            'value'
          )?.set
          if (nativeSetter) {
            nativeSetter.call(activeEl, transcript)
            activeEl.dispatchEvent(new Event('input', { bubbles: true }))
            toast.success(`"${transcript.substring(0, 30)}" ইনজেক্ট হয়েছে`)
          }
        }
      }
    }
    recognition.onerror = (e: any) => {
      toast.error('ভয়েস ব্যর্থ: ' + (e.error || 'unknown'))
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
      const el = useVoiceInputStore.getState().activeInputRef.current
      if (el) setTimeout(() => el.focus(), 100)
    }
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    toast.info(lang === 'bn' ? 'বলুন...' : lang === 'hi' ? 'बोलिए...' : 'Speak...', { duration: 1500 })
  }, [])

  const handleToggleMic = useCallback(() => {
    if (listening) stopListening()
    else startListening()
  }, [listening, startListening, stopListening])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startPosX = posX; ds.moved = false; ds.dragging = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX
      if (!ds.moved && Math.abs(dx) > 6) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
        setPosX(Math.max(0, Math.min(window.innerWidth - MIC_SIZE, ds.startPosX + dx)))
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) {
        // Snap to nearest edge
        setPosX((cur) => {
          const cx = cur + MIC_SIZE / 2
          const snapped = cx < window.innerWidth / 2 ? EDGE_MARGIN : window.innerWidth - MIC_SIZE - EDGE_MARGIN
          try { localStorage.setItem('bizledger-mic-x', String(snapped)) } catch {}
          return snapped
        })
        setIsDragging(false)
      } else if (!ds.moved) {
        handleToggleMic()
      }
      ds.dragging = false; ds.moved = false
      const el = useVoiceInputStore.getState().activeInputRef.current
      if (el) setTimeout(() => el.focus(), 50)
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [posX, handleToggleMic])

  // Animations
  useEffect(() => {
    if (listening) {
      micControls.start({ scale: [1, 1.15, 1], transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' } })
    } else if (keyboardActive) {
      micControls.start({ scale: [1, 1.1, 1], transition: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' } })
    } else {
      micControls.start({ scale: 1, transition: { duration: 0.2 } })
    }
  }, [listening, keyboardActive, micControls])

  if (!keyboardActive || typeof document === 'undefined') return null

  // §CRITICAL-FIX: Use `bottom` instead of `top` for vertical positioning.
  // `bottom: KEYBOARD_GAP` means the mic sits KEYBOARD_GAP pixels above the
  // bottom of the viewport. When the keyboard opens, the viewport shrinks
  // from the bottom, so `bottom` automatically keeps the mic above the keyboard.
  //
  // `top` was the problem: it's relative to the top of the viewport, and
  // `visualViewport.height` changes during scroll, causing the mic to jump.
  // `bottom` is stable — it doesn't change during scroll.
  //
  // createPortal to document.body ensures no ancestor transform/will-change
  // breaks position:fixed.
  return createPortal(
    <div
      key="floating-keyboard-mic-wrapper"
      style={{
        position: 'fixed',
        left: `${posX}px`,
        bottom: `${KEYBOARD_GAP}px`,
        width: MIC_SIZE,
        height: MIC_SIZE,
        zIndex: 9999,
        pointerEvents: 'auto',
      }}
    >
      <motion.div
        key="floating-keyboard-mic"
        initial={{ opacity: 0, scale: 0.3 }}
        animate={{ opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 300, damping: 18, mass: 0.8 } }}
        className="select-none"
        style={{ width: MIC_SIZE, height: MIC_SIZE, position: 'relative' }}
      >
        {!listening && (
          <>
            <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'var(--primary)' }} animate={{ scale: [1, 1.5], opacity: [0.6, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }} />
            <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'var(--primary)' }} animate={{ scale: [1, 1.5], opacity: [0.4, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.7 }} />
          </>
        )}
        {listening && (
          <>
            <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'rgb(239 68 68)' }} animate={{ scale: [1, 1.8], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />
            <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'rgb(239 68 68)' }} animate={{ scale: [1, 1.8], opacity: [0.3, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.4 }} />
          </>
        )}

        <motion.button
          onPointerDown={handlePointerDown}
          tabIndex={-1}
          onMouseDown={(e) => e.preventDefault()}
          data-mic-button="true"
          animate={micControls}
          whileTap={{ scale: 0.9 }}
          className={`absolute inset-0 flex items-center justify-center rounded-full text-white shadow-xl border-2 backdrop-blur-xl ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${listening ? 'border-red-300' : 'border-white/30'}`}
          style={{ backgroundColor: listening ? 'rgb(239 68 68)' : 'color-mix(in oklch, var(--primary) 70%, transparent)', touchAction: 'none' }}
          aria-label={listening ? 'Stop voice input' : 'Start voice input (draggable)'}
        >
          {listening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
        </motion.button>

        {!listening && (
          <button
            onClick={(e) => { e.stopPropagation(); unregisterInput(); }}
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            data-mic-button="true"
            className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md z-10"
            aria-label="Hide microphone"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </motion.div>
    </div>,
    document.body
  )
}
