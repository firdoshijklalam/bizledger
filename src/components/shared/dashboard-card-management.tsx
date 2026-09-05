'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, TrendingDown, Heart, AlertTriangle, Wallet,
  ArrowUpRight, ArrowDownRight, Receipt, Users, Package, FileText, Boxes,
  X, Loader2, Settings, Eye, EyeOff, GripVertical, ChevronUp, ChevronDown,
} from 'lucide-react'
import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import type { RangeContext } from '@/lib/date-ranges'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors, DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  verticalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ─── Card Definitions ───────────────────────────────────────────────────

export interface DashboardCardDef {
  id: string
  label: string
  icon: typeof Wallet
  tint: string
  bg: string
  text: string
  description: string
  recommended?: boolean
  isTimeMetric?: boolean
  valueExtractor: (data: any) => number
  formatValue: (val: number, currency: string) => string
  // §PHASE-5-D1: onClick now receives a FULL RangeContext (range + customStart
  // + customEnd) instead of just the range string. This carries custom range
  // dates through navigation so History/Reports see the EXACT same window.
  onClick: (ctx: RangeContext) => void
  defaultRange?: string
}

// §DEFAULT-CARDS: Recommended default card IDs in order.
// §P16-STEP3.8.1: Reordered per approved Phase E priority:
//   PRIMARY PERFORMANCE → SECONDARY FINANCIAL → INVENTORY/OPS → HEALTH
// Added 2 new cards: netProfitLoss (visible) + grossProfit (hidden).
export const DEFAULT_CARD_CONFIG = [
  // §PRIMARY-PERFORMANCE
  { id: 'totalSales',       visible: true,  order: 0 },
  { id: 'netProfitLoss',    visible: true,  order: 1 },
  { id: 'totalCollection',  visible: true,  order: 2 },
  { id: 'totalRevenue',     visible: true,  order: 3 },

  // §SECONDARY-FINANCIAL
  { id: 'totalReceivable',  visible: true,  order: 4 },
  { id: 'totalPayable',     visible: true,  order: 5 },
  { id: 'totalExpense',     visible: true,  order: 6 },

  // §INVENTORY-OPERATIONS
  { id: 'lowStock',         visible: true,  order: 7 },
  { id: 'stockValue',       visible: true,  order: 8 },

  // §HEALTH-INSIGHTS
  { id: 'businessHealth',   visible: true,  order: 9 },

  // §HIDDEN-BY-DEFAULT
  { id: 'todaySales',       visible: false, order: 10 },
  { id: 'monthlyRevenue',   visible: false, order: 11 },
  { id: 'grossProfit',      visible: false, order: 12 },
  { id: 'totalCustomers',   visible: false, order: 13 },
  { id: 'totalProducts',    visible: false, order: 14 },
  { id: 'totalInvoices',    visible: false, order: 15 },
]

export type CardConfig = Array<{ id: string; visible: boolean; order: number }>

// §PARSE-CARD-CONFIG: Defensive parse with fallback to defaults
export function parseCardConfig(raw: any): CardConfig {
  if (!raw) return DEFAULT_CARD_CONFIG
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(parsed)) return DEFAULT_CARD_CONFIG
    // Filter to known IDs, validate types
    const KNOWN_IDS = new Set(DEFAULT_CARD_CONFIG.map(c => c.id))
    const clean = parsed
      .filter((c: any) => typeof c?.id === 'string' && KNOWN_IDS.has(c.id) && typeof c.visible === 'boolean' && typeof c.order === 'number')
      .map((c: any) => ({ id: c.id, visible: c.visible, order: c.order }))
    // Merge: add any missing known cards as hidden
    for (const def of DEFAULT_CARD_CONFIG) {
      if (!clean.find((c: any) => c.id === def.id)) {
        clean.push({ ...def, visible: false })
      }
    }
    return clean.sort((a: any, b: any) => a.order - b.order)
  } catch {
    return DEFAULT_CARD_CONFIG
  }
}

// ─── Sortable Card Item ─────────────────────────────────────────────────

function SortableCardItem({ card, visible, onToggle }: {
  card: { id: string; label: string; icon: typeof Wallet; description: string; recommended?: boolean }
  visible: boolean
  onToggle: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const Icon = card.icon
  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2 p-2.5 rounded-xl bg-muted/40 hover:bg-muted transition-colors h-[52px]">
      <button {...attributes} {...listeners} className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground shrink-0 p-1" aria-label="Drag to reorder">
        <GripVertical className="w-4 h-4" />
      </button>
      <span className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="w-4 h-4 text-primary" />
      </span>
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{card.label}</span>
          {card.recommended && <span className="text-[8px] px-1 py-0.5 rounded bg-primary/10 text-primary font-bold shrink-0">REC</span>}
        </div>
        <p className="text-[10px] text-muted-foreground truncate">{card.description}</p>
      </div>
      <button onClick={onToggle} className={`w-9 h-5 rounded-full flex items-center transition-colors shrink-0 ${visible ? 'bg-primary justify-end' : 'bg-muted justify-start'}`} aria-label={visible ? 'Hide card' : 'Show card'}>
        <span className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5 flex items-center justify-center">
          {visible ? <Eye className="w-2.5 h-2.5 text-primary" /> : <EyeOff className="w-2.5 h-2.5 text-muted-foreground" />}
        </span>
      </button>
    </div>
  )
}

