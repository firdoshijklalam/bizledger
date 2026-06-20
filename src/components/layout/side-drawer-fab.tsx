'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Plus, UserPlus, PackagePlus, FilePlus, ArrowLeftRight, Zap, X } from 'lucide-react'
import { useEffect } from 'react'

const ACTIONS = [
  { id: 'add-party', icon: UserPlus, labelKey: 'qa.addParty', color: 'text-emerald-600' },
  { id: 'add-product', icon: PackagePlus, labelKey: 'qa.addProduct', color: 'text-amber-600' },
  { id: 'new-invoice', icon: FilePlus, labelKey: 'qa.newInvoice', color: 'text-orange-600' },
  { id: 'add-transaction', icon: ArrowLeftRight, labelKey: 'qa.addTransaction', color: 'text-teal-600' },
  { id: 'quick-sale', icon: Zap, labelKey: 'qa.quickSale', color: 'text-purple-600' },
] as const

export function SideDrawerFab() {
  const { fabOpen, setFabOpen, triggerQuickAction, setActiveView } = useAppStore()
  const { t } = useI18n()

  // Close on outside click + escape
  useEffect(() => {
    if (!fabOpen) return
    const close = () => setFabOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFabOpen(false)
    window.addEventListener('keydown', onKey)
    const timer = setTimeout(() => {
      document.addEventListener('click', close)
    }, 0)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('click', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [fabOpen, setFabOpen])

  const handleAction = (id: string) => {
    if (id === 'quick-sale') {
      setActiveView('sale-pad')
      setFabOpen(false)
      return
    }
    triggerQuickAction({ id: crypto.randomUUID(), type: id as any })
    setFabOpen(false)
  }

  return (
    <>
      {/* Backdrop when open */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px]"
          />
        )}
      </AnimatePresence>

      {/* Quick action menu */}
      <AnimatePresence>
        {fabOpen && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.9 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="fixed right-4 z-50 w-56 bg-card rounded-2xl shadow-2xl border border-border p-2 overflow-hidden"
            style={{ bottom: 'calc(96px + env(safe-area-inset-bottom))' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-3 py-2 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {t('qa.title')}
              </p>
              <button
                onClick={() => setFabOpen(false)}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1">
              {ACTIONS.map((a) => {
                const Icon = a.icon
                return (
                  <button
                    key={a.id}
                    onClick={() => handleAction(a.id)}
                    className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-accent transition-colors min-h-[44px] text-left"
                  >
                    <span className={`shrink-0 ${a.color}`}>
                      <Icon className="w-5 h-5" />
                    </span>
                    <span className="text-sm font-medium flex-1">{t(a.labelKey)}</span>
                  </button>
                )
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* The FAB itself — half hidden on right edge, slides out on click */}
      <motion.button
        onClick={(e) => {
          e.stopPropagation()
          setFabOpen(!fabOpen)
        }}
        className="fixed z-50 flex items-center justify-center w-14 h-14 rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/30 ring-4 ring-background"
        style={{ right: fabOpen ? '16px' : '-20px', bottom: 'calc(88px + env(safe-area-inset-bottom))' }}
        animate={{ x: fabOpen ? 0 : 0 }}
        whileTap={{ scale: 0.9 }}
        aria-label={t('qa.title')}
        aria-expanded={fabOpen}
      >
        <motion.div animate={{ rotate: fabOpen ? 45 : 0 }} transition={{ duration: 0.2 }}>
          {fabOpen ? <Plus className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
        </motion.div>
      </motion.button>
    </>
  )
}
