'use client'

/**
 * FloatingKeyboardMic — GLOBAL draggable microphone button.
 *
 * §KEYBOARD-VIEWPORT-FIX (Android Chrome PWA):
 * The classic bug: on Android Chrome, when the soft keyboard opens, the
 * VISUAL viewport shrinks (height decreases) and may scroll independently
 * of the LAYOUT viewport. CSS `position: fixed` anchors to the LAYOUT
 * viewport — so a fixed element with `top: <some-Y>` ends up either:
 *   (a) below the visible area (hidden under the keyboard), or
 *   (b) scrolling with the page (if the layout viewport itself scrolled).
 *
 * THE FIX — anchor to the VISUAL viewport dynamically:
 *   1. Store `pos` in VISUAL-VIEWPORT coords (relative to the top-left of
 *      what the user actually sees on screen). This means "middle of the
 *      screen" stays "middle of the screen" regardless of keyboard state.
 *   2. Track `visualViewport` ({width, height, offsetLeft, offsetTop}).
 *   3. On render, CONVERT visual-viewport coords → layout-viewport coords
 *      by ADDING the visualViewport offset:
 *        transform: translate3d(pos.x + vv.ox, pos.y + vv.oy, 0)
 *      (Previous code SUBTRACTED — that was the bug. Subtracting pushes
 *       the element ABOVE the visible area, off-screen.)
 *   4. On every visualViewport resize, CLAMP pos.y so the mic always
 *      stays within the visible area (if it would be hidden under the
 *      keyboard, slide it up to sit just above the keyboard).
 *   5. Default position uses visualViewport.height (not window.innerHeight),
 *      so it works even when the mic first mounts with keyboard already open.
 *
 * §JITTER-FIX (v2): The previous approach called setVV + setPos inside
 * a requestAnimationFrame on EVERY visualViewport scroll event. This
 * triggered a React re-render that lagged one frame behind the actual
 * scroll position, causing a visible "slight shaking" during scroll.
 *
 * THE FIX: Split visualViewport handling into two paths:
 *   - SCROLL events (frequent, 60+ fps): Update the DOM transform DIRECTLY
 *     via wrapperRef.current.style.transform — NO rAF, NO setState. This
 *     is synchronous with the scroll, so there is ZERO lag and ZERO jitter.
 *   - RESIZE events (infrequent, keyboard open/close): Use setState to
 *     update vv + clamp pos. The re-render is acceptable here because
 *     resize is rare.
 *
 * transform:translate3d uses the GPU compositor — no layout thrashing.
 *
 * §KEYBOARD-DISMISS: The X button blurs the active element to dismiss
 * the virtual keyboard natively.
 *
 * §PORTAL: createPortal(document.body) — no ancestor containing block
 * can break position:fixed (transform/will-change/backdrop-filter).
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
interface VVState { w: number; h: number; ox: number; oy: number }

function getInitialVV(): VVState {
  if (typeof window === 'undefined' || !window.visualViewport) {
    return { w: typeof window !== 'undefined' ? window.innerWidth : 375, h: typeof window !== 'undefined' ? window.innerHeight : 700, ox: 0, oy: 0 }
  }
  const vv = window.visualViewport
  return { w: vv.width, h: vv.height, ox: vv.offsetLeft, oy: vv.offsetTop }
}

function getDefaultPos(vv: VVState): MicPos {
  return {
    x: vv.w - MIC_SIZE - EDGE_MARGIN,
    y: vv.h - MIC_SIZE - BOTTOM_LIMIT,
  }
}

function loadPos(vv: VVState): MicPos {
  if (typeof window === 'undefined') return getDefaultPos(vv)
  try {
    const s = localStorage.getItem('bizledger-mic-pos-2d')
    if (s) {
      const p = JSON.parse(s)
      // Validate against visual viewport dimensions (so a stale position
      // saved when keyboard was closed doesn't end up off-screen).
      if (p.x >= 0 && p.x <= vv.w - MIC_SIZE && p.y >= 0 && p.y <= vv.h - MIC_SIZE) return p
    }
  } catch {}
  return getDefaultPos(vv)
}

function savePos(p: MicPos) {
  try { localStorage.setItem('bizledger-mic-pos-2d', JSON.stringify(p)) } catch {}
}

export function FloatingKeyboardMic() {
  const { keyboardActive, activeInputRef, unregisterInput } = useVoiceInputStore()
  const { language } = useI18n()
  const languageRef = useRef(language)
  useEffect(() => { languageRef.current = language }, [language])

  // §KEYBOARD-VIEWPORT-FIX: Track the VISUAL viewport state.
  // pos is stored in visual-viewport coords (relative to top-left of
  // the visible screen, NOT the layout viewport).
  const [vv, setVV] = useState<VVState>(getInitialVV)
  const [pos, setPos] = useState<MicPos>(() => loadPos(getInitialVV()))
  const [isDragging, setIsDragging] = useState(false)
  const [listening, setListening] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const recognitionRef = useRef<any>(null)
  const micControls = useAnimationControls()
  const vvRef = useRef(vv)
  useEffect(() => { vvRef.current = vv }, [vv])
  // §JITTER-FIX: wrapperRef for direct DOM transform updates on scroll.
  // posRef mirrors `pos` so the scroll handler can read the latest pos
  // without re-subscribing (the useEffect has [] deps).
  const wrapperRef = useRef<HTMLDivElement>(null)
  const posRef = useRef(pos)
  useEffect(() => { posRef.current = pos }, [pos])

  // §JITTER-FIX: Two separate visualViewport handlers:
  //   onScroll → direct DOM transform update (NO setState, NO rAF)
  //   onResize → setState for clamping + direct DOM transform
  useEffect(() => {
    const winVV = window.visualViewport
    if (!winVV) return

    // Synchronously update the wrapper's transform. This runs inside the
    // scroll event handler — BEFORE the browser paints — so the mic moves
    // in the SAME frame as the scroll. Zero lag = zero jitter.
    const applyTransform = () => {
      const el = wrapperRef.current
      if (!el) return
      const p = posRef.current
      el.style.transform = `translate3d(${p.x + winVV.offsetLeft}px, ${p.y + winVV.offsetTop}px, 0)`
    }

    // SCROLL: direct DOM only — no setState → no re-render → no jitter
    const onScroll = () => applyTransform()

    // RESIZE: keyboard open/close — clamp pos + apply transform immediately
    const onResize = () => {
      const nextH = winVV.height
      const nextW = winVV.width
      const nextOX = winVV.offsetLeft
      const nextOY = winVV.offsetTop
      setVV({ w: nextW, h: nextH, ox: nextOX, oy: nextOY })
      setPos((p) => {
        const maxY = Math.max(TOP_LIMIT, nextH - MIC_SIZE - 10)
        if (p.y > maxY || p.y < TOP_LIMIT) {
          return { ...p, y: Math.max(TOP_LIMIT, Math.min(maxY, p.y)) }
        }
        return p
      })
      // Apply transform immediately (don't wait for re-render)
      applyTransform()
    }

    winVV.addEventListener('resize', onResize)
    winVV.addEventListener('scroll', onScroll)
    return () => {
      winVV.removeEventListener('resize', onResize)
      winVV.removeEventListener('scroll', onScroll)
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

  // §KEYBOARD-VIEWPORT-FIX: Full 2D drag. Pointer events return clientX/Y
  // in LAYOUT-viewport coords. We convert to VISUAL-viewport coords by
  // subtracting vv.ox/oy so the stored pos is "where on the visible screen
  // the user wants the mic". On render we add vv.ox/oy back to convert
  // to layout-viewport coords for the transform.
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

    const curVV = vvRef.current
    const maxX = Math.max(0, curVV.w - MIC_SIZE)
    const maxY = Math.max(TOP_LIMIT, curVV.h - MIC_SIZE - 10)

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
          const snappedX = cx < vvRef.current.w / 2 ? EDGE_MARGIN : vvRef.current.w - MIC_SIZE - EDGE_MARGIN
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
    if (document.activeElement && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    const el = useVoiceInputStore.getState().activeInputRef.current
    if (el) el.blur()
    unregisterInput()
  }, [unregisterInput])

  if (!keyboardActive || typeof document === 'undefined') return null

  // §KEYBOARD-VIEWPORT-FIX: Convert visual-viewport coords → layout-viewport
  // coords by ADDING vv.ox/oy. This anchors the mic to the VISIBLE screen,
  // not the scrolling document.
  return createPortal(
    <div
      key="floating-keyboard-mic-wrapper"
      ref={wrapperRef}
      style={{
        position: 'fixed',
        left: '0',
        top: '0',
        width: MIC_SIZE,
        height: MIC_SIZE,
        zIndex: 9999,
        pointerEvents: 'auto',
        // ADD visualViewport offset (do NOT subtract — that was the bug).
        // pos is in visual-viewport coords; adding vv.ox/oy converts to
        // layout-viewport coords (which is what position:fixed anchors to).
        // §JITTER-FIX: This React-rendered transform is the INITIAL value.
        // During scroll, the onScroll handler updates the DOM transform
        // DIRECTLY via wrapperRef — bypassing React entirely for zero lag.
        transform: `translate3d(${pos.x + vv.ox}px, ${pos.y + vv.oy}px, 0)`,
        willChange: 'transform',
        backfaceVisibility: 'hidden',
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