// ─── Dashboard Card Management Sheet ────────────────────────────────────

export function DashboardCardManagementSheet({
  open,
  onClose,
  cardDefs,
  savedConfig,
  onSave,
}: {
  open: boolean
  onClose: () => void
  cardDefs: Array<{ id: string; label: string; icon: typeof Wallet; description: string; recommended?: boolean }>
  savedConfig: CardConfig
  onSave: (config: CardConfig) => Promise<void>
}) {
  const [draft, setDraft] = useState<CardConfig>(savedConfig)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(savedConfig)
      setSaveError(null)
      setSaveSuccess(false)
      setShowDiscardConfirm(false)
    }
  }, [open, savedConfig])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedConfig)

  const tryClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true)
    } else {
      onClose()
    }
  }

  const cancel = () => {
    setDraft(savedConfig)
    setSaveError(null)
    setSaveSuccess(false)
    setShowDiscardConfirm(false)
    onClose()
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      await onSave(draft)
      setSaveSuccess(true)
      setTimeout(() => {
        onClose()
        setSaveSuccess(false)
      }, 800)
    } catch {
      setSaveError('Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = (id: string) => {
    setDraft(prev => prev.map(c => c.id === id ? { ...c, visible: !c.visible } : c))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraft(prev => {
      const oldIndex = prev.findIndex(c => c.id === active.id)
      const newIndex = prev.findIndex(c => c.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      const reordered = arrayMove(prev, oldIndex, newIndex)
      return reordered.map((c, i) => ({ ...c, order: i }))
    })
  }

  const handleMoveUp = (id: string) => {
    setDraft(prev => {
      const index = prev.findIndex(c => c.id === id)
      if (index <= 0) return prev
      const reordered = arrayMove(prev, index, index - 1)
      return reordered.map((c, i) => ({ ...c, order: i }))
    })
  }

  const handleMoveDown = (id: string) => {
    setDraft(prev => {
      const index = prev.findIndex(c => c.id === id)
      if (index < 0 || index >= prev.length - 1) return prev
      const reordered = arrayMove(prev, index, index + 1)
      return reordered.map((c, i) => ({ ...c, order: i }))
    })
  }

  const handleReset = () => {
    setDraft(DEFAULT_CARD_CONFIG.map(c => ({ ...c })))
  }

  // Sort draft by order for display
  const sortedDraft = [...draft].sort((a, b) => a.order - b.order)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={tryClose}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="fixed bottom-0 inset-x-0 z-[100] bg-card rounded-t-3xl border-t border-border max-w-2xl mx-auto max-h-[85vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 pb-2 border-b border-border">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Settings className="w-4 h-4" /> Manage Dashboard Cards
              </h3>
              <button onClick={tryClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={sortedDraft.map(c => c.id)} strategy={verticalListSortingStrategy}>
                  {sortedDraft.map((cardConfig) => {
                    const def = cardDefs.find(d => d.id === cardConfig.id)
                    if (!def) return null
                    return (
                      <div key={cardConfig.id} className="flex items-center gap-1">
                        <div className="flex-1">
                          <SortableCardItem
                            card={def}
                            visible={cardConfig.visible}
                            onToggle={() => handleToggle(cardConfig.id)}
                          />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <button
                            onClick={() => handleMoveUp(cardConfig.id)}
                            className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground"
                            aria-label="Move up"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleMoveDown(cardConfig.id)}
                            className="w-6 h-6 rounded hover:bg-muted flex items-center justify-center text-muted-foreground"
                            aria-label="Move down"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </SortableContext>
              </DndContext>

              {/* Reset */}
              <button onClick={handleReset} className="w-full text-xs text-muted-foreground hover:text-foreground py-2 mt-2">
                Reset to recommended defaults
              </button>
            </div>

            {/* Sticky footer */}
            <div className="border-t border-border p-3 flex items-center gap-2 bg-card">
              {saveError && <span className="text-[10px] text-destructive flex-1">{saveError}</span>}
              {saveSuccess && <span className="text-[10px] text-emerald-600 flex-1">✓ Changes saved</span>}
              {!saveError && !saveSuccess && <span className="flex-1" />}
              <button onClick={tryClose} disabled={saving} className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors min-h-[44px] disabled:opacity-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving || !isDirty} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50 flex items-center gap-1.5">
                {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'No changes'}
              </button>
            </div>
          </motion.div>

          {/* Discard confirmation */}
          <AnimatePresence>
            {showDiscardConfirm && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4"
                onClick={() => setShowDiscardConfirm(false)}
              >
                <motion.div
                  initial={{ scale: 0.9 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0.9 }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-card rounded-2xl p-5 max-w-xs w-full space-y-3"
                >
                  <p className="text-sm font-semibold text-center">Discard unsaved changes?</p>
                  <p className="text-[11px] text-muted-foreground text-center">Your draft changes will be lost.</p>
                  <div className="flex gap-2 pt-2">
                    <button onClick={() => setShowDiscardConfirm(false)} className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium min-h-[44px]">
                      Continue Editing
                    </button>
                    <button onClick={cancel} className="flex-1 px-3 py-2.5 rounded-xl bg-destructive/10 text-destructive text-xs font-medium min-h-[44px]">
                      Discard
                    </button>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>
        </>
      )}
    </AnimatePresence>
  )
}
