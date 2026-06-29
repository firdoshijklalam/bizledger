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
  ChevronDown, ChevronUp, Calculator,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useMemo, useState } from 'react'
import { FullScreenPicker } from '@/components/shared/full-screen-picker'

interface CartItem {
  productId: string
  name: string
  unit: string
  price: number // per kg (retail) or per bag (wholesale)
  quantity: number
  total: number
}

type PaymentMode = 'cash' | 'upi' | 'credit' | 'cheque'

export function SalePadView() {
  const { business, setActiveView, setSelectedInvoiceId, triggerRefresh } = useAppStore()
  const { t } = useI18n()
  const { data: products } = useFetch<Product[]>('/api/products', [])
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [])

  const [mode, setMode] = useState<'retail' | 'wholesale'>('retail')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [cart, setCart] = useState<CartItem[]>([])
  const [customer, setCustomer] = useState<Party | null>(null)
  const [showCustPicker, setShowCustPicker] = useState(false)
  const [confirming, setConfirming] = useState(false)
  // Multi-payment (PRD Part 17 §3)
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('cash')
  const [cashReceived, setCashReceived] = useState('')
  const [partialPaid, setPartialPaid] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)

  const currency = business?.currency || 'INR'

  const categories = useMemo(() => {
    if (!products) return ['All']
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[]
    return ['All', ...cats]
  }, [products])

  // Retail filter: in retail mode, only show products with retailEnabled (PRD Part 17 §2)
  const filteredProducts = useMemo(() => {
    if (!products) return []
    let list = products
    if (mode === 'retail') {
      list = list.filter((p) => (p as any).retailEnabled)
    }
    if (activeCategory !== 'All') {
      list = list.filter((p) => p.category === activeCategory)
    }
    return list
  }, [products, mode, activeCategory])

  const getPrice = (p: Product) => {
    if (mode === 'wholesale' && p.wholesalePrice) return p.wholesalePrice
    return p.salePrice
  }

  const addToCart = (p: Product) => {
    const price = getPrice(p)
    setCart((prev) => {
      const existing = prev.find((i) => i.productId === p.id)
      if (existing) {
        const qty = Number((existing.quantity + 1).toFixed(3))
        return prev.map((i) =>
          i.productId === p.id
            ? { ...i, quantity: qty, total: qty * i.price }
            : i
        )
      }
      return [...prev, { productId: p.id, name: p.name, unit: p.unit, price, quantity: 1, total: price }]
    })
  }

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((i) => {
          if (i.productId !== productId) return i
          // PRD Part 17 §6: decimal qty support
          const step = mode === 'retail' ? 0.5 : 1
          const newQty = Math.max(0, Number((i.quantity + delta * step).toFixed(3)))
          return { ...i, quantity: newQty, total: newQty * i.price }
        })
        .filter((i) => i.quantity > 0)
    )
  }

  const setQty = (productId: string, qty: number) => {
    setCart((prev) =>
      prev
        .map((i) =>
          i.productId === productId ? { ...i, quantity: qty, total: qty * i.price } : i
        )
        .filter((i) => i.quantity > 0)
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((i) => i.productId !== productId))
  }

  const grandTotal = cart.reduce((s, i) => s + i.total, 0)

  // Cash exchange calculator (PRD Part 17 §3.1)
  const cashReceivedNum = Number(cashReceived) || 0
  const changeDue = Math.max(0, cashReceivedNum - grandTotal)

  const handleGenerateInvoice = async () => {
    if (cart.length === 0) {
      toast.error('Cart is empty')
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
        discountMode: 'flat',
        discountValue: 0,
        isGst: false,
        paymentMode,
        type: 'retail',
        amountPaid,
      })
      toast.success('Invoice generated')
      triggerRefresh()
      setCart([])
      setCustomer(null)
      setCashReceived('')
      setPartialPaid('')
      setChequeNo('')
      setConfirming(false)
      setSelectedInvoiceId(invoice.id)
      setActiveView('billing')
    } catch (e) {
      toast.error('Failed: ' + String(e))
      setConfirming(false)
    }
  }

  const handleCashSale = async () => {
    if (cart.length === 0) return
    setConfirming(true)
    try {
      // Cash Sale: track as a transaction AND deduct stock (PRD Part 17 §7)
      if (customer) {
        await apiPost('/api/transactions', {
          partyId: customer.id,
          type: 'credit',
          amount: grandTotal,
          description: `Cash sale (${mode})`,
          category: 'Cash Sale',
        })
      } else {
        // Walk-in: record as anonymous cash sale (no party needed)
        await apiPost('/api/transactions', {
          partyId: null,
          type: 'credit',
          amount: grandTotal,
          description: `Walk-in cash sale (${mode})`,
          category: 'Cash Sale',
        })
      }
      // Stock deduction: post each item as invoice with paymentMode=cash, amountPaid=total (auto-deduct stock)
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
        discountMode: 'flat',
        discountValue: 0,
        isGst: false,
        paymentMode: 'cash',
        type: 'retail',
        amountPaid: grandTotal,
      })
      toast.success('Cash sale recorded — stock updated')
      triggerRefresh()
      setCart([])
      setCustomer(null)
      setCashReceived('')
      setConfirming(false)
    } catch (e) {
      toast.error('Failed: ' + String(e))
      setConfirming(false)
    }
  }

  const partyItems = (parties || []).map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: p.phone || 'No phone',
  }))

  return (
    <div className="space-y-4 pb-4">
      {/* Mode selector — PRD Part 17 §1 */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setMode('retail')}
          className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 min-h-[88px] justify-center ${
            mode === 'retail' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border bg-muted/30'
          }`}
        >
          <Store className={`w-6 h-6 ${mode === 'retail' ? 'text-emerald-600' : 'text-muted-foreground'}`} />
          <span className={`text-sm font-bold ${mode === 'retail' ? 'text-emerald-600' : 'text-muted-foreground'}`}>🟢 খুচরো প্রোডাক্ট</span>
          <span className="text-[10px] text-muted-foreground">Retail (per kg)</span>
        </button>
        <button
          onClick={() => setMode('wholesale')}
          className={`p-4 rounded-2xl border-2 transition-all flex flex-col items-center gap-1 min-h-[88px] justify-center ${
            mode === 'wholesale' ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/30' : 'border-border bg-muted/30'
          }`}
        >
          <Boxes className={`w-6 h-6 ${mode === 'wholesale' ? 'text-amber-600' : 'text-muted-foreground'}`} />
          <span className={`text-sm font-bold ${mode === 'wholesale' ? 'text-amber-600' : 'text-muted-foreground'}`}>🟤 আস্ত প্রোডাক্ট</span>
          <span className="text-[10px] text-muted-foreground">Full Product (per bag)</span>
        </button>
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
          {mode === 'retail' ? 'Select Retail Products (per kg)' : 'Select Products (per bag/box)'}
        </p>
        {filteredProducts.length === 0 ? (
          <EmptyState
            icon={Package}
            title={mode === 'retail' ? 'No retail-enabled products' : 'No products'}
            description={mode === 'retail' ? 'Enable "খুচরো প্রোডাক্ট" in product form.' : undefined}
          />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {filteredProducts.map((p) => {
              const price = getPrice(p)
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
                      ? `${(p as any).looseStock} ${(p as any).retailUnit || 'kg'}`
                      : `${p.stock} ${p.unit}`} in stock
                  </p>
                  <p className="text-sm font-bold tabular text-primary mt-0.5">{formatCurrency(price, currency)}</p>
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

      {/* Cart */}
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
                <ShoppingBag className="w-4 h-4" /> Cart ({cart.length})
              </h3>
              <button onClick={() => setCart([])} className="text-xs text-red-600 font-medium">Clear</button>
            </div>
            <div className="space-y-2 max-h-64 overflow-y-auto scroll-area">
              {cart.map((item) => (
                <div key={item.productId} className="flex items-center gap-2 p-2 rounded-xl bg-muted/50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    <p className="text-[11px] text-muted-foreground">{formatCurrency(item.price, currency)} / {item.unit}</p>
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
                  <span className="text-sm font-bold tabular w-20 text-right">{formatCurrency(item.total, currency)}</span>
                  <button onClick={() => removeFromCart(item.productId)} className="text-red-500" aria-label="Remove">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-3 mt-2 border-t border-border">
              <span className="font-semibold">{t('bill.grandTotal')}</span>
              <span className="font-bold tabular text-primary text-lg">{formatCurrency(grandTotal, currency)}</span>
            </div>

            {/* Customer */}
            <button
              onClick={() => setShowCustPicker(true)}
              className="w-full mt-3 p-2.5 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted"
            >
              {customer ? (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span className="font-medium text-foreground">{customer.name}</span>
                </>
              ) : (
                <>
                  <UserPlus className="w-4 h-4" /> Add Customer (optional)
                </>
              )}
            </button>

            {/* Payment Mode selector (PRD Part 17 §3) */}
            <div className="mt-3">
              <p className="text-[10px] text-muted-foreground uppercase mb-1.5">Payment Mode</p>
              <div className="grid grid-cols-4 gap-1.5">
                <button
                  onClick={() => setPaymentMode('cash')}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium ${
                    paymentMode === 'cash' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <Wallet className="w-3.5 h-3.5" /> Cash
                </button>
                <button
                  onClick={() => setPaymentMode('upi')}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium ${
                    paymentMode === 'upi' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <QrCode className="w-3.5 h-3.5" /> UPI
                </button>
                <button
                  onClick={() => setPaymentMode('credit')}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium ${
                    paymentMode === 'credit' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <CreditCard className="w-3.5 h-3.5" /> Credit
                </button>
                <button
                  onClick={() => setPaymentMode('cheque')}
                  className={`flex flex-col items-center gap-1 py-2 rounded-lg text-[10px] font-medium ${
                    paymentMode === 'cheque' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <FileCheck className="w-3.5 h-3.5" /> Cheque
                </button>
              </div>
            </div>

            {/* Payment mode-specific inputs (PRD Part 17 §3) */}
            <AnimatePresence>
              {paymentMode === 'cash' && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden mt-2"
                >
                  <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
                    <div className="flex items-center gap-2 mb-2">
                      <Calculator className="w-4 h-4 text-emerald-600" />
                      <p className="text-xs font-medium text-emerald-700 dark:text-emerald-300">Exchange Calculator</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Cash Received</label>
                        <Input
                          value={cashReceived}
                          onChange={(e) => setCashReceived(e.target.value)}
                          className="h-9 text-sm"
                          inputMode="numeric"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Change Due</label>
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
                  className="overflow-hidden mt-2"
                >
                  <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30">
                    <label className="text-[10px] text-muted-foreground">Partial Payment (Due: {formatCurrency(grandTotal, currency)})</label>
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
                  className="overflow-hidden mt-2"
                >
                  <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30">
                    <label className="text-[10px] text-muted-foreground">Cheque Number</label>
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

            {/* Advanced Options toggle (PRD Part 17 §4) */}
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full mt-3 flex items-center justify-between p-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <span>Advanced Options</span>
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
                  <div className="p-3 rounded-xl bg-muted/30 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <label className="text-muted-foreground">Discount %</label>
                      <Input className="h-9" placeholder="0" inputMode="numeric" />
                    </div>
                    <div>
                      <label className="text-muted-foreground">GST %</label>
                      <Input className="h-9" placeholder="0" inputMode="numeric" />
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Actions */}
            <div className="grid grid-cols-2 gap-2 mt-3">
              <Button variant="outline" onClick={handleCashSale} disabled={confirming} className="h-11">
                <ShoppingBag className="w-4 h-4 mr-1.5" /> Done / সম্পূর্ণ হয়েছে
              </Button>
              <Button onClick={handleGenerateInvoice} disabled={confirming} className="h-11">
                <Receipt className="w-4 h-4 mr-1.5" /> {confirming ? '…' : 'Invoice'}
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
        placeholder="Search customer…"
        emptyText="No customers found"
      />
    </div>
  )
}
