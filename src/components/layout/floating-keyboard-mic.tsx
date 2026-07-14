'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §1: Global Root Mount — mounted ONCE at app-shell.tsx root level. NOT
 *     copy-pasted into individual screens. Works universally on ALL screens.
 * §2: Strict Keyboard Sync — uses VisualViewport API (web equivalent of
 *     Keyboard.addListener) to show/hide based on keyboard visibility.
 *     Mic shows ONLY when keyboard is active (keyboardActive in global store).
 * §3: Universal Active Input Context — reads activeInputCallback from global
 *     Zustand store. Any input that wants voice support registers its callback
 *     via useVoiceInputStore().registerInput() on focus. The mic fires this
 *     callback with transcribed text — no need to track which specific input
 *     is focused.
 */

import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Mic, MicOff, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { toast } from 'sonner'
import { useVoiceInputStore } from '@/store/voice-input-store'

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
function snapToEdge(p: MicPos): MicPos {
  if (typeof window === 'undefined') return p
  const cx = p.x + MIC_SIZE / 2
  const left = cx < window.innerWidth / 2
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight
  return {
    x: left ? EDGE_MARGIN : window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    y: Math.max(TOP_BAR + 8, Math.min(visibleHeight - MIC_SIZE - 8, p.y))
  }
}

export function FloatingKeyboardMic() {
  // §3: Read from global store — no local focus tracking needed
  const { keyboardActive, activeInputCallback, activeInputRef, unregisterInput } = useVoiceInputStore()

  const [keyboardHeight, setKeyboardHeight] = useState(0)
  const [position, setPosition] = useState<MicPos>(loadPos)
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()

  // §2: VisualViewport API — keyboard show/hide sync
  // When keyboard opens, visualViewport.height shrinks → keyboardActive is set
  // by the global store (via registerInput on focus). When keyboard closes,
  // unregisterInput sets keyboardActive false. This is the strict lifecycle.
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

    const recognition = new SpeechRecognition()
    recognition.lang = 'bn-IN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: any) => {
      let transcript = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript
      }
      // §3: Fire the globally registered callback — sends text to whichever
      // input is currently active. This is the universal input context.
      if (activeInputCallback) {
        activeInputCallback(transcript)
      }
    }
    recognition.onerror = (e: any) => {
      toast.error('ভয়েস ব্যর্থ: ' + (e.error || 'unknown'))
      setListening(false)
    }
    recognition.onend = () => {
      setListening(false)
      recognitionRef.current = null
      // Restore focus to the active input
      if (activeInputRef.current) {
        setTimeout(() => activeInputRef.current?.focus(), 100)
      }
    }
    recognitionRef.current = recognition
    recognition.start()
    setListening(true)
    toast.info('বলুন...', { duration: 1500 })
  }, [activeInputCallback, activeInputRef])

  const handleToggleMic = useCallback(() => {
    if (listening) stopListening()
    else startListening()
  }, [listening, startListening, stopListening])

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault()
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const visibleHeight = window.visualViewport?.height ?? window.innerHeight
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
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
      if (activeInputRef.current) {
        setTimeout(() => activeInputRef.current?.focus(), 50)
      }
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, handleToggleMic, activeInputRef])

  // §3: Animations
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

  // §1: Mic renders ONLY when keyboardActive is true (strict keyboard sync)
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
          className="fixed z-[60] select-none"
          style={{ left: `${position.x}px`, top: `${position.y}px`, width: MIC_SIZE, height: MIC_SIZE }}
        >
          {/* Premium pulse/ripple idle animation */}
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
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
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

          {/* Close button — hides the mic (unregisters input) */}
          {!listening && (
            <button
              onClick={(e) => { e.stopPropagation(); unregisterInput(); }}
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
