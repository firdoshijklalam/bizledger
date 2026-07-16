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
}

interface CartState {
  // Cart data
  carts: HeldCart[]
  activeCartId: number
  setCarts: (carts: HeldCart[]) => void
  setActiveCartId: (id: number) => void
  updateActiveCart: (updater: (c: HeldCart) => HeldCart) => void
  resetCart: () => void

  // Billing state
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

  // Clear all billing state (called after checkout)
  clearBillingState: () => void
}

const DEFAULT_CART: HeldCart = {
  id: 1,
  label: 'পার্সন ১',
  items: [],
  customer: null,
  paymentMode: 'cash',
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

  discountMode: 'flat',
  setDiscountMode: (m) => set({ discountMode: m }),
  discountValue: '',
  setDiscountValue: (v) => set({ discountValue: v }),
  deliveryCharge: '',
  setDeliveryCharge: (v) => set({ deliveryCharge: v }),
  fulfillmentStatus: 'handed',
  setFulfillmentStatus: (s) => set({ fulfillmentStatus: s }),
  splitCash: '',
  setSplitCash: (v) => set({ splitCash: v }),
  splitUpi: '',
  setSplitUpi: (v) => set({ splitUpi: v }),
  splitChequeNo: '',
  setSplitChequeNo: (v) => set({ splitChequeNo: v }),

  clearBillingState: () => set({
    discountMode: 'flat',
    discountValue: '',
    deliveryCharge: '',
    fulfillmentStatus: 'handed',
    splitCash: '',
    splitUpi: '',
    splitChequeNo: '',
  }),
}))
