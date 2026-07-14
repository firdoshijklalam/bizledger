'use client'

/**
 * §1 FloatingKeyboardMic — draggable microphone button that ONLY appears when
 * a text input/keyboard is active. Web equivalent of react-native-reanimated +
 * PanGestureHandler implementation.
 *
 * - Mounts when ANY <input> / <textarea> gains focus (keyboard active)
 * - Unmounts (with exit animation) when all inputs blur
 * - Draggable via pointer events (works on touch + mouse)
 * - Snaps to nearest screen edge on release
 * - Tapping it starts Web Speech API voice recognition → fills the focused input
 * - Position persists in localStorage
 */

import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'

const MIC_SIZE = 52
const EDGE_MARGIN = 12
const TOP_BAR = 56
const BOTTOM_NAV = 80
const DRAG_THRESH = 6
const DEFAULT_BOTTOM_OFFSET = 120 // sits above bottom nav when keyboard opens

interface MicPos { x: number; y: number }
const DEFAULT_POS: MicPos = { x: -999, y: -999 }

function getDefault(): MicPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: window.innerWidth - MIC_SIZE - EDGE_MARGIN, y: window.innerHeight - MIC_SIZE - BOTTOM_NAV - DEFAULT_BOTTOM_OFFSET }
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
  return getDefault()
}
function savePos(p: MicPos) { try { localStorage.setItem('bizledger-keyboard-mic-pos', JSON.stringify(p)) } catch {} }
function snapToEdge(p: MicPos): MicPos {
  if (typeof window === 'undefined') return p
  const cx = p.x + MIC_SIZE / 2
  const left = cx < window.innerWidth / 2
  return {
    x: left ? EDGE_MARGIN : window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    y: Math.max(TOP_BAR + 8, Math.min(window.innerHeight - MIC_SIZE - BOTTOM_NAV - 8, p.y))
  }
}

export function FloatingKeyboardMic() {
  // §1: keyboardActive = true when any input/textarea is focused
  const [keyboardActive, setKeyboardActive] = useState(false)
  const [position, setPosition] = useState<MicPos>(() => { if (typeof window === 'undefined') return DEFAULT_POS; return loadPos() })
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const focusedInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()

  // §1: stopListening — declared first so it can be referenced in the focus tracking effect
  const stopListening = useCallback(() => {
    if (recognitionRef.current) {
      try { recognitionRef.current.stop() } catch {}
      recognitionRef.current = null
    }
    setListening(false)
  }, [])

  // §1: Track focus/blur on ALL inputs/textareas to detect keyboard active state
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
        // Delay to allow focus to transfer to another input
        setTimeout(() => {
          const active = document.activeElement
          if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
            focusedInputRef.current = active as HTMLInputElement | HTMLTextAreaElement
          } else {
            focusedInputRef.current = null
            setKeyboardActive(false)
            // Stop any active recognition
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

  // §1: Handle resize (keyboard open/close changes viewport height)
  useEffect(() => {
    const handleResize = () => {
      setPosition((prev) => { if (prev.x === -999) return getDefault(); const s = snapToEdge(prev); savePos(s); return s })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  const startListening = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SpeechRecognition) {
      toast.error('ভয়েস ইনপুট এই ব্রাউজারে সাপোর্ট করে না')
      return
    }
    // Stop any existing recognition
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }

    const recognition = new SpeechRecognition()
    // Use bn-IN for Bengali Indian, fall back to en-IN
    recognition.lang = 'bn-IN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      // §1: Fill the focused input with the transcript
      const input = focusedInputRef.current
      if (input) {
        // Use native input setter so React's onChange fires
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
    }
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    toast.info('বলুন...', { duration: 1500 })
  }, [])

  const handleToggleMic = useCallback(() => {
    if (listening) {
      stopListening()
    } else {
      startListening()
    }
  }, [listening, startListening, stopListening])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
        setPosition({
          x: Math.max(0, Math.min(window.innerWidth - MIC_SIZE, ds.startPosX + dx)),
          y: Math.max(TOP_BAR, Math.min(window.innerHeight - MIC_SIZE - BOTTOM_NAV, ds.startPosY + dy))
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) { setPosition((c) => { const s = snapToEdge(c); savePos(s); return s }); setIsDragging(false) }
      else if (!ds.moved) { handleToggleMic() }
      ds.dragging = false; ds.moved = false
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, handleToggleMic])

  // §1: Pulse animation when listening
  useEffect(() => {
    if (listening) {
      micControls.start({
        scale: [1, 1.15, 1],
        transition: { duration: 1, repeat: Infinity, ease: 'easeInOut' }
      })
    } else {
      micControls.start({ scale: 1, transition: { duration: 0.2 } })
    }
  }, [listening, micControls])

  return (
    <AnimatePresence>
      {keyboardActive && (
        <motion.div
          key="floating-keyboard-mic"
          initial={{ opacity: 0, scale: 0.5, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: { type: 'spring', stiffness: 300, damping: 20 } }}
          exit={{ opacity: 0, scale: 0.5, y: 20, transition: { duration: 0.2 } }}
          className="fixed z-[60] select-none"
          style={{ left: `${position.x}px`, top: `${position.y}px`, width: MIC_SIZE, height: MIC_SIZE }}
        >
          {/* Listening ripple */}
          {listening && (
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: 'rgb(239 68 68)', opacity: 0.3 }}
              animate={{ scale: [1, 1.8], opacity: [0.3, 0] }}
              transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }}
            />
          )}

          <motion.button
            onPointerDown={handlePointerDown}
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

          {/* Close button (X) — top right of mic, only when not listening */}
          {!listening && (
            <button
              onClick={(e) => { e.stopPropagation(); setKeyboardActive(false); }}
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
