'use client'

import { create } from 'zustand'
import type { Party } from '@/lib/types'

// §1: Types moved here so they can be shared across components
export type PaymentMode = 'cash' | 'upi' | 'credit' | 'cheque'
export type SaleMode = 'retail' | 'full' | 'wholesale'

export interface CartItem {
  cartKey: string
  productId: string
  name: string
  unit: string
  price: number
  quantity: number
  qtyStr: string
  total: number
  manualOverride: boolean
  gstRate: number
  mrp: number
  retailMrp: number
  itemGstEnabled: boolean
  itemGstRate: number
  itemGstManuallyDisabled: boolean
  itemMode: SaleMode
}

export interface HeldCart {
  id: number
  label: string
  items: CartItem[]
  customer: Party | null
  paymentMode: PaymentMode
  // §STATE-LEAK-FIX: Billing/payment fields scoped PER CART so they don't
  // bleed across Person 1 / Person 2 / etc. Each cart has its own isolated
  // memory for split payment inputs, discount, delivery, and fulfillment.
  splitCash: string
  splitUpi: string
  splitChequeNo: string
  discountMode: 'flat' | 'percent'
  discountValue: string
  deliveryCharge: string
  fulfillmentStatus: 'handed' | 'pickup'
}

interface CartState {
  // Cart data
  carts: HeldCart[]
  activeCartId: number
  setCarts: (carts: HeldCart[]) => void
  setActiveCartId: (id: number) => void
  updateActiveCart: (updater: (c: HeldCart) => HeldCart) => void
  resetCart: () => void
  createNewCart: () => void

  // §STATE-LEAK-FIX: Cart-scoped billing accessors.
  // These read/write the ACTIVE cart's fields via updateActiveCart so the
  // values are isolated per cart. Components consume them exactly as before.
  discountMode: 'flat' | 'percent'
  setDiscountMode: (m: 'flat' | 'percent') => void
  discountValue: string
  setDiscountValue: (v: string) => void
  deliveryCharge: string
  setDeliveryCharge: (v: string) => void
  fulfillmentStatus: 'handed' | 'pickup'
  setFulfillmentStatus: (s: 'handed' | 'pickup') => void
  splitCash: string
  setSplitCash: (v: string) => void
  splitUpi: string
  setSplitUpi: (v: string) => void
  splitChequeNo: string
  setSplitChequeNo: (v: string) => void

  // Clear the ACTIVE cart's billing state (called after checkout)
  clearBillingState: () => void
}

const DEFAULT_CART: HeldCart = {
  id: 1,
  label: 'পার্সন ১',
  items: [],
  customer: null,
  paymentMode: 'cash',
  splitCash: '',
  splitUpi: '',
  splitChequeNo: '',
  discountMode: 'flat',
  discountValue: '',
  deliveryCharge: '',
  fulfillmentStatus: 'handed',
}

