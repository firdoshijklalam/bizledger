'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useNotificationStore, type AppNotification } from '@/store/notification-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Party } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, AlertTriangle, AlertCircle, MessageSquare, CheckCircle2, TrendingUp, X } from 'lucide-react'
import { useState, useMemo } from 'react'

const TYPE_META: Record<string, { icon: any; color: string; bg: string }> = {
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  'low-stock': { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  promise: { icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  backup: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  defaulter: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  grade: { icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30' },
}

export function NotificationsView() {
  const { setActiveView, setSelectedPartyId, setInventoryFilter, setKhataFilter } = useAppStore()
  const { t } = useI18n()
  const { notifications, markRead, markAllRead } = useNotificationStore()
  const { data: parties } = useFetch<Party[]>('/api/parties', [])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications
  const unreadCount = notifications.filter((n) => !n.read).length

  // Resolve demo party IDs to real IDs by name match
  const resolvePartyId = (demoId: string, nameHint: string): string | undefined => {
    if (!demoId.startsWith('demo-')) return demoId
    if (!parties) return undefined
    const map: Record<string, string> = {
      'demo-maa-lakshmi': 'Maa Lakshmi',
      'demo-defaulted': 'Defaulted',
      'demo-amit': 'Amit',
    }
    const hint = map[demoId] || nameHint
    const found = parties.find((p) => p.name.includes(hint))
    return found?.id
  }

  const handleAction = (n: AppNotification) => {
    markRead(n.id)
    if (!n.action) return

    const { view, partyId, filter: f } = n.action
    if (partyId) {
      const realId = resolvePartyId(partyId, n.body.split(' ')[0])
      if (realId) setSelectedPartyId(realId)
    }
    if (f === 'receivable') setKhataFilter('receivable')
    if (f === 'low-stock') setInventoryFilter('low-stock')
    setActiveView(view)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t('header.notifications')}</h2>
          <p className="text-[11px] text-muted-foreground">{unreadCount} unread</p>
        </div>
        {unreadCount > 0 && (
          <button onClick={markAllRead} className="text-xs text-primary font-medium">
            Mark all read
          </button>
        )}
      </div>

      <div className="flex items-center gap-2">
        {(['all', 'unread'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium min-h-[36px] ${
              filter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f === 'all' ? 'All' : `Unread (${unreadCount})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Bell className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium">All caught up! 🎉</p>
          <p className="text-xs text-muted-foreground mt-1">No new notifications.</p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((n, i) => {
              const meta = TYPE_META[n.type]
              const Icon = meta.icon
              return (
                <motion.button
                  key={n.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  onClick={() => handleAction(n)}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    n.read ? 'bg-card border-border' : 'bg-card border-primary/30 shadow-sm'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${meta.bg}`}>
                      <Icon className={`w-5 h-5 ${meta.color}`} />
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold flex-1">{n.title}</p>
                        {!n.read && <span className="w-2 h-2 rounded-full bg-primary shrink-0" />}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                      <div className="flex items-center justify-between mt-2">
                        <p className="text-[10px] text-muted-foreground">{n.time}</p>
                        {n.action && (
                          <span className="text-[11px] text-primary font-medium">
                            {n.action.view === 'khata' ? 'View Ledger →' : n.action.view === 'inventory' ? 'Restock →' : n.action.view === 'reports' ? 'View Report →' : 'Open →'}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
