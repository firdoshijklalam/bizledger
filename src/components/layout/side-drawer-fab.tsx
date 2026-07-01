'use client'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, UserPlus, PackagePlus, FilePlus, ArrowLeftRight, Zap, X } from 'lucide-react'
import { useEffect, useRef, useState, useCallback } from 'react'
const ACTIONS = [
  { id: 'add-party', icon: UserPlus, labelKey: 'qa.addParty', color: 'text-emerald-600' },
  { id: 'add-product', icon: PackagePlus, labelKey: 'qa.addProduct', color: 'text-amber-600' },
  { id: 'add-transaction', icon: ArrowLeftRight, labelKey: 'qa.addTransaction', color: 'text-teal-600' },
  { id: 'new-invoice', icon: FilePlus, labelKey: 'qa.newInvoice', color: 'text-orange-600' },
  { id: 'quick-sale', icon: Zap, labelKey: 'qa.quickSale', color: 'text-purple-600' },
] as const
const FAB_SIZE = 64, EDGE_MARGIN = 16, TOP_BAR = 56, BOTTOM_NAV = 80, DRAG_THRESH = 6, HIDE_OFFSET = 36
interface FabPos { x: number; y: number }
const DEFAULT_POS: FabPos = { x: -999, y: -999 }
function getDefault(): FabPos { if (typeof window === 'undefined') return {x:0,y:0}; return { x: window.innerWidth - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET, y: window.innerHeight - FAB_SIZE - BOTTOM_NAV - 28 } }
function loadPos(): FabPos { if (typeof window === 'undefined') return DEFAULT_POS; try { const s = localStorage.getItem('bizledger-fab-pos'); if (s) { const p = JSON.parse(s); if (p.x >= -HIDE_OFFSET && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight) return p } } catch {} return getDefault() }
function savePos(p: FabPos) { try { localStorage.setItem('bizledger-fab-pos', JSON.stringify(p)) } catch {} }
function snapToEdge(p: FabPos): FabPos { if (typeof window === 'undefined') return p; const cx = p.x + FAB_SIZE/2; const left = cx < window.innerWidth/2; return { x: left ? EDGE_MARGIN - HIDE_OFFSET : window.innerWidth - FAB_SIZE - EDGE_MARGIN + HIDE_OFFSET, y: Math.max(TOP_BAR+8, Math.min(window.innerHeight - FAB_SIZE - BOTTOM_NAV - 8, p.y)) } }
export function SideDrawerFab() {
  const { fabOpen, setFabOpen, triggerQuickAction, setActiveView } = useAppStore()
  const { t } = useI18n()
  const [position, setPosition] = useState<FabPos>(() => { if (typeof window === 'undefined') return DEFAULT_POS; return loadPos() })
  const [isDragging, setIsDragging] = useState(false)
  const dragRef = useRef({ startX: 0, startY: 0, startPosX: 0, startPosY: 0, moved: false, dragging: false })
  useEffect(() => {
    const handleResize = () => { setPosition((prev) => { if (prev.x === -999) return getDefault(); const s = snapToEdge(prev); savePos(s); return s }) }
    window.addEventListener('resize', handleResize); return () => window.removeEventListener('resize', handleResize)
  }, [])
  useEffect(() => {
    if (!fabOpen) return
    const close = () => setFabOpen(false); const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFabOpen(false)
    window.addEventListener('keydown', onKey); const timer = setTimeout(() => document.addEventListener('click', close), 0)
    return () => { clearTimeout(timer); document.removeEventListener('click', close); window.removeEventListener('keydown', onKey) }
  }, [fabOpen, setFabOpen])
  const handleAction = (id: string) => {
    if (id === 'quick-sale') { setActiveView('sale-pad'); setFabOpen(false); return }
    const vm: Record<string,string> = { 'add-party':'khata', 'add-product':'inventory', 'new-invoice':'billing', 'add-transaction':'khata' }
    if (vm[id]) setActiveView(vm[id] as any)
    triggerQuickAction({ id: crypto.randomUUID(), type: id as any }); setFabOpen(false)
  }
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (fabOpen) return; e.preventDefault()
    const ds = dragRef.current; ds.startX = e.clientX; ds.startY = e.clientY; ds.startPosX = position.x; ds.startPosY = position.y; ds.moved = false; ds.dragging = false
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - ds.startX, dy = ev.clientY - ds.startY
      if (!ds.moved && (Math.abs(dx) > DRAG_THRESH || Math.abs(dy) > DRAG_THRESH)) { ds.moved = true; ds.dragging = true; setIsDragging(true) }
      if (ds.dragging) { setPosition({ x: Math.max(-HIDE_OFFSET, Math.min(window.innerWidth - FAB_SIZE + HIDE_OFFSET, ds.startPosX + dx)), y: Math.max(TOP_BAR, Math.min(window.innerHeight - FAB_SIZE - BOTTOM_NAV, ds.startPosY + dy)) }) }
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onUp)
      if (ds.dragging) { setPosition((c) => { const s = snapToEdge(c); savePos(s); return s }); setIsDragging(false) }
      else if (!ds.moved) { setFabOpen(!fabOpen) }
      ds.dragging = false; ds.moved = false
    }
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp)
  }, [position, fabOpen, setFabOpen])
  const isOnLeft = position.x >= 0 && position.x + FAB_SIZE/2 < (typeof window !== 'undefined' ? window.innerWidth/2 : 999)
  return (
    <>
      <AnimatePresence>{fabOpen && <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={() => setFabOpen(false)} className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]" />}</AnimatePresence>
      <AnimatePresence>{fabOpen && (
        <motion.div initial={{opacity:0,y:20,scale:0.9}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:20,scale:0.9}} transition={{type:'spring',stiffness:400,damping:25}} className={`fixed z-50 w-56 bg-card rounded-2xl shadow-2xl border border-border p-2 overflow-hidden ${isOnLeft?'left-4':'right-4'}`} style={{bottom:`calc(${typeof window!=='undefined'?window.innerHeight-position.y-FAB_SIZE-8:96}px + env(safe-area-inset-bottom))`}} onClick={(e)=>e.stopPropagation()}>
          <div className="px-3 py-2 flex items-center justify-between"><p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t('qa.title')}</p><button onClick={()=>setFabOpen(false)} className="text-muted-foreground hover:text-foreground" aria-label="Close"><X className="w-4 h-4" /></button></div>
          <div className="space-y-1">{ACTIONS.map((a) => { const Icon = a.icon; return <button key={a.id} onClick={()=>handleAction(a.id)} className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-accent transition-colors min-h-[44px] text-left"><span className={`shrink-0 ${a.color}`}><Icon className="w-5 h-5" /></span><span className="text-sm font-medium flex-1">{t(a.labelKey)}</span></button> })}</div>
          <p className="px-3 pt-1 pb-0.5 text-[9px] text-muted-foreground/60 text-center">হোল্ড করে টেনে বাটন সরানো যায়</p>
        </motion.div>
      )}</AnimatePresence>
      <motion.button onPointerDown={handlePointerDown} className={`fixed z-50 flex items-center justify-center w-16 h-16 rounded-full text-primary-foreground shadow-lg ring-4 ring-background/40 backdrop-blur-xl border border-white/20 select-none ${isDragging?'cursor-grabbing':'cursor-grab'}`} style={{ left:`${position.x}px`, top:`${position.y}px`, backgroundColor:'color-mix(in oklch, var(--primary) 45%, transparent)', touchAction:'none', transition: isDragging?'none':'left 0.3s cubic-bezier(0.4,0,0.2,1), top 0.3s cubic-bezier(0.4,0,0.2,1), scale 0.2s' }} animate={{scale:isDragging?1.15:1}} whileTap={{scale:0.95}} aria-label={t('qa.title')} aria-expanded={fabOpen}>
        <motion.div animate={{rotate:fabOpen?45:0}} transition={{duration:0.2}}><Plus className="w-7 h-7 drop-shadow" /></motion.div>
      </motion.button>
    </>
  )
}
