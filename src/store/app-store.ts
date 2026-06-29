import { create } from 'zustand'
import type { ViewId, Business } from '@/lib/types'

export type KhataFilter = 'all' | 'receivable' | 'payable'
export type InventoryFilter = 'all' | 'low-stock'

interface QuickAction {
  id: string
  type: 'add-party' | 'add-product' | 'new-invoice' | 'add-transaction' | 'quick-sale'
}

interface AppState {
  // Navigation
  activeView: ViewId
  setActiveView: (view: ViewId) => void

  // Business
  business: Business | null
  setBusiness: (b: Business | null) => void
  businessLoaded: boolean
  setBusinessLoaded: (loaded: boolean) => void

  // Khata
  khataFilter: KhataFilter
  setKhataFilter: (f: KhataFilter) => void
  selectedPartyId: string | null
  setSelectedPartyId: (id: string | null) => void
  showPartyForm: boolean
  setShowPartyForm: (show: boolean) => void
  editingPartyId: string | null
  setEditingPartyId: (id: string | null) => void

  editingProductId: string | null
  setEditingProductId: (id: string | null) => void

  // Inventory
  inventoryFilter: InventoryFilter
  setInventoryFilter: (f: InventoryFilter) => void
  selectedProductId: string | null
  setSelectedProductId: (id: string | null) => void
  showProductForm: boolean
  setShowProductForm: (show: boolean) => void

  // Billing
  showInvoiceForm: boolean
  setShowInvoiceForm: (show: boolean) => void
  selectedInvoiceId: string | null
  setSelectedInvoiceId: (id: string | null) => void
  floatingInvoiceOpen: boolean
  setFloatingInvoiceOpen: (open: boolean) => void

  // Notifications
  showNotifications: boolean
  setShowNotifications: (show: boolean) => void

  // Search
  searchQuery: string
  setSearchQuery: (q: string) => void
  showSearch: boolean
  setShowSearch: (show: boolean) => void

  // Side drawer FAB
  fabOpen: boolean
  setFabOpen: (open: boolean) => void

  // Refresh trigger (increment to refetch data)
  refreshKey: number
  triggerRefresh: () => void

  // Quick action trigger
  pendingQuickAction: QuickAction | null
  triggerQuickAction: (action: QuickAction) => void
  clearQuickAction: () => void

  // Pending new customer (for auto-fill after creating from invoice form)
  pendingNewCustomerId: string | null
  pendingNewCustomerName: string | null
  setPendingNewCustomer: (id: string | null, name: string | null) => void

  // Return-to-view for back navigation (PRD Part 5 §3)
  returnToView: ViewId | null
  setReturnToView: (view: ViewId | null) => void
}

export const useAppStore = create<AppState>()((set) => ({
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),

  business: null,
  setBusiness: (b) => set({ business: b }),
  businessLoaded: false,
  setBusinessLoaded: (loaded) => set({ businessLoaded: loaded }),

  khataFilter: 'all',
  setKhataFilter: (f) => set({ khataFilter: f }),
  selectedPartyId: null,
  setSelectedPartyId: (id) => set({ selectedPartyId: id }),
  showPartyForm: false,
  setShowPartyForm: (show) => set({ showPartyForm: show }),
  editingPartyId: null,
  setEditingPartyId: (id) => set({ editingPartyId: id }),

  editingProductId: null,
  setEditingProductId: (id) => set({ editingProductId: id }),

  inventoryFilter: 'all',
  setInventoryFilter: (f) => set({ inventoryFilter: f }),
  selectedProductId: null,
  setSelectedProductId: (id) => set({ selectedProductId: id }),
  showProductForm: false,
  setShowProductForm: (show) => set({ showProductForm: show }),

  showInvoiceForm: false,
  setShowInvoiceForm: (show) => set({ showInvoiceForm: show }),
  selectedInvoiceId: null,
  setSelectedInvoiceId: (id) => set({ selectedInvoiceId: id }),
  floatingInvoiceOpen: false,
  setFloatingInvoiceOpen: (open) => set({ floatingInvoiceOpen: open }),

  showNotifications: false,
  setShowNotifications: (show) => set({ showNotifications: show }),

  searchQuery: '',
  setSearchQuery: (q) => set({ searchQuery: q }),
  showSearch: false,
  setShowSearch: (show) => set({ showSearch: show }),

  fabOpen: false,
  setFabOpen: (open) => set({ fabOpen: open }),

  refreshKey: 0,
  triggerRefresh: () => set((s) => ({ refreshKey: s.refreshKey + 1 })),

  pendingQuickAction: null,
  triggerQuickAction: (action) => set({ pendingQuickAction: action }),
  clearQuickAction: () => set({ pendingQuickAction: null }),

  pendingNewCustomerId: null,
  pendingNewCustomerName: null,
  setPendingNewCustomer: (id, name) => set({ pendingNewCustomerId: id, pendingNewCustomerName: name }),

  returnToView: null,
  setReturnToView: (view) => set({ returnToView: view }),
}))
