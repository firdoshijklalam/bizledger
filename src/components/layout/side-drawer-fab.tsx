'use client'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { Plus, UserPlus, PackagePlus, ArrowLeftRight, Zap, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'

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
//   Idle spin:  withRepeat(withTiming(360, { duration: 3000, easing: Easing.linear }), -1, false)
//   Open:       withSpring(45)  → damping 15, stiffness 200, mass 0.8
//   Close:      withSpring(0) then resume idle spin
const IDLE_SPIN_DURATION = 3 // seconds per 360°
const ICON_SPRING = { type: 'spring' as const, stiffness: 200, damping: 15, mass: 0.8 }

interface FabPos { x: number; y: number }
const DEFAULT_POS: FabPos = { x: -999, y: -999 }

function getDefault(): FabPos {
  if (typeof window === 'undefined') return { x: 0, y: 0 }
  return { x: window.innerWidth - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET, y: window.innerHeight - FAB_SIZE - BOTTOM_NAV - 28 }
}
function loadPos(): FabPos {
  if (typeof window === 'undefined') return DEFAULT_POS
  try {
    const s = localStorage.getItem('bizledger-fab-pos')
    if (s) {
      const p = JSON.parse(s)
      if (p.x >= -HIDE_OFFSET && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) return p
    }
  } catch {}
  return getDefault()
}
function savePos(p: FabPos) { try { localStorage.setItem('bizledger-fab-pos', JSON.stringify(p)) } catch {} }
function snapToEdge(p: FabPos): FabPos {
  if (typeof window === 'undefined') return p
  const cx = p.x + FAB_SIZE / 2
  const left = cx < window.innerWidth / 2
  return {
    x: left ? EDGE_MARGIN - HIDE_OFFSET : window.innerWidth - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET,
    y: Math.max(TOP_BAR + 8, Math.min(window.innerHeight - FAB_SIZE - BOTTOM_NAV - 8, p.y))
  }
}

export function SideDrawerFab() {
  const { fabOpen, setFabOpen, triggerQuickAction, navigateTo } = useAppStore()
  const { t } = useI18n()
  const [position, setPosition] = useState<FabPos>(() => { if (typeof window === 'undefined') return DEFAULT_POS; return loadPos() })
  const [isDragging, setIsDragging] = useState(false)
  const [peekMode, setPeekMode] = useState(true)
  const [interacted, setInteracted] = useState(false)
  const [vw, setVw] = useState(() => (typeof window !== 'undefined' ? window.innerWidth : 375))
  const [vh, setVh] = useState(() => (typeof window !== 'undefined' ? window.innerHeight : 700))
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })

  // §1: Icon rotation controller — drives the infinite idle spin + open/close transitions
  const iconControls = useAnimationControls()
  // Ref to guard against stale callbacks if user rapidly toggles open/close.
  // Kept in sync inside an effect (not during render) per react-hooks/refs rule.
  const fabOpenRef = useRef(fabOpen)
  useEffect(() => { fabOpenRef.current = fabOpen }, [fabOpen])

  useEffect(() => {
    const handleResize = () => {
      setVw(window.innerWidth)
      setVh(window.innerHeight)
      setPosition((prev) => { if (prev.x === -999) return getDefault(); const s = snapToEdge(prev); savePos(s); return s })
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
  //   CLOSED → spring to 0° (if not already), THEN start infinite linear 360° spin (3s/rev).
  //   OPEN   → cancel the infinite loop, spring to 45° (turns + into ×).
  //   CLOSE  → spring back to 0°, then RESUME the infinite spin.
  // The .then() promise guards against rapid toggles via fabOpenRef.
  // §FAB-ICON-FIX: on mount, explicitly set rotate to 0 so the Plus icon
  // never appears as an X (45°) when collapsed. Without this, a race between
  // the initial render and the first .start() could leave it stuck at 45°.
  useEffect(() => {
    // Mount-only: force the icon to 0° (Plus orientation) before any animation.
    iconControls.set({ rotate: 0 })
  }, [])

  useEffect(() => {
    if (fabOpen) {
      // OPEN: cancel idle spin → spring to 45°
      iconControls.start({
        rotate: 45,
        transition: ICON_SPRING,
      })
    } else {
      // CLOSE: spring back to 0° first, then resume infinite spin
      iconControls
        .start({
          rotate: 0,
          transition: ICON_SPRING,
        })
        .then(() => {
          // Guard: only resume spin if still closed (user may have re-opened during the spring)
          if (!fabOpenRef.current) {
            iconControls.start({
              rotate: 360,
              transition: { duration: IDLE_SPIN_DURATION, repeat: Infinity, ease: 'linear' },
            })
          }
        })
    }
  }, [fabOpen, iconControls])

  // Outside-click + Escape to close. Deferred by a tick so the opening click doesn't immediately close.
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

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (fabOpen) return
    e.preventDefault()
    setInteracted(true)
    setPeekMode(false)
    const ds = dragRef.current
    ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) {
        setPosition({
          x: Math.max(-HIDE_OFFSET, Math.min(window.innerWidth - FAB_SIZE + HIDE_OFFSET, ds.startPosX + dx)),
          y: Math.max(TOP_BAR, Math.min(window.innerHeight - FAB_SIZE - BOTTOM_NAV, ds.startPosY + dy))
        })
      }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) { setPosition((c) => { const s = snapToEdge(c); savePos(s); return s }); setIsDragging(false) }
      else if (!ds.moved) { setFabOpen(!fabOpen) }
      ds.dragging = false; ds.moved = false
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, fabOpen, setFabOpen])

  // §1: Strict dynamic X-axis anchoring (compare FAB center to viewport center)
  const fabCenterX = position.x + FAB_SIZE / 2
  const isOnLeft = fabCenterX < vw / 2

  // §1: Strict conditional menuStyle with explicit 'auto' counterparts
  const menuStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column' }
  if (isOnLeft) {
    menuStyle.left = `${position.x + FAB_SIZE + MENU_GAP}px`
    menuStyle.right = 'auto'
    menuStyle.alignItems = 'flex-start'
  } else {
    menuStyle.right = `${vw - position.x + MENU_GAP}px`
    menuStyle.left = 'auto'
    menuStyle.alignItems = 'flex-end'
  }
  const nearTop = position.y - MENU_HEIGHT < TOP_BAR + 20
  if (nearTop) {
    menuStyle.top = `${position.y + FAB_SIZE + MENU_GAP}px`
    menuStyle.bottom = 'auto'
  } else {
    menuStyle.bottom = `${vh - position.y + MENU_GAP}px`
    menuStyle.top = 'auto'
  }

  // Peek offset — nudge FAB towards center by 35px while peeking
  const peekOffset = peekMode ? (isOnLeft ? 35 : -35) : 0

  return (
    <>
      {/* Backdrop — fade in/out over 200ms */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            key="fab-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.2 } }}
            onClick={() => setFabOpen(false)}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* Menu — REVERTED to original V1 (commit 5b43af2) with green Quick Sale highlight.
          ONLY the menuStyle (Left/Right position) is kept from newer code.
          Internal padding/width/alignment UNTOUCHED — uses original Tailwind classes. */}
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
            className="fixed z-50 w-56 bg-card rounded-2xl shadow-2xl border border-border p-2 overflow-hidden"
            style={menuStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {/* §1 HEADER — width 100%, flex row, space-between, align-center (QUICK ACTIONS left, X right) */}
            <div style={{ width: '100%', display: 'flex', flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px' }}>
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('qa.title')}</p>
              <button onClick={() => setFabOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-4 h-4" /></button>
            </div>
            {/* §2 MENU ITEMS — parent: width 100%, alignItems flex-start (strictly left-aligned) */}
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
            {/* §4 FOOTER — width 100%, alignItems center, marginTop 10, text center */}
            <div style={{ width: '100%', alignItems: 'center', marginTop: '10px', display: 'flex', justifyContent: 'center' }}>
              <p className="text-[9px] text-muted-foreground/60" style={{ textAlign: 'center' }}>হোল্ড করে টেনে বাটন সরানো যায়</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* FAB container with idle ripple halo */}
      <div className="fixed z-50 select-none" style={{ left: `${position.x + peekOffset}px`, top: `${position.y}px`, width: FAB_SIZE, height: FAB_SIZE }}>
        {/* Idle Ripple Halo — two offset pulses, infinite (only when not interacted & closed) */}
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

        {/* FAB Button */}
        <motion.button
          onPointerDown={handlePointerDown}
          className={`absolute inset-0 flex items-center justify-center w-16 h-16 rounded-full text-primary-foreground shadow-lg ring-4 ring-background/40 backdrop-blur-xl border border-white/20 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
          style={{
            backgroundColor: 'color-mix(in oklch, var(--primary) 45%, transparent)',
            touchAction: 'none',
            transition: isDragging ? 'none' : 'left 0.3s cubic-bezier(0.4,0,0.2,1), top 0.3s cubic-bezier(0.4,0,0.2,1)',
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
          {/* §1: Infinite idle rotation icon.
              - CLOSED: continuously spins 360° linearly over 3s (premium attention-grabber)
              - OPEN:   cancels spin, springs to 45° (+ → ×)
              - CLOSE:  springs back to 0°, then resumes spin
              Driven by iconControls (useAnimationControls) — see the useEffect above. */}
          <motion.div animate={iconControls}>
            <Plus className="w-7 h-7 drop-shadow" />
          </motion.div>
        </motion.button>
      </div>
    </>
  )
}
