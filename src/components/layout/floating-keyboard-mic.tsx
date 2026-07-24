'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §1: Z-INDEX 9999 — highest possible, always on top of everything including
 *     keyboard, dialogs, overlays. Parent has pointerEvents:'none' so touches
 *     pass through except on the mic button itself.
 * §2: Keyboard sync — VisualViewport API detects keyboard, positions mic
 *     ON TOP of keyboard (not under it).
 * §3: Text injection — reads activeInputCallback from store at result time.
 *     Mic button has data-mic-button='true' so useVoiceInput's handleBlur
 *     does NOT unregister the callback when mic is tapped.
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
const TOP_BAR = 56
const DRAG_THRESH = 6
const KEYBOARD_GAP = 20

interface MicPos { x: number; y: number }
const DEFAULT_POS: MicPos = { x: -999, y: -999 }

function getDefault(keyboardHeight = 0): MicPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  // §2: Position mic ON TOP of keyboard — use visualViewport.height
  // (which shrinks when keyboard opens) as the bottom of visible area
  const visibleHeight = window.visualViewport?.height ?? window.innerHeight
  const bottomY = visibleHeight - MIC_SIZE - KEYBOARD_GAP
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
  const { keyboardActive, activeInputRef, unregisterInput } = useVoiceInputStore()
  const { language } = useI18n()
  const languageRef = useRef(language)
  useEffect(() => { languageRef.current = language }, [language])

  const [keyboardHeight, setKeyboardHeight] = useState(0)
  // §FIX: If loadPos returns DEFAULT_POS (-999,-999), use getDefault() instead
  const [position, setPosition] = useState<MicPos>(() => {
    const saved = loadPos()
    if (saved.x === -999 || saved.y === -999) return getDefault(0)
    return saved
  })
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()

  // §2: VisualViewport API — reposition mic ONLY when keyboard height changes.
  // §FIX: visualViewport 'resize' AND 'scroll' events both fire when scrolling
  // with keyboard open. The 'resize' event fires because visualViewport.height
  // fluctuates slightly during scroll. The 'scroll' event fires because
  // visualViewport.pageTop changes. Both caused the mic to jump around.
  //
  // FIX: Only reposition when keyboard height changes by >10px (actual keyboard
  // open/close, not scroll fluctuation). Completely IGNORE the 'scroll' event —
  // the mic is position:fixed via createPortal to document.body, so it stays
  // put regardless of scroll.
  const lastKbHeightRef = useRef(0)
  useEffect(() => {
    if (!window.visualViewport) return
    const vv = window.visualViewport
    const onResize = () => {
      const kbHeight = Math.max(0, window.innerHeight - vv.height)
      // §FIX: Only reposition if keyboard height actually changed by >10px.
      if (Math.abs(kbHeight - lastKbHeightRef.current) > 10) {
        lastKbHeightRef.current = kbHeight
        setKeyboardHeight(kbHeight)
        setPosition(getDefault(kbHeight))
      }
    }
    // §FIX: visualViewport 'scroll' event — do NOTHING. The mic is position:fixed
    // on document.body via createPortal, so it stays put. We must NOT
    // reposition on scroll.
    const onScroll = () => { /* intentionally empty — mic stays fixed */ }
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onScroll)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onScroll)
    }
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

    // §3: Read callback from store RIGHT NOW (before recognition starts)
    // to verify it exists
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
      // §3: Read callback FRESH from store at result time
      const cb = useVoiceInputStore.getState().activeInputCallback
      if (cb) {
        cb(transcript)
        toast.success(`"${transcript.substring(0, 30)}" ইনজেক্ট হয়েছে`)
      } else {
        // Fallback: directly set value on DOM element
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
      // Restore focus to the active input
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
      // §3: Re-focus the active input after mic interaction
      const el = useVoiceInputStore.getState().activeInputRef.current
      if (el) setTimeout(() => el.focus(), 50)
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, handleToggleMic])

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

  // Strict keyboard sync
  if (!keyboardActive || typeof document === 'undefined') return null

  // §CRITICAL-FIX: Use createPortal to render the mic DIRECTLY on document.body.
  // This completely bypasses ALL ancestor elements (app-shell, main, motion.div,
  // SearchOverlay, ThemeProvider, QueryProvider, etc.). No ancestor can have
  // transform/will-change/backdrop-filter that creates a containing block and
  // breaks position:fixed. The mic is a direct child of <body> — truly floating.
  return createPortal(
    <div
      key="floating-keyboard-mic-wrapper"
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
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
          {/* Premium pulse/ripple idle animation */}
          {!listening && (
            <>
              <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'var(--primary)' }} animate={{ scale: [1, 1.5], opacity: [0.6, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }} />
              <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'var(--primary)' }} animate={{ scale: [1, 1.5], opacity: [0.4, 0] }} transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.7 }} />
            </>
          )}
          {/* Listening ripple */}
          {listening && (
            <>
              <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'rgb(239 68 68)' }} animate={{ scale: [1, 1.8], opacity: [0.5, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut' }} />
              <motion.div className="absolute inset-0 rounded-full pointer-events-none" style={{ backgroundColor: 'rgb(239 68 68)' }} animate={{ scale: [1, 1.8], opacity: [0.3, 0] }} transition={{ duration: 1.2, repeat: Infinity, ease: 'easeOut', delay: 0.4 }} />
            </>
          )}

          {/* §3: CRITICAL — data-mic-button='true' so useVoiceInput.handleBlur
              does NOT unregister the callback when mic is tapped */}
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

          {/* Close button */}
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
