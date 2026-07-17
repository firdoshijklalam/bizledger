'use client'

import { useAppStore } from '@/store/app-store'
import { useCartStore, type CartItem, type HeldCart, type PaymentMode, type SaleMode } from '@/store/cart-store'
import { useBillingStore } from '@/store/billing-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Product, Party } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Package, Plus, Minus, Trash2, UserPlus, Receipt, AlertTriangle,
  Store, Boxes, CheckCircle2, X, Wallet, QrCode, CreditCard, FileCheck,
  ChevronLeft, ChevronRight, Calculator, Lock, Eye, EyeOff, ShieldCheck,
  Users, BadgePercent, Layers, Share2, ArrowLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { memo, useMemo, useState, useCallback, useRef, useEffect } from 'react'
import QRCode from 'qrcode'
import { FullScreenPicker } from '@/components/shared/full-screen-picker'
import { useGateTrigger } from '@/store/biometric-gate-store'
import { useSoundBox } from '@/hooks/use-sound-box'
import { PartyForm } from './khata/party-form'

// §1: Types moved to cart-store.ts — imported above

// §1: Memoized CartRow — prevents full-list re-render when single item changes
interface CartRowProps {
  item: CartItem
  mode: SaleMode
  masterGstOn: boolean
  currency: string
  onSetUnitPrice: (cartKey: string, price: number) => void
  onSetQty: (cartKey: string, raw: string) => void
  onCommitQty: (cartKey: string) => void
  onUpdateQty: (cartKey: string, delta: number) => void
  onSetManualTotal: (cartKey: string, total: number) => void
  onResetManualTotal: (cartKey: string) => void
  onRemoveFromCart: (cartKey: string) => void
  onToggleItemGst: (cartKey: string) => void
  onSetItemGstRate: (cartKey: string, rate: number) => void
}

