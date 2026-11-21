// Billing multi-tab hold store (PRD v2 §10.6)
// Up to 3 (expandable to 5) independent invoice drafts, persisted in localStorage.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface BillingItem {
  productId?: string
  name: string
  quantity: number
  unitPrice: number
  gstRate: number
  discount: number
  total: number
}

export interface BillingTab {
  id: string
  label: string
  hasDraft: boolean
  customerId?: string
  customerName?: string
  items: BillingItem[]
  discountMode: 'flat' | 'percent'
  discountValue: number
  isGst: boolean
  paymentMode: string
  invoiceType: string
  createdAt: number
  updatedAt: number
}

interface BillingState {
  tabs: BillingTab[]
  activeTabId: string | null
  maxTabs: number
  setActiveTab: (id: string) => void
  addTab: () => string | null
  closeTab: (id: string) => void
  updateTab: (id: string, patch: Partial<BillingTab>) => void
  clearTab: (id: string) => void
  renameTab: (id: string, label: string) => void
}

function newTab(label: string): BillingTab {
  return {
    id: crypto.randomUUID(),
    label,
    hasDraft: false,
    items: [],
    discountMode: 'flat',
    discountValue: 0,
    isGst: true,
    paymentMode: 'cash',
    invoiceType: 'retail',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
}

export const useBillingStore = create<BillingState>()(
  persist(
    (set, get) => ({
      tabs: [newTab('Person 1')],
      activeTabId: null,
      maxTabs: 5,

      setActiveTab: (id) => set({ activeTabId: id }),

      addTab: () => {
        const { tabs, maxTabs } = get()
        if (tabs.length >= maxTabs) return null
        const label = `Person ${tabs.length + 1}`
        const tab = newTab(label)
        set({ tabs: [...tabs, tab], activeTabId: tab.id })
        return tab.id
      },

      closeTab: (id) => {
        const { tabs, activeTabId } = get()
        if (tabs.length <= 1) {
          // Don't remove the last tab — reset it instead
          const fresh = newTab('Person 1')
          set({ tabs: [fresh], activeTabId: fresh.id })
          return
        }
        const idx = tabs.findIndex((t) => t.id === id)
        const next = tabs.filter((t) => t.id !== id)
        // Renumber labels to keep them sequential
        const relabeled = next.map((t, i) => ({ ...t, label: `Person ${i + 1}` }))
        const newActive = activeTabId === id
          ? relabeled[Math.min(idx, relabeled.length - 1)].id
          : activeTabId
        set({ tabs: relabeled, activeTabId: newActive })
      },

      updateTab: (id, patch) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id
              ? {
                  ...t,
                  ...patch,
                  hasDraft: !!(patch.items?.length || t.items.length || patch.customerId || t.customerId),
                  updatedAt: Date.now(),
                }
              : t
          ),
        })),

      clearTab: (id) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === id
              ? { ...t, hasDraft: false, customerId: undefined, customerName: undefined, items: [], discountValue: 0, updatedAt: Date.now() }
              : t
          ),
        })),

      renameTab: (id, label) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === id ? { ...t, label, updatedAt: Date.now() } : t)),
        })),
    }),
    { name: 'bizledger-billing-tabs' }
  )
)
