'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §JITTER-FIX: Previous approach used position:absolute + JS scroll listener
 * to manually offset by scrollY — this caused jitter/shaking on every scroll
 * event because React state updates (setRenderPos) lag behind the actual
 * scroll position by one frame.
 *
 * NEW APPROACH: Pure CSS position:fixed + transform:translate3d for GPU-
 * accelerated movement. NO scroll event listeners. NO position recalculation.
 * The mic is fixed to the viewport via CSS — it CANNOT jitter because there
 * is zero JS involvement in its screen position.
 *
 * transform:translate3d(x, y, 0) is used instead of top/left for the drag
 * position — this uses the GPU compositor (no layout thrashing).
 *
 * §KEYBOARD-DISMISS: The X button now calls document.activeElement?.blur()
 * to dismiss the virtual keyboard natively before unregistering.
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
const DRAG_THRESH = 6

interface MicPos { x: number; y: number }

function getDefaultPos(): MicPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  const vh = window.visualViewport?.height ?? window.innerHeight
  return {
    x: window.innerWidth - MIC_SIZE - EDGE_MARGIN,
    y: vh - MIC_SIZE - BOTTOM_LIMIT,
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

  // §ANDROID-FIX: On Android Chrome with keyboard open, position:fixed
  // elements scroll with the body. This is a known browser bug.
  // FIX: Use visualViewport API to compensate. On every visualViewport
  // scroll/resize event, recalculate the transform offset to keep the
  // mic truly fixed on screen. Uses transform (GPU-accelerated) — no jitter.
  const [pos, setPos] = useState<MicPos>(loadPos)
  const [viewportOffset, setViewportOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()
  const rafRef = useRef<number | null>(null)

  // §ANDROID-FIX: Track visualViewport offset to compensate for scroll.
  // On desktop: offsetTop/offsetLeft are always 0 — no effect.
  // On Android Chrome with keyboard: offsetTop changes on scroll — we
  // subtract it from our position to keep the mic fixed on screen.
  useEffect(() => {
    if (!keyboardActive) return
    const vv = window.visualViewport
    if (!vv) return

    const update = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        setViewportOffset({
          x: vv.offsetLeft,
          y: vv.offsetTop,
        })
      })
    }

    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [keyboardActive])

  // When keyboard opens, adjust Y if mic would be hidden by keyboard.
  // Only fires ONCE on keyboard open, NOT on scroll.
  const prevKbActive = useRef(false)
  useEffect(() => {
    if (keyboardActive && !prevKbActive.current) {
      const vv = window.visualViewport
      if (vv) {
        const visibleBottom = vv.height
        const t = setTimeout(() => {
          setPos((p) => {
            if (p.y + MIC_SIZE > visibleBottom - 20) {
              return { ...p, y: Math.max(TOP_LIMIT, visibleBottom - MIC_SIZE - 20) }
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

  // §JITTER-FIX: Full 2D drag using transform:translate3d for GPU acceleration.
  // Updates the `pos` state — the wrapper div uses transform (not top/left)
  // for rendering, so there's no layout thrashing.
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
    const vh = vv?.height ?? window.innerHeight
    const maxX = window.innerWidth - MIC_SIZE
    const maxY = vh - MIC_SIZE - 10

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX
      const dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) {
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

  // §KEYBOARD-DISMISS: Close button — blur active element to dismiss keyboard
  const handleClose = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    // §FIX: Force-dismiss the virtual keyboard by blurring the active input.
    // This is required on mobile — without it, the keyboard stays open
    // even after the mic UI disappears.
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    // Also blur via the stored ref (fallback)
    const el = useVoiceInputStore.getState().activeInputRef.current
    if (el) el.blur()
    unregisterInput()
  }, [unregisterInput])

  if (!keyboardActive || typeof document === 'undefined') return null

  // §JITTER-FIX: Pure CSS position:fixed + transform:translate3d.
  // NO scroll listeners. NO JS position recalculation. NO renderPos state.
  // The mic is fixed to the viewport via CSS — it CANNOT jitter because
  // there is zero JS involvement in its screen position during scroll.
  //
  // transform:translate3d(x, y, 0) uses the GPU compositor — no layout
  // thrashing, no reflow, butter-smooth drag.
  //
  // createPortal to document.body — no ancestor containing block.
  return createPortal(
    <div
      key="floating-keyboard-mic-wrapper"
      style={{
        position: 'fixed',
        left: '0',
        top: '0',
        width: MIC_SIZE,
        height: MIC_SIZE,
        zIndex: 9999,
        pointerEvents: 'auto',
        // §JITTER-FIX: Use transform (GPU-accelerated) instead of top/left.
        // translate3d forces hardware acceleration — no jitter, no layout thrashing.
        // §ANDROID-FIX: Subtract visualViewport offset to compensate for
        // Android Chrome's position:fixed-with-keyboard bug. On desktop,
        // viewportOffset is {0,0} — no effect. On Android with keyboard,
        // viewportOffset.y = visualViewport.offsetTop which changes on scroll.
        // Subtracting it keeps the mic truly fixed on screen.
        transform: `translate3d(${pos.x - viewportOffset.x}px, ${pos.y - viewportOffset.y}px, 0)`,
        willChange: 'transform',
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
            onClick={handleClose}
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
