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
  // §1: Navigation back stack — remembers where user was so Back returns correctly
  viewStack: ViewId[]
  navigateTo: (view: ViewId) => void
  goBack: () => void
  canGoBack: () => boolean

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

  // §HISTORY-ROUTING: when the dashboard Sales card is tapped, this carries the
  // active dateRange so the History view can auto-filter to the same timeframe.
  // 'today' | 'yesterday' | 'week' | 'custom'. Cleared after consumption.
  historyDateRange: 'today' | 'yesterday' | 'week' | 'custom' | null
  setHistoryDateRange: (r: 'today' | 'yesterday' | 'week' | 'custom' | null) => void

  // §2: Global overlay — party detail / invoice preview can open as overlay
  // above the current view without switching tabs. Preserves scroll state.
  overlayPartyId: string | null
  setOverlayPartyId: (id: string | null) => void
  overlayInvoiceId: string | null
  setOverlayInvoiceId: (id: string | null) => void
}

export const useAppStore = create<AppState>()((set, get) => ({
  activeView: 'dashboard',
  setActiveView: (view) => set({ activeView: view }),

  // §1: Navigation back stack
  viewStack: [],
  navigateTo: (view) => {
    const { activeView, viewStack } = get()
    // Don't push if navigating to the same view
    if (activeView === view) return
    set({
      viewStack: [...viewStack, activeView],
      activeView: view,
    })
  },
  goBack: () => {
    const { viewStack } = get()
    if (viewStack.length > 0) {
      const newStack = [...viewStack]
      const prevView = newStack.pop()!
      set({ viewStack: newStack, activeView: prevView })
    } else {
      // No history — go to dashboard as fallback
      set({ activeView: 'dashboard' })
    }
  },
  canGoBack: () => get().viewStack.length > 0,

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

  // §HISTORY-ROUTING: date range passed from dashboard Sales card → History view
  historyDateRange: null,
  setHistoryDateRange: (r) => set({ historyDateRange: r }),

  overlayPartyId: null,
  setOverlayPartyId: (id) => set({ overlayPartyId: id }),
  overlayInvoiceId: null,
  setOverlayInvoiceId: (id) => set({ overlayInvoiceId: id }),
}))
