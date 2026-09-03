'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Loader2, Settings, ChevronUp, ChevronDown, Eye, EyeOff,
  LayoutGrid, BarChart3, Users, Package, ArrowLeftRight, Zap,
  RotateCcw, Check,
} from 'lucide-react'
import {
  DEFAULT_DASHBOARD_CONFIG,
  parseDashboardSectionConfig,
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
              {/* Show/Hide + Reorder Sections */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground mb-2">Dashboard Sections</p>
                <p className="text-[10px] text-muted-foreground/70 mb-3">Toggle visibility and reorder sections. Changes apply on save.</p>
                <div className="space-y-2">
                  {sortedDraft.map((section, i) => {
                    const meta = SECTION_LABELS[section.id] || { label: section.id, icon: LayoutGrid }
                    const Icon = meta.icon
                    return (
                      <div key={section.id} className={`flex items-center gap-2 p-3 rounded-xl border ${section.visible ? 'border-border bg-card' : 'border-border/50 bg-muted/30'}`}>
                        {/* Move controls */}
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
                        {/* Visibility toggle */}
                        <button
                          onClick={() => handleToggle(section.id)}
                          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 hover:bg-muted transition-colors min-h-[44px]"
                          aria-label={section.visible ? 'Hide section' : 'Show section'}
                        >
                          {section.visible ? (
                            <Eye className="w-4 h-4 text-primary" />
                          ) : (
                            <EyeOff className="w-4 h-4 text-muted-foreground" />
                          )}
                        </button>
                      </div>
                    )
                  })}
                </div>
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

interface SectionSettingsSheetProps {
  open: boolean
  onClose: () => void
  title: string
  // Section-level visibility toggle
  sectionVisible: boolean
  onToggleSection: (visible: boolean) => void
  // Tab/action items to toggle
  items: Array<{ id: string; label: string }>
  visibleItems: string[]
  onToggleItem: (id: string) => void
  // Default item selector
  defaultItemId?: string
  onSetDefault?: (id: string) => void
  // Reset
  onReset: () => void
}

export function SectionSettingsSheet({
  open, onClose, title, sectionVisible, onToggleSection,
  items, visibleItems, onToggleItem, defaultItemId, onSetDefault, onReset,
}: SectionSettingsSheetProps) {
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // Reset confirm state when sheet opens (use key change pattern to avoid setState-in-effect)
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) setShowResetConfirm(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
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
              <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto overscroll-contain p-4 space-y-4 flex-1">
              {/* Section visibility */}
              <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50">
                <div>
                  <p className="text-xs font-medium">Show {title}</p>
                  <p className="text-[10px] text-muted-foreground">Toggle this section on the dashboard</p>
                </div>
                <button
                  onClick={() => onToggleSection(!sectionVisible)}
                  className={`w-12 h-7 rounded-full transition-colors relative ${sectionVisible ? 'bg-primary' : 'bg-muted'}`}
                  aria-label={sectionVisible ? 'Hide section' : 'Show section'}
                >
                  <span className={`absolute top-1 w-5 h-5 rounded-full bg-white transition-transform ${sectionVisible ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              {/* Items (tabs/actions) */}
              {items.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2">Visible Items</p>
                  <div className="space-y-1">
                    {items.map(item => {
                      const isVisible = visibleItems.includes(item.id)
                      const isDefault = defaultItemId === item.id
                      return (
                        <div key={item.id} className="flex items-center justify-between p-2.5 rounded-lg hover:bg-muted/50">
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <button
                              onClick={() => onToggleItem(item.id)}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${isVisible ? 'bg-primary border-primary' : 'border-muted-foreground/30'}`}
                              aria-label={isVisible ? 'Hide' : 'Show'}
                            >
                              {isVisible && <Check className="w-3 h-3 text-primary-foreground" />}
                            </button>
                            <span className={`text-xs font-medium truncate ${isVisible ? '' : 'text-muted-foreground line-through'}`}>
                              {item.label}
                            </span>
                          </div>
                          {onSetDefault && isVisible && (
                            <button
                              onClick={() => onSetDefault(item.id)}
                              className={`text-[10px] px-2 py-1 rounded-md shrink-0 ${isDefault ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted'}`}
                            >
                              {isDefault ? '✓ Default' : 'Set Default'}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Reset */}
              <div className="pt-2 border-t border-border">
                {showResetConfirm ? (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground text-center py-1">
                      Restore {title} settings to defaults?
                    </p>
                    <div className="flex gap-2">
                      <button onClick={() => setShowResetConfirm(false)} className="flex-1 py-2 rounded-lg bg-muted text-xs font-medium min-h-[44px]">Cancel</button>
                      <button onClick={() => { onReset(); setShowResetConfirm(false) }} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-xs font-medium min-h-[44px]">Reset</button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowResetConfirm(true)}
                    className="w-full flex items-center justify-center gap-2 p-3 rounded-xl text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors min-h-[44px]"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span className="text-xs font-medium">Restore Default</span>
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
