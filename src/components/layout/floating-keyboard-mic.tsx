'use client'

/**
 * FloatingKeyboardMic — draggable microphone button that ONLY appears when
 * a text input/keyboard is active.
 *
 * §1: Dynamic STT Language — uses useI18n() to sync recognition.lang with the
 *     app's active language (bn→bn-IN, hi→hi-IN, en→en-US).
 * §2: Unrestricted 2D Drag — both X and Y axis, position relative to entire
 *     window (fixed positioning), no vertical clamping that blocks dragging down.
 * §3: Global Root Overlay — mounted at app-shell root level (not screen-level).
 * §4: Prevent Focus Steal — mic button uses onPointerDown + preventDefault to
 *     avoid blurring the active TextInput. tabIndex={-1} + onMouseDown prevent.
 */

import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/store/i18n-store'

const MIC_SIZE = 52
const EDGE_MARGIN = 12
const TOP_BAR = 56
const DRAG_THRESH = 6
const KEYBOARD_GAP = 20

interface MicPos { x: number; y: number }
const DEFAULT_POS: MicPos = { x: -999, y: -999 }

function getDefault(keyboardHeight = 0): MicPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight
  const bottomY = visibleHeight - MIC_SIZE - KEYBOARD_GAP - keyboardHeight
  return {
    x: window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    y: Math.max(TOP_BAR + 8, bottomY)
  }
}
function loadPos(): MicPos {
  if (typeof window === 'undefined') return DEFAULT_POS
  try {
    const s = localStorage.getItem('bizledger-keyboard-mic-pos')
    if (s) {
      const p = JSON.parse(s)
      if (p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) return p
    }
  } catch {}
  return DEFAULT_POS
}
function savePos(p: MicPos) { try { localStorage.setItem('bizledger-keyboard-mic-pos', JSON.stringify(p)) } catch {} }
// §2: snapToEdge only clamps X to nearest edge; Y is clamped to viewport but
// NOT restricted to a small band — allows full vertical drag.
function snapToEdge(p: MicPos): MicPos {
  if (typeof window === 'undefined') return p
  const cx = p.x + MIC_SIZE / 2
  const left = cx < window.innerWidth / 2
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight
  return {
    x: left ? EDGE_MARGIN : window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    // §2: Y can go anywhere from top bar to bottom of visible viewport
    y: Math.max(TOP_BAR + 8, Math.min(visibleHeight - MIC_SIZE - 8, p.y))
  }
}

