'use client'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Plus, UserPlus, PackagePlus, ArrowLeftRight, Zap, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'

const ACTIONS = [
  { id: 'quick-sale', icon: Zap, labelKey: 'qa.quickSale', color: 'text-emerald-600', primary: true },
  { id: 'add-transaction', icon: ArrowLeftRight, labelKey: 'qa.addTransaction', color: 'text-teal-600', primary: false },
  { id: 'add-party', icon: UserPlus, labelKey: 'qa.addParty', color: 'text-emerald-600', primary: false },
  { id: 'add-product', icon: PackagePlus, labelKey: 'qa.addProduct', color: 'text-amber-600', primary: false },
] as const

const FAB_SIZE = 64
const EDGE_MARGIN = 16
const TOP_BAR = 56
const BOTTOM_NAV = 80
const DRAG_THRESH = 6
const HIDE_OFFSET = 36
const MENU_HEIGHT = 320
const MENU_GAP = 8
const MENU_WIDTH = 240 // w-60 = 15rem = 240px (used for near-top flip calc)

// §1: Icon rotation tuning — matches user's Reanimated spec
const IDLE_SPIN_DURATION = 3 // seconds per 360°
const ICON_SPRING = { type: 'spring' as const, stiffness: 200, damping: 15, mass: 0.8 }

interface FabPos { x: number; y: number }
interface VVState { w: number; h: number; ox: number; oy: number }
const DEFAULT_POS: FabPos = { x: -999, y: -999 }

function getInitialVV(): VVState {
  if (typeof window === 'undefined' || !window.visualViewport) {
    return { w: typeof window !== 'undefined' ? window.innerWidth : 375, h: typeof window !== 'undefined' ? window.innerHeight : 700, ox: 0, oy: 0 }
  }
  const vv = window.visualViewport
  return { w: vv.width, h: vv.height, ox: vv.offsetLeft, oy: vv.offsetTop }
}

// §KEYBOARD-VIEWPORT-FIX: Default & snap use VISUAL viewport dimensions
// (not window.innerHeight). This way the FAB sits at the bottom-right of
// the VISIBLE screen even when the keyboard is open.
function getDefault(vv: VVState): FabPos {
  return { x: vv.w - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET, y: vv.h - FAB_SIZE - BOTTOM_NAV - 28 }
}
function loadPos(vv: VVState): FabPos {
  if (typeof window === 'undefined') return DEFAULT_POS
  try {
    const s = localStorage.getItem('bizledger-fab-pos')
    if (s) {
      const p = JSON.parse(s)
      // Validate against visual viewport (not window.innerHeight).
      if (p.x >= -HIDE_OFFSET && p.x <= vv.w && p.y >= 0 && p.y <= vv.h) return p
    }
  } catch {}
  return getDefault(vv)
}
function savePos(p: FabPos) { try { localStorage.setItem('bizledger-fab-pos', JSON.stringify(p)) } catch {} }
function snapToEdge(p: FabPos, vv: VVState): FabPos {
  const cx = p.x + FAB_SIZE / 2
  const left = cx < vv.w / 2
  return {
    x: left ? EDGE_MARGIN - HIDE_OFFSET : vv.w - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET,
    y: Math.max(TOP_BAR + 8, Math.min(vv.h - FAB_SIZE - BOTTOM_NAV - 8, p.y))
  }
}

