'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { Home, BookOpen, Package, Receipt, MoreHorizontal, BarChart3, Sparkles, Settings, Bell, Store, Users, History, ShoppingBag, ClipboardList, MessageSquare, MessageCircle, ListTodo } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { ViewId } from '@/lib/types'
import { useState } from 'react'
import { X } from 'lucide-react'

const TABS: Array<{ id: ViewId | 'more'; icon: typeof Home; labelKey: string }> = [
  { id: 'dashboard', icon: Home, labelKey: 'nav.home' },
  { id: 'khata', icon: BookOpen, labelKey: 'nav.khata' },
  { id: 'inventory', icon: Package, labelKey: 'nav.inventory' },
  { id: 'billing', icon: Receipt, labelKey: 'nav.billing' },
  { id: 'more', icon: MoreHorizontal, labelKey: 'nav.more' },
]

// §MORE-ITEMS-I18N (Task 10): labelKeys are REAL dictionary keys now —
// they were raw English strings ('Fulfillment', 'Staff', …) which t()
// silently echoed back, so bn/hi users saw an English More sheet.
const MORE_ITEMS = [
  { id: 'fulfillment' as ViewId, icon: ClipboardList, labelKey: 'more.fulfillment', color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30' },
  { id: 'online-orders' as ViewId, icon: ShoppingBag, labelKey: 'more.onlineOrders', color: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-900/30' },
  { id: 'history' as ViewId, icon: History, labelKey: 'more.history', color: 'text-orange-600 bg-orange-100 dark:bg-orange-900/30' },
  { id: 'sourcing' as ViewId, icon: Store, labelKey: 'more.sourcing', color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' },
  { id: 'reports' as ViewId, icon: BarChart3, labelKey: 'rep.title', color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
  { id: 'ai-tools' as ViewId, icon: Sparkles, labelKey: 'ai.tools', color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' },
  { id: 'notifications' as ViewId, icon: Bell, labelKey: 'header.notifications', color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
  { id: 'staff' as ViewId, icon: Users, labelKey: 'more.staff', color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' },
  { id: 'complaints' as ViewId, icon: MessageSquare, labelKey: 'more.complaints', color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
  { id: 'followups' as ViewId, icon: ListTodo, labelKey: 'more.followups', color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' },
  { id: 'messages' as ViewId, icon: MessageCircle, labelKey: 'more.messages', color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
  { id: 'settings' as ViewId, icon: Settings, labelKey: 'set.title', color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' },
]

// §MORE-MENU-GROUPS: the flat 12-tile grid becomes 4 labeled sections —
// Operations / Insights / Communications / Management — so a merchant can
// find a tool by its JOB instead of scanning a wall of icons.
const MORE_GROUPS: Array<{ labelKey: string; itemIds: ViewId[] }> = [
  { labelKey: 'more.group.ops', itemIds: ['fulfillment', 'online-orders', 'history', 'sourcing'] },
  { labelKey: 'more.group.insights', itemIds: ['reports', 'ai-tools'] },
  { labelKey: 'more.group.comms', itemIds: ['notifications', 'complaints', 'followups', 'messages'] },
  { labelKey: 'more.group.mgmt', itemIds: ['staff', 'settings'] },
]

export function BottomTabNav() {
  const { activeView, setActiveView } = useAppStore()
  const { t } = useI18n()
  const [moreOpen, setMoreOpen] = useState(false)
  // PRD Part 30 §2: RBAC — Sales role hides Khata & More
  const { data: settings } = useFetch<any>('/api/app-settings', [])
  const userRole = settings?.userRole || 'owner'
  const visibleTabs = TABS.filter(tab => {
    if (userRole === 'sales') {
      return tab.id !== 'khata' && tab.id !== 'more'
    }
    return true
  })

  // §TAB-POP-TO-ROOT: Tapping a tab always returns that tab to its ROOT list —
  // the standard mobile tab-bar convention. Sub-view selections (party /
  // invoice / product detail) render INSIDE a tab; without this, navigating
  // away via the bottom nav left the selection persisted, so returning to the
  // tab silently REOPENED the last detail view instead of the list (verified
  // bug for both Khata party-detail and Inventory product-profile). Also
  // makes tapping the ALREADY-ACTIVE tab pop an open detail back to the list
  // (setActiveView early-returns on same-view, so this is the only path).
  // Safe by construction: every set-selection-then-navigate flow (search
  // overlay, Reports, drilldown sheets, dashboard links, browser back) calls
  // setActiveView DIRECTLY and never routes through this handler.
  const popSubViewsToRoot = () => {
    const s = useAppStore.getState()
    if (s.selectedPartyId) s.setSelectedPartyId(null)
    if (s.selectedProductId) s.setSelectedProductId(null)
    if (s.selectedInvoiceId) s.setSelectedInvoiceId(null)
  }

  const handleTab = (id: ViewId | 'more') => {
    if (id === 'more') {
      setMoreOpen(true)
    } else {
      popSubViewsToRoot()
      setActiveView(id)
    }
  }

  const pickMore = (id: ViewId) => {
    popSubViewsToRoot()
    setActiveView(id)
    setMoreOpen(false)
  }

  return (
    <>
      <nav className="fixed bottom-0 inset-x-0 z-40 bg-background/95 backdrop-blur-xl border-t border-border pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch h-16 max-w-2xl mx-auto">
          {visibleTabs.map((tab) => {
            const isActive =
              tab.id === 'more'
                ? ['reports', 'sourcing', 'ai-tools', 'settings', 'notifications', 'staff', 'online-orders', 'complaints', 'followups', 'messages'].includes(activeView)
                : activeView === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => handleTab(tab.id)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[48px] relative group px-1"
                aria-label={t(tab.labelKey)}
                aria-current={isActive ? 'page' : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="active-tab"
                    className="absolute top-0 h-1 w-10 rounded-full bg-primary"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                {/* §ACTIVE-PILL: subtle tinted pill behind icon+label gives the
                    active tab a tap-target affordance beyond color alone
                    (VLM review: color-only active state lacks affordance). */}
                {isActive && (
                  <motion.div
                    layoutId="active-tab-pill"
                    className="absolute inset-x-1.5 inset-y-2 rounded-2xl bg-primary/10 dark:bg-primary/15"
                    transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                  />
                )}
                <Icon
                  className={`w-5 h-5 transition-colors relative ${
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`}
                />
                <span
                  className={`text-[10px] font-medium leading-none transition-colors relative ${
                    isActive ? 'text-primary' : 'text-muted-foreground'
                  }`}
                >
                  {t(tab.labelKey)}
                </span>
              </button>
            )
          })}
        </div>
      </nav>

      {/* More menu — bottom sheet */}
      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMoreOpen(false)}
              className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="fixed bottom-0 inset-x-0 z-[60] bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(env(safe-area-inset-bottom)+16px)] shadow-2xl"
            >
              {/* §SHEET-HANDLE: bg-border (not bg-muted) — VLM flagged the
                  faint handle against white; this is the draggable affordance. */}
              <div className="w-10 h-1 rounded-full bg-border mx-auto mb-4" />
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">{t('more.title')}</h3>
                <button onClick={() => setMoreOpen(false)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center" aria-label={t('more.close')}>
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="max-h-[65vh] overflow-y-auto no-scrollbar space-y-4">
                {MORE_GROUPS.map((group) => (
                  <div key={group.labelKey}>
                    <p className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground mb-1.5 px-1">
                      {t(group.labelKey)}
                    </p>
                    <div className="grid grid-cols-4 gap-1.5">
                      {group.itemIds.map((id) => {
                        const item = MORE_ITEMS.find((mi) => mi.id === id)!
                        const Icon = item.icon
                        return (
                          <button
                            key={item.id}
                            onClick={() => pickMore(item.id)}
                            className="flex flex-col items-center gap-1.5 p-2 rounded-2xl hover:bg-muted active:scale-95 transition-all min-h-[76px] justify-center"
                          >
                            <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.color}`}>
                              <Icon className="w-4.5 h-4.5" />
                            </span>
                            <span className="text-[9px] font-medium text-center leading-tight">{t(item.labelKey)}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
