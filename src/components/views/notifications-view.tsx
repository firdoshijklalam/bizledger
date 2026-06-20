'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Bell, AlertTriangle, AlertCircle, MessageSquare, CheckCircle2, TrendingUp, X } from 'lucide-react'
import { useState } from 'react'

interface Notif {
  id: string
  type: 'overdue' | 'low-stock' | 'promise' | 'backup' | 'defaulter' | 'grade'
  title: string
  body: string
  time: string
  read: boolean
  action?: { view: string; label: string }
}

const DEMO_NOTIFS: Notif[] = [
  {
    id: '1', type: 'overdue', title: 'Payment Overdue 🔴',
    body: 'Maa Lakshmi Bhandar has ₹45,000 overdue beyond credit period.',
    time: '2h ago', read: false, action: { view: 'khata', label: 'View Ledger' },
  },
  {
    id: '2', type: 'low-stock', title: 'Low Stock Alert ⚠️',
    body: 'Steel Glass is below threshold (8 units left).',
    time: '5h ago', read: false, action: { view: 'inventory', label: 'Restock' },
  },
  {
    id: '3', type: 'defaulter', title: 'New Defaulter 🚨',
    body: 'Defaulted Customer crossed credit limit (₹68,000 / ₹50,000).',
    time: '1d ago', read: false, action: { view: 'khata', label: 'View Profile' },
  },
  {
    id: '4', type: 'promise', title: 'Payment Promise 💬',
    body: 'Amit Trading promised to pay ₹5,000 by Friday.',
    time: '1d ago', read: true,
  },
  {
    id: '5', type: 'backup', title: 'Backup Complete ✅',
    body: 'Daily local backup saved successfully.',
    time: '2d ago', read: true,
  },
  {
    id: '6', type: 'grade', title: 'Grade Change 📊',
    body: 'Sourav Stores upgraded from Grade C to B (improved payment speed).',
    time: '3d ago', read: true,
  },
]

const TYPE_META: Record<string, { icon: any; color: string; bg: string }> = {
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  'low-stock': { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  promise: { icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  backup: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  defaulter: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  grade: { icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30' },
}

export function NotificationsView() {
  const { setActiveView, setSelectedPartyId, setInventoryFilter } = useAppStore()
  const { t } = useI18n()
  const [notifs, setNotifs] = useState<Notif[]>(DEMO_NOTIFS)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')

  const filtered = filter === 'unread' ? notifs.filter((n) => !n.read) : notifs
  const unreadCount = notifs.filter((n) => !n.read).length

  const handleAction = (n: Notif) => {
    setNotifs((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)))
    if (n.type === 'low-stock') {
      setInventoryFilter('low-stock')
      setActiveView('inventory')
    } else if (n.type === 'overdue' || n.type === 'defaulter' || n.type === 'promise' || n.type === 'grade') {
      setActiveView('khata')
    }
  }

  const markAllRead = () => setNotifs((prev) => prev.map((n) => ({ ...n, read: true })))

  return (
    <div className="space-y-4">
      {/* Header */}
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

      {/* Filter */}
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

      {/* List */}
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
                          <span className="text-[11px] text-primary font-medium">{n.action.label} →</span>
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