export const useCartStore = create<CartState>()((set, get) => ({
  carts: [DEFAULT_CART],
  activeCartId: 1,
  setCarts: (carts) => set({ carts }),
  setActiveCartId: (id) => set({ activeCartId: id }),
  updateActiveCart: (updater) => {
    const { carts, activeCartId } = get()
    set({ carts: carts.map((c) => (c.id === activeCartId ? updater(c) : c)) })
  },
  resetCart: () => set({ carts: [{ ...DEFAULT_CART }], activeCartId: 1 }),

  createNewCart: () => {
    const { carts } = get()

    // §1: Check if any existing cart is empty (no items AND no customer).
    // If so, just focus on that cart instead of creating a new one.
    const emptyCart = carts.find(c => c.items.length === 0 && !c.customer)
    if (emptyCart) {
      // Focus on the existing empty cart — don't create a new one
      set({ activeCartId: emptyCart.id })
      return
    }

    // All existing carts have items or customers — create a new one
    const nextId = Math.max(0, ...carts.map((c) => c.id)) + 1
    const newCart: HeldCart = {
      id: nextId,
      label: `পার্সন ${carts.length + 1}`,
      items: [],
      customer: null,
      paymentMode: 'cash',
      splitCash: '',
      splitUpi: '',
      splitChequeNo: '',
      discountMode: 'flat',
      discountValue: '',
      deliveryCharge: '',
      fulfillmentStatus: 'handed',
    }
    set({ carts: [...carts, newCart], activeCartId: nextId })
  },

  // §STATE-LEAK-FIX: Billing fields now live ON the cart object (per-cart
  // isolated memory). These top-level mirror values are kept in sync with
  // the active cart via a subscription (see useSyncActiveCartBilling below)
  // so existing selectors (`useCartStore(s => s.splitCash)`) continue to
  // work and return the ACTIVE cart's value. Setters write through
  // updateActiveCart so only the active cart is mutated.
  discountMode: DEFAULT_CART.discountMode,
  setDiscountMode: (m) => get().updateActiveCart((c) => ({ ...c, discountMode: m })),
  discountValue: DEFAULT_CART.discountValue,
  setDiscountValue: (v) => get().updateActiveCart((c) => ({ ...c, discountValue: v })),
  deliveryCharge: DEFAULT_CART.deliveryCharge,
  setDeliveryCharge: (v) => get().updateActiveCart((c) => ({ ...c, deliveryCharge: v })),
  fulfillmentStatus: DEFAULT_CART.fulfillmentStatus,
  setFulfillmentStatus: (s) => get().updateActiveCart((c) => ({ ...c, fulfillmentStatus: s })),
  splitCash: DEFAULT_CART.splitCash,
  setSplitCash: (v) => get().updateActiveCart((c) => ({ ...c, splitCash: v })),
  splitUpi: DEFAULT_CART.splitUpi,
  setSplitUpi: (v) => get().updateActiveCart((c) => ({ ...c, splitUpi: v })),
  splitChequeNo: DEFAULT_CART.splitChequeNo,
  setSplitChequeNo: (v) => get().updateActiveCart((c) => ({ ...c, splitChequeNo: v })),

  // §STATE-LEAK-FIX: Clears only the ACTIVE cart's billing fields.
  clearBillingState: () => get().updateActiveCart((c) => ({
    ...c,
    discountMode: 'flat',
    discountValue: '',
    deliveryCharge: '',
    fulfillmentStatus: 'handed',
    splitCash: '',
    splitUpi: '',
    splitChequeNo: '',
  })),
}))

// §STATE-LEAK-FIX: Mirror subscription — whenever `carts` or `activeCartId`
// changes, copy the active cart's billing fields back to the top-level mirror
// properties. This keeps `useCartStore(s => s.splitCash)` etc. returning the
// ACTIVE cart's isolated value, so switching carts immediately reflects that
// cart's own payment inputs (no bleed across Person 1 / Person 2).
// Uses the plain subscribe(listener) form (no middleware needed).
let _lastActiveCartId: number | null = null
useCartStore.subscribe((state) => {
  const active = state.carts.find((c) => c.id === state.activeCartId)
  if (!active) return
  // Only mirror when the active cart identity changes OR its billing fields
  // differ from the mirror — avoids redundant renders on unrelated state.
  const idChanged = _lastActiveCartId !== state.activeCartId
  if (idChanged) _lastActiveCartId = state.activeCartId
  const billingChanged =
    state.splitCash !== active.splitCash ||
    state.splitUpi !== active.splitUpi ||
    state.splitChequeNo !== active.splitChequeNo ||
    state.discountMode !== active.discountMode ||
    state.discountValue !== active.discountValue ||
    state.deliveryCharge !== active.deliveryCharge ||
    state.fulfillmentStatus !== active.fulfillmentStatus
  if (!idChanged && !billingChanged) return
  useCartStore.setState({
    splitCash: active.splitCash,
    splitUpi: active.splitUpi,
    splitChequeNo: active.splitChequeNo,
    discountMode: active.discountMode,
    discountValue: active.discountValue,
    deliveryCharge: active.deliveryCharge,
    fulfillmentStatus: active.fulfillmentStatus,
  })
})
