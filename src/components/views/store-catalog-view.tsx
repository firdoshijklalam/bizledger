'use client'

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { addVisitedShop } from '@/components/views/visited-shops-deck'
import {
  ShoppingCart, MapPin, Search, Plus, Minus, Trash2, X, Package,
  Store, Smartphone, ChevronRight, CheckCircle2, AlertTriangle,
  ShoppingBag, Phone, Navigation, Home, Sparkles, ArrowLeft,
} from 'lucide-react'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { formatCurrency, formatDate } from '@/lib/utils'
import { toNumber } from '@/lib/numeric'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { StoreOrderConfirmation } from './store-order-confirmation'

interface StoreCatalogViewProps {
  slug: string
  invoiceToken?: string
}

interface StoreProduct {
  id: string
  name: string
  sku: string | null
  category: string | null
  unit: string | null
  salePrice: number
  mrp: number | null
  wholesalePrice: number | null
  gstRate: number | null
  stock: number
  retailEnabled: boolean
  retailUnit: string | null
  retailSalePrice: number | null
  subCategory: string | null
}

interface StoreData {
  id: string
  name: string
  ownerName: string | null
  phone: string | null
  address: string | null
  state: string | null
  logoUrl: string | null
  upiId: string | null
  currency: string
  deliveryRadiusKm: number | null
  latitude: number | null
  longitude: number | null
  products: StoreProduct[]
}

interface InvoiceData {
  invoice: {
    id: string
    invoiceNumber: string
    grandTotal: number
    amountPaid: number
    amountDue: number
    status: string
    createdAt: string
    items: Array<{ id: string; name: string; quantity: number; total: number }>
  }
  party: { name: string; phone: string | null } | null
  business: {
    name: string
    phone: string | null
    upiId: string | null
    logoUrl: string | null
    address: string | null
    currency: string
  }
}

interface CartItem {
  productId: string
  name: string
  unit: string | null
  unitPrice: number
  quantity: number
  total: number
}

const LOW_STOCK_THRESHOLD = 10

const AVATAR_GRADIENTS = [
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-blue-600',
  'from-lime-500 to-green-600',
]

function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

