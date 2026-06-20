// Notification store with deep-link actions (PRD v2 §13)
import { create } from 'zustand'
import type { ViewId } from '@/lib/types'

export interface AppNotification {
  id: string
  type: 'overdue' | 'low-stock' | 'promise' | 'backup' | 'defaulter' | 'grade'
  title: string
  body: string
  time: string
  read: boolean
  // Deep-link target
  action?: {
    view: ViewId
    partyId?: string
    productId?: string
    filter?: string
  }
}

interface NotificationState {
  notifications: AppNotification[]
  markRead: (id: string) => void
  markAllRead: () => void
  addNotification: (n: AppNotification) => void
}

const DEMO_NOTIFS: AppNotification[] = [
  {
    id: '1', type: 'overdue', title: 'Payment Overdue 🔴',
    body: 'Maa Lakshmi Bhandar has ₹45,000 overdue beyond credit period.',
    time: '2h ago', read: false,
    action: { view: 'khata', partyId: 'demo-maa-lakshmi', filter: 'receivable' },
  },
  {
    id: '2', type: 'low-stock', title: 'Low Stock Alert ⚠️',
    body: 'Steel Glass is below threshold (8 units left).',
    time: '5h ago', read: false,
    action: { view: 'inventory', filter: 'low-stock' },
  },
  {
    id: '3', type: 'defaulter', title: 'New Defaulter 🚨',
    body: 'Defaulted Customer crossed credit limit (₹68,000 / ₹50,000).',
    time: '1d ago', read: false,
    action: { view: 'khata', partyId: 'demo-defaulted' },
  },
  {
    id: '4', type: 'promise', title: 'Payment Promise 💬',
    body: 'Amit Trading promised to pay ₹5,000 by Friday.',
    time: '1d ago', read: true,
    action: { view: 'khata', partyId: 'demo-amit' },
  },
  {
    id: '5', type: 'backup', title: 'Backup Complete ✅',
    body: 'Daily local backup saved successfully.',
    time: '2d ago', read: true,
    action: { view: 'settings' },
  },
  {
    id: '6', type: 'grade', title: 'Grade Change 📊',
    body: 'Sourav Stores upgraded from Grade C to B (improved payment speed).',
    time: '3d ago', read: true,
    action: { view: 'reports' },
  },
]

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: DEMO_NOTIFS,
  markRead: (id) =>
    set((s) => ({
      notifications: s.notifications.map((n) => (n.id === id ? { ...n, read: true } : n)),
    })),
  markAllRead: () =>
    set((s) => ({
      notifications: s.notifications.map((n) => ({ ...n, read: true })),
    })),
  addNotification: (n) =>
    set((s) => ({ notifications: [n, ...s.notifications] })),
}))