export function SideDrawerFab() {
  const { fabOpen, setFabOpen, triggerQuickAction, navigateTo, activeView } = useAppStore()
  const { t } = useI18n()
  // §KEYBOARD-VIEWPORT-FIX: pos is in VISUAL-VIEWPORT coords (relative to
  // top-left of the visible screen, NOT the layout viewport).
  const [vv, setVV] = useState<VVState>(getInitialVV)
  const [position, setPosition] = useState<FabPos>(() => {
    if (typeof window === 'undefined') return DEFAULT_POS
    const initVV = getInitialVV()
    return loadPos(initVV)
  })
  const [isDragging, setIsDragging] = useState(false)
  const [peekMode, setPeekMode] = useState(true)
  const [interacted, setInteracted] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  const vvRef = useRef(vv)
  useEffect(() => { vvRef.current = vv }, [vv])

  // §KEYBOARD-VIEWPORT-FIX: Listen to visualViewport resize/scroll.
  // On every change:
  //   1. Update vv state (width, height, offsetLeft, offsetTop).
  //   2. Clamp position.y so the FAB stays inside the visible area.
  //      If the keyboard opened and shrunk vv.h, slide the FAB up.
  //   3. If position is still the placeholder (-999), initialize it.
  // The listener is throttled via requestAnimationFrame to avoid jitter.
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    const winVV = window.visualViewport
    if (!winVV) return

    const update = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        const nextVV = { w: winVV.width, h: winVV.height, ox: winVV.offsetLeft, oy: winVV.offsetTop }
        setVV(nextVV)
        setPosition((prev) => {
          if (prev.x === -999) return getDefault(nextVV)
          // Clamp Y so FAB stays inside the visible area.
          const maxY = Math.max(TOP_BAR + 8, nextVV.h - FAB_SIZE - 8)
          const minY = TOP_BAR + 8
          if (prev.y > maxY || prev.y < minY) {
            return { ...prev, y: Math.max(minY, Math.min(maxY, prev.y)) }
          }
          return prev
        })
      })
    }

    update()
    winVV.addEventListener('resize', update)
    winVV.addEventListener('scroll', update)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
      winVV.removeEventListener('resize', update)
      winVV.removeEventListener('scroll', update)
    }
  }, [])

  // §1: Icon rotation controller — drives the infinite idle spin + open/close transitions
  const iconControls = useAnimationControls()
  const fabOpenRef = useRef(fabOpen)
  useEffect(() => { fabOpenRef.current = fabOpen }, [fabOpen])

  // Handle window resize (orientation change, etc.) — re-clamp position.
  useEffect(() => {
    const handleResize = () => {
      const curVV = vvRef.current
      setPosition((prev) => {
        if (prev.x === -999) return getDefault(curVV)
        const s = snapToEdge(prev, curVV)
        savePos(s)
        return s
      })
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Peek & bounce launch animation on mount (1.5s)
  useEffect(() => {
    const t1 = setTimeout(() => setPeekMode(false), 1500)
    return () => clearTimeout(t1)
  }, [])

  // §1: Infinite idle rotation engine.
  useEffect(() => {
    iconControls.set({ rotate: 0 })
  }, [])

  // §FAB-ICON-FIX: Close the FAB menu whenever the active view changes.
  useEffect(() => {
    setFabOpen(false)
  }, [activeView, setFabOpen])

  useEffect(() => {
    if (fabOpen) {
      iconControls.start({
        rotate: 45,
        transition: ICON_SPRING,
      })
    } else {
      iconControls
        .start({
          rotate: 0,
          transition: ICON_SPRING,
        })
        .then(() => {
          if (!fabOpenRef.current) {
            iconControls.start({
              rotate: 360,
              transition: { duration: IDLE_SPIN_DURATION, repeat: Infinity, ease: 'linear' },
            })
          }
        })
    }
  }, [fabOpen, iconControls])

  // Outside-click + Escape to close.
  useEffect(() => {
    if (!fabOpen) return
    const close = () => setFabOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFabOpen(false)
    window.addEventListener('keydown', onKey)
    const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [fabOpen, setFabOpen])

  const handleAction = (id: string) => {
    if (id === 'quick-sale') { navigateTo('sale-pad'); setFabOpen(false); return }
    const vm: Record<string, string> = { 'add-party': 'khata', 'add-product': 'inventory', 'add-transaction': 'khata' }
    if (vm[id]) navigateTo(vm[id] as any)
    triggerQuickAction({ id: crypto.randomUUID(), type: id as any })
    setFabOpen(false)
  }

  // §KEYBOARD-VIEWPORT-FIX: Drag stores position in VISUAL-VIEWPORT coords.
  // clientX/Y are in layout-viewport coords; delta is the same in both
  // (assuming vv doesn't change during a drag — which it doesn't, since
  // the user is dragging, not scrolling).
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (fabOpen) return
    e.preventDefault()
    setInteracted(true)
    setPeekMode(false)
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const curVV = vvRef.current
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
        setPosition({
          x: Math.max(-HIDE_OFFSET, Math.min(curVV.w - FAB_SIZE + HIDE_OFFSET, ds.startPosX + dx)),
          y: Math.max(TOP_BAR, Math.min(curVV.h - FAB_SIZE - 8, ds.startPosY + dy))
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) { setPosition((c) => { const s = snapToEdge(c, vvRef.current); savePos(s); return s }); setIsDragging(false) }
      else if (!ds.moved) { setFabOpen(!fabOpen) }
      ds.dragging = false; ds.moved = false
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, fabOpen, setFabOpen])

  // §1: Strict dynamic X-axis anchoring (compare FAB center to viewport center)
  const fabCenterX = position.x + FAB_SIZE / 2
  const isOnLeft = fabCenterX < vv.w / 2

  // §1: Strict conditional menuStyle with explicit 'auto' counterparts
  // Menu uses VISUAL viewport dimensions (vv.w/h) so it stays on-screen
  // when the keyboard is open.
  const menuStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' }
  if (isOnLeft) {
    menuStyle.left = `${position.x + FAB_SIZE + MENU_GAP}px`
    menuStyle.right = 'auto'
    menuStyle.alignItems = 'flex-start'
  } else {
    menuStyle.right = `${vv.w - position.x + MENU_GAP}px`
    menuStyle.left = 'auto'
    menuStyle.alignItems = 'flex-end'
  }
  const nearTop = position.y - MENU_HEIGHT < TOP_BAR + 20
  if (nearTop) {
    menuStyle.top = `${position.y + FAB_SIZE + MENU_GAP}px`
    menuStyle.bottom = 'auto'
  } else {
    menuStyle.bottom = `${vv.h - position.y + MENU_GAP}px`
    menuStyle.top = 'auto'
  }

  // Peek offset — nudge FAB towards center by 35px while peeking
  const peekOffset = peekMode ? (isOnLeft ? 35 : -35) : 0

  // §FIX: createPortal to document.body — no ancestor containing block.
  if (typeof document === 'undefined') return null
  return createPortal(
    <>
      {/* Backdrop — fade in/out over 200ms.
          §KEYBOARD-VIEWPORT-FIX: Backdrop uses position:fixed inset:0
          BUT we override its top/left/width/height with visualViewport
          values so it covers ONLY the visible area (not the hidden part
          under the keyboard). Otherwise clicking below the keyboard
          area wouldn't register on the backdrop. */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            key="fab-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            onClick={() => setFabOpen(false)}
            className="fixed z-40 bg-black/30 backdrop-blur-[2px]"
            style={{
              left: `${vv.ox}px`,
              top: `${vv.oy}px`,
              width: `${vv.w}px`,
              height: `${vv.h}px`,
            }}
          />
        )}
      </AnimatePresence>

      {/* Menu — green Quick Sale highlight. menuStyle uses vv dimensions. */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            key="fab-menu"
            initial={{ opacity: 0, scale: 0.8, x: isOnLeft ? -14 : 14, y: 6 }}
            animate={{
              opacity: 1,
              scale: 1,
              x: 0,
              y: 0,
              transition: { type: 'spring', stiffness: 100, damping: 15, mass: 0.8 }
            }}
            exit={{
              opacity: 0,
              scale: 0.8,
              x: isOnLeft ? -14 : 14,
              y: 8,
              transition: { duration: 0.2, ease: [0.4, 0, 1, 1] }
            }}
            // §KEYBOARD-VIEWPORT-FIX: Menu anchored via fixed positioning
            // with explicit pixel values calculated from visual-viewport
            // coords + offset. This way the menu stays put on the visible
            // screen when the keyboard is open.
            className="fixed z-50 w-56 bg-card rounded-2xl shadow-2xl border border-border p-2 overflow-hidden"
            style={{
              ...menuStyle,
              left: menuStyle.left ? `${parseFloat(menuStyle.left as string) + vv.ox}px` : menuStyle.left,
              right: menuStyle.right,
              top: menuStyle.top ? `${parseFloat(menuStyle.top as string) + vv.oy}px` : menuStyle.top,
              bottom: menuStyle.bottom,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: '100%', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('qa.title')}</p>
              <button onClick={() => setFabOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            <div style={{ width: '100%', alignItems: 'flex-start', display: 'flex', flexDirection: 'column' }}>
              {ACTIONS.map((a) => {
                const Icon = a.icon
                return (
                  <button
                    key={a.id}
                    onClick={() => handleAction(a.id)}
                    className={`w-full flex items-center gap-3 px-3 rounded-xl hover:bg-accent transition-colors text-left ${a.primary ? 'bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-400/40' : ''}`}
                    style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', width: '100%', paddingTop: '10px', paddingBottom: '10px' }}
                  >
                    <span className={`shrink-0 ${a.color}`}><Icon className={`w-5 h-5 ${a.primary ? 'stroke-[2.5]' : ''}`} /></span>
                    <span className={`text-sm flex-1 ${a.primary ? 'font-bold text-emerald-700 dark:text-emerald-300' : 'font-medium'}`}>{t(a.labelKey)}</span>
                  </button>
                )
              })}
            </div>
            <div style={{ width: '100%', alignItems: 'center', marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
              <p className="text-[9px] text-muted-foreground/60" style={{ textAlign: 'center' }}>হোল্ড করে টেনে বাটন সরানো যায়</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB container with idle ripple halo.
          §KEYBOARD-VIEWPORT-FIX: transform ADDS vv.ox/oy to convert
          visual-viewport coords → layout-viewport coords. position:fixed
          anchors to layout viewport, so adding the offset keeps the FAB
          visually anchored to the visible screen even when keyboard
          scrolls the layout viewport. */}
      <div className="fixed z-50 select-none" style={{
        left: '0',
        top: '0',
        width: FAB_SIZE,
        height: FAB_SIZE,
        // ADD visualViewport offset (do NOT subtract — that was the bug).
        transform: `translate3d(${position.x + peekOffset + vv.ox}px, ${position.y + vv.oy}px, 0)`,
        willChange: 'transform',
      }}>
        {!interacted && !fabOpen && (
          <>
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: 'var(--primary)', opacity: 0.4 }}
              animate={{ scale: [1, 1.6], opacity: [0.4, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
            />
            <motion.div
              className="absolute inset-0 rounded-full"
              style={{ backgroundColor: 'var(--primary)', opacity: 0.3 }}
              animate={{ scale: [1, 1.6], opacity: [0.3, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: 'easeOut', delay: 0.7 }}
            />
          </>
        )}

        <motion.button
          onPointerDown={handlePointerDown}
          className={`absolute inset-0 flex items-center justify-center w-16 h-16 rounded-full text-primary-foreground shadow-lg ring-4 ring-background/40 backdrop-blur-xl border border-white/20 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            backgroundColor: 'color-mix(in oklch, var(--primary) 45%, transparent)',
            touchAction: 'none',
          }}
          animate={{
            scale: isDragging ? 1.15 : (peekMode ? [1, 1.12, 1] : 1),
          }}
          transition={{
            scale: { duration: 0.6, repeat: peekMode ? 2 : 0, ease: 'easeInOut' },
          }}
          whileTap={{ scale: 0.92 }}
          aria-label={t('qa.title')}
          aria-expanded={fabOpen}
        >
          <motion.div animate={iconControls}>
            <Plus className="w-7 h-7 drop-shadow" />
          </motion.div>
        </motion.button>
      </div>
    </>,
    document.body
  )
}
