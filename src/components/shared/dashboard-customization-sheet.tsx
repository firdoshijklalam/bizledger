'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Loader2, Settings, ChevronUp, ChevronDown,
  LayoutGrid, BarChart3, Users, Package, ArrowLeftRight, Zap,
  RotateCcw, Check,
} from 'lucide-react'
import { SortableList, SortableListItem, DragHandle, reconstructOrderFromDrag } from '@/components/shared/sortable-list'
import { DashboardVisibilityToggle } from '@/components/shared/dashboard-visibility-toggle'
import {
  DEFAULT_DASHBOARD_CONFIG,
  parseDashboardSectionConfig,
  isSectionVisible,
  moveItemInOrder,
  resolveConfirmMode,
  normalizeDefaultTabBeforeSave,
  type DashboardSectionConfig,
  type DashboardSection,
} from '@/lib/dashboard-preferences'

/**
 * §DASHBOARD-CUSTOMIZATION-SHEET: Full "Customize Dashboard" bottom sheet.
 *
 * Allows the user to:
 *   - Show/Hide dashboard sections (6 sections)
 *   - Reorder dashboard sections (move up/down)
 *   - Access "Manage Summary Cards →" (opens existing DashboardCardManagementSheet)
 *   - Reset to defaults
 *
 * §REUSE: Does NOT duplicate card management. The "Manage Summary Cards →"
 * button is a link that opens the existing DashboardCardManagementSheet
 * (passed via onManageCards callback).
 *
 * §PERSISTENCE: Saves via POST /api/card-customization with
 * { dashboardSections: JSON.stringify(config) }. The API validates and
 * persists to AppSettings.dashboardSections.
 *
 * §MOBILE: Bottom sheet pattern, min 44px touch targets, no horizontal overflow.
 */

interface DashboardCustomizationSheetProps {
  open: boolean
  onClose: () => void
  savedConfig: DashboardSectionConfig | null
  onSave: (config: DashboardSectionConfig) => Promise<void>
  onManageCards: () => void
}

const SECTION_LABELS: Record<string, { label: string; icon: typeof LayoutGrid }> = {
  summaryCards: { label: 'Summary Cards', icon: LayoutGrid },
  performanceChart: { label: 'Performance Chart', icon: BarChart3 },
  customerQuality: { label: 'Customer Quality Distribution', icon: Users },
  topInsights: { label: 'Top Insights', icon: Users },
  businessActivity: { label: 'Business Activity', icon: Package },
  quickActions: { label: 'Quick Actions', icon: Zap },
}