export function StoreCatalogView({ slug, invoiceToken }: StoreCatalogViewProps) {
  const { data: store, loading: storeLoading } = useFetch<StoreData>(`/api/store/${slug}`, [slug])
  const { data: invoiceData } = useFetch<InvoiceData>(
    invoiceToken ? `/api/payment?token=${invoiceToken}` : null,
    [invoiceToken]
  )

  const [cart, setCart] = useState<CartItem[]>([])
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [cartOpen, setCartOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [deliveryCharge, setDeliveryCharge] = useState('0')
  const [placing, setPlacing] = useState(false)
  const [placedOrderId, setPlacedOrderId] = useState<string | null>(null)

  const currency = store?.currency || 'INR'

  // PRD Part 33 §2.2: Track visited shop in localStorage for the "My Visited Shops" deck
  useEffect(() => {
    if (store?.name) {
      addVisitedShop({ slug, name: store.name, logoUrl: store.logoUrl })
    }
  }, [store?.name, slug])

  // Reset everything when "Place Another Order" is tapped on confirmation screen.
  const resetOrder = () => {
    setCart([])
    setCustomerName('')
    setCustomerPhone('')
    setCustomerAddress('')
    setDeliveryCharge('0')
    setPlacedOrderId(null)
    setCartOpen(false)
  }

  // ---------- Derived product list ----------
  const categories = useMemo(() => {
    if (!store?.products) return ['All']
    const cats = Array.from(
      new Set(store.products.map((p) => p.category).filter(Boolean))
    ) as string[]
    return ['All', ...cats.sort()]
  }, [store])

  const filteredProducts = useMemo(() => {
    if (!store?.products) return []
    let list = store.products
    if (activeCategory !== 'All') {
      list = list.filter((p) => p.category === activeCategory)
    }
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.subCategory?.toLowerCase().includes(q) ?? false) ||
          (p.sku?.toLowerCase().includes(q) ?? false)
      )
    }
    return list
  }, [store, activeCategory, search])

  // ---------- Cart operations ----------
  // PRD Part 35 §3.2-3.3: addToCart supports dynamic weight + price sync
  const addToCart = (p: StoreProduct, quantity: number = 1, unitPrice?: number, unitLabel?: string) => {
    const price = unitPrice ?? p.salePrice
    const qty = quantity || 1
    setCart((prev) => {
      const existing = prev.find((it) => it.productId === p.id)
      if (existing) {
        return prev.map((it) =>
          it.productId === p.id
            ? { ...it, quantity: it.quantity + qty, total: (it.quantity + qty) * it.unitPrice }
            : it
        )
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: unitLabel || p.unit,
          unitPrice: price,
          quantity: qty,
          total: price * qty,
        },
      ]
    })
    toast.success(`${p.name} added to cart${qty > 1 ? ` (${qty})` : ''}`)
  }

  const updateQty = (productId: string, delta: number) => {
    setCart((prev) =>
      prev
        .map((it) => {
          if (it.productId !== productId) return it
          const nextQty = it.quantity + delta
          return { ...it, quantity: nextQty, total: nextQty * it.unitPrice }
        })
        .filter((it) => it.quantity > 0)
    )
  }

  const removeFromCart = (productId: string) => {
    setCart((prev) => prev.filter((it) => it.productId !== productId))
  }

  const cartCount = cart.reduce((sum, it) => sum + it.quantity, 0)
  // §FRONTEND-NUMERIC-FIX: cart items are seeded from StoreProduct.salePrice
  // (API Decimal), which may arrive as a string; coerce via toNumber() to
  // prevent string concatenation in the subtotal reduce.
  const subtotal = cart.reduce((sum, it) => sum + toNumber(it.total), 0)
  const delivery = Number(deliveryCharge) || 0
  const grandTotal = subtotal + delivery

  // ---------- Place order ----------
  const handlePlaceOrder = async () => {
    if (!customerName.trim()) {
      toast.error('Please enter your name')
      return
    }
    if (cart.length === 0) {
      toast.error('Your cart is empty')
      return
    }
    setPlacing(true)
    try {
      const body = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        items: cart.map((it) => ({
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
        })),
        deliveryCharge: delivery,
        source: 'catalog',
      }
      const order = await apiPost(`/api/store/${slug}/order`, body)
      setPlacedOrderId(order.id)
      setCartOpen(false)
      toast.success('Order placed successfully!')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to place order. Please try again.')
    } finally {
      setPlacing(false)
    }
  }

  // ---------- Add to Home Screen hint ----------
  const showAddToHomeScreenHint = () => {
    const ua = navigator.userAgent
    const isIOS = /iPad|iPhone|iPod/.test(ua)
    const isAndroid = /Android/.test(ua)
    if (isIOS) {
      toast.info(
        'Add to Home Screen: tap the Share icon in Safari, then "Add to Home Screen".',
        { duration: 6000 }
      )
    } else if (isAndroid) {
      toast.info(
        'Add to Home Screen: tap the ⋮ menu in Chrome, then "Add to Home screen".',
        { duration: 6000 }
      )
    } else {
      toast.info('Add to Home Screen: drag the URL to your desktop/taskbar.', {
        duration: 6000,
      })
    }
  }

  // ---------- Pay Now (UPI deep link) ----------
  const handlePayNow = () => {
    if (!invoiceData || !invoiceData.business.upiId) return
    const amount = invoiceData.invoice.amountDue
    const pn = encodeURIComponent(invoiceData.business.name)
    const tn = encodeURIComponent(`Invoice ${invoiceData.invoice.invoiceNumber}`)
    window.location.href = `upi://pay?pa=${invoiceData.business.upiId}&pn=${pn}&am=${amount}&tn=${tn}`
  }

  // ---------- Confirmation screen ----------
  if (placedOrderId && store) {
    return (
      <StoreOrderConfirmation
        orderId={placedOrderId}
        storeName={store.name}
        onPlaceAnother={resetOrder}
      />
    )
  }

  // ---------- Loading ----------
  if (storeLoading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30">
        <div className="w-12 h-12 rounded-2xl bg-emerald-600 flex items-center justify-center mb-3 animate-pulse">
          <Store className="w-6 h-6 text-white" />
        </div>
        <div className="w-8 h-8 border-[3px] border-emerald-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-muted-foreground mt-3">Loading store…</p>
      </div>
    )
  }

  // ---------- Not found ----------
  if (!store) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-b from-background to-muted/30 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center mb-4">
          <AlertTriangle className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="text-lg font-bold">Store not found</h1>
        <p className="text-sm text-muted-foreground mt-1 max-w-xs">
          The store you're looking for doesn't exist or has been removed.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      {/* ============================ STICKY HEADER ============================ */}
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* §BACK-BUTTON: Allow user to return to previous page (More Shops, etc.) */}
          <button
            onClick={() => window.history.length > 1 ? window.history.back() : window.location.href = '/?more-shops=1'}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          {/* Logo / Avatar */}
          {store.logoUrl ? (
            <img
              src={store.logoUrl}
              alt={store.name}
              className="w-11 h-11 rounded-xl object-cover ring-1 ring-border"
            />
          ) : (
            <div
              className={`w-11 h-11 rounded-xl bg-gradient-to-br ${gradientFor(
                store.id
              )} flex items-center justify-center text-white font-bold text-lg shadow-sm`}
            >
              {store.name.charAt(0).toUpperCase()}
            </div>
          )}

          {/* Name + owner + address */}
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-foreground leading-tight truncate">{store.name}</h1>
            {store.ownerName && (
              <p className="text-xs text-muted-foreground truncate">
                by {store.ownerName}
              </p>
            )}
            {store.address && (
              <p className="text-[11px] text-muted-foreground/80 flex items-center gap-0.5 mt-0.5 truncate">
                <MapPin className="w-3 h-3 shrink-0" />
                <span className="truncate">{store.address}</span>
              </p>
            )}
          </div>

          {/* Cart button with badge */}
          <button
            onClick={() => setCartOpen(true)}
            className="relative w-11 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform"
            aria-label={`Cart with ${cartCount} items`}
          >
            <ShoppingCart className="w-5 h-5" />
            {cartCount > 0 && (
              <motion.span
                key={cartCount}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', stiffness: 500, damping: 15 }}
                className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-card"
              >
                {cartCount}
              </motion.span>
            )}
          </button>
        </div>

        {/* Delivery radius badge bar */}
        {store.deliveryRadiusKm && store.deliveryRadiusKm > 0 && (
          <div className="max-w-2xl mx-auto px-4 pb-2">
            <Badge
              variant="secondary"
              className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50 gap-1"
            >
              <Navigation className="w-3 h-3" />
              Delivers within {store.deliveryRadiusKm}km
            </Badge>
          </div>
        )}
      </header>

      {/* ============================ MAIN CONTENT ============================ */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-6">
        {/* ---------- Invoice section (optional) ---------- */}
        {invoiceToken && invoiceData && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <h2 className="font-bold text-foreground text-base leading-tight">
                    Invoice #{invoiceData.invoice.invoiceNumber}
                  </h2>
                  <p className="text-[11px] text-muted-foreground">
                    {formatDate(invoiceData.invoice.createdAt)}
                  </p>
                </div>
              </div>
              <Badge
                className={
                  invoiceData.invoice.status === 'paid'
                    ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50'
                    : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50'
                }
                variant="outline"
              >
                {invoiceData.invoice.status === 'paid' ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : (
                  <AlertTriangle className="w-3 h-3" />
                )}
                {invoiceData.invoice.status.toUpperCase()}
              </Badge>
            </div>

            {/* Item list */}
            <div className="space-y-1.5 mb-3">
              {invoiceData.invoice.items.map((it) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span className="flex-1 truncate text-muted-foreground">
                    {it.name} × {it.quantity}
                  </span>
                  <span className="tabular font-medium text-foreground">
                    {formatCurrency(it.total, invoiceData.business.currency)}
                  </span>
                </div>
              ))}
            </div>

            {/* Totals */}
            <div className="border-t border-border pt-3 space-y-1 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Grand Total</span>
                <span className="tabular">
                  {formatCurrency(
                    invoiceData.invoice.grandTotal,
                    invoiceData.business.currency
                  )}
                </span>
              </div>
              {invoiceData.invoice.amountPaid > 0 && (
                <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
                  <span>Already Paid</span>
                  <span className="tabular">
                    {formatCurrency(
                      invoiceData.invoice.amountPaid,
                      invoiceData.business.currency
                    )}
                  </span>
                </div>
              )}
              <div className="flex justify-between font-bold text-foreground text-base pt-1">
                <span>Amount Due</span>
                <span className="tabular">
                  {formatCurrency(
                    invoiceData.invoice.amountDue,
                    invoiceData.business.currency
                  )}
                </span>
              </div>
            </div>

            {/* Pay Now button */}
            {invoiceData.invoice.amountDue > 0 && invoiceData.business.upiId && (
              <Button
                onClick={handlePayNow}
                className="w-full mt-4 h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/20 hover:shadow-xl hover:shadow-emerald-600/30"
              >
                <Smartphone className="w-4 h-4" />
                Pay {formatCurrency(invoiceData.invoice.amountDue, invoiceData.business.currency)} via UPI
              </Button>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 my-1 mt-5">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground font-medium whitespace-nowrap">
                👇 More Products from Our Shop
              </span>
              <div className="flex-1 h-px bg-border" />
            </div>
          </motion.section>
        )}

        {/* ---------- Product catalog ---------- */}
        <section>
          <div className="flex items-baseline justify-between mb-3">
            <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
              <ShoppingBag className="w-4 h-4 text-emerald-600" />
              Our Products
            </h2>
            <span className="text-xs text-muted-foreground">
              {store.products.length} {store.products.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Search */}
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products…"
              className="pl-9 h-11 rounded-xl bg-card border-border"
            />
          </div>

          {/* Category chips */}
          {categories.length > 1 && (
            <div className="flex gap-2 overflow-x-auto pb-2 mb-3 -mx-4 px-4 no-scrollbar">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 ${
                    activeCategory === cat
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          )}

          {/* Product grid */}
          {filteredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-16 px-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-base font-semibold mb-1">No products available right now.</h3>
              <p className="text-sm text-muted-foreground max-w-xs">
                {search || activeCategory !== 'All'
                  ? 'Try a different search or category filter.'
                  : 'Please check back later.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {filteredProducts.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  onAdd={(qty, price, label) => addToCart(p, qty, price, label)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {/* ============================ FOOTER ============================ */}
      <footer className="mt-auto border-t border-border bg-card/60 backdrop-blur-xl">
        <div className="max-w-2xl mx-auto px-4 py-5 flex flex-col items-center gap-2 text-center">
          <div className="flex items-center gap-1.5 text-sm">
            <Store className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-foreground">{store.name}</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground text-xs">
              Powered by{' '}
              <span className="font-semibold text-emerald-600 dark:text-emerald-400">BizLedger</span>
            </span>
          </div>
          <button
            onClick={showAddToHomeScreenHint}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors px-3 py-1.5 rounded-full border border-border bg-background/50"
          >
            <Home className="w-3 h-3" />
            Add to Home Screen
            <ChevronRight className="w-3 h-3" />
          </button>
          {store.phone && (
            <a
              href={`tel:${store.phone}`}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-emerald-600 transition-colors mt-1"
            >
              <Phone className="w-3 h-3" />
              {store.phone}
            </a>
          )}
        </div>
      </footer>

      {/* ============================ CART DRAWER ============================ */}
      <AnimatePresence>
        {cartOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCartOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            {/* Bottom sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl bg-background rounded-t-3xl border-t border-border shadow-2xl max-h-[92vh] flex flex-col"
            >
              {/* Drag handle */}
              <div className="pt-3 pb-1 flex justify-center shrink-0">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              {/* Header */}
              <div className="flex items-center justify-between px-5 pb-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-foreground">Your Cart</h3>
                  {cartCount > 0 && (
                    <Badge variant="secondary" className="bg-muted">
                      {cartCount}
                    </Badge>
                  )}
                </div>
                <button
                  onClick={() => setCartOpen(false)}
                  className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
                  aria-label="Close cart"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Body — scrollable */}
              <div className="flex-1 overflow-y-auto px-5 py-3">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12">
                    <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                      <ShoppingCart className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-sm">Your cart is empty</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Browse products above and tap "Add" to start.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {cart.map((it) => (
                      <motion.div
                        key={it.productId}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className="flex items-center gap-3 p-2.5 rounded-xl bg-card border border-border"
                      >
                        <div
                          className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradientFor(
                            it.productId
                          )} flex items-center justify-center text-white font-bold shrink-0`}
                        >
                          {it.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{it.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(it.unitPrice, currency)}
                            {it.unit ? ` / ${it.unit}` : ''}
                          </p>
                        </div>
                        {/* Stepper */}
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => updateQty(it.productId, -1)}
                            className="w-7 h-7 rounded-lg bg-muted hover:bg-muted-foreground/20 flex items-center justify-center active:scale-90 transition-transform"
                            aria-label="Decrease quantity"
                          >
                            <Minus className="w-3.5 h-3.5" />
                          </button>
                          <span className="w-6 text-center text-sm font-semibold tabular">
                            {it.quantity}
                          </span>
                          <button
                            onClick={() => updateQty(it.productId, 1)}
                            className="w-7 h-7 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 flex items-center justify-center active:scale-90 transition-transform"
                            aria-label="Increase quantity"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => removeFromCart(it.productId)}
                            className="w-7 h-7 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 text-rose-500 flex items-center justify-center ml-1 active:scale-90 transition-transform"
                            aria-label="Remove item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </motion.div>
                    ))}

                    {/* Delivery charge */}
                    <div className="flex items-center gap-2 pt-2">
                      <label className="text-sm text-muted-foreground flex-1">
                        Delivery charge
                      </label>
                      <div className="relative">
                        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          {currency === 'INR' ? '₹' : currency}
                        </span>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          value={deliveryCharge}
                          onChange={(e) => setDeliveryCharge(e.target.value)}
                          className="pl-8 h-9 w-28 text-right tabular"
                        />
                      </div>
                    </div>

                    {/* Customer info form */}
                    <div className="pt-3 border-t border-border mt-3 space-y-2.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                        <Sparkles className="w-3 h-3 text-emerald-600" />
                        Delivery Details
                      </p>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Your name *"
                        className="h-10"
                      />
                      <Input
                        value={customerPhone}
                        onChange={(e) => setCustomerPhone(e.target.value)}
                        placeholder="Phone number"
                        inputMode="tel"
                        className="h-10"
                      />
                      <Textarea
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Delivery address"
                        rows={2}
                        className="resize-none"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Footer — totals + place order */}
              {cart.length > 0 && (
                <div className="shrink-0 border-t border-border px-5 py-3 bg-card/80 backdrop-blur-xl space-y-3">
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between text-muted-foreground">
                      <span>Subtotal</span>
                      <span className="tabular">{formatCurrency(subtotal, currency)}</span>
                    </div>
                    <div className="flex justify-between text-muted-foreground">
                      <span>Delivery</span>
                      <span className="tabular">{formatCurrency(delivery, currency)}</span>
                    </div>
                    <div className="flex justify-between font-bold text-base text-foreground pt-1">
                      <span>Total</span>
                      <span className="tabular text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(grandTotal, currency)}
                      </span>
                    </div>
                  </div>
                  <Button
                    onClick={handlePlaceOrder}
                    disabled={placing || !customerName.trim()}
                    className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/20 disabled:opacity-50"
                  >
                    {placing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        Placing Order…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-4 h-4" />
                        Place Order · {formatCurrency(grandTotal, currency)}
                      </>
                    )}
                  </Button>
                  {!customerName.trim() && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400 text-center">
                      Please enter your name to place the order
                    </p>
                  )}
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============================ Product Card ============================
function ProductCard({
  product,
  currency,
  onAdd,
}: {
  product: StoreProduct
  currency: string
  onAdd: (quantity: number, unitPrice: number, unitLabel: string) => void
}) {
  const [selectedWeight, setSelectedWeight] = useState(1)
  const [useRetail, setUseRetail] = useState(false)

  const discount =
    product.mrp && product.mrp > product.salePrice
      ? Math.round(((product.mrp - product.salePrice) / product.mrp) * 100)
      : 0
  const lowStock = product.stock > 0 && product.stock < LOW_STOCK_THRESHOLD
  const outOfStock = product.stock <= 0

  // PRD Part 35 §3.2: Dynamic weight options for loose/retail products
  const weightOptions = product.retailEnabled && product.retailUnit
    ? [1, 2, 5, 10]
    : []

  const currentPrice = useRetail && product.retailSalePrice
    ? product.retailSalePrice * selectedWeight
    : product.salePrice * selectedWeight

  const currentUnitLabel = useRetail && product.retailUnit
    ? `${selectedWeight} ${product.retailUnit}`
    : selectedWeight > 1
    ? `${selectedWeight} ${product.unit}s`
    : product.unit || ''

  const handleAdd = () => {
    onAdd(selectedWeight, useRetail && product.retailSalePrice ? product.retailSalePrice : product.salePrice, currentUnitLabel)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ scale: 1.02, boxShadow: '0 10px 30px -10px rgba(0,0,0,0.15)' }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl overflow-hidden flex flex-col"
    >
      {/* Image placeholder with first letter */}
      <div
        className={`relative aspect-square bg-gradient-to-br ${gradientFor(
          product.id
        )} flex items-center justify-center`}
      >
        <span className="text-4xl font-bold text-white/90 drop-shadow-sm">
          {product.name.charAt(0).toUpperCase()}
        </span>
        {/* Discount badge */}
        {discount > 0 && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-rose-500 text-white text-[10px] font-bold">
            {discount}% OFF
          </span>
        )}
        {/* Loose product badge */}
        {product.retailEnabled && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded-md bg-violet-500 text-white text-[10px] font-bold">
            Loose
          </span>
        )}
        {/* Stock badge */}
        <div className="absolute top-2 right-2">
          {outOfStock ? (
            <span className="px-1.5 py-0.5 rounded-md bg-zinc-900/70 text-white text-[10px] font-medium">
              Out of stock
            </span>
          ) : lowStock ? (
            <span className="px-1.5 py-0.5 rounded-md bg-amber-500/90 text-white text-[10px] font-medium">
              Low stock
            </span>
          ) : (
            <span className="px-1.5 py-0.5 rounded-md bg-emerald-500/90 text-white text-[10px] font-medium">
              In stock
            </span>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5 flex flex-col flex-1 gap-1.5">
        {/* Category */}
        {product.category && (
          <div className="flex items-center gap-1 flex-wrap">
            <Badge
              variant="secondary"
              className="bg-muted text-muted-foreground text-[9px] px-1.5 py-0 h-4"
            >
              {product.category}
            </Badge>
            {product.subCategory && (
              <span className="text-[9px] text-muted-foreground/70 truncate">
                · {product.subCategory}
              </span>
            )}
          </div>
        )}

        {/* Name */}
        <h3 className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.4em]">
          {product.name}
        </h3>

        {/* PRD Part 35 §1.2: AI-generated description */}
        {(product as any).description && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">
            {(product as any).description}
          </p>
        )}

        {/* Price */}
        <div className="mt-auto">
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold text-emerald-600 dark:text-emerald-400 tabular">
              {formatCurrency(product.salePrice, currency)}
            </span>
            {product.unit && (
              <span className="text-[10px] text-muted-foreground">/ {product.unit}</span>
            )}
          </div>
          {product.mrp && product.mrp > product.salePrice && (
            <span className="text-[11px] text-muted-foreground line-through tabular">
              {formatCurrency(product.mrp, currency)}
            </span>
          )}
          {/* Retail price alternative */}
          {product.retailEnabled && product.retailSalePrice && product.retailUnit && (
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Retail:{' '}
              <span className="font-medium text-foreground/80">
                {formatCurrency(product.retailSalePrice, currency)}/{product.retailUnit}
              </span>
            </p>
          )}
        </div>

        {/* PRD Part 35 §3.2: Dynamic weight selector for loose products */}
        {weightOptions.length > 0 && (
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setUseRetail(false)}
                className={`flex-1 text-[9px] py-1 rounded-md font-medium ${
                  !useRetail ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                Bulk ({product.unit})
              </button>
              <button
                onClick={() => setUseRetail(true)}
                className={`flex-1 text-[9px] py-1 rounded-md font-medium ${
                  useRetail ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                Loose ({product.retailUnit})
              </button>
            </div>
            {useRetail && (
              <select
                value={selectedWeight}
                onChange={(e) => setSelectedWeight(Number(e.target.value))}
                className="w-full h-7 rounded-md bg-muted px-1.5 text-[10px] border-0 outline-none"
              >
                {weightOptions.map((w) => (
                  <option key={w} value={w}>{w} {product.retailUnit}</option>
                ))}
              </select>
            )}
          </div>
        )}

        {/* Dynamic total price preview */}
        {selectedWeight > 1 && (
          <p className="text-[10px] text-muted-foreground">
            Total: <span className="font-bold text-foreground">{formatCurrency(currentPrice, currency)}</span>
          </p>
        )}

        {/* Add to Cart */}
        <Button
          onClick={handleAdd}
          disabled={outOfStock}
          size="sm"
          className="w-full mt-1 h-8 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" />
          Add {selectedWeight > 1 ? `(${selectedWeight})` : ''}
        </Button>
      </div>
    </motion.div>
  )
}
