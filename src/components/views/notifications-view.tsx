'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useNotificationStore, type AppNotification } from '@/store/notification-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Party } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Bell, AlertTriangle, AlertCircle, MessageSquare, CheckCircle2, TrendingUp,
  X, Settings, Megaphone, Store, FolderOpen, CheckCheck,
} from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { ShareSheet } from '@/components/shared/share-sheet'
import { toast } from 'sonner'
import { useState, useMemo, useRef } from 'react'

const TYPE_META: Record<string, { icon: any; color: string; bg: string }> = {
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  'low-stock': { icon: AlertTriangle, color: 'text-orange-600', bg: 'bg-orange-100 dark:bg-orange-900/30' },
  promise: { icon: MessageSquare, color: 'text-blue-600', bg: 'bg-blue-100 dark:bg-blue-900/30' },
  backup: { icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-100 dark:bg-emerald-900/30' },
  defaulter: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-100 dark:bg-red-900/30' },
  grade: { icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-100 dark:bg-purple-900/30' },
}

// PRD Part 27 §3: Channel toggle labels
const CHANNEL_LABELS = [
  { key: 'lowStock' as const, label: 'Low Stock Alerts', labelBn: 'লো স্টক অ্যালার্ট' },
  { key: 'overduePayments' as const, label: 'Overdue Payment Warnings', labelBn: 'বকেয়া পেমেন্ট সতর্কতা' },
  { key: 'gradeChanges' as const, label: 'Customer Grade Changes', labelBn: 'গ্রেড পরিবর্তন' },
  { key: 'backups' as const, label: 'App System Backups', labelBn: 'সিস্টেম ব্যাকআপ' },
]

export function NotificationsView() {
  const { setActiveView, setSelectedPartyId, setInventoryFilter, setKhataFilter, business } = useAppStore()
  const { t } = useI18n()
  const { notifications, channels, markRead, markAllRead, dismiss, toggleChannel } = useNotificationStore()
  const { data: parties } = useFetch<Party[]>('/api/parties', [])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [showSettings, setShowSettings] = useState(false)
  const [swipingId, setSwipingId] = useState<string | null>(null)
  const [swipeX, setSwipeX] = useState(0)
  const startXRef = useRef(0)

  // PRD Part 27 §2: ShareSheet for Remind Now action
  const [showRemindSheet, setShowRemindSheet] = useState(false)
  const [remindParty, setRemindParty] = useState<{ name: string; phone?: string | null; amount: number } | null>(null)

  const currency = business?.currency || 'INR'

  const filtered = filter === 'unread' ? notifications.filter((n) => !n.read) : notifications
  const unreadCount = notifications.filter((n) => !n.read).length

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

  // PRD Part 27 §2: Contextual AI actions
  const handleRemindNow = (n: AppNotification) => {
    const partyName = n.body.split(' ')[0] // Extract party name from body
    const party = parties?.find((p) => p.name.includes(partyName) || n.body.includes(p.name))
    const amount = party ? Math.abs(party.balance) : 0
    setRemindParty({ name: party?.name || partyName, phone: party?.phone, amount })
    setShowRemindSheet(true)
    toast.success(`${party?.name || partyName}-কে তাগাদা পাঠানো হচ্ছে…`)
  }

  const handleOrderForecast = (n: AppNotification) => {
    toast.success('সাপ্লায়ার ক্যাটালগ খোলা হচ্ছে…')
    setActiveView('sourcing')
  }

  const handleOpenStorage = () => {
    toast.success('লোকাল ব্যাকআপ ফাইল ডাউনলোড হচ্ছে…')
    const a = document.createElement('a')
    a.href = '/api/data-export?format=json'
    a.click()
  }

  // PRD Part 27 §1: Swipe handlers
  const handleTouchStart = (e: React.TouchEvent, id: string) => {
    startXRef.current = e.touches[0].clientX
    setSwipingId(id)
    setSwipeX(0)
  }

  const handleTouchMove = (e: React.TouchEvent, id: string) => {
    if (swipingId !== id) return
    const delta = e.touches[0].clientX - startXRef.current
    setSwipeX(delta)
  }

  const handleTouchEnd = (id: string) => {
    if (swipingId !== id) return
    if (Math.abs(swipeX) > 100) {
      // Swipe threshold — dismiss
      dismiss(id)
      toast.success('Notification dismissed')
    }
    setSwipingId(null)
    setSwipeX(0)
  }

  // PRD Part 27 §2: Get contextual action button for notification type
  const getContextualAction = (n: AppNotification) => {
    if (n.type === 'overdue' || n.type === 'defaulter') {
      return { label: 'Remind Now', icon: Megaphone, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30', onClick: () => handleRemindNow(n) }
    }
    if (n.type === 'low-stock') {
      return { label: 'Order Forecast', icon: Store, color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30', onClick: () => handleOrderForecast(n) }
    }
    if (n.type === 'backup') {
      return { label: 'Open File', icon: FolderOpen, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30', onClick: handleOpenStorage }
    }
    return null
  }

  return (
    <div className="space-y-4">
      {/* Header with Mark All Read + Settings gear */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold">{t('header.notifications')}</h2>
          <p className="text-[11px] text-muted-foreground">{unreadCount} unread</p>
        </div>
        <div className="flex items-center gap-2">
          {/* PRD Part 27 §1: Mark All Read button */}
          {unreadCount > 0 && (
            <button
              onClick={() => { markAllRead(); toast.success('All marked as read') }}
              className="flex items-center gap-1 text-xs text-primary font-medium px-2 py-1.5 rounded-lg bg-primary/10"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark All Read
            </button>
          )}
          {/* PRD Part 27 §3: Settings gear */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${showSettings ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
            aria-label="Notification settings"
          >
            <Settings className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* PRD Part 27 §3: Channel Preferences Panel */}
      <AnimatePresence>
        {showSettings && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-2xl bg-card border border-border space-y-3">
              <p className="text-xs font-semibold text-muted-foreground uppercase">নোটিফিকেশন চ্যানেল (Channels)</p>
              {CHANNEL_LABELS.map((ch) => (
                <div key={ch.key} className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{ch.label}</p>
                    <p className="text-[10px] text-muted-foreground">{ch.labelBn}</p>
                  </div>
                  <Switch
                    checked={channels[ch.key]}
                    onCheckedChange={() => toggleChannel(ch.key)}
                  />
                </div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Filter chips */}
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

      {/* Notifications list */}
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
              const ctxAction = getContextualAction(n)
              const isSwiping = swipingId === n.id
              const swipeOpacity = isSwiping ? Math.max(0.3, 1 - Math.abs(swipeX) / 200) : 1

              return (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0, x: isSwiping ? swipeX : 0 }}
                  exit={{ opacity: 0, x: swipeX > 0 ? 300 : -300, transition: { duration: 0.2 } }}
                  transition={{ delay: i * 0.03 }}
                  style={{ opacity: swipeOpacity }}
                  onTouchStart={(e) => handleTouchStart(e, n.id)}
                  onTouchMove={(e) => handleTouchMove(e, n.id)}
                  onTouchEnd={() => handleTouchEnd(n.id)}
                  className={`p-4 rounded-2xl border transition-all ${
                    n.read ? 'bg-card border-border' : 'bg-card border-primary/30 shadow-sm'
                  } ${isSwiping ? 'touch-none' : 'cursor-pointer'}`}
                >
                  <div className="flex items-start gap-3" onClick={() => !isSwiping && handleAction(n)}>
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

                  {/* PRD Part 27 §2: Contextual AI Action Button */}
                  {ctxAction && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <button
                        onClick={(e) => { e.stopPropagation(); ctxAction.onClick() }}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${ctxAction.color} hover:opacity-80`}
                      >
                        <ctxAction.icon className="w-3 h-3" />
                        {ctxAction.label}
                      </button>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Swipe hint */}
      {filtered.length > 0 && (
        <p className="text-center text-[10px] text-muted-foreground/50">
          ← সোয়াইপ করে ডিসমিস করুন (Swipe to dismiss) →
        </p>
      )}

      {/* PRD Part 27 §2: Remind ShareSheet */}
      <ShareSheet
        open={showRemindSheet}
        onClose={() => setShowRemindSheet(false)}
        customerName={remindParty?.name || ''}
        customerPhone={remindParty?.phone}
        shareText={remindParty ? `প্রিয় ${remindParty.name},\n\nআপনার বকেয়া টাকা: ${remindParty.amount > 0 ? '₹' + remindParty.amount : 'নির্ধারিত'}\n\nঅনুগ্রহ করে শীঘ্র পরিশোধ করুন।\n\nধন্যবাদ,\n${business?.name || 'BizLedger'}` : ''}
        shareTitle="তাগাদা (Reminder)"
      />
    </div>
  )
}