export function DashboardCustomizationSheet({
  open, onClose, savedConfig, onSave, onManageCards,
}: DashboardCustomizationSheetProps) {
  const [draft, setDraft] = useState<DashboardSectionConfig>(savedConfig ?? DEFAULT_DASHBOARD_CONFIG)
  const [saving, setSaving] = useState(false)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    if (open) {
      setDraft(savedConfig ?? DEFAULT_DASHBOARD_CONFIG)
      setShowResetConfirm(false)
    }
  }, [open, savedConfig])

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedConfig ?? DEFAULT_DASHBOARD_CONFIG)

  const tryClose = () => {
    if (isDirty) {
      setShowResetConfirm(true)
    } else {
      onClose()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await onSave(draft)
      setTimeout(() => onClose(), 500)
    } catch {
      // Error handled by caller
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = (id: string) => {
    setDraft(prev => ({
      ...prev,
      sections: prev.sections.map(s => s.id === id ? { ...s, visible: !s.visible } : s),
    }))
  }

  const handleMove = (id: string, direction: 'up' | 'down') => {
    setDraft(prev => {
      const sorted = [...prev.sections].sort((a, b) => a.order - b.order)
      const index = sorted.findIndex(s => s.id === id)
      if (index < 0) return prev
      const swapIndex = direction === 'up' ? index - 1 : index + 1
      if (swapIndex < 0 || swapIndex >= sorted.length) return prev
      const temp = sorted[index].order
      sorted[index].order = sorted[swapIndex].order
      sorted[swapIndex].order = temp
      return { ...prev, sections: sorted }
    })
  }

  const handleReset = () => {
    setDraft(DEFAULT_DASHBOARD_CONFIG)
    setShowResetConfirm(false)
  }

  const sortedDraft = [...draft.sections].sort((a, b) => a.order - b.order)

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
            <div className="flex items-center justify-between p-4 pb-2 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Settings className="w-4 h-4" /> Customize Dashboard
              </h3>
              <button onClick={tryClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto overscroll-contain p-4 space-y-3 flex-1">
              {/* Show/Hide + Reorder Sections — §STEP-4C: now with DnD via SortableList */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Dashboard Sections</p>
                <p className="text-[10px] text-muted-foreground/70 mb-3">Toggle visibility and reorder sections. Changes apply on save.</p>
                <SortableList
                  sortableItems={sortedDraft.map(s => s.id)}
                  onReorder={(newOrder) => {
                    // §STEP-4C-FIX: All sections are always sortable (no hidden sections in this list).
                    // Re-index the sections from the new order.
                    setDraft(prev => {
                      const newSections = newOrder.map((id, idx) => {
                        const existing = prev.sections.find(s => s.id === id)
                        return existing ? { ...existing, order: idx } : { id: id as any, visible: true, order: idx }
                      })
                      return { ...prev, sections: newSections }
                    })
                  }}
                >
                  <div className="space-y-2">
                    {sortedDraft.map((section, i) => {
                      const meta = SECTION_LABELS[section.id] || { label: section.id, icon: LayoutGrid }
                      const Icon = meta.icon
                      return (
                        <SortableListItem key={section.id} id={section.id}>
                          {({ dragHandleProps }) => (
                            <div className={`flex items-center gap-2 p-3 rounded-xl border ${section.visible ? 'border-border bg-card' : 'border-border/50 bg-muted/30'}`}>
                              {/* §STEP-4C: Drag handle */}
                              <DragHandle {...dragHandleProps} />
                              {/* §STEP-4C: Keep ↑/↓ as accessibility fallback */}
                              <div className="flex flex-col gap-0.5 shrink-0">
                                <button
                                  onClick={() => handleMove(section.id, 'up')}
                                  disabled={i === 0}
                                  className="w-7 h-5 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                  aria-label="Move up"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => handleMove(section.id, 'down')}
                                  disabled={i === sortedDraft.length - 1}
                                  className="w-7 h-5 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
                                  aria-label="Move down"
                                >
                                  <ChevronDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              {/* Icon */}
                              <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${section.visible ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                                <Icon className="w-4 h-4" />
                              </span>
                              {/* Label */}
                              <div className="min-w-0 flex-1">
                                <p className={`text-xs font-medium truncate ${section.visible ? '' : 'text-muted-foreground'}`}>
                                  {meta.label}
                                </p>
                              </div>
                              {/* §STEP-4B-UI-CONSISTENCY: Standardized DashboardVisibilityToggle */}
                              <DashboardVisibilityToggle
                                visible={section.visible}
                                onChange={() => handleToggle(section.id)}
                                ariaLabel={section.visible ? 'Hide section' : 'Show section'}
                              />
                            </div>
                          )}
                        </SortableListItem>
                      )
                    })}
                  </div>
                </SortableList>
              </div>

              {/* Manage Summary Cards link */}
              <div className="pt-2 border-t border-border">
                <button
                  onClick={() => { onManageCards(); onClose() }}
                  className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-muted transition-colors text-left min-h-[44px]"
                >
                  <span className="text-xs font-medium flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-muted-foreground" />
                    Manage Summary Cards
                  </span>
                  <ChevronDown className="w-4 h-4 text-muted-foreground -rotate-90" />
                </button>
              </div>

              {/* Reset */}
              <div className="pt-2 border-t border-border">
                {showResetConfirm ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Restore dashboard layout and visibility to defaults?
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="flex-1 py-2 rounded-lg bg-muted text-xs font-medium hover:bg-muted/80 min-h-[44px]"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleReset}
                        className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 min-h-[44px]"
                      >
                        Restore Defaults
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-h-[44px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">Restore Dashboard Defaults</span>
                  </button>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 pt-2 border-t border-border shrink-0 flex gap-2">
              <button
                onClick={tryClose}
                className="flex-1 py-2.5 rounded-xl bg-muted text-xs font-medium hover:bg-muted/80 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isDirty ? <Check className="w-3.5 h-3.5" /> : null}
                {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'No changes'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ─── Section Settings Sheet (reusable per-section settings) ─────────────
//
// §STEP-3C: Converted from immediate-save to local draft + explicit Save.
//   - The sheet owns a `draft: DashboardSectionConfig` initialized from savedConfig.
//   - All toggle/move/default/reset operations mutate ONLY the draft (no network).
//   - Save persists via the parent's onSave callback (one POST), closes on success.
//   - On failure, the sheet stays open, draft intact, error shown.
//   - The parent's dashSectionConfig is NOT mutated until save succeeds.
//   - The Customer Quality advanced panel is rendered inside the sheet (via sectionId)
//     so it can mutate the draft directly.

interface SectionSettingsSheetProps {
  open: boolean
  onClose: () => void
  title: string
  // §STEP-3C: the section this sheet configures — drives which sub-config + advanced panel to render
  sectionId: 'customerQuality' | 'topInsights' | 'businessActivity' | 'quickActions'
  // §STEP-3C: the committed config from the parent — draft initializes from this on open
  savedConfig: DashboardSectionConfig
  // §STEP-3C: persist the draft — called on Save. Throws on failure.
  onSave: (config: DashboardSectionConfig) => Promise<void>
  // Static item metadata (labels) for the toggle list
  items: Array<{ id: string; label: string }>
  // §STEP-3C: whether this section supports a default-item selector + reordering
  supportsDefault?: boolean
  supportsReorder?: boolean
  // §STEP-3C: the section-level reset target (defaults for THIS section only)
  sectionDefaults: DashboardSectionConfig['customerQuality'] | DashboardSectionConfig['topInsights'] | DashboardSectionConfig['businessActivity'] | DashboardSectionConfig['quickActions']
}

export function SectionSettingsSheet({
  open, onClose, title, sectionId, savedConfig, onSave, items,
  supportsDefault, supportsReorder, sectionDefaults,
}: SectionSettingsSheetProps) {
  const [draft, setDraft] = useState<DashboardSectionConfig>(savedConfig)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // §STEP-3C-FIX: Replaced ambiguous `showResetConfirm: boolean` with an explicit
  // intent state. This fixes the bug where the Restore Default button was
  // hijacked by the discard-confirm path when the draft was dirty.
  //   'discard' = user is closing/discard-ending a dirty sheet (from X/backdrop/Cancel)
  //   'reset'   = user clicked Restore Default (wants to reset draft to defaults, stay open)
  //   null      = no confirmation shown
  const [confirmMode, setConfirmMode] = useState<'discard' | 'reset' | null>(null)

  // §STEP-3C: Re-sync draft to savedConfig when the sheet opens (false→true).
  // Mirrors the DashboardCustomizationSheet pattern (L61-66).
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setDraft(savedConfig)
      setSaveError(null)
      setConfirmMode(null)
    }
  }

  const isDirty = JSON.stringify(draft) !== JSON.stringify(savedConfig)

  // ── Draft mutation helpers (NO network) ──────────────────────────────
  const sectionVisible = isSectionVisible(draft, sectionId)

  const toggleSection = (visible: boolean) => {
    setDraft(prev => ({ ...prev, sections: prev.sections.map(s => s.id === sectionId ? { ...s, visible } : s) }))
  }

  // §STEP-3C: generic per-section field updater — used for visibleTabs/visibleActions etc.
  const updateSection = (updater: (prev: DashboardSectionConfig) => DashboardSectionConfig) => {
    setDraft(prev => updater(prev))
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      // §STEP-4F-CORRECTION: Normalize defaultTab before saving so the persisted
      // config never contains a defaultTab that references a hidden tab.
      const normalizedDraft = normalizeDefaultTabBeforeSave(draft)
      await onSave(normalizedDraft)
      // §STEP-3C: parent's onSave updates dashSectionConfig on success.
      // Close after a short delay to let the success state show (matches DashboardCustomizationSheet).
      setTimeout(() => onClose(), 300)
    } catch (e: any) {
      // §STEP-3C: failure — sheet stays open, draft intact, error visible.
      setSaveError(e?.message || 'Save failed. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  const tryClose = () => {
    // §STEP-3C-FIX: dirty close → discard confirmation intent (NOT reset).
    // Uses the pure resolveConfirmMode helper so the tested logic matches the component.
    const mode = resolveConfirmMode('close', isDirty)
    if (mode === null) {
      onClose()
    } else {
      setConfirmMode(mode)
    }
  }

  const handleReset = () => {
    // §STEP-3C: reset ONLY this section's sub-config to defaults (in draft, not persisted).
    // §STEP-3C-FIX: other sections of the draft remain unchanged. No network request.
    setDraft(prev => ({ ...prev, [sectionId]: JSON.parse(JSON.stringify(sectionDefaults)) }))
    setConfirmMode(null)
  }

  // ── Derive display values from the DRAFT (not savedConfig) ────────────
  const cq = draft.customerQuality
  const ti = draft.topInsights
  const ba = draft.businessActivity
  const qa = draft.quickActions

  // visibleItems + itemOrder + defaultItemId come from the draft's section
  const visibleItems =
    sectionId === 'customerQuality' ? cq.visibleGrades
    : sectionId === 'topInsights' ? ti.visibleTabs
    : sectionId === 'businessActivity' ? ba.visibleTabs
    : qa.visibleActions
  const itemOrder = supportsReorder
    ? (sectionId === 'topInsights' ? ti.order
      : sectionId === 'businessActivity' ? ba.order
      : qa.order)
    : undefined
  const defaultItemId = supportsDefault
    ? (sectionId === 'topInsights' ? ti.defaultTab
      : sectionId === 'businessActivity' ? ba.defaultTab
      : undefined)
    : undefined

  // ── Item-level draft mutations ───────────────────────────────────────
  const onToggleItem = (id: string) => {
    updateSection(prev => {
      if (sectionId === 'customerQuality') {
        const grades = prev.customerQuality.visibleGrades
        const newGrades = grades.includes(id) ? grades.filter(g => g !== id) : [...grades, id]
        return { ...prev, customerQuality: { ...prev.customerQuality, visibleGrades: newGrades } }
      }
      if (sectionId === 'topInsights') {
        const tabs = prev.topInsights.visibleTabs
        const newTabs = tabs.includes(id) ? tabs.filter(t => t !== id) : [...tabs, id]
        return { ...prev, topInsights: { ...prev.topInsights, visibleTabs: newTabs } }
      }
      if (sectionId === 'businessActivity') {
        const tabs = prev.businessActivity.visibleTabs
        const newTabs = tabs.includes(id) ? tabs.filter(t => t !== id) : [...tabs, id]
        return { ...prev, businessActivity: { ...prev.businessActivity, visibleTabs: newTabs } }
      }
      // quickActions
      const actions = prev.quickActions.visibleActions
      const newActions = actions.includes(id) ? actions.filter(a => a !== id) : [...actions, id]
      return { ...prev, quickActions: { ...prev.quickActions, visibleActions: newActions } }
    })
  }

  const onMoveItem = supportsReorder ? (id: string, direction: 'up' | 'down') => {
    updateSection(prev => {
      if (sectionId === 'topInsights') {
        const newOrder = moveItemInOrder(prev.topInsights.order, prev.topInsights.visibleTabs, id, direction)
        if (!newOrder) return prev
        return { ...prev, topInsights: { ...prev.topInsights, order: newOrder } }
      }
      if (sectionId === 'businessActivity') {
        const newOrder = moveItemInOrder(prev.businessActivity.order, prev.businessActivity.visibleTabs, id, direction)
        if (!newOrder) return prev
        return { ...prev, businessActivity: { ...prev.businessActivity, order: newOrder } }
      }
      // quickActions
      const newOrder = moveItemInOrder(prev.quickActions.order, prev.quickActions.visibleActions, id, direction)
      if (!newOrder) return prev
      return { ...prev, quickActions: { ...prev.quickActions, order: newOrder } }
    })
  } : undefined

  const onSetDefault = supportsDefault ? (id: string) => {
    updateSection(prev => {
      if (sectionId === 'topInsights') return { ...prev, topInsights: { ...prev.topInsights, defaultTab: id } }
      if (sectionId === 'businessActivity') return { ...prev, businessActivity: { ...prev.businessActivity, defaultTab: id } }
      return prev
    })
  } : undefined

  // Sort items by draft order for display (when reorder is supported)
  const sortedItems = supportsReorder && itemOrder
    ? [...items].sort((a, b) => {
        const aIdx = itemOrder.indexOf(a.id)
        const bIdx = itemOrder.indexOf(b.id)
        return (aIdx < 0 ? 999 : aIdx) - (bIdx < 0 ? 999 : bIdx)
      })
    : items

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={tryClose}
            className="fixed inset-0 z-[95] bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="fixed bottom-0 inset-x-0 z-[105] bg-card rounded-t-3xl border-t border-border max-w-2xl mx-auto max-h-[80vh] flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 pb-2 border-b border-border shrink-0">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <Settings className="w-4 h-4" /> {title} Settings
              </h3>
              <button onClick={tryClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto overscroll-contain p-4 space-y-4 flex-1">
              {/* §STEP-4B-UI-CONSISTENCY: Section visibility — standardized DashboardVisibilityToggle */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                <div>
                  <p className="text-xs font-medium">Show {title}</p>
                  <p className="text-[10px] text-muted-foreground">Toggle this section on the dashboard</p>
                </div>
                <DashboardVisibilityToggle
                  visible={sectionVisible}
                  onChange={() => toggleSection(!sectionVisible)}
                  ariaLabel={sectionVisible ? 'Hide section' : 'Show section'}
                />
              </div>

              {/* Items (tabs/actions) */}
              {items.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">
                    {supportsReorder ? 'Actions' : 'Visible Items'}
                  </p>
                  {/* §STEP-4C-FIX: Wrap reorderable items in SortableList for DnD.
                      Only VISIBLE items are sortable (draggable + droppable).
                      Hidden items are rendered but disabled in the SortableContext. */}
                  {supportsReorder && itemOrder ? (
                    (() => {
                      // §STEP-4C-FIX: Compute the visible-ordered list (only sortable items)
                      const visibleSortedIds = sortedItems
                        .filter(i => visibleItems.includes(i.id))
                        .map(i => i.id)
                      // The full current order (for reconstruction)
                      const fullOrder = itemOrder

                      return (
                    <SortableList
                      sortableItems={visibleSortedIds}
                      onReorder={(newVisibleOrder) => {
                        // §STEP-4C-FIX: Reconstruct the full order from the DnD visible reorder.
                        // Hidden items retain their relative positions; visible items adopt the new order.
                        const reconstructed = reconstructOrderFromDrag(fullOrder, visibleItems, newVisibleOrder)
                        updateSection(prev => {
                          if (sectionId === 'topInsights') {
                            return { ...prev, topInsights: { ...prev.topInsights, order: reconstructed } }
                          }
                          if (sectionId === 'businessActivity') {
                            return { ...prev, businessActivity: { ...prev.businessActivity, order: reconstructed } }
                          }
                          if (sectionId === 'quickActions') {
                            return { ...prev, quickActions: { ...prev.quickActions, order: reconstructed } }
                          }
                          return prev
                        })
                      }}
                    >
                      <div className="space-y-1">
                        {sortedItems.map((item) => {
                          const isVisible = visibleItems.includes(item.id)
                          const isDefault = defaultItemId === item.id
                          const visibleSorted = sortedItems.filter(i => visibleItems.includes(i.id))
                          const visibleIndex = visibleSorted.findIndex(i => i.id === item.id)
                          const canMoveUp = isVisible && visibleIndex > 0
                          const canMoveDown = isVisible && visibleIndex >= 0 && visibleIndex < visibleSorted.length - 1
                          return (
                            <SortableListItem key={item.id} id={item.id} sortable={isVisible}>
                              {({ dragHandleProps }) => (
                                <div className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                                  <div className="flex items-center gap-2 min-w-0 flex-1">
                                    {/* §STEP-4C-FIX: Drag handle — only for visible (sortable) items */}
                                    {isVisible && dragHandleProps && <DragHandle {...dragHandleProps} />}
                                    <DashboardVisibilityToggle
                                      visible={isVisible}
                                      onChange={() => onToggleItem(item.id)}
                                      ariaLabel={isVisible ? `Hide ${item.label}` : `Show ${item.label}`}
                                    />
                                    <span className={`text-xs font-medium truncate ${isVisible ? '' : 'text-muted-foreground line-through'}`}>
                                      {item.label}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {/* §STEP-4C: Keep ↑/↓ as accessibility fallback */}
                                    {isVisible && (
                                      <div className="flex items-center gap-0.5">
                                        <button
                                          onClick={() => onMoveItem?.(item.id, 'up')}
                                          disabled={!canMoveUp}
                                          className="w-7 h-7 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                          aria-label={`Move ${item.label} up`}
                                        >
                                          <ChevronUp className="w-3.5 h-3.5" />
                                        </button>
                                        <button
                                          onClick={() => onMoveItem?.(item.id, 'down')}
                                          disabled={!canMoveDown}
                                          className="w-7 h-7 rounded hover:bg-muted flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                                          aria-label={`Move ${item.label} down`}
                                        >
                                          <ChevronDown className="w-3.5 h-3.5" />
                                        </button>
                                      </div>
                                    )}
                                    {onSetDefault && isVisible && (
                                      <button
                                        onClick={() => onSetDefault(item.id)}
                                        className={`text-[10px] px-2 py-1 rounded-md shrink-0 ${isDefault ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                                      >
                                        {isDefault ? '✓ Default' : 'Set Default'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              )}
                            </SortableListItem>
                          )
                        })}
                      </div>
                    </SortableList>
                      )
                    })()
                  ) : (
                    /* Non-reorderable items (Customer Quality grades) — simple list */
                    <div className="space-y-1">
                      {sortedItems.map((item) => {
                        const isVisible = visibleItems.includes(item.id)
                        return (
                            <div key={item.id} className="flex items-center gap-2 p-2.5 rounded-lg hover:bg-muted/50">
                              <DashboardVisibilityToggle
                                visible={isVisible}
                                onChange={() => onToggleItem(item.id)}
                                ariaLabel={isVisible ? `Hide ${item.label}` : `Show ${item.label}`}
                              />
                              <span className={`text-xs font-medium truncate ${isVisible ? '' : 'text-muted-foreground line-through'}`}>
                                {item.label}
                              </span>
                            </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* §STEP-4E-REVIEW: Quick Actions maxVisible selector */}
              {sectionId === 'quickActions' && (
                <div className="pt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Display</p>
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Maximum Visible Actions</p>
                    <div className="grid grid-cols-3 gap-1">
                      {([4, 6, 8] as const).map((val) => (
                        <button
                          key={val}
                          onClick={() => updateSection(prev => ({ ...prev, quickActions: { ...prev.quickActions, maxVisible: val } }))}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[36px] ${qa.maxVisible === val ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* §STEP-4F: Top Insights advanced controls panel */}
              {sectionId === 'topInsights' && (
                <div className="pt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Display</p>

                  {/* Item count selector */}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Item Count</p>
                    <div className="grid grid-cols-3 gap-1">
                      {([3, 5, 10] as const).map((val) => (
                        <button
                          key={val}
                          onClick={() => updateSection(prev => ({ ...prev, topInsights: { ...prev.topInsights, itemCount: val } }))}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[36px] ${ti.itemCount === val ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          {val}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Display toggles */}
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground mb-1">Show</p>
                    {([
                      ['showRank', 'Show Rank'],
                      ['showAvatar', 'Show Avatar'],
                      ['showAmount', 'Show Amount'],
                    ] as const).map(([field, label]) => {
                      const isEnabled = ti[field]
                      return (
                        <div
                          key={field}
                          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/50 min-h-[40px]"
                        >
                          <span className="text-xs font-medium">{label}</span>
                          {/* §STEP-4B-UI-CONSISTENCY: Use standardized DashboardVisibilityToggle */}
                          <DashboardVisibilityToggle
                            visible={isEnabled}
                            onChange={() => updateSection(prev => ({ ...prev, topInsights: { ...prev.topInsights, [field]: !isEnabled } }))}
                            ariaLabel={isEnabled ? `Hide ${label}` : `Show ${label}`}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* §STEP-2C: Customer Quality advanced controls panel — now mutates the DRAFT */}
              {sectionId === 'customerQuality' && (
                <div className="pt-2 border-t border-border space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground">Chart & Display</p>

                  {/* Chart shape selector */}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Chart Shape</p>
                    <div className="grid grid-cols-3 gap-1">
                      {(['bar', 'donut', 'horizontal'] as const).map((shape) => (
                        <button
                          key={shape}
                          onClick={() => updateSection(prev => ({ ...prev, customerQuality: { ...prev.customerQuality, chartShape: shape } }))}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[36px] ${cq.chartShape === shape ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          {shape === 'bar' ? 'Bar' : shape === 'donut' ? 'Donut' : 'Horizontal'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Sort order selector */}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Sort Order</p>
                    <div className="grid grid-cols-2 gap-1">
                      {([['grade', 'Grade (A→E)'], ['count-desc', 'Highest Count']] as const).map(([order, label]) => (
                        <button
                          key={order}
                          onClick={() => updateSection(prev => ({ ...prev, customerQuality: { ...prev.customerQuality, sortOrder: order } }))}
                          className={`py-1.5 rounded-lg text-[11px] font-medium transition-colors min-h-[36px] ${cq.sortOrder === order ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/80'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* §STEP-2C-REVIEW: Tap enabled ON/OFF toggle */}
                  <div>
                    <p className="text-[10px] text-muted-foreground mb-1.5">Tap to open customers</p>
                    <button
                      onClick={() => updateSection(prev => ({ ...prev, customerQuality: { ...prev.customerQuality, tapEnabled: !prev.customerQuality.tapEnabled } }))}
                      className="w-full flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50"
                    >
                      <span className="text-xs font-medium">
                        {cq.tapEnabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className={`w-9 h-5 rounded-full transition-colors relative ${cq.tapEnabled ? 'bg-primary' : 'bg-muted'}`}>
                        <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${cq.tapEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </span>
                    </button>
                  </div>

                  {/* Display toggles */}
                  <div className="space-y-1">
                    <p className="text-[10px] text-muted-foreground mb-1">Display</p>
                    {([
                      ['showCount', 'Show Count'],
                      ['showPercentage', 'Show Percentage'],
                      ['showDescription', 'Show Description'],
                    ] as const).map(([field, label]) => {
                      const isEnabled = cq[field]
                      return (
                        <button
                          key={field}
                          onClick={() => updateSection(prev => ({ ...prev, customerQuality: { ...prev.customerQuality, [field]: !isEnabled } }))}
                          className="w-full flex items-center justify-between p-2 rounded-lg hover:bg-muted/50"
                        >
                          <span className="text-xs font-medium">{label}</span>
                          <span className={`w-9 h-5 rounded-full transition-colors relative ${isEnabled ? 'bg-primary' : 'bg-muted'}`}>
                            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${isEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* §STEP-3C: Save error (visible only on failure) */}
              {saveError && (
                <div className="p-2.5 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
                  <p className="text-xs text-red-600 dark:text-red-400">{saveError}</p>
                </div>
              )}

              {/* §STEP-3C-FIX: Confirmation dispatches on `confirmMode` (the intent),
                  NOT on `isDirty`. This fixes the bug where Restore Default was
                  hijacked by the discard path when the draft was dirty. */}
              <div className="pt-2 border-t border-border">
                {confirmMode === 'discard' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center py-1">
                      Discard unsaved changes to {title}?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmMode(null)} className="flex-1 py-2 rounded-lg bg-muted text-xs font-medium min-h-[44px]">Continue Editing</button>
                      <button
                        onClick={() => {
                          // §STEP-3C-FIX: discard draft → re-sync to savedConfig + close
                          setDraft(savedConfig)
                          setConfirmMode(null)
                          onClose()
                        }}
                        className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-medium min-h-[44px]"
                      >
                        Discard
                      </button>
                    </div>
                  </div>
                ) : confirmMode === 'reset' ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center py-1">
                      Restore {title} settings to defaults?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setConfirmMode(null)} className="flex-1 py-2 rounded-lg bg-muted text-xs font-medium min-h-[44px]">Cancel</button>
                      <button
                        onClick={() => { handleReset() }}
                        className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-medium min-h-[44px]"
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setConfirmMode(resolveConfirmMode('reset', isDirty) ?? 'reset')}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-h-[44px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">Restore Default</span>
                  </button>
                )}
              </div>
            </div>

            {/* §STEP-3C: Footer with explicit Save / Cancel */}
            <div className="p-4 pt-2 border-t border-border shrink-0 flex gap-2">
              <button
                onClick={tryClose}
                className="flex-1 py-2.5 rounded-xl bg-muted text-xs font-medium hover:bg-muted/80 min-h-[44px]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !isDirty}
                className="flex-1 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5 min-h-[44px]"
              >
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isDirty ? <Check className="w-3.5 h-3.5" /> : null}
                {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'No changes'}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
