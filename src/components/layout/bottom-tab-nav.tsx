'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { Home, BookOpen, Package, Receipt, MoreHorizontal, BarChart3, Sparkles, Settings, Bell, Store } from 'lucide-react'
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

const MORE_ITEMS = [
  { id: 'sourcing' as ViewId, icon: Store, labelKey: 'B2B Sourcing', color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' },
  { id: 'reports' as ViewId, icon: BarChart3, labelKey: 'rep.title', color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
  { id: 'sourcing' as ViewId, icon: Store, labelKey: 'nav.sourcing', color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' },
  { id: 'ai-tools' as ViewId, icon: Sparkles, labelKey: 'ai.tools', color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/30' },
  { id: 'notifications' as ViewId, icon: Bell, labelKey: 'header.notifications', color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
  { id: 'settings' as ViewId, icon: Settings, labelKey: 'set.title', color: 'text-teal-600 bg-teal-100 dark:bg-teal-900/30' },
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

  const handleTab = (id: ViewId | 'more') => {
    if (id === 'more') {
      setMoreOpen(true)
    } else {
      setActiveView(id)
    }
  }

  const pickMore = (id: ViewId) => {
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
                ? ['reports', 'sourcing', 'ai-tools', 'settings', 'notifications'].includes(activeView)
                : activeView === tab.id
            const Icon = tab.icon
            return (
              <button
                key={tab.id}
                onClick={() => handleTab(tab.id)}
                className="flex-1 flex flex-col items-center justify-center gap-0.5 min-h-[48px] relative group"
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
                <Icon
                  className={`w-5 h-5 transition-colors ${
                    isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                  }`}
                />
                <span
                  className={`text-[10px] font-medium leading-none transition-colors ${
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
              className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="fixed bottom-0 inset-x-0 z-50 bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(env(safe-area-inset-bottom)+16px)]"
            >
              <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4" />
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold">More Options</h3>
                <button onClick={() => setMoreOpen(false)} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-5 gap-2">
                {MORE_ITEMS.map((item) => {
                  const Icon = item.icon
                  return (
                    <button
                      key={item.id}
                      onClick={() => pickMore(item.id)}
                      className="flex flex-col items-center gap-2 p-2 rounded-2xl hover:bg-muted transition-colors min-h-[80px] justify-center"
                    >
                      <span className={`w-11 h-11 rounded-2xl flex items-center justify-center ${item.color}`}>
                        <Icon className="w-5 h-5" />
                      </span>
                      <span className="text-[10px] font-medium text-center leading-tight">{t(item.labelKey)}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
