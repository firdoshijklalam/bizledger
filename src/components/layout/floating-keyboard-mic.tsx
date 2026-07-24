'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §FIX (scroll + drag):
 * 1. SCROLL: Render via createPortal to document.body with position:fixed.
 *    NO ancestor transform/will-change/backdrop-filter can break it.
 *    NO visualViewport listeners — the mic's position is pure CSS + user drag.
 * 2. DRAG: Full 2D drag (X AND Y). User can drag the mic anywhere on screen.
 *    Position saved to localStorage. Snap-to-edge on release (horizontal only,
 *    vertical stays where dropped).
 * 3. KEYBOARD: When keyboard opens, the mic adjusts its Y position to stay
 *    above the keyboard using visualViewport — but ONLY once when keyboard
 *    opens, NOT on every scroll event.
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
const TOP_LIMIT = 60
const BOTTOM_LIMIT = 80

interface MicPos { x: number; y: number }

function getDefaultPos(): MicPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return {
    x: window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    y: window.innerHeight - MIC_SIZE - BOTTOM_LIMIT,
  }
}

function loadPos(): MicPos {
  if (typeof window === 'undefined') return getDefaultPos()
  try {
    const s = localStorage.getItem('bizledger-mic-pos-2d')
    if (s) {
      const p = JSON.parse(s)
      if (p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) return p
    }
  } catch {}
  return getDefaultPos()
}

function savePos(p: MicPos) {
  try { localStorage.setItem('bizledger-mic-pos-2d', JSON.stringify(p)) } catch {}
}

export function FloatingKeyboardMic() {
  const { keyboardActive, activeInputRef, unregisterInput } = useVoiceInputStore()
  const { language } = useI18n()
  const languageRef = useRef(language)
  useEffect(() => { languageRef.current = language }, [language])

  // §FIX: Full 2D position (X AND Y) — user can drag anywhere
  const [pos, setPos] = useState<MicPos>(loadPos)
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()

  // §FIX: When keyboard opens, push mic UP if it would be hidden by keyboard.
  // Only fires ONCE on keyboard open (keyboardActive goes false→true), NOT on scroll.
  const prevKbActive = useRef(false)
  useEffect(() => {
    if (keyboardActive && !prevKbActive.current) {
      // Keyboard just opened — adjust Y if mic is in the bottom half
      const vv = window.visualViewport
      if (vv) {
        const visibleBottom = vv.height
        const t = setTimeout(() => {
          setPos((p) => {
            if (p.y + MIC_SIZE > visibleBottom - 20) {
              const newY = Math.max(TOP_LIMIT, visibleBottom - MIC_SIZE - 20)
              return { ...p, y: newY }
            }
            return p
          })
        }, 0)
        return () => clearTimeout(t)
      }
    }
    prevKbActive.current = keyboardActive
  }, [keyboardActive])

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

  // §FIX: Full 2D drag — X AND Y
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const ds = dragRef.current
    ds.startX = e.clientX
    ds.startY = e.clientY
    ds.startPosX = pos.x
    ds.startPosY = pos.y
    ds.moved = false
    ds.dragging = false

    const vv = window.visualViewport
    const maxX = window.innerWidth - MIC_SIZE
    const maxY = (vv?.height ?? window.innerHeight) - MIC_SIZE - 10

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX
      const dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > 6 || Math.abs(dy) > 6)) {
        ds.moved = true
        ds.dragging = true
        setIsDragging(true)
      }
      if (ds.dragging) {
        setPos({
          x: Math.max(0, Math.min(maxX, ds.startPosX + dx)),
          y: Math.max(TOP_LIMIT, Math.min(maxY, ds.startPosY + dy)),
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) {
        // Snap X to nearest edge, keep Y where dropped
        setPos((cur) => {
          const cx = cur.x + MIC_SIZE / 2
          const snappedX = cx < window.innerWidth / 2 ? EDGE_MARGIN : window.innerWidth - MIC_SIZE - EDGE_MARGIN
          const final = { x: snappedX, y: cur.y }
          savePos(final)
          return final
        })
        setIsDragging(false)
      } else if (!ds.moved) {
        handleToggleMic()
      }
      ds.dragging = false
      ds.moved = false
      const el = useVoiceInputStore.getState().activeInputRef.current
      if (el) setTimeout(() => el.focus(), 50)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
  }, [pos, handleToggleMic])

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

  // §CRITICAL: createPortal to document.body + position:fixed with X,Y.
  // NO visualViewport listeners for scroll — the position is set once by
  // the user (drag) and adjusted once when keyboard opens. Scroll does NOT
  // trigger any repositioning.
  return createPortal(
    <div
      key="floating-keyboard-mic-wrapper"
      style={{
        position: 'fixed',
        left: `${pos.x}px`,
        top: `${pos.y}px`,
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