const CartRow = memo(function CartRow({
  item, mode, masterGstOn, currency,
  onSetUnitPrice, onSetQty, onCommitQty, onUpdateQty,
  onSetManualTotal, onResetManualTotal, onRemoveFromCart,
  onToggleItemGst, onSetItemGstRate,
}: CartRowProps) {
  const effectiveMrp = item.itemMode === 'retail' ? item.retailMrp : item.mrp
  const hasMrpDiscount = effectiveMrp > 0 && effectiveMrp > item.price

  return (
    <div className="p-2.5 rounded-xl bg-muted/40 border border-border/50">
      {/* Row 1 — product name ONLY + trash icon */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">
            {item.name} {item.itemMode === 'retail' && <span className="text-[10px] text-emerald-600 font-normal">(খুচরো)</span>}
          </p>
          {hasMrpDiscount && (
            <span className="text-[10px] text-emerald-600 font-medium">
              ছাড় ₹{(effectiveMrp - item.price).toFixed(2)} per {item.unit}
            </span>
          )}
          {item.manualOverride && (
            <span className="text-[10px] text-amber-600 font-medium ml-1">· মোট ম্যানুয়াল</span>
          )}
        </div>
        <button
          onClick={() => onRemoveFromCart(item.cartKey)}
          className="shrink-0 w-7 h-7 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center hover:bg-red-500/20 transition-colors"
          aria-label={`Remove ${item.name}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>
      {/* 3-column POS row */}
      <div className="grid grid-cols-3 gap-2 items-end">
        {/* Column 1: rate */}
        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground/70 font-medium uppercase tracking-wide block">প্রতি {item.unit} দর</label>
          <div className="flex items-baseline gap-0.5">
            <span className="text-[10px] text-muted-foreground">₹</span>
            <input
              value={item.price}
              onChange={(e) => onSetUnitPrice(item.cartKey, Number(e.target.value) || 0)}
              className="w-full text-sm font-semibold tabular bg-transparent border-0 border-b border-border focus:border-primary outline-none px-0 py-0.5 leading-tight"
              inputMode="decimal"
            />
          </div>
        </div>
        {/* Column 2: qty */}
        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground/70 font-medium uppercase tracking-wide block">কত {item.unit} নেবে</label>
          <div className="flex items-center gap-1">
            <button onClick={() => onUpdateQty(item.cartKey, -1)} className="w-6 h-6 rounded bg-card border border-border flex items-center justify-center text-muted-foreground hover:bg-muted shrink-0" aria-label="Decrease">
              <Minus className="w-3 h-3" />
            </button>
            <input
              value={item.qtyStr}
              onChange={(e) => onSetQty(item.cartKey, e.target.value)}
              onBlur={() => onCommitQty(item.cartKey)}
              className="flex-1 min-w-0 text-center text-sm tabular bg-transparent border-0 border-b border-border focus:border-primary outline-none px-0 py-0.5 leading-tight"
              inputMode="decimal"
              step="any"
            />
            <button onClick={() => onUpdateQty(item.cartKey, 1)} className="w-6 h-6 rounded bg-card border border-border flex items-center justify-center text-muted-foreground hover:bg-muted shrink-0" aria-label="Increase">
              <Plus className="w-3 h-3" />
            </button>
          </div>
        </div>
        {/* Column 3: total with MRP strikethrough */}
        <div className="space-y-0.5">
          <label className="text-[9px] text-muted-foreground/70 font-medium uppercase tracking-wide block text-right">মোট দাম</label>
          <div className="flex flex-col items-end">
            {hasMrpDiscount && (
              <del className="text-[9px] text-muted-foreground/50 tabular leading-none">
                MRP ₹{(effectiveMrp * item.quantity).toFixed(0)}
              </del>
            )}
            <div className="flex items-baseline gap-0.5 justify-end">
              <span className="text-[10px] text-muted-foreground">₹</span>
              <input
                value={item.total}
                onChange={(e) => onSetManualTotal(item.cartKey, Number(e.target.value) || 0)}
                onDoubleClick={() => onResetManualTotal(item.cartKey)}
                className="w-full text-right text-sm font-bold tabular bg-transparent border-0 border-b border-amber-400/40 focus:border-amber-500 outline-none px-0 py-0.5 leading-tight"
                inputMode="numeric"
              />
            </div>
          </div>
        </div>
      </div>
      {/* Tax Chip + auto-discount */}
      <div className="flex items-center justify-between mt-1.5 text-[10px] gap-2">
        <button
          onClick={() => onToggleItemGst(item.cartKey)}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-medium transition-all ${
            item.itemGstEnabled
              ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30 text-blue-600'
              : 'border-border bg-card text-muted-foreground hover:border-blue-400'
          }`}
        >
          {item.itemGstEnabled ? (
            <>
              <input
                type="number"
                value={item.itemGstRate}
                onChange={(e) => onSetItemGstRate(item.cartKey, Number(e.target.value) || 0)}
                onClick={(e) => e.stopPropagation()}
                className="w-6 h-4 text-[9px] text-center bg-transparent border-0 outline-none tabular p-0"
                inputMode="numeric"
              />
              <span>% GST</span>
              <span className="tabular">+₹{(item.total * item.itemGstRate / 100).toFixed(2)}</span>
            </>
          ) : item.itemGstManuallyDisabled ? (
            <span className="text-red-500">GST OFF</span>
          ) : (
            <>
              <Plus className="w-2.5 h-2.5" />
              <span>Add GST</span>
              {masterGstOn && item.gstRate > 0 && (
                <span className="text-blue-500 ml-0.5">({item.gstRate}%)</span>
              )}
            </>
          )}
        </button>
        {hasMrpDiscount && (
          <span className="text-emerald-600 font-medium">
            ছাড় ₹{((effectiveMrp - item.price) * item.quantity).toFixed(2)}
          </span>
        )}
      </div>
    </div>
  )
})

export function SalePadView() {
  const { business, setActiveView, setSelectedInvoiceId, triggerRefresh, showPartyForm, setShowPartyForm } = useAppStore()
  const { t } = useI18n()
  const { speak: soundBoxSpeak } = useSoundBox()
  const { data: products } = useFetch<Product[]>('/api/products', [])
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [])

  // §1: Cart state from GLOBAL store — persists across screen navigations
  // Use individual selectors for proper reactivity
  const carts = useCartStore(s => s.carts)
  const setStoreCarts = useCartStore(s => s.setCarts)
  const setStoreCartId = useCartStore(s => s.setActiveCartId)
  const updateActiveCart = useCartStore(s => s.updateActiveCart)
  const resetCart = useCartStore(s => s.resetCart)
  const clearBillingState = useCartStore(s => s.clearBillingState)
  const storeDiscountMode = useCartStore(s => s.discountMode)
  const setStoreDiscountMode = useCartStore(s => s.setDiscountMode)
  const storeDiscountValue = useCartStore(s => s.discountValue)
  const setStoreDiscountValue = useCartStore(s => s.setDiscountValue)
  const storeDeliveryCharge = useCartStore(s => s.deliveryCharge)
  const setStoreDeliveryCharge = useCartStore(s => s.setDeliveryCharge)
  const storeFulfillmentStatus = useCartStore(s => s.fulfillmentStatus)
  const setStoreFulfillmentStatus = useCartStore(s => s.setFulfillmentStatus)
  const storeSplitCash = useCartStore(s => s.splitCash)
  const setStoreSplitCash = useCartStore(s => s.setSplitCash)
  const storeSplitUpi = useCartStore(s => s.splitUpi)
  const setStoreSplitUpi = useCartStore(s => s.setSplitUpi)
  const storeSplitChequeNo = useCartStore(s => s.splitChequeNo)
  const setStoreSplitChequeNo = useCartStore(s => s.setSplitChequeNo)
  const activeCartId = useCartStore(s => s.activeCartId)
  const activeCart = carts.find((c) => c.id === activeCartId) || carts[0]

  // §2: Sale mode — খুচরো / আস্ত / পাইকারি (wholesale PIN-gated)
  const [mode, setMode] = useState<SaleMode>('retail')
  const [wholesaleUnlocked, setWholesaleUnlocked] = useState(false)
  const triggerGate = useGateTrigger()
  // §2 Cloaked Wholesale: only reveal via explicit left-swipe from right edge
  const [wholesaleRevealed, setWholesaleRevealed] = useState(false)
  const swipeStartX = useRef<number | null>(null)
  const swipeStartY = useRef<number | null>(null)
  // §1 Multi-Cart Tab Closure: prompt to wipe or hold
  const [closePromptCartId, setClosePromptCartId] = useState<number | null>(null)
  // §1 Held Queue: carts sent here free up active slots but stay recoverable
  const [heldQueue, setHeldQueue] = useState<HeldCart[]>([])
  const [showHeldQueue, setShowHeldQueue] = useState(false)

  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [showCustPicker, setShowCustPicker] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // §2: Animated credit gate — RED warning shown ONLY on final submit failure
  const [showCreditGate, setShowCreditGate] = useState(false)
  // §1: Inline customer reveal — NEUTRAL block shown on Ledger Due / Pick Up Later interaction
  const [showInlineCustomer, setShowInlineCustomer] = useState(false)

  // §3: Hardware back button interception — same as UI back button
  useEffect(() => {
    const handlePopState = (e: PopStateEvent) => {
      // Check if we're on the sale-pad view
      if (useAppStore.getState().activeView === 'sale-pad') {
        e.preventDefault()
        // Go to Billing page (same as UI back button)
        useAppStore.getState().setActiveView('billing')
        // Push state back so browser doesn't actually navigate away
        window.history.pushState(null, '', window.location.href)
      }
    }
    // Push a state so back button triggers popstate
    window.history.pushState(null, '', window.location.href)
    window.addEventListener('popstate', handlePopState)
    return () => {
      window.removeEventListener('popstate', handlePopState)
    }
  }, [])

  // §4: Discount from global store + live Grand Total
  const discountMode = storeDiscountMode
  const setDiscountMode = setStoreDiscountMode
  const discountValue = storeDiscountValue
  const setDiscountValue = setStoreDiscountValue
  // §3: Global GST override (Advanced Options) — individual product GSTs apply behind the scenes
  const [globalGstRate, setGlobalGstRate] = useState('')
  // §3: Master GST On/Off toggle — if ON, apply database-defined product taxes. If OFF, bypass all.
  const [masterGstOn, setMasterGstOn] = useState(true)
  // §1: Delivery/Shipping Charge from global store
  const deliveryCharge = storeDeliveryCharge
  const setDeliveryCharge = setStoreDeliveryCharge

  const currency = business?.currency || 'INR'

  // ---- Cart helpers (operate on the active held cart) ----
  const updateActiveCartCb = useCallback((updater: (c: HeldCart) => HeldCart) => {
    updateActiveCart(updater)
  }, [updateActiveCart])

  const cart = activeCart.items
  const customer = activeCart.customer
  const paymentMode = activeCart.paymentMode

  // §1: Sync active cart to billing store so Billing tab shows draft with customer name
  const { tabs: billingTabs, updateTab: updateBillingTab } = useBillingStore()
  useEffect(() => {
    if (cart.length === 0) return // Don't sync empty carts
    // Use the first billing tab as the draft holder
    const tabId = billingTabs[0]?.id
    if (!tabId) return
    updateBillingTab(tabId, {
      hasDraft: true,
      customerId: customer?.id,
      customerName: customer?.name,
      items: cart.map((i) => ({
        productId: i.productId,
        name: i.name,
        quantity: i.quantity,
        unitPrice: i.price,
        gstRate: i.gstRate,
        discount: 0,
        total: i.total,
      })),
      paymentMode,
    })
  }, [cart, customer, paymentMode])

  // §2: Reactive dismissal — auto-hide warnings when customer is selected
  useEffect(() => {
    if (customer) {
      setShowCreditGate(false)
      setShowInlineCustomer(false)
    }
  }, [customer])

  const setCart = (items: CartItem[]) => updateActiveCartCb((c) => ({ ...c, items }))
  const setCustomer = (p: Party | null) => updateActiveCartCb((c) => ({ ...c, customer: p }))
  const setPaymentMode = (m: PaymentMode) => updateActiveCartCb((c) => ({ ...c, paymentMode: m }))

  const [chequeNo, setChequeNo] = useState('')
  // §5: Fulfillment status from global store
  const fulfillmentStatus = storeFulfillmentStatus
  const setFulfillmentStatus = setStoreFulfillmentStatus
  // §1: Split payment from global store
  const splitCash = storeSplitCash
  const setSplitCash = setStoreSplitCash
  const splitUpi = storeSplitUpi
  const setSplitUpi = setStoreSplitUpi
  const splitCredit = ''
  const splitChequeNo = storeSplitChequeNo
  const setSplitChequeNo = setStoreSplitChequeNo
  // §2: Sub-categories — dynamically derived from products based on selected main category
  const subCategories = useMemo(() => {
    if (!products) return ['All']
    let filtered = products
    if (mode === 'retail') {
      filtered = filtered.filter((p) => (p as any).retailEnabled && (p as any).retailSalePrice > 0)
    } else if (mode === 'full') {
      filtered = filtered.filter((p) => p.salePrice > 0)
    } else if (mode === 'wholesale') {
      filtered = filtered.filter((p) => p.wholesalePrice != null && p.wholesalePrice > 0)
    }
    if (activeCategory !== 'All') {
      filtered = filtered.filter((p) => p.category === activeCategory)
    }
    const subCats = Array.from(new Set(filtered.map((p) => (p as any).subCategory).filter(Boolean))) as string[]
    return ['All', ...subCats]
  }, [products, mode, activeCategory])

  const [activeSubCategory, setActiveSubCategory] = useState<string>('All')

  // Reset sub-category when main category or mode changes — derived state pattern
  // Instead of effect, we use a key-based reset: when category/mode changes,
  // the sub-category filter is applied only if it exists in the current subCategories list
  // This avoids setState-in-effect lint errors
  const effectiveSubCategory = subCategories.includes(activeSubCategory) ? activeSubCategory : 'All'
  const setActiveSubCategorySafe = (sub: string) => setActiveSubCategory(sub)

  const categories = useMemo(() => {
    if (!products) return ['All']
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[]
    return ['All', ...cats]
  }, [products])

  // §2: Mode-based product filtering — STRICT isolation
  const filteredProducts = useMemo(() => {
    if (!products) return []
    let list = products
    if (mode === 'retail') {
      // ONLY products with retail price set (retailEnabled + retailSalePrice > 0)
      list = list.filter((p) => (p as any).retailEnabled && (p as any).retailSalePrice > 0)
    } else if (mode === 'full') {
      // ONLY products with bulk price (salePrice > 0) — sealed full bag/box
      list = list.filter((p) => p.salePrice > 0)
    } else if (mode === 'wholesale') {
      // ONLY products with explicit wholesale price set
      list = list.filter((p) => p.wholesalePrice != null && p.wholesalePrice > 0)
    }
    if (activeCategory !== 'All') {
      list = list.filter((p) => p.category === activeCategory)
    }
    // §2: Filter by sub-category
    if (effectiveSubCategory !== 'All') {
      list = list.filter((p) => (p as any).subCategory === effectiveSubCategory)
    }
    return list
  }, [products, mode, activeCategory, effectiveSubCategory])

  // §2: Price display per mode — STRICT, no mixing
  const getPrice = (p: Product): number => {
    if (mode === 'retail') return (p as any).retailSalePrice || 0
    if (mode === 'wholesale') return p.wholesalePrice || p.salePrice
    return p.salePrice // 'full' mode = bulk price
  }

  const getPriceUnit = (p: Product): string => {
    if (mode === 'retail') return (p as any).retailUnit || 'kg'
    return p.unit
  }

  // §3: Mode-suffixed cart key — ensures strict isolation between Loose/Sealed/Wholesale.
  // Same product in Retail mode (abc_loose) is a DIFFERENT cart item from Full mode (abc_sealed).
  // Changing qty of a Sealed item NEVER mutates the corresponding Loose item.
  const getCartKey = (productId: string, saleMode: SaleMode): string => {
    const suffix = saleMode === 'retail' ? 'loose' : saleMode === 'full' ? 'sealed' : 'wholesale'
    return `${productId}_${suffix}`
  }

  // §2: Avoid Duplicate Cart Rows — increment quantity if item exists, else append.
  // Uses cartKey (mode-suffixed) so the same product in different modes is a separate row.
  // §1 FIX: Grid click always increments by whole integer (1). Fractional inputs
  // (0.5, 1.5, etc.) are only permitted via manual text input in the qty field.
  const addToCart = (p: Product) => {
    const price = getPrice(p)
    const unit = getPriceUnit(p)
    const key = getCartKey(p.id, mode)
    const existing = cart.find((i) => i.cartKey === key)
    if (existing) {
      // Increment by whole integer (1) — NOT 0.5
      const newQty = Number((existing.quantity + 1).toFixed(3))
      setCart(cart.map((i) =>
        i.cartKey === key
          ? {
              ...i,
              quantity: newQty,
              qtyStr: String(newQty),
              total: i.manualOverride ? i.total : newQty * i.price,
            }
          : i
      ))
    } else {
      setCart([...cart, {
        cartKey: key,
        productId: p.id,
        name: p.name,
        unit,
        price,
        quantity: 1,
        qtyStr: '1',
        total: price,
        manualOverride: false,
        gstRate: (p as any).gstRate || 0,
        mrp: (p as any).mrp || 0,
        retailMrp: (p as any).retailMrp || 0,
        itemGstEnabled: false,
        itemGstRate: 0,
        itemGstManuallyDisabled: false,
        itemMode: mode, // §1: lock mode at creation — prevents MRP leakage on re-render
      }])
    }
  }

  const updateQty = (cartKey: string, delta: number) => {
    setCart(cart
      .map((i) => {
        if (i.cartKey !== cartKey) return i
        // §1: stepper always increments by 1 (whole integer). Fractional via manual input only.
        const newQty = Math.max(0, Number((i.quantity + delta).toFixed(3)))
        // Sync qtyStr with the new numeric quantity
        if (i.manualOverride) return { ...i, quantity: newQty, qtyStr: String(newQty) }
        return { ...i, quantity: newQty, qtyStr: String(newQty), total: newQty * i.price }
      })
      // §3: only remove if qty is genuinely 0 (not while typing decimals like 0.5)
      .filter((i) => i.quantity > 0)
    )
  }

  // §2: Float/Decimal Quantity Validation Fix — strict float parsing
  // The qty input is bound to qtyStr (raw string), NOT quantity (number).
  // This allows the merchant to type '0', '.', '0.', '.5', '0.5', '1.25', '0.250'
  // without the UI breaking or clearing the entry.
  // quantity (number) is derived from qtyStr for calculations.
  const setQty = (cartKey: string, raw: string) => {
    // Sanitize: allow only digits and a single dot
    let sanitized = raw.replace(/[^\d.]/g, '')
    // Allow only one dot
    const dotIndex = sanitized.indexOf('.')
    if (dotIndex !== -1) {
      sanitized = sanitized.substring(0, dotIndex + 1) + sanitized.substring(dotIndex + 1).replace(/\./g, '')
    }
    setCart(cart
      .map((i) => {
        if (i.cartKey !== cartKey) return i
        // Parse the sanitized string to a float
        let qty: number
        if (sanitized === '' || sanitized === '.') {
          qty = 0
        } else {
          qty = parseFloat(sanitized)
          if (isNaN(qty)) qty = 0
        }
        // Keep qtyStr as the raw sanitized string (preserves '0.', '.5', etc.)
        // Recalculate total = price × quantity (unless manual override on total)
        if (i.manualOverride) return { ...i, quantity: qty, qtyStr: sanitized }
        return { ...i, quantity: qty, qtyStr: sanitized, total: qty * i.price }
      })
      // DO NOT filter here — keep the item even if qty is 0 so the owner
      // can continue typing (e.g. "0" then ".5"). Removal handled on blur.
    )
  }

  // §2: On blur, if quantity is still 0, remove the item
  const commitQty = (cartKey: string) => {
    setCart(prev => prev
      .map((i) => {
        if (i.cartKey !== cartKey) return i
        // Normalize qtyStr on commit — trim leading/trailing dots
        let normalized = i.qtyStr
        if (normalized.endsWith('.')) normalized = normalized.slice(0, -1)
        if (normalized === '' || normalized === '.') normalized = '0'
        const qty = parseFloat(normalized) || 0
        return { ...i, quantity: qty, qtyStr: normalized }
      })
      .filter((i) => !(i.cartKey === cartKey && i.quantity <= 0))
    )
  }

  // §1: Editable Per-Unit Price — update the base rate and re-run calculation
  // New Per-KG Rate × Quantity = Total Item Price
  const setUnitPrice = (cartKey: string, newPrice: number) => {
    setCart(cart.map((i) => {
      if (i.cartKey !== cartKey) return i
      // Always recalculate total from new price × quantity (clears manual override)
      return { ...i, price: newPrice, total: newPrice * i.quantity, manualOverride: false }
    }))
  }

  // §4: Manual Price Override — editable total field in cart
  const setManualTotal = (cartKey: string, total: number) => {
    setCart(cart.map((i) =>
      i.cartKey === cartKey
        ? { ...i, total, manualOverride: true }
        : i
    ))
  }

  // Reset a manually overridden item back to auto-calc
  const resetManualTotal = (cartKey: string) => {
    setCart(cart.map((i) =>
      i.cartKey === cartKey
        ? { ...i, total: i.quantity * i.price, manualOverride: false }
        : i
    ))
  }

  const removeFromCart = (cartKey: string) => {
    setCart(cart.filter((i) => i.cartKey !== cartKey))
  }

  // §2: Per-item GST toggle + custom rate
  // When user toggles OFF, set itemGstManuallyDisabled = true to override Global Master GST
  const toggleItemGst = (cartKey: string) => {
    setCart(cart.map((i) => {
      if (i.cartKey !== cartKey) return i
      const newEnabled = !i.itemGstEnabled
      return {
        ...i,
        itemGstEnabled: newEnabled,
        itemGstRate: newEnabled ? (i.gstRate || 5) : 0,
        // §2: If user explicitly turns OFF, mark as manually disabled — overrides Global Master
        itemGstManuallyDisabled: !newEnabled && i.itemGstEnabled ? true : (newEnabled ? false : i.itemGstManuallyDisabled),
      }
    }))
  }
  const setItemGstRate = (cartKey: string, rate: number) => {
    setCart(cart.map((i) =>
      i.cartKey === cartKey ? { ...i, itemGstRate: rate } : i
    ))
  }

  // §3: Calculation Pipeline — ALL wrapped in useMemo for performance
  // Prevents expensive re-calculations on every keystroke/render cycle
  const subtotal = useMemo(() => cart.reduce((s, i) => s + i.total, 0), [cart])

  const globalGstNum = Number(globalGstRate) || 0
  const gstAmount = useMemo(() => {
    if (globalGstNum > 0) {
      return cart.reduce((s, i) => {
        if (i.itemGstManuallyDisabled) return s
        if (i.itemGstEnabled) return s + (i.total * i.itemGstRate) / 100
        if (!masterGstOn) return s
        return s + (i.total * globalGstNum) / 100
      }, 0)
    }
    return cart.reduce((s, i) => {
      if (i.itemGstManuallyDisabled) return s
      if (i.itemGstEnabled) return s + (i.total * i.itemGstRate) / 100
      if (!masterGstOn) return s
      return s + (i.total * (i.gstRate || 0)) / 100
    }, 0)
  }, [cart, globalGstNum, masterGstOn])

  const subtotalWithGst = useMemo(() => subtotal + gstAmount, [subtotal, gstAmount])

  const discountNum = Number(discountValue) || 0
  const discountAmount = useMemo(() => discountMode === 'percent'
    ? (subtotalWithGst * discountNum) / 100
    : Math.min(discountNum, subtotalWithGst), [subtotalWithGst, discountNum, discountMode])

  const grandTotal = useMemo(() => Math.max(0, subtotalWithGst - discountAmount), [subtotalWithGst, discountAmount])

  const preDeliveryTotal = useMemo(() => Math.round(grandTotal), [grandTotal])
  const roundOffAmount = useMemo(() => preDeliveryTotal - grandTotal, [preDeliveryTotal, grandTotal])

  const deliveryChargeNum = Number(deliveryCharge) || 0
  const roundedTotal = useMemo(() => preDeliveryTotal + deliveryChargeNum, [preDeliveryTotal, deliveryChargeNum])

  const autoDiscountTotal = useMemo(() => cart.reduce((s, i) => {
    const effectiveMrp = i.itemMode === 'retail' ? i.retailMrp : i.mrp
    if (effectiveMrp > 0 && effectiveMrp > i.price) return s + (effectiveMrp - i.price) * i.quantity
    return s
  }, 0), [cart])

  const splitCashNum = Number(splitCash) || 0
  const splitUpiNum = Number(splitUpi) || 0
  const upiQrAmount = splitUpiNum > 0 ? splitUpiNum : 0
  const totalSplitPaid = splitCashNum + splitUpiNum
  const ledgerDue = useMemo(() => Math.max(0, roundedTotal - totalSplitPaid), [roundedTotal, totalSplitPaid])
  const overpaid = useMemo(() => Math.max(0, totalSplitPaid - roundedTotal), [totalSplitPaid, roundedTotal])
  const hasSplitPayment = splitCashNum > 0 || splitUpiNum > 0
  const needsCredit = hasSplitPayment && ledgerDue > 0
  const totalPaidForExchange = totalSplitPaid
  const exchangeDifference = useMemo(() => totalPaidForExchange - roundedTotal, [totalPaidForExchange, roundedTotal])
  const isShortAmount = totalPaidForExchange < roundedTotal && totalPaidForExchange > 0
  const isChangeDue = totalPaidForExchange > roundedTotal

    // §3: Dynamic UPI Intent QR Code Generation
  // When PAYMENT MODE 'UPI' is clicked, generate a QR code embedding the UPI amount
  // into the UPI deep-link payload: upi://pay?pa=VPA&pn=MERCHANT&am=AMOUNT&cu=INR
  // §2: If split UPI amount is set, QR requests THAT amount. Otherwise full grand total.
  const upiId = business?.upiId || ''
  const merchantName = business?.name || 'Merchant'
  const [upiQrDataUrl, setUpiQrDataUrl] = useState<string>('')
  useEffect(() => {
    let cancelled = false
    if (paymentMode !== 'upi' || upiQrAmount <= 0 || !upiId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUpiQrDataUrl('')
      return
    }
    const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${upiQrAmount.toFixed(2)}&cu=INR`
    QRCode.toDataURL(upiUrl, { width: 240, margin: 1, color: { dark: '#0a0a0a', light: '#ffffff' } })
      .then((url) => { if (!cancelled) setUpiQrDataUrl(url) })
      .catch(() => { if (!cancelled) setUpiQrDataUrl('') })
    return () => { cancelled = true }
  }, [paymentMode, upiQrAmount, upiId, merchantName])

  // ---- §3: Multi-Cart Hold Protocol ----
  const addNewCart = () => {
    const nextId = Math.max(0, ...carts.map((c) => c.id)) + 1
    const newCart: HeldCart = {
      id: nextId,
      label: `পার্সন ${nextId}`,
      items: [],
      customer: null,
      paymentMode: 'cash',
    }
    setStoreCarts([...carts, newCart])
    setStoreCartId(nextId)
    setDiscountValue(''); setDeliveryCharge('')
    toast.success(`${newCart.label} এর জন্য নতুন কার্ট খোলা হলো`, {
      description: 'আগের কার্ট হোল্ড করা আছে',
    })
  }

  const switchCart = (id: number) => {
    if (id === activeCartId) return
    setStoreCartId(id)
    setDiscountValue(''); setDeliveryCharge('')
    toast(`কার্ট সুইচ হলো`, { description: carts.find((c) => c.id === id)?.label })
  }

  // §1: Multi-Cart Tab Closure — prompt to Wipe or Send to Held Queue
  const requestCartClose = (id: number) => {
    const target = carts.find((c) => c.id === id)
    if (!target) return
    if (target.items.length === 0) {
      // Empty cart — just delete
      doRemoveCart(id)
      return
    }
    setClosePromptCartId(id)
  }

  const doRemoveCart = (id: number) => {
    if (carts.length <= 1) {
      toast('কমপক্ষে ১টি কার্ট থাকতে হবে')
      return
    }
    const newCarts = carts.filter((c) => c.id !== id)
    setStoreCarts(newCarts)
    if (activeCartId === id) setStoreCartId(newCarts[0].id)
    setClosePromptCartId(null)
  }

  // Keep removeCart as an alias for backward compat (used by old remove button)
  const removeCart = doRemoveCart

  // §1: Wipe — permanently delete the cart and its items
  const wipeCart = (id: number) => {
    doRemoveCart(id)
    toast.success('কার্ট মুছে ফেলা হয়েছে')
  }

  // §1: Send to Held Queue — remove from active viewport but keep recoverable
  const sendToHeldQueue = (id: number) => {
    const target = carts.find((c) => c.id === id)
    if (!target) return
    setHeldQueue([...heldQueue, target])
    doRemoveCart(id)
    toast.success(`${target.customer?.name || target.label} হোল্ড কিউ-তে পাঠানো হয়েছে`, {
      description: 'পুনরুদ্ধার করতে হোল্ড কিউ বাটনে ট্যাপ করুন',
    })
  }

  // §1: Restore from Held Queue back to active
  const restoreFromHeldQueue = (id: number) => {
    const target = heldQueue.find((c) => c.id === id)
    if (!target) return
    setStoreCarts([...carts, target])
    setHeldQueue(heldQueue.filter((c) => c.id !== id))
    setStoreCartId(id)
    setShowHeldQueue(false)
    toast.success(`${target.customer?.name || target.label} পুনরুদ্ধার করা হয়েছে`)
  }

  const deleteFromHeldQueue = (id: number) => {
    setHeldQueue(heldQueue.filter((c) => c.id !== id))
    toast.success('হোল্ড কিউ থেকে মুছে ফেলা হয়েছে')
  }

  // §2: Wholesale mode is eye-locked — PIN gate required
  const handleModeSwitch = (newMode: SaleMode) => {
    if (newMode === 'wholesale') {
      if (wholesaleUnlocked) {
        setMode('wholesale')
        return
      }
      triggerGate(
        'inventory_price',
        'পাইকারি মোড আনলক — বিশেষ পাইকারি রেট দেখতে ভেরিফিকেশন প্রয়োজন',
        () => {
          setWholesaleUnlocked(true)
          setMode('wholesale')
          toast.success('পাইকারি মোড আনলক হলো', { description: 'এক্সক্লুসিভ পাইকারি দাম এখন দৃশ্যমান' })
        },
        () => {
          toast('পাইকারি মোড লক রয়ে গেছে', { description: 'পিন প্রয়োজন' })
        }
      )
      return
    }
    if (mode === 'wholesale') setWholesaleUnlocked(false)
    setMode(newMode)
  }

  const handleGenerateInvoice = async () => {
    if (cart.length === 0) {
      toast.error('কার্ট খালি')
      return
    }
    // §2: Hard-stop — block if Ledger Due > 0 AND Customer == null
    if (ledgerDue > 0 && !customer) {
      // §2: Trigger animated slide-in credit gate above footer
      setShowCreditGate(true)
      toast.error('বাকি রাখার জন্য কাস্টমার যুক্ত করা বাধ্যতামূলক', {
        description: `খাতায় বাকি ₹${ledgerDue.toFixed(2)} — কাস্টমার ছাড়া ট্রানজেকশন নিষিদ্ধ`,
      })
      return
    }
    setShowCreditGate(false)
    setConfirming(true)
    try {
      // §1: Split payment — amountPaid is the sum of all split modes.
      // If no split, fall back to full grand total.
      const amountPaid = hasSplitPayment ? totalSplitPaid : grandTotal
      const invoice = await apiPost('/api/invoices', {
        partyId: customer?.id,
        items: cart.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price,
          discount: 0,
          gstRate: 0,
          total: i.total,
        })),
        discountMode,
        discountValue: discountNum,
        isGst: false,
        paymentMode,
        type: 'retail',
        amountPaid,
        deliveryStatus: fulfillmentStatus,
      })
      // §2: If ledger due > 0 and customer is selected, auto-route remainder to debt ledger
      if (ledgerDue > 0 && customer) {
        await apiPost('/api/transactions', {
          partyId: customer.id,
          type: 'debit',
          amount: ledgerDue,
          description: `Ledger due (split payment) — Invoice ${invoice.invoiceNumber || invoice.id}`,
          category: 'Credit Sale',
        })
        toast.success(`ইনভয়েস তৈরি · খাতায় বাকি ₹${ledgerDue.toFixed(2)} যুক্ত হয়েছে`)
      } else {
        toast.success('ইনভয়েস তৈরি হয়েছে')
      }
      // Sound Box: announce payment received
      soundBoxSpeak({ amount: amountPaid, customerName: customer?.name })
      triggerRefresh()
      // Clear active cart + split payment fields
      setCart([])
      setCustomer(null)
      setSplitCash('')
      setSplitUpi('')
      setSplitCredit('')
      setSplitChequeNo('')
      setDiscountValue(''); setDeliveryCharge('')
      setConfirming(false)
      setSelectedInvoiceId(invoice.id)
      setActiveView('billing')
    } catch (e) {
      toast.error('ব্যর্থ: ' + String(e))
      setConfirming(false)
    }
  }

  const handleDone = async () => {
    if (cart.length === 0) {
      toast.error('কার্ট খালি')
      return
    }
    // §2: Hard-stop — block if Ledger Due > 0 OR Pick Up Later, AND Customer == null
    if ((ledgerDue > 0 || fulfillmentStatus === 'pickup') && !customer) {
      setShowCreditGate(true)
      toast.error('বাকি রাখার জন্য কাস্টমার যুক্ত করা বাধ্যতামূলক', {
        description: `খাতায় বাকি ₹${ledgerDue.toFixed(2)} — কাস্টমার ছাড়া ট্রানজেকশন নিষিদ্ধ`,
      })
      return
    }
    setShowCreditGate(false)
    setConfirming(true)
    try {
      // §1: Split payment — amountPaid is sum of all split modes (or grand total if no split)
      const amountPaid = hasSplitPayment ? totalSplitPaid : grandTotal
      if (customer) {
        await apiPost('/api/transactions', {
          partyId: customer.id,
          type: 'credit',
          amount: amountPaid,
          description: `Sale (${mode}) — split payment`,
          category: 'Cash Sale',
        })
      } else {
        await apiPost('/api/transactions', {
          partyId: null,
          type: 'credit',
          amount: amountPaid,
          description: `Walk-in sale (${mode}) — split payment`,
          category: 'Cash Sale',
        })
      }
      await apiPost('/api/invoices', {
        partyId: customer?.id,
        items: cart.map((i) => ({
          productId: i.productId,
          name: i.name,
          quantity: i.quantity,
          unitPrice: i.price,
          discount: 0,
          gstRate: 0,
          total: i.total,
        })),
        discountMode,
        discountValue: discountNum,
        isGst: false,
        paymentMode,
        type: 'retail',
        amountPaid,
      })
      // §2: Auto-route ledger due to customer's debt account
      if (ledgerDue > 0 && customer) {
        await apiPost('/api/transactions', {
          partyId: customer.id,
          type: 'debit',
          amount: ledgerDue,
          description: `Ledger due (split payment)`,
          category: 'Credit Sale',
        })
        toast.success(`সম্পন্ন · খাতায় বাকি ₹${ledgerDue.toFixed(2)} যুক্ত হয়েছে`)
      } else {
        toast.success('সম্পন্ন হয়েছে — স্টক আপডেট হয়েছে')
      }
      // Sound Box: announce payment received
      soundBoxSpeak({ amount: amountPaid, customerName: customer?.name })
      triggerRefresh()
      setCart([])
      setCustomer(null)
      setSplitCash('')
      setSplitUpi('')
      setSplitCredit('')
      setSplitChequeNo('')
      setDiscountValue(''); setDeliveryCharge('')
      setConfirming(false)
    } catch (e) {
      toast.error('ব্যর্থ: ' + String(e))
      setConfirming(false)
    }
  }

  const partyItems = (parties || []).map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: p.phone || 'No phone',
  }))

  const modeMeta = {
    retail: { label: 'খুচরো প্রোডাক্ট', sub: 'Retail · per kg/pcs', icon: Store, color: 'emerald' },
    full: { label: 'প্রোডাক্ট', sub: 'Full · per bag/box', icon: Boxes, color: 'teal' },
    wholesale: { label: 'পাইকারি প্রোডাক্ট', sub: 'Wholesale · bulk rate', icon: Layers, color: 'amber' },
  } as const

  return (
    <div className="space-y-4 pb-4">
      {/* §1: Back button → goes to Billing page (not dashboard) */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => useAppStore.getState().setActiveView('billing')}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
          aria-label="Back to Billing"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">Quick Sale</h2>
      </div>

      {/* §1: Customer Input Bar — pinned to absolute TOP of Quick Sale */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowCustPicker(true)}
          className="flex-1 h-11 px-3 rounded-xl border border-dashed border-border bg-card flex items-center gap-2 text-sm hover:bg-muted transition-colors"
        >
          {customer ? (
            <>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span className="font-medium text-foreground truncate">{customer.name}</span>
              {customer.phone && <span className="text-[11px] text-muted-foreground">· {customer.phone}</span>}
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">কাস্টমার যোগ করুন (ঐচ্ছিক)</span>
            </>
          )}
        </button>
        <button
          onClick={() => setShowPartyForm(true)}
          className="w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0 hover:bg-primary/90 transition-colors"
          aria-label="নতুন কাস্টমার যোগ করুন"
          title="নতুন কাস্টমার রেজিস্ট্রেশন"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* §3: Multi-Cart Hold Protocol — পার্সন ১, ২, ৩, + */}
      <div className="p-3 rounded-2xl bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/20">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-blue-500" />
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">কার্ট হোল্ড সিস্টেম (Multi-Cart)</p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {carts.map((c, cartIndex) => {
            const active = c.id === activeCartId
            const itemCount = c.items.length
            const cartTotal = c.items.reduce((s, i) => s + i.total, 0)
            // §1: Dynamic Tab Name — use index+1 for position-based labeling.
            // If a customer is selected, show their name. Otherwise 'পার্সন N' (N = index+1).
            const tabLabel = c.customer?.name || `পার্সন ${cartIndex + 1}`
            return (
              <div
                key={c.id}
                className={`shrink-0 relative px-4 py-2.5 rounded-xl border-2 transition-all min-w-[100px] cursor-pointer ${
                  active
                    ? 'border-blue-500 bg-blue-500 text-white shadow-md'
                    : 'border-border bg-card text-muted-foreground'
                }`}
                onClick={() => switchCart(c.id)}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold truncate max-w-[90px]">{tabLabel}</span>
                  {itemCount > 0 && (
                    <span className={`text-[10px] px-1.5 rounded-full shrink-0 ${active ? 'bg-white/25' : 'bg-muted'}`}>
                      {itemCount}
                    </span>
                  )}
                </div>
                {itemCount > 0 && (
                  <p className={`text-[10px] tabular mt-0.5 ${active ? 'text-white/80' : 'text-muted-foreground'}`}>
                    {formatCurrency(cartTotal, currency)}
                  </p>
                )}
                {/* §1: X close button on EVERY cart (active + non-active) when >1 cart */}
                {carts.length > 1 && (
                  <button
                    onClick={(e) => { e.stopPropagation(); requestCartClose(c.id) }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors shadow-sm"
                    aria-label={`Close পার্সন ${cartIndex + 1}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                {active && itemCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </div>
            )
          })}
          {/* + button to add new cart */}
          <button
            onClick={addNewCart}
            className="shrink-0 w-11 h-11 rounded-xl border-2 border-dashed border-blue-400/50 flex items-center justify-center text-blue-500 hover:bg-blue-500/10 transition-colors"
            aria-label="Add new cart"
          >
            <Plus className="w-5 h-5" />
          </button>
          {/* §1: Held Queue button — shows count of held carts */}
          {heldQueue.length > 0 && (
            <button
              onClick={() => setShowHeldQueue(true)}
              className="shrink-0 px-3 h-11 rounded-xl border-2 border-amber-400/50 bg-amber-500/10 flex items-center gap-1.5 text-amber-600 hover:bg-amber-500/20 transition-colors"
              aria-label="Held queue"
            >
              <Layers className="w-4 h-4" />
              <span className="text-[10px] font-bold">{heldQueue.length}</span>
            </button>
          )}
        </div>
      </div>

      {/* §2: Mode selector — default shows only খুচরো + আস্ত. পাইকারি is cloaked,
          revealed only via explicit left-swipe from the right edge. */}
      <div
        className="relative overflow-hidden -mx-1 px-1"
        onTouchStart={(e) => {
          const t = e.touches[0]
          // §2: only trigger reveal if swipe starts near right edge (last 20% of screen)
          if (t.clientX > window.innerWidth * 0.8) {
            swipeStartX.current = t.clientX
            swipeStartY.current = t.clientY
          }
        }}
        onTouchMove={(e) => {
          if (swipeStartX.current === null) return
          const t = e.touches[0]
          const dx = swipeStartX.current - t.clientX
          const dy = Math.abs(swipeStartY.current! - t.clientY)
          // Left-swipe: dx > 60 and horizontal-dominant
          if (dx > 60 && dy < 40 && !wholesaleRevealed) {
            setWholesaleRevealed(true)
          }
        }}
        onTouchEnd={() => {
          swipeStartX.current = null
          swipeStartY.current = null
        }}
        onMouseDown={(e) => {
          // Desktop: right-edge click-drag
          if (e.clientX > window.innerWidth * 0.8) {
            swipeStartX.current = e.clientX
            swipeStartY.current = e.clientY
          }
        }}
        onMouseMove={(e) => {
          if (swipeStartX.current === null) return
          const dx = swipeStartX.current - e.clientX
          const dy = Math.abs(swipeStartY.current! - e.clientY)
          if (dx > 60 && dy < 40 && !wholesaleRevealed) {
            setWholesaleRevealed(true)
          }
        }}
        onMouseUp={() => {
          swipeStartX.current = null
          swipeStartY.current = null
        }}
        onMouseLeave={() => {
          swipeStartX.current = null
          swipeStartY.current = null
        }}
      >
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          {/* Default visible cards: retail + full */}
          {(['retail', 'full'] as const).map((m) => {
            const meta = modeMeta[m]
            const Icon = meta.icon
            const active = mode === m
            return (
              <button
                key={m}
                onClick={() => handleModeSwitch(m)}
                className={`shrink-0 px-4 py-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 min-w-[120px] min-h-[80px] justify-center relative ${
                  active
                    ? meta.color === 'emerald' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                    : 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                    : 'border-border bg-muted/30'
                }`}
              >
                <Icon className={`w-5 h-5 ${
                  active
                    ? meta.color === 'emerald' ? 'text-emerald-600' : 'text-teal-600'
                    : 'text-muted-foreground'
                }`} />
                <span className={`text-xs font-bold ${
                  active
                    ? meta.color === 'emerald' ? 'text-emerald-600' : 'text-teal-600'
                    : 'text-muted-foreground'
                }`}>{meta.label}</span>
                <span className="text-[9px] text-muted-foreground">{meta.sub}</span>
              </button>
            )
          })}

          {/* §2: Cloaked wholesale card — animates in only after left-swipe reveal */}
          <AnimatePresence>
            {wholesaleRevealed && (
              <motion.button
                initial={{ width: 0, opacity: 0, marginRight: 0 }}
                animate={{ width: 'auto', opacity: 1, marginRight: 8 }}
                exit={{ width: 0, opacity: 0, marginRight: 0 }}
                transition={{ duration: 0.3 }}
                onClick={() => handleModeSwitch('wholesale')}
                className={`shrink-0 px-4 py-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 min-w-[120px] min-h-[80px] justify-center relative overflow-hidden ${
                  mode === 'wholesale'
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                    : 'border-amber-400/40 bg-amber-500/5'
                }`}
              >
                {(() => {
                  const m = 'wholesale' as const
                  const meta = modeMeta[m]
                  const Icon = meta.icon
                  const active = mode === m
                  const locked = !wholesaleUnlocked
                  return (
                    <>
                      <Icon className={`w-5 h-5 ${active ? 'text-amber-600' : 'text-amber-500/70'}`} />
                      <span className={`text-xs font-bold ${active ? 'text-amber-600' : 'text-amber-600/80'}`}>{meta.label}</span>
                      <span className="text-[9px] text-muted-foreground">{meta.sub}</span>
                      {locked && (
                        <span className="absolute top-1.5 right-1.5">
                          <Lock className="w-3 h-3 text-amber-500" />
                        </span>
                      )}
                      {wholesaleUnlocked && !active && (
                        <ShieldCheck className="absolute top-1.5 right-1.5 w-3 h-3 text-emerald-500" />
                      )}
                    </>
                  )
                })()}
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* §2: Swipe hint — visible when wholesale is NOT yet revealed */}
        {!wholesaleRevealed && (
          <div className="absolute right-0 top-0 bottom-0 flex items-center pointer-events-none">
            <motion.div
              animate={{ x: [0, -6, 0] }}
              transition={{ repeat: Infinity, duration: 1.5 }}
              className="flex items-center gap-1 px-2 py-1 rounded-l-xl bg-amber-500/20 text-amber-600 text-[9px] font-medium"
            >
              <ChevronLeft className="w-3 h-3" />
              <span>সোয়াইপ</span>
            </motion.div>
          </div>
        )}

        {/* §2: Re-hide button when wholesale is revealed */}
        {wholesaleRevealed && (
          <button
            onClick={() => {
              setWholesaleRevealed(false)
              if (mode === 'wholesale') {
                setMode('retail')
                setWholesaleUnlocked(false)
              }
            }}
            className="absolute right-0 top-0 bottom-0 px-2 flex items-center text-amber-600 hover:bg-amber-500/10"
            aria-label="Hide wholesale"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Category slider */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] ${
              activeCategory === cat ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* §2: Sub-category slider — dynamically loaded based on selected main category */}
      {subCategories.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {subCategories.map((subCat) => (
            <button
              key={subCat}
              onClick={() => setActiveSubCategorySafe(subCat)}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all min-h-[30px] ${
                effectiveSubCategory === subCat ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
              }`}
            >
              {subCat}
            </button>
          ))}
        </div>
      )}

      {/* Product grid */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {mode === 'retail' ? 'খুচরো পণ্য (per kg/pcs)' : mode === 'full' ? 'প্রোডাক্ট (per bag/box)' : 'পাইকারি পণ্য (bulk rate)'}
        </p>
        {filteredProducts.length === 0 ? (
          <EmptyState
            icon={Package}
            title={mode === 'retail' ? 'কোনো খুচরো পণ্য নেই' : mode === 'wholesale' ? 'কোনো পাইকারি পণ্য নেই' : 'কোনো পণ্য নেই'}
            description={
              mode === 'retail' ? 'প্রোডাক্ট ফর্মে "খুচরো দাম" সেট করুন।'
              : mode === 'wholesale' ? 'প্রোডাক্ট ফর্মে "Wholesale Price" সেট করুন।'
              : undefined
            }
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredProducts.map((p) => {
              const price = getPrice(p)
              const unit = getPriceUnit(p)
              // §3: Use mode-suffixed cartKey so highlight only shows for the CURRENT mode.
              // Switching from Retail to Full will NOT show the product as "in cart" if it
              // was only added in Retail mode.
              const inCart = cart.find((i) => i.cartKey === getCartKey(p.id, mode))
              return (
                <motion.button
                  key={p.id}
                  whileTap={{ scale: 0.96 }}
                  onClick={() => addToCart(p)}
                  className={`relative p-3 rounded-2xl border text-left transition-all ${
                    inCart ? 'border-primary bg-primary/5' : 'border-border bg-card hover:border-primary/30'
                  }`}
                >
                  <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-2">
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <p className="text-xs font-medium truncate">{p.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {mode === 'retail' && (p as any).looseStock !== undefined
                      ? `${(p as any).looseStock} ${unit}`
                      : `${p.stock} ${p.unit}`} স্টকে
                  </p>
                  <p className="text-sm font-bold tabular text-primary mt-0.5">
                    {formatCurrency(price, currency)}
                    <span className="text-[9px] text-muted-foreground font-normal">/{unit}</span>
                  </p>
                  {inCart && (
                    <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                      {inCart.quantity}
                    </span>
                  )}
                </motion.button>
              )
            })}
          </div>
        )}
      </div>

      {/* Cart — only shows active cart's items */}
      <AnimatePresence>
        {cart.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="rounded-2xl bg-card border border-border p-4 shadow-lg"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <ShoppingBag className="w-4 h-4" /> {activeCart.customer?.name || activeCart.label} · কার্ট ({cart.length})
              </h3>
              <button onClick={() => setCart([])} className="text-xs text-red-600 font-medium">মুছুন</button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto scroll-area">
              {cart.map((item) => (
                <CartRow
                  key={item.cartKey}
                  item={item}
                  mode={mode}
                  masterGstOn={masterGstOn}
                  currency={currency}
                  onSetUnitPrice={setUnitPrice}
                  onSetQty={setQty}
                  onCommitQty={commitQty}
                  onUpdateQty={updateQty}
                  onSetManualTotal={setManualTotal}
                  onResetManualTotal={resetManualTotal}
                  onRemoveFromCart={removeFromCart}
                  onToggleItemGst={toggleItemGst}
                  onSetItemGstRate={setItemGstRate}
                />
              ))}
            </div>

            {/* §3: Billing Sequence — 5 rows with Left Buttons | Right Values alignment */}
            <div className="pt-3 mt-2 border-t border-border space-y-2">
              {/* Row 1: GST Toggle — Left: [No GST]/[Include GST] button, Right: GST amount */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setMasterGstOn(!masterGstOn)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                    masterGstOn
                      ? 'bg-blue-500 text-white'
                      : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {masterGstOn ? 'Include GST' : 'No GST'}
                </button>
                <span className="tabular text-sm font-medium text-blue-600">
                  {masterGstOn && gstAmount > 0 ? `+${formatCurrency(gstAmount, currency)}` : '₹0.00'}
                </span>
              </div>

              {/* Row 2: Total after GST (subtotal + GST) */}
              <div className="flex justify-between items-center text-sm bg-muted/30 rounded-lg px-3 py-1.5">
                <span className="text-muted-foreground">GST সহ মোট</span>
                <span className="tabular font-semibold">{formatCurrency(subtotalWithGst, currency)}</span>
              </div>

              {/* Row 3: Discount Block — Left: discount input/button, Right: cash value subtracted */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-0.5 bg-muted/50 p-0.5 rounded-md">
                  <button
                    onClick={() => setDiscountMode('flat')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                      discountMode === 'flat' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400'
                    }`}
                  >
                    ₹
                  </button>
                  <button
                    onClick={() => setDiscountMode('percent')}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all ${
                      discountMode === 'percent' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white text-gray-400'
                    }`}
                  >
                    %
                  </button>
                </div>
                <Input
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  className="h-8 text-sm flex-1"
                  inputMode="numeric"
                  placeholder="0"
                />
                <span className="tabular text-sm font-medium text-amber-600 min-w-[80px] text-right">
                  −{formatCurrency(discountAmount, currency)}
                </span>
              </div>

              {/* Row 4: Total after Discount */}
              <div className="flex justify-between items-center text-sm bg-muted/30 rounded-lg px-3 py-1.5">
                <span className="text-muted-foreground">ছাড় পরবর্তী মোট</span>
                <span className="tabular font-semibold">{formatCurrency(grandTotal, currency)}</span>
              </div>

              {/* §2: Auto-discount info from MRP vs Sale Price */}
              {autoDiscountTotal > 0 && (
                <div className="flex justify-between text-[10px] text-emerald-600 px-1">
                  <span>স্বয়ংক্রিয় ছাড় (MRP vs দর)</span>
                  <span className="tabular font-medium">−{formatCurrency(autoDiscountTotal, currency)}</span>
                </div>
              )}

              {/* §1: Round Off — displayed right above Delivery Charge */}
              {Math.abs(roundOffAmount) > 0.001 && (
                <div className="flex justify-between text-xs text-muted-foreground px-1">
                  <span>Round Off ({roundOffAmount > 0 ? '+' : '−'}₹{Math.abs(roundOffAmount).toFixed(2)})</span>
                  <span className="tabular">{formatCurrency(roundOffAmount, currency)}</span>
                </div>
              )}

              {/* §1: Delivery/Shipping Charge — between Round Off and Actual Price */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] text-muted-foreground shrink-0">
                  ডেলিভারি / পরিবহন খরচ
                </label>
                <div className="flex items-baseline gap-0.5 flex-1">
                  <span className="text-[10px] text-muted-foreground">₹</span>
                  <input
                    value={deliveryCharge}
                    onChange={(e) => setDeliveryCharge(e.target.value)}
                    className="w-full text-sm tabular bg-transparent border-0 border-b border-border focus:border-primary outline-none px-0 py-0.5"
                    inputMode="numeric"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Row 5: Final Payable — [Actual Price] (includes delivery) */}
              <div className="flex justify-between items-center pt-2 border-t border-border">
                <span className="font-bold text-base">Actual Price</span>
                <motion.span
                  key={roundedTotal}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className="font-bold tabular text-primary text-xl"
                >
                  {formatCurrency(roundedTotal, currency)}
                </motion.span>
              </div>
            </div>

            {/* §1: Customer bar removed from mid-screen — now at TOP only */}

            {/* §4: Payment Mode split matrix — underneath Actual Price */}
            <div className="mt-3 p-3 rounded-xl bg-muted/30 border border-border/50">
              <p className="text-[10px] text-muted-foreground uppercase mb-2 font-medium">Split Payment (একসাথে একাধিক মোড)</p>
              <div className="grid grid-cols-2 gap-2">
                {/* Cash split */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Wallet className="w-3 h-3" /> Cash ₹
                  </label>
                  <Input
                    value={splitCash}
                    onChange={(e) => setSplitCash(e.target.value)}
                    className="h-9 text-sm"
                    inputMode="numeric"
                    placeholder="0"
                  />
                </div>
                {/* UPI split */}
                <div className="space-y-1">
                  <button
                    onClick={() => setPaymentMode(paymentMode === 'upi' ? 'cash' : 'upi')}
                    className="text-[10px] text-muted-foreground flex items-center gap-1 w-full"
                  >
                    <QrCode className={`w-3 h-3 ${paymentMode === 'upi' ? 'text-violet-600' : ''}`} />
                    UPI ₹
                    {paymentMode === 'upi' && <span className="ml-auto text-[9px] text-violet-600">QR চালু</span>}
                  </button>
                  <Input
                    value={splitUpi}
                    onChange={(e) => { setSplitUpi(e.target.value); setPaymentMode('upi') }}
                    className={`h-9 text-sm ${paymentMode === 'upi' ? 'border-violet-400' : ''}`}
                    inputMode="numeric"
                    placeholder="0"
                  />
                </div>
                {/* §1: Credit split input REMOVED — user uses Cash + UPI only.
                    Ledger Due is calculated automatically when Total Input < Actual Price. */}
                {/* Cheque */}
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <FileCheck className="w-3 h-3" /> Cheque No
                  </label>
                  <Input
                    value={splitChequeNo}
                    onChange={(e) => setSplitChequeNo(e.target.value)}
                    className="h-9 text-sm"
                    placeholder="CHQ-001234"
                  />
                </div>
              </div>

              {/* Split payment summary */}
              {hasSplitPayment && (
                <div className="mt-2 pt-2 border-t border-border/50 space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">মোট পরিশোধিত</span>
                    <span className="tabular font-medium text-emerald-600">₹{totalSplitPaid.toFixed(2)}</span>
                  </div>
                  {overpaid > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">বাকি (খুচরা)</span>
                      <span className="tabular font-medium text-emerald-600">₹{overpaid.toFixed(2)}</span>
                    </div>
                  ) : ledgerDue > 0 ? (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">খাতায় বাকি (Ledger Due)</span>
                      <span className="tabular font-medium text-amber-600">₹{ledgerDue.toFixed(2)}</span>
                    </div>
                  ) : (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">স্ট্যাটাস</span>
                      <span className="tabular font-medium text-emerald-600">সম্পূর্ণ পরিশোধিত ✓</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* UPI QR — conditional on amount > 0 */}
            <AnimatePresence>
              {paymentMode === 'upi' && upiQrAmount > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 mt-2 rounded-xl bg-violet-50 dark:bg-violet-950/30">
                    <div className="flex items-center gap-2 mb-2">
                      <QrCode className="w-4 h-4 text-violet-600" />
                      <p className="text-xs font-medium text-violet-700 dark:text-violet-300 flex-1">
                        UPI পেমেন্ট QR {splitUpiNum > 0 && <span className="text-[10px]">(স্প্লিট: ₹{splitUpiNum.toFixed(2)})</span>}
                      </p>
                      {/* §6: Share QR button */}
                      {upiQrDataUrl && (
                        <button
                          onClick={async () => {
                            try {
                              const res = await fetch(upiQrDataUrl)
                              const blob = await res.blob()
                              const file = new File([blob], `upi-qr-${upiQrAmount}.png`, { type: 'image/png' })
                              const upiUrl = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(merchantName)}&am=${upiQrAmount.toFixed(2)}&cu=INR`
                              if (navigator.share) {
                                if (navigator.canShare && navigator.canShare({ files: [file] })) {
                                  await navigator.share({ title: 'UPI Payment QR', text: `Pay ₹${upiQrAmount.toFixed(2)} to ${merchantName}`, files: [file] })
                                } else {
                                  await navigator.share({ title: 'UPI Payment', text: upiUrl })
                                }
                              } else {
                                // Fallback: open WhatsApp
                                const text = encodeURIComponent(`Pay ₹${upiQrAmount.toFixed(2)} to ${merchantName}\n${upiUrl}`)
                                window.open(`https://wa.me/?text=${text}`, '_blank')
                              }
                            } catch (e) {
                              // Fallback: download QR image
                              const link = document.createElement('a')
                              link.download = `upi-qr-${upiQrAmount}.png`
                              link.href = upiQrDataUrl
                              link.click()
                            }
                          }}
                          className="w-7 h-7 rounded-lg bg-violet-600 text-white flex items-center justify-center hover:bg-violet-700 transition-colors"
                          aria-label="Share QR code"
                          title="Share QR"
                        >
                          <Share2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    {upiQrDataUrl ? (
                      <div className="flex flex-col items-center gap-2">
                        <img src={upiQrDataUrl} alt="UPI QR Code" className="w-44 h-44 rounded-lg bg-white p-1" />
                        <div className="text-center w-full">
                          <p className="text-[10px] text-muted-foreground">স্ক্যান করে পরিশোধ করুন</p>
                          <p className="text-sm font-bold tabular text-violet-700 dark:text-violet-300">
                            {formatCurrency(upiQrAmount, currency)}
                          </p>
                          <p className="text-[9px] text-muted-foreground mt-0.5">{upiId}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="text-center py-4">
                        <p className="text-[11px] text-muted-foreground">QR তৈরি হচ্ছে…</p>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §2: Ledger Due — show when Total Input < Actual Price (red/orange).
                §1: Auto-opens customer picker if no customer selected. */}
            <AnimatePresence>
              {isShortAmount && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div
                    onClick={() => { if (!customer) setShowInlineCustomer(true); }}
                    className={`p-3 mt-2 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-400/40 ${!customer ? 'cursor-pointer hover:bg-orange-100 dark:hover:bg-orange-950/50' : ''}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-orange-700 dark:text-orange-300">
                        খাতায় বাকি (Ledger Due)
                      </span>
                      <span className="text-lg font-bold tabular text-orange-600">
                        ₹{ledgerDue.toFixed(2)}
                      </span>
                    </div>
                    <p className="text-[10px] text-orange-600 mt-1">
                      সম্পন্ন হলে এই পরিমাণ কাস্টমারের খাতায় যুক্ত হবে
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §3: Exchange Calculator — ONLY when Total Input > Actual Price */}
            <AnimatePresence>
              {isChangeDue && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 mt-2 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-400/40">
                    <div className="flex items-center gap-2 mb-2">
                      <Calculator className="w-4 h-4 text-emerald-600" />
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">এক্সচেঞ্জ ক্যালকুলেটর</p>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-emerald-700 dark:text-emerald-300">
                        ফেরত দিতে হবে
                      </span>
                      <span className="text-2xl font-bold tabular text-emerald-600">
                        ₹{overpaid.toFixed(2)}
                      </span>
                    </div>
                    {/* Breakdown */}
                    <div className="mt-2 pt-2 border-t border-emerald-200 dark:border-emerald-800 space-y-1 text-[10px]">
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                        <span>Actual Price</span>
                        <span className="tabular">{formatCurrency(roundedTotal, currency)}</span>
                      </div>
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-300">
                        <span>নগদ + UPI প্রদান</span>
                        <span className="tabular">{formatCurrency(totalPaidForExchange, currency)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §1: Inline customer reveal — NEUTRAL block (blue/gray, NOT red).
                Shown when user taps Ledger Due or Pick Up Later without a customer.
                Smoothly expands with animation. No warning text. */}
            <AnimatePresence>
              {showInlineCustomer && !customer && (
                <motion.div
                  initial={{ opacity: 0, height: 0, y: 10 }}
                  animate={{ opacity: 1, height: 'auto', y: 0 }}
                  exit={{ opacity: 0, height: 0, y: 10 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 25 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 p-3 rounded-xl border-2 border-blue-400/50 bg-blue-50 dark:bg-blue-950/20">
                    <div className="flex items-center gap-1.5 mb-2">
                      <UserPlus className="w-3.5 h-3.5 text-blue-600" />
                      <p className="text-xs font-medium text-blue-700 dark:text-blue-300">
                        কাস্টমার যোগ করুন
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCustPicker(true)}
                        className="flex-1 h-11 px-3 rounded-xl border-2 border-dashed border-blue-400 bg-card flex items-center gap-2 text-sm hover:bg-blue-50 dark:hover:bg-blue-950/20 transition-colors"
                      >
                        <UserPlus className="w-4 h-4 text-blue-600" />
                        <span className="text-blue-700 dark:text-blue-300 font-medium">কাস্টমার নির্বাচন করুন</span>
                      </button>
                      <button
                        onClick={() => { setShowPartyForm(true); }}
                        className="w-11 h-11 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0 hover:bg-blue-600 transition-colors"
                        aria-label="নতুন কাস্টমার"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §2: Animated Credit Gate — RED warning. ONLY shown on final submit failure. */}
            <AnimatePresence>
              {showCreditGate && (
                <motion.div
                  initial={{ opacity: 0, y: 30, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: 20, height: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 20 }}
                  className="overflow-hidden"
                >
                  <motion.div
                    animate={{ x: [0, -8, 8, -6, 6, 0] }}
                    transition={{ duration: 0.4, repeat: 2 }}
                    className="mt-3 p-3 rounded-xl border-2 border-red-500 bg-red-50 dark:bg-red-950/30"
                  >
                    {/* Mandatory warning label */}
                    <div className="flex items-center gap-1.5 mb-2">
                      <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
                      <p className="text-xs font-bold text-red-700 dark:text-red-300">
                        বাকি রাখার জন্য কাস্টমার যুক্ত করা বাধ্যতামূলক
                      </p>
                    </div>
                    {/* Clone of Add Customer input */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setShowCustPicker(true); }}
                        className="flex-1 h-11 px-3 rounded-xl border-2 border-dashed border-red-400 bg-card flex items-center gap-2 text-sm hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                      >
                        <UserPlus className="w-4 h-4 text-red-600" />
                        <span className="text-red-700 dark:text-red-300 font-medium">কাস্টমার নির্বাচন করুন</span>
                      </button>
                      <button
                        onClick={() => { setShowPartyForm(true); }}
                        className="w-11 h-11 rounded-xl bg-red-500 text-white flex items-center justify-center shrink-0 hover:bg-red-600 transition-colors"
                        aria-label="নতুন কাস্টমার"
                      >
                        <Plus className="w-5 h-5" />
                      </button>
                    </div>
                    {/* Ledger due amount */}
                    <p className="text-[10px] text-red-600 mt-1.5 text-center">
                      খাতায় বাকি: ₹{ledgerDue.toFixed(2)} · কাস্টমার যুক্ত করলে ট্রানজেকশন সম্পন্ন হবে
                    </p>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §5: Fulfillment Status toggle — Handled Over / Pick Up Later */}
            <div className="flex items-center gap-2 mt-2 p-2.5 rounded-xl bg-muted/30 border border-border/50">
              <span className="text-[11px] font-medium text-muted-foreground shrink-0">Delivery Status:</span>
              <div className="flex items-center gap-1 flex-1">
                <button
                  onClick={() => setFulfillmentStatus('handed')}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    fulfillmentStatus === 'handed' ? 'bg-emerald-600 text-white shadow-sm' : 'bg-card text-muted-foreground'
                  }`}
                >
                  ✓ Handed Over
                </button>
                <button
                  onClick={() => {
                    // §1: If no customer, smoothly reveal inline customer block (NOT red, NOT navigation)
                    if (!customer) {
                      setShowInlineCustomer(true)
                      return
                    }
                    setFulfillmentStatus('pickup')
                  }}
                  className={`flex-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                    fulfillmentStatus === 'pickup' ? 'bg-amber-600 text-white shadow-sm' : 'bg-card text-muted-foreground'
                  }`}
                >
                  📦 Pick Up Later
                </button>
              </div>
            </div>

            {/* §4: Action Footer — Invoice (left) + Done (right) */}
            <div className="flex items-center gap-2 mt-3">
              <Button
                variant="outline"
                onClick={handleGenerateInvoice}
                disabled={confirming}
                className="h-12 px-6 text-sm font-semibold rounded-2xl flex-1"
              >
                <Receipt className="w-4 h-4 mr-1.5" /> {confirming ? '…' : 'ইনভয়েস'}
              </Button>
              <Button
                onClick={handleDone}
                disabled={confirming}
                className="h-12 px-8 text-base font-bold rounded-2xl shadow-lg"
              >
                {confirming ? (
                  <><span className="animate-spin">⏳</span> হচ্ছে…</>
                ) : (
                  <><CheckCircle2 className="w-5 h-5 mr-2" /> সম্পন্ন হয়েছে</>
                )}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <FullScreenPicker
        open={showCustPicker}
        onClose={() => setShowCustPicker(false)}
        onSelect={(item) => {
          const p = (parties || []).find((x) => x.id === item.id)
          if (p) setCustomer(p)
          setShowCustPicker(false)
        }}
        items={partyItems}
        placeholder="কাস্টমার খুঁজুন…"
        emptyText="কোনো কাস্টমার পাওয়া যায়নি"
      />

      {/* §1: PartyForm — rendered here so [+] icon can trigger customer registration
          directly from Quick Sale without navigating away. */}
      <PartyForm
        open={showPartyForm}
        onOpenChange={(o) => setShowPartyForm(o)}
      />

      {/* §1: Cart Close Prompt — Wipe or Send to Held Queue */}
      <AnimatePresence>
        {closePromptCartId !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setClosePromptCartId(null)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-2xl p-5 max-w-sm w-full space-y-4 shadow-2xl"
            >
              <div className="text-center">
                <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
                  <Trash2 className="w-6 h-6 text-red-500" />
                </div>
                <h3 className="text-base font-bold">কার্ট বন্ধ করুন</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  {carts.find((c) => c.id === closePromptCartId)?.customer?.name || carts.find((c) => c.id === closePromptCartId)?.label} এর কার্টে{' '}
                  {carts.find((c) => c.id === closePromptCartId)?.items.length || 0} টি আইটেম আছে। কী করবেন?
                </p>
              </div>
              <div className="space-y-2">
                <Button
                  variant="outline"
                  className="w-full h-11 border-amber-400 text-amber-600 hover:bg-amber-500/10"
                  onClick={() => sendToHeldQueue(closePromptCartId)}
                >
                  <Layers className="w-4 h-4 mr-2" /> হোল্ড কিউ-তে পাঠান
                  <span className="text-[10px] text-muted-foreground ml-1">(পুনরুদ্ধারযোগ্য)</span>
                </Button>
                <Button
                  variant="destructive"
                  className="w-full h-11"
                  onClick={() => wipeCart(closePromptCartId)}
                >
                  <Trash2 className="w-4 h-4 mr-2" /> সম্পূর্ণ মুছে ফেলুন
                </Button>
                <Button
                  variant="ghost"
                  className="w-full h-10"
                  onClick={() => setClosePromptCartId(null)}
                >
                  বাতিল
                </Button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* §1: Held Queue Modal — restore or delete held carts */}
      <AnimatePresence>
        {showHeldQueue && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => setShowHeldQueue(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-card rounded-2xl p-5 max-w-sm w-full space-y-3 shadow-2xl"
            >
              <div className="flex items-center gap-2 pb-2 border-b border-border">
                <Layers className="w-5 h-5 text-amber-500" />
                <h3 className="text-base font-bold">হোল্ড কিউ ({heldQueue.length})</h3>
              </div>
              {heldQueue.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-4">হোল্ড কিউ খালি</p>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto">
                  {heldQueue.map((c, hqIndex) => {
                    const cartTotal = c.items.reduce((s, i) => s + i.total, 0)
                    return (
                      <div key={c.id} className="p-3 rounded-xl bg-amber-500/5 border border-amber-400/30">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold">{c.customer?.name || `পার্সন ${hqIndex + 1}`}</p>
                            <p className="text-[11px] text-muted-foreground">
                              {c.items.length} আইটেম · {formatCurrency(cartTotal, currency)}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => restoreFromHeldQueue(c.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-500 text-white text-[11px] font-medium hover:bg-emerald-600"
                            >
                              পুনরুদ্ধার
                            </button>
                            <button
                              onClick={() => deleteFromHeldQueue(c.id)}
                              className="w-7 h-7 rounded-lg bg-red-500/10 text-red-500 flex items-center justify-center"
                              aria-label="Delete"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <Button variant="ghost" className="w-full h-10" onClick={() => setShowHeldQueue(false)}>
                বন্ধ করুন
              </Button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
// trigger rebuild Fri Jul 17 00:09:50 UTC 2026