export function FloatingKeyboardMic() {
  // §1: Get active app language for dynamic STT locale
  const { language } = useI18n()

  const [keyboardActive, setKeyboardActive] = useState(false)
  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [position, setPosition] = useState<MicPos>(loadPos)
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const focusedInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const recognitionRef = useRef<any>(null)
  const languageRef = useRef(language) // §1: ref to access latest language in callbacks
  const micControls = useAnimationControls()

  // §1: Keep languageRef in sync with active language
  useEffect(() => { languageRef.current = language }, [language])

  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setListening(false)
  }, [])

  // §3: Track focus/blur on ALL inputs/textareas (document-level = global scope)
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        focusedInputRef.current = target as HTMLInputElement | HTMLTextAreaElement
        setKeyboardActive(true)
      }
    }
    const handleFocusOut = (e: FocusEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        // §4: Delay to allow focus to transfer — but DON'T dismiss if mic button
        // or its children are being interacted with
        setTimeout(() => {
          const active = document.activeElement
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            focusedInputRef.current = active as HTMLInputElement | HTMLTextAreaElement
          } else if (active && active.getAttribute('data-mic-button') === 'true') {
            // Mic button stole focus — re-focus the input
            if (focusedInputRef.current) focusedInputRef.current.focus()
          } else {
            focusedInputRef.current = null
            setKeyboardActive(false)
            stopListening()
          }
        }, 100)
      }
    }
    document.addEventListener('focusin', handleFocusIn)
    document.addEventListener('focusout', handleFocusOut)
    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      document.removeEventListener('focusout', handleFocusOut)
    }
  }, [stopListening])

  // §2: VisualViewport API — keyboard height detection
  useEffect(() => {
    if (!window.visualViewport) return
    const onResize = () => {
      const kbHeight = Math.max(0, window.innerHeight - window.visualViewport!.height)
      setKeyboardHeight(kbHeight)
      setPosition((prev) => {
        if (prev.x === -999) return getDefault(kbHeight)
        const s = snapToEdge(prev)
        savePos(s)
        return s
      })
    }
    window.visualViewport.addEventListener('resize', onResize)
    return () => window.visualViewport!.removeEventListener('resize', onResize)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('ভয়েস ইনপুট এই ব্রাউজারে সাপোর্ট করে না')
      return
    }
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }

    const recognition = new SpeechRecognition()
    // §1: Dynamic STT language — sync with app's active language
    // bn → bn-IN, hi → hi-IN, en → en-US (default)
    const lang = languageRef.current
    recognition.lang = lang === 'bn' ? 'bn-IN' : lang === 'hi' ? 'hi-IN' : 'en-US'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      const input = focusedInputRef.current
      if (input) {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
        const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')?.set
        const setter = input.tagName === 'TEXTAREA' ? nativeTextareaValueSetter : nativeInputValueSetter
        if (setter) {
          setter.call(input, transcript)
          input.dispatchEvent(new Event('input', { bubbles: true }))
        } else {
          input.value = transcript
          input.dispatchEvent(new Event('input', { bubbles: true }))
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
      // §4: Re-focus the input after recognition ends
      if (focusedInputRef.current) {
        setTimeout(() => focusedInputRef.current?.focus(), 100)
      }
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

  // §2: Unrestricted 2D Drag — both X and Y axis, relative to entire window.
  // §4: preventDefault stops the mic from stealing focus from the active input.
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault() // §4: Prevent focus steal
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
        // §2: Allow full 2D movement — X clamped to viewport width, Y clamped to
        // visible viewport (top bar to bottom). NO restricted band.
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - MIC_SIZE, ds.startPosX + dx)),
          y: Math.max(TOP_BAR, Math.min(visibleHeight - MIC_SIZE - 8, ds.startPosY + dy))
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) { setPosition((c) => { const s = snapToEdge(c); savePos(s); return s }); setIsDragging(false) }
      else if (!ds.moved) { handleToggleMic() }
      ds.dragging = false; ds.moved = false
      // §4: Re-focus the input after drag/tap
      if (focusedInputRef.current) {
        setTimeout(() => focusedInputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, handleToggleMic])

  // §3: Animations — breathing idle + pulse
  useEffect(() => {
    if (listening) {
      micControls.start({
        scale: [1, 1.15, 1],
        transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' }
      })
    } else if (keyboardActive) {
      micControls.start({
        scale: [1, 1.1, 1],
        transition: { duration: 2.5, repeat: Infinity, ease: 'easeInOut' }
      })
    } else {
      micControls.start({ scale: 1, transition: { duration: 0.2 } })
    }
  }, [listening, keyboardActive, micControls])

  return (
    <AnimatePresence>
      {keyboardActive && (
        <motion.div
          key="floating-keyboard-mic"
          initial={{ opacity: 0, scale: 0.3, y: 30 }}
          animate={{
            opacity: 1,
            scale: 1,
            y: 0,
            transition: { type: 'spring', stiffness: 300, damping: 18, mass: 0.8 }
          }}
          exit={{ opacity: 0, scale: 0.3, y: 30, transition: { duration: 0.2 } }}
          // §2: position: fixed = relative to entire window (not trapped in a container)
          className="fixed z-[60] select-none"
          style={{ left: `${position.x}px`, top: `${position.y}px`, width: MIC_SIZE, height: MIC_SIZE }}
        >
          {/* §3: Premium pulse/ripple idle animation */}
          {!listening && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ backgroundColor: 'var(--primary)' }}
                animate={{ scale: [1, 1.5], opacity: [0.6, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ backgroundColor: 'var(--primary)' }}
                animate={{ scale: [1, 1.5], opacity: [0.4, 0] }}
                transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.7 }}
              />
            </>
          )}

          {/* Listening ripple */}
          {listening && (
            <>
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ backgroundColor: 'rgb(239 68 68)' }}
                animate={{ scale: [1, 1.8], opacity: [0.5, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
              />
              <motion.div
                className="absolute inset-0 rounded-full pointer-events-none"
                style={{ backgroundColor: 'rgb(239 68 68)' }}
                animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
                transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.4 }}
              />
            </>
          )}

          <motion.button
            onPointerDown={handlePointerDown}
            // §4: Prevent focus steal — don't let this button become focusable
            // or blur the active input when tapped
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()} // §4: Prevent default focus behavior
            data-mic-button="true" // §4: Marker for focusout handler to detect mic interaction
            animate={micControls}
            whileTap={{ scale: 0.9 }}
            className={`absolute inset-0 flex items-center justify-center rounded-full text-white shadow-xl border-2 backdrop-blur-xl ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} ${listening ? 'border-red-300' : 'border-white/30'}`}
            style={{
              backgroundColor: listening ? 'rgb(239 68 68)' : 'color-mix(in oklch, var(--primary) 70%, transparent)',
              touchAction: 'none',
            }}
            aria-label={listening ? 'Stop voice input' : 'Start voice input (draggable)'}
          >
            {listening ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
          </motion.button>

          {/* Close button (X) */}
          {!listening && (
            <button
              onClick={(e) => { e.stopPropagation(); setKeyboardActive(false); }}
              // §4: Prevent focus steal on close button too
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-md z-10"
              aria-label="Hide microphone"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
