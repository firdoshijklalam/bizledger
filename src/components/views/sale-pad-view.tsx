'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Product, Party } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Package, Plus, Minus, Trash2, UserPlus, Receipt,
  Store, Boxes, CheckCircle2, X, Wallet, QrCode, CreditCard, FileCheck,
  ChevronDown, ChevronUp, Calculator, Lock, Eye, EyeOff, ShieldCheck,
  Users, BadgePercent, Settings2, Layers,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useMemo, useState, useCallback } from 'react'
import { FullScreenPicker } from '@/components/shared/full-screen-picker'
import { useGateTrigger } from '@/store/biometric-gate-store'

interface CartItem {
  productId: string
  name: string
  unit: string
  price: number
  quantity: number
  total: number
  manualOverride: boolean // true when owner manually edited the total
}

type PaymentMode = 'cash' | 'upi' | 'credit' | 'cheque'
type SaleMode = 'retail' | 'full' | 'wholesale'

// PRD Part 39 §3: Multi-Cart Hold Protocol — each person gets their own held cart
interface HeldCart {
  id: number
  label: string
  items: CartItem[]
  customer: Party | null
  paymentMode: PaymentMode
}

export function SalePadView() {
  const { business, setActiveView, setSelectedInvoiceId, triggerRefresh } = useAppStore()
  const { t } = useI18n()
  const { data: products } = useFetch<Product[]>('/api/products', [])
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [])

  // §3: Multi-Cart Hold Protocol — পার্সন ১, ২, ৩, +
  const [carts, setCarts] = useState<HeldCart[]>([
    { id: 1, label: 'পার্সন ১', items: [], customer: null, paymentMode: 'cash' },
  ])
  const [activeCartId, setActiveCartId] = useState(1)
  const activeCart = carts.find((c) => c.id === activeCartId) || carts[0]

  // §2: Sale mode — খুচরো / আস্ত / পাইকারি (wholesale PIN-gated)
  const [mode, setMode] = useState<SaleMode>('retail')
  const [wholesaleUnlocked, setWholesaleUnlocked] = useState(false)
  const triggerGate = useGateTrigger()

  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [showCustPicker, setShowCustPicker] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // §4: Discount with % / ₹ toggle + live Grand Total
  const [discountMode, setDiscountMode] = useState<'flat' | 'percent'>('flat')
  const [discountValue, setDiscountValue] = useState('')

  const currency = business?.currency || 'INR'

  // ---- Cart helpers (operate on the active held cart) ----
  const updateActiveCart = useCallback((updater: (c: HeldCart) => HeldCart) => {
    setCarts((prev) => prev.map((c) => (c.id === activeCartId ? updater(c) : c)))
  }, [activeCartId])

  const cart = activeCart.items
  const customer = activeCart.customer
  const paymentMode = activeCart.paymentMode

  const setCart = (items: CartItem[]) => updateActiveCart((c) => ({ ...c, items }))
  const setCustomer = (p: Party | null) => updateActiveCart((c) => ({ ...c, customer: p }))
  const setPaymentMode = (m: PaymentMode) => updateActiveCart((c) => ({ ...c, paymentMode: m }))

  const [cashReceived, setCashReceived] = useState('')
  const [partialPaid, setPartialPaid] = useState('')
  const [chequeNo, setChequeNo] = useState('')

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
    return list
  }, [products, mode, activeCategory])

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

  const addToCart = (p: Product) => {
    const price = getPrice(p)
    const unit = getPriceUnit(p)
    setCart([...cart, { productId: p.id, name: p.name, unit, price, quantity: 1, total: price, manualOverride: false }])
  }

  const updateQty = (productId: string, delta: number) => {
    setCart(cart
      .map((i) => {
        if (i.productId !== productId) return i
        const step = mode === 'retail' ? 0.5 : 1
        const newQty = Math.max(0, Number((i.quantity + delta * step).toFixed(3)))
        // If manual override, keep total as-is (don't recompute from price)
        if (i.manualOverride) return { ...i, quantity: newQty }
        return { ...i, quantity: newQty, total: newQty * i.price }
      })
      .filter((i) => i.quantity > 0)
    )
  }

  const setQty = (productId: string, qty: number) => {
    setCart(cart
      .map((i) => {
        if (i.productId !== productId) return i
        if (i.manualOverride) return { ...i, quantity: qty }
        return { ...i, quantity: qty, total: qty * i.price }
      })
      .filter((i) => i.quantity > 0)
    )
  }

  // §4: Manual Price Override — editable total field in cart
  const setManualTotal = (productId: string, total: number) => {
    setCart(cart.map((i) =>
      i.productId === productId
        ? { ...i, total, manualOverride: true }
        : i
    ))
  }

  // Reset a manually overridden item back to auto-calc
  const resetManualTotal = (productId: string) => {
    setCart(cart.map((i) =>
      i.productId === productId
        ? { ...i, total: i.quantity * i.price, manualOverride: false }
        : i
    ))
  }

  const removeFromCart = (productId: string) => {
    setCart(cart.filter((i) => i.productId !== productId))
  }

  // §4: Grand Total with live discount sync
  const subtotal = cart.reduce((s, i) => s + i.total, 0)
  const discountNum = Number(discountValue) || 0
  const discountAmount = discountMode === 'percent'
    ? (subtotal * discountNum) / 100
    : Math.min(discountNum, subtotal)
  const grandTotal = Math.max(0, subtotal - discountAmount)

  // Cash exchange calculator
  const cashReceivedNum = Number(cashReceived) || 0
  const changeDue = Math.max(0, cashReceivedNum - grandTotal)

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
    setCarts([...carts, newCart])
    setActiveCartId(nextId)
    setCashReceived('')
    setPartialPaid('')
    setDiscountValue('')
    toast.success(`${newCart.label} এর জন্য নতুন কার্ট খোলা হলো`, {
      description: 'আগের কার্ট হোল্ড করা আছে',
    })
  }

  const switchCart = (id: number) => {
    if (id === activeCartId) return
    setActiveCartId(id)
    setCashReceived('')
    setPartialPaid('')
    setDiscountValue('')
    toast(`কার্ট সুইচ হলো`, { description: carts.find((c) => c.id === id)?.label })
  }

  const removeCart = (id: number) => {
    if (carts.length <= 1) {
      toast('কমপক্ষে ১টি কার্ট থাকতে হবে')
      return
    }
    const newCarts = carts.filter((c) => c.id !== id)
    setCarts(newCarts)
    if (activeCartId === id) setActiveCartId(newCarts[0].id)
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
    setConfirming(true)
    try {
      const amountPaid = paymentMode === 'cash'
        ? grandTotal
        : paymentMode === 'credit'
        ? (Number(partialPaid) || 0)
        : grandTotal
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
      })
      toast.success('ইনভয়েস তৈরি হয়েছে')
      triggerRefresh()
      // Clear active cart
      setCart([])
      setCustomer(null)
      setCashReceived('')
      setPartialPaid('')
      setChequeNo('')
      setDiscountValue('')
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
    setConfirming(true)
    try {
      if (customer) {
        await apiPost('/api/transactions', {
          partyId: customer.id,
          type: 'credit',
          amount: grandTotal,
          description: `Cash sale (${mode})`,
          category: 'Cash Sale',
        })
      } else {
        await apiPost('/api/transactions', {
          partyId: null,
          type: 'credit',
          amount: grandTotal,
          description: `Walk-in cash sale (${mode})`,
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
        paymentMode: 'cash',
        type: 'retail',
        amountPaid: grandTotal,
      })
      toast.success('সম্পন্ন হয়েছে — স্টক আপডেট হয়েছে')
      triggerRefresh()
      setCart([])
      setCustomer(null)
      setCashReceived('')
      setDiscountValue('')
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
    full: { label: 'আস্ত প্রোডাক্ট', sub: 'Full · per bag/box', icon: Boxes, color: 'teal' },
    wholesale: { label: 'পাইকারি প্রোডাক্ট', sub: 'Wholesale · bulk rate', icon: Layers, color: 'amber' },
  } as const

  return (
    <div className="space-y-4 pb-4">
      {/* §3: Multi-Cart Hold Protocol — পার্সন ১, ২, ৩, + */}
      <div className="p-3 rounded-2xl bg-gradient-to-r from-blue-500/5 to-emerald-500/5 border border-blue-500/20">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-blue-500" />
          <p className="text-xs font-semibold text-blue-700 dark:text-blue-300">কার্ট হোল্ড সিস্টেম (Multi-Cart)</p>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {carts.map((c) => {
            const active = c.id === activeCartId
            const itemCount = c.items.length
            const cartTotal = c.items.reduce((s, i) => s + i.total, 0)
            return (
              <button
                key={c.id}
                onClick={() => switchCart(c.id)}
                className={`shrink-0 relative px-4 py-2.5 rounded-xl border-2 transition-all min-w-[100px] ${
                  active
                    ? 'border-blue-500 bg-blue-500 text-white shadow-md'
                    : 'border-border bg-card text-muted-foreground'
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-bold">{c.label}</span>
                  {itemCount > 0 && (
                    <span className={`text-[10px] px-1.5 rounded-full ${active ? 'bg-white/25' : 'bg-muted'}`}>
                      {itemCount}
                    </span>
                  )}
                </div>
                {itemCount > 0 && (
                  <p className={`text-[10px] tabular mt-0.5 ${active ? 'text-white/80' : 'text-muted-foreground'}`}>
                    {formatCurrency(cartTotal, currency)}
                  </p>
                )}
                {!active && itemCount > 0 && carts.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); removeCart(c.id) }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); removeCart(c.id) } }}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center"
                  >
                    <X className="w-3 h-3" />
                  </span>
                )}
                {active && itemCount > 0 && (
                  <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                )}
              </button>
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
        </div>
      </div>

      {/* §2: Mode selector — 3 cards (খুচরো / আস্ত / পাইকারি) */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {(['retail', 'full', 'wholesale'] as const).map((m) => {
          const meta = modeMeta[m]
          const Icon = meta.icon
          const active = mode === m
          const locked = m === 'wholesale' && !wholesaleUnlocked
          return (
            <button
              key={m}
              onClick={() => handleModeSwitch(m)}
              className={`shrink-0 px-4 py-3 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 min-w-[120px] min-h-[80px] justify-center relative ${
                active
                  ? meta.color === 'emerald' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                  : meta.color === 'teal' ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
                  : 'border-amber-500 bg-amber-50 dark:bg-amber-950/30'
                  : 'border-border bg-muted/30'
              }`}
            >
              <Icon className={`w-5 h-5 ${
                active
                  ? meta.color === 'emerald' ? 'text-emerald-600'
                  : meta.color === 'teal' ? 'text-teal-600'
                  : 'text-amber-600'
                  : 'text-muted-foreground'
              }`} />
              <span className={`text-xs font-bold ${
                active
                  ? meta.color === 'emerald' ? 'text-emerald-600'
                  : meta.color === 'teal' ? 'text-teal-600'
                  : 'text-amber-600'
                  : 'text-muted-foreground'
              }`}>{meta.label}</span>
              <span className="text-[9px] text-muted-foreground">{meta.sub}</span>
              {locked && (
                <span className="absolute top-1.5 right-1.5 flex items-center gap-0.5">
                  <Lock className="w-3 h-3 text-amber-500" />
                </span>
              )}
              {m === 'wholesale' && wholesaleUnlocked && !active && (
                <ShieldCheck className="absolute top-1.5 right-1.5 w-3 h-3 text-emerald-500" />
              )}
            </button>
          )
        })}
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

      {/* Product grid */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          {mode === 'retail' ? 'খুচরো পণ্য (per kg/pcs)' : mode === 'full' ? 'আস্ত পণ্য (per bag/box)' : 'পাইকারি পণ্য (bulk rate)'}
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
              const inCart = cart.find((i) => i.productId === p.id)
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
                <ShoppingBag className="w-4 h-4" /> {activeCart.label} · কার্ট ({cart.length})
              </h3>
              <button onClick={() => setCart([])} className="text-xs text-red-600 font-medium">মুছুন</button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto scroll-area">
              {cart.map((item) => (
                <div key={item.productId} className="p-2 rounded-xl bg-muted/50">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {formatCurrency(item.price, currency)} / {item.unit}
                        {item.manualOverride && (
                          <span className="ml-1 text-amber-600 font-medium">· ম্যানুয়াল</span>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1">
                      <button onClick={() => updateQty(item.productId, -1)} className="w-7 h-7 rounded-lg bg-card flex items-center justify-center" aria-label="Decrease">
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        value={item.quantity}
                        onChange={(e) => setQty(item.productId, Number(e.target.value) || 0)}
                        className="w-14 h-7 text-center text-sm tabular bg-card rounded-lg border-0 outline-none"
                        inputMode="decimal"
                        step="any"
                      />
                      <button onClick={() => updateQty(item.productId, 1)} className="w-7 h-7 rounded-lg bg-card flex items-center justify-center" aria-label="Increase">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    {/* §4: Manual Price Override — editable total */}
                    <input
                      value={item.total}
                      onChange={(e) => setManualTotal(item.productId, Number(e.target.value) || 0)}
                      onDoubleClick={() => resetManualTotal(item.productId)}
                      className="w-20 h-7 text-right text-sm font-bold tabular bg-amber-50 dark:bg-amber-950/30 rounded-lg border border-amber-300/50 outline-none focus:border-amber-500 px-1"
                      inputMode="numeric"
                      title="মোট দাম ম্যানুয়ালি এডিট করুন (ডাবল-ক্লিকে রিসেট)"
                    />
                    <button onClick={() => removeFromCart(item.productId)} className="text-red-500" aria-label="Remove">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Subtotal + Discount + Grand Total */}
            <div className="pt-3 mt-2 border-t border-border space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">সাবটোটাল</span>
                <span className="tabular font-medium">{formatCurrency(subtotal, currency)}</span>
              </div>

              {/* §4: Discount with % / ₹ toggle */}
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
                  <button
                    onClick={() => setDiscountMode('flat')}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                      discountMode === 'flat' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
                    }`}
                  >
                    ₹
                  </button>
                  <button
                    onClick={() => setDiscountMode('percent')}
                    className={`px-2 py-1 rounded-md text-[11px] font-medium transition-all ${
                      discountMode === 'percent' ? 'bg-card shadow-sm text-foreground' : 'text-muted-foreground'
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
                  placeholder={discountMode === 'flat' ? '০' : '০'}
                />
                <div className="flex items-center gap-1 text-xs text-amber-600 min-w-[80px] justify-end">
                  <BadgePercent className="w-3.5 h-3.5" />
                  <span className="tabular font-medium">−{formatCurrency(discountAmount, currency)}</span>
                </div>
              </div>

              {/* Grand Total — live updates */}
              <div className="flex justify-between items-center pt-1">
                <span className="font-semibold">{t('bill.grandTotal')}</span>
                <motion.span
                  key={grandTotal.toFixed(2)}
                  initial={{ scale: 1.05 }}
                  animate={{ scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className="font-bold tabular text-primary text-lg"
                >
                  {formatCurrency(grandTotal, currency)}
                </motion.span>
              </div>
            </div>

            {/* §4: Advanced Options dropdown — Customer + Invoice moved here */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full mt-3 flex items-center justify-between p-2.5 rounded-xl bg-muted/50 text-xs font-medium hover:bg-muted"
            >
              <span className="flex items-center gap-1.5">
                <Settings2 className="w-3.5 h-3.5" /> অ্যাডভান্সড অপশন (Advanced Options)
              </span>
              {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
            <AnimatePresence>
              {showAdvanced && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="p-3 mt-1 rounded-xl bg-muted/30 space-y-3">
                    {/* Add Customer (with + icon for new user) */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setShowCustPicker(true)}
                        className="flex-1 p-2.5 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted"
                      >
                        {customer ? (
                          <>
                            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                            <span className="font-medium text-foreground">{customer.name}</span>
                          </>
                        ) : (
                          <>
                            <UserPlus className="w-4 h-4" /> কাস্টমার যোগ করুন
                          </>
                        )}
                      </button>
                      <button
                        onClick={() => { setActiveView('khata'); toast('নতুন কাস্টমার যোগ করতে খাতা পেজে যান') }}
                        className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0"
                        aria-label="New customer"
                        title="নতুন কাস্টমার"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {/* Payment Mode selector */}
                    <div>
                      <p className="text-[10px] text-muted-foreground uppercase mb-1.5">Payment Mode</p>
                      <div className="grid grid-cols-4 gap-1.5">
                        {([
                          { m: 'cash', icon: Wallet, label: 'Cash' },
                          { m: 'upi', icon: QrCode, label: 'UPI' },
                          { m: 'credit', icon: CreditCard, label: 'Credit' },
                          { m: 'cheque', icon: FileCheck, label: 'Cheque' },
                        ] as const).map(({ m, icon: Icon, label }) => (
                          <button
                            key={m}
                            onClick={() => setPaymentMode(m)}
                            className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium ${
                              paymentMode === m ? 'bg-primary text-primary-foreground' : 'bg-card'
                            }`}
                          >
                            <Icon className="w-3.5 h-3.5" /> {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Payment mode-specific inputs */}
                    <AnimatePresence>
                      {paymentMode === 'cash' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
                            <div className="flex items-center gap-2 mb-2">
                              <Calculator className="w-4 h-4 text-emerald-600" />
                              <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">খুচরা ক্যালকুলেটর</p>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div>
                                <label className="text-[10px] text-muted-foreground">গ্রহণ করা নগদ</label>
                                <Input
                                  value={cashReceived}
                                  onChange={(e) => setCashReceived(e.target.value)}
                                  className="h-9 text-sm"
                                  inputMode="numeric"
                                  placeholder="0"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] text-muted-foreground">বাকি</label>
                                <div className="h-9 rounded-lg bg-card flex items-center justify-center text-sm font-bold tabular text-emerald-600">
                                  {formatCurrency(changeDue, currency)}
                                </div>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                      {paymentMode === 'credit' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30">
                            <label className="text-[10px] text-muted-foreground">আংশিক পেমেন্ট (বাকি: {formatCurrency(grandTotal, currency)})</label>
                            <Input
                              value={partialPaid}
                              onChange={(e) => setPartialPaid(e.target.value)}
                              className="h-9 text-sm"
                              inputMode="numeric"
                              placeholder="0"
                            />
                          </div>
                        </motion.div>
                      )}
                      {paymentMode === 'cheque' && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30">
                            <label className="text-[10px] text-muted-foreground">চেক নম্বর</label>
                            <Input
                              value={chequeNo}
                              onChange={(e) => setChequeNo(e.target.value)}
                              className="h-9 text-sm"
                              placeholder="CHQ-001234"
                            />
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Invoice button inside Advanced Options */}
                    <Button
                      variant="outline"
                      onClick={handleGenerateInvoice}
                      disabled={confirming}
                      className="w-full h-10"
                    >
                      <Receipt className="w-4 h-4 mr-1.5" /> {confirming ? '…' : 'ইনভয়েস তৈরি করুন'}
                    </Button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §4: Done button — bottom-right corner */}
            <div className="flex justify-end mt-3">
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
    </div>
  )
}
