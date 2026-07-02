'use client'

// ============================================================================
// PRD Part 36 §1 — Zepto-Style Central Catalog (Hyperlocal Marketplace)
// ----------------------------------------------------------------------------
// Public, customer-facing storefront that merges products from ALL shops
// within the customer's 5 km geo-fence into one unified Zepto-style shopping
// experience. Supports:
//   §1.1  Zepto-style speed UI (location detection, category chips, fast grid)
//   §1.2  Anonymous browse (shop names hidden unless favorite)
//   §1.3  3-tier priority search ranking (favorites+sponsored top tier → others by price asc)
//   §2.1  Global cart with auto order-splitting by shop
//   §2.2  Payment split info (2% commission, instant merchant settlement)
//   §3.1  Smart returns (instant refund + stock restore + trust score update)
//   §3.2  Trust score display + COD-lock warning
// ============================================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Search, ShoppingCart, MapPin, Star, Navigation, X, Plus, Minus, Check,
  Package, Truck, RotateCcw, ChevronRight, Sparkles, Loader2, AlertTriangle,
  Store, Phone, Home, CheckCircle2, ShieldCheck, Wallet, ArrowLeft, Heart,
  Trash2, Crown, BadgePercent, Lock, MapPinned, Compass, RefreshCw, Send,
} from 'lucide-react'
import { useFetch, apiPost, apiDelete } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CatalogProduct {
  id: string
  name: string
  category: string
  salePrice: number
  mrp: number | null
  unit: string
  stock: number
  retailEnabled: boolean
  retailUnit: string | null
  retailSalePrice: number | null
  description: string | null
  storeSlug: string
  businessId: string
  isFavorite: boolean
  isSponsored: boolean
  tier: 'top' | 'bottom'
  shopName: string | null
}

interface CatalogCategory {
  name: string
  products: CatalogProduct[]
  hasTopTier: boolean
}

interface CatalogResponse {
  categories: CatalogCategory[]
  totalProducts: number
  shopsInRange: number
}

interface CartItem {
  productId: string
  name: string
  unit: string | null
  unitPrice: number
  quantity: number
  total: number
  storeSlug: string
  businessId: string
  businessName: string // "Local Shop" when not favorite (privacy)
  isFavorite: boolean
  shopName: string | null
  isSponsored: boolean
}

interface FavoriteShop {
  id: string
  customerPhone: string
  businessId: string
  businessName: string
  storeSlug: string
  addedAt: string
}

interface OrderSplitResult {
  id: string
  parentOrderId: string
  businessId: string
  businessName: string
  items: Array<{ productId: string; name: string; quantity: number; unitPrice: number; total: number }>
  subtotal: number
  commissionPct: number
  commissionAmount: number
  merchantAmount: number
  status: string
  deliveryOtp: string | null
  createdAt: string
  paymentSplit?: {
    id: string
    settlementStatus: string
    merchantAmount: number
    commissionAmount: number
  } | null
}

interface TrustScore {
  trustScore: number
  totalOrders: number
  totalReturns: number
  consecutiveReturns: number
  codLocked: boolean
  lastReturnAt: string | null
}

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------
const AVATAR_GRADIENTS = [
  'from-emerald-500 to-teal-600',
  'from-rose-500 to-pink-600',
  'from-amber-500 to-orange-600',
  'from-violet-500 to-purple-600',
  'from-cyan-500 to-sky-600',
  'from-lime-500 to-green-600',
]

function gradientFor(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) | 0
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length]
}

const LOW_STOCK_THRESHOLD = 10

const RETURN_REASONS = [
  { value: 'damaged', label: 'Damaged / Broken', labelBn: 'ভাঙা পণ্য' },
  { value: 'wrong_product', label: 'Wrong Product', labelBn: 'ভুল পণ্য' },
  { value: 'quality_issue', label: 'Quality Issue', labelBn: 'মান সমস্যা' },
  { value: 'other', label: 'Other Reason', labelBn: 'অন্যান্য' },
]

// ============================================================================
// Sub-component: ProductCard
// ============================================================================
function ProductCard({
  product,
  cartQty,
  onAdd,
  onInc,
  onDec,
}: {
  product: CatalogProduct
  cartQty: number
  onAdd: () => void
  onInc: () => void
  onDec: () => void
}) {
  const isTopTier = product.tier === 'top'
  const discountPct =
    product.mrp && product.mrp > product.salePrice
      ? Math.round(((product.mrp - product.salePrice) / product.mrp) * 100)
      : 0
  const lowStock = product.stock <= LOW_STOCK_THRESHOLD

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl border overflow-hidden flex flex-col bg-card transition-shadow hover:shadow-md ${
        isTopTier
          ? 'border-amber-500/40 bg-amber-500/5'
          : 'border-border'
      }`}
    >
      {/* Tier badge */}
      {isTopTier && (
        <div className="absolute top-2 left-2 z-10 flex gap-1">
          {product.isFavorite && (
            <Badge className="bg-amber-500 text-white border-0 text-[10px] px-1.5 py-0 h-5 gap-0.5">
              <Star className="w-2.5 h-2.5 fill-white" />
              Favorite
            </Badge>
          )}
          {product.isSponsored && !product.isFavorite && (
            <Badge className="bg-amber-500 text-white border-0 text-[10px] px-1.5 py-0 h-5 gap-0.5">
              <Crown className="w-2.5 h-2.5" />
              Sponsored
            </Badge>
          )}
        </div>
      )}

      {/* Discount badge */}
      {discountPct > 0 && (
        <div className="absolute top-2 right-2 z-10">
          <Badge className="bg-emerald-600 text-white border-0 text-[10px] px-1.5 py-0 h-5">
            {discountPct}% OFF
          </Badge>
        </div>
      )}

      {/* Image placeholder (first letter gradient) */}
      <div
        className={`aspect-square bg-gradient-to-br ${gradientFor(
          product.id
        )} flex items-center justify-center text-white font-bold text-3xl`}
      >
        {product.name.charAt(0).toUpperCase()}
      </div>

      {/* Body */}
      <div className="p-2.5 flex flex-col gap-1 flex-1">
        <h3 className="text-sm font-semibold text-foreground leading-tight line-clamp-2 min-h-[2.4em]">
          {product.name}
        </h3>

        {/* Shop name (only if favorite) — §1.2 anonymous browse */}
        {product.shopName && (
          <p className="text-[10px] text-amber-600 dark:text-amber-400 flex items-center gap-0.5 truncate">
            <Store className="w-2.5 h-2.5 shrink-0" />
            <span className="truncate">{product.shopName}</span>
          </p>
        )}
        {!product.shopName && (
          <p className="text-[10px] text-muted-foreground/70 italic">Local Shop</p>
        )}

        {/* Description */}
        {product.description && (
          <p className="text-[10px] text-muted-foreground line-clamp-1">
            {product.description}
          </p>
        )}

        {/* Price */}
        <div className="flex items-baseline gap-1.5 mt-0.5">
          <span className="text-sm font-bold text-foreground tabular">
            {formatCurrency(product.salePrice)}
          </span>
          {product.mrp && product.mrp > product.salePrice && (
            <span className="text-[11px] text-muted-foreground line-through tabular">
              {formatCurrency(product.mrp)}
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground">
          per {product.unit || 'unit'}
          {lowStock && (
            <span className="ml-1 text-amber-600 dark:text-amber-400 font-medium">
              · Only {product.stock} left
            </span>
          )}
        </p>

        {/* Add / Stepper */}
        <div className="mt-1.5">
          {cartQty === 0 ? (
            <button
              onClick={onAdd}
              className={`w-full h-8 rounded-lg flex items-center justify-center gap-1 text-xs font-semibold transition-transform active:scale-95 ${
                isTopTier
                  ? 'bg-amber-500 hover:bg-amber-600 text-white'
                  : 'bg-emerald-600 hover:bg-emerald-700 text-white'
              }`}
              aria-label={`Add ${product.name} to cart`}
            >
              <Plus className="w-3.5 h-3.5" />
              ADD
            </button>
          ) : (
            <div className="flex items-center justify-between h-8 rounded-lg bg-muted px-1">
              <button
                onClick={onDec}
                className="w-7 h-7 rounded-md bg-background hover:bg-muted-foreground/10 flex items-center justify-center active:scale-90 transition-transform"
                aria-label="Decrease quantity"
              >
                <Minus className="w-3.5 h-3.5" />
              </button>
              <span className="text-sm font-bold tabular">{cartQty}</span>
              <button
                onClick={onInc}
                className={`w-7 h-7 rounded-md flex items-center justify-center active:scale-90 transition-transform text-white ${
                  isTopTier ? 'bg-amber-500 hover:bg-amber-600' : 'bg-emerald-600 hover:bg-emerald-700'
                }`}
                aria-label="Increase quantity"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
}

// ============================================================================
// Sub-component: FavoritesModal — §1.2 favorite shops management
// ============================================================================
function FavoritesModal({
  open,
  onClose,
  customerPhone,
  onRefreshCatalog,
}: {
  open: boolean
  onClose: () => void
  customerPhone: string
  onRefreshCatalog: () => void
}) {
  const { data, loading, refetch } = useFetch<{ favorites: FavoriteShop[] }>(
    open && customerPhone ? `/api/favorite-shops?customerPhone=${encodeURIComponent(customerPhone)}` : null,
    [open, customerPhone]
  )
  const [removing, setRemoving] = useState<string | null>(null)

  const favorites = data?.favorites ?? []

  const handleRemove = async (fav: FavoriteShop) => {
    setRemoving(fav.id)
    try {
      await apiDelete(
        `/api/favorite-shops?customerPhone=${encodeURIComponent(customerPhone)}&businessId=${encodeURIComponent(fav.businessId)}`
      )
      toast.success(`${fav.businessName} removed from favorites`)
      refetch()
      onRefreshCatalog()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove favorite')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl bg-background rounded-t-3xl border-t border-border shadow-2xl max-h-[85vh] flex flex-col"
          >
            <div className="pt-3 pb-1 flex justify-center shrink-0">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>
            <div className="flex items-center justify-between px-5 pb-3 border-b border-border shrink-0">
              <div className="flex items-center gap-2">
                <Heart className="w-5 h-5 text-rose-500 fill-rose-500" />
                <h3 className="font-bold text-foreground">My Favorite Shops</h3>
                <Badge variant="secondary" className="bg-muted">{favorites.length}</Badge>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center"
                aria-label="Close favorites"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                  <p className="text-xs text-muted-foreground">Loading favorites…</p>
                </div>
              ) : favorites.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-12">
                  <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                    <Heart className="w-7 h-7 text-muted-foreground" />
                  </div>
                  <p className="font-semibold text-sm">No favorite shops yet</p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                    Place your first order from a shop's merchant link to auto-add it to your favorites.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {favorites.map((fav) => (
                    <div
                      key={fav.id}
                      className="flex items-center gap-3 p-3 rounded-xl bg-card border border-border"
                    >
                      <div
                        className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradientFor(
                          fav.businessId
                        )} flex items-center justify-center text-white font-bold shrink-0`}
                      >
                        {fav.businessName.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold truncate">{fav.businessName}</p>
                        <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Store className="w-3 h-3" />
                          /store/{fav.storeSlug}
                        </p>
                      </div>
                      <button
                        onClick={() => handleRemove(fav)}
                        disabled={removing === fav.id}
                        className="w-9 h-9 rounded-lg bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 flex items-center justify-center disabled:opacity-50 active:scale-95 transition-transform"
                        aria-label={`Remove ${fav.businessName} from favorites`}
                      >
                        {removing === fav.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Trash2 className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Sub-component: ReturnDialog — §3.1 smart returns reason picker
// ============================================================================
function ReturnDialog({
  open,
  onClose,
  split,
  customerPhone,
  onReturned,
}: {
  open: boolean
  onClose: () => void
  split: OrderSplitResult | null
  customerPhone: string
  onReturned: (splitId: string, result: any) => void
}) {
  const [reason, setReason] = useState<string>('damaged')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (open) setReason('damaged')
  }, [open])

  const handleSubmit = async () => {
    if (!split) return
    setSubmitting(true)
    try {
      const result = await apiPost('/api/returns', {
        orderSplitId: split.id,
        customerPhone,
        reason,
      })
      toast.success(`Refund of ${formatCurrency(result.refundAmount)} processed instantly to your wallet`)
      toast.info(`Stock restored to shop inventory · New trust score: ${result.trustScore.toFixed(1)}★`)
      onReturned(split.id, result)
      onClose()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to process return')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {open && split && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[60] bg-black/60 backdrop-blur-sm"
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed inset-x-3 top-1/2 -translate-y-1/2 z-[60] mx-auto max-w-md bg-background rounded-3xl border border-border shadow-2xl p-5"
          >
            <div className="flex items-center gap-2 mb-1">
              <div className="w-10 h-10 rounded-xl bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center">
                <RotateCcw className="w-5 h-5 text-rose-600 dark:text-rose-400" />
              </div>
              <div>
                <h3 className="font-bold text-foreground">Return Order</h3>
                <p className="text-[11px] text-muted-foreground">
                  Refund will be processed instantly · Stock will be restored
                </p>
              </div>
            </div>

            <div className="mt-3 p-3 rounded-xl bg-muted/60 border border-border">
              <p className="text-xs text-muted-foreground">Shop</p>
              <p className="text-sm font-semibold">{split.businessName}</p>
              <p className="text-xs text-muted-foreground mt-1">Refund Amount</p>
              <p className="text-base font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(split.subtotal)}
              </p>
            </div>

            <p className="text-xs font-medium text-foreground mt-4 mb-2">Select reason for return</p>
            <div className="grid grid-cols-2 gap-2">
              {RETURN_REASONS.map((r) => (
                <button
                  key={r.value}
                  onClick={() => setReason(r.value)}
                  className={`p-2.5 rounded-xl border text-left transition-all ${
                    reason === r.value
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30'
                      : 'border-border bg-card hover:bg-muted'
                  }`}
                >
                  <p className="text-xs font-semibold text-foreground">{r.label}</p>
                  <p className="text-[10px] text-muted-foreground">{r.labelBn}</p>
                </button>
              ))}
            </div>

            <div className="flex gap-2 mt-5">
              <Button
                onClick={onClose}
                variant="outline"
                className="flex-1 h-11 rounded-xl"
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 h-11 rounded-xl bg-rose-600 hover:bg-rose-700 text-white"
              >
                {submitting ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-1" />
                ) : (
                  <RotateCcw className="w-4 h-4 mr-1" />
                )}
                Confirm Return
              </Button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}

// ============================================================================
// Main component: CentralCatalogView
// ============================================================================
export function CentralCatalogView() {
  // ---- Identity ----
  const [customerPhone, setCustomerPhone] = useState<string>('')
  const [identityReady, setIdentityReady] = useState(false)

  // ---- Location ----
  const [location, setLocation] = useState<{ lat: number; lng: number; label?: string } | null>(null)
  const [locating, setLocating] = useState(false)
  const [areaQuery, setAreaQuery] = useState('')
  const [geoError, setGeoError] = useState<string | null>(null)

  // ---- Catalog ----
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string | null>(null)

  // ---- Cart ----
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [customerName, setCustomerName] = useState('')
  const [customerAddress, setCustomerAddress] = useState('')
  const [placing, setPlacing] = useState(false)

  // ---- Order result ----
  const [orderResult, setOrderResult] = useState<{
    splits: OrderSplitResult[]
    parentOrders: any[]
  } | null>(null)
  const [verifyingSplitId, setVerifyingSplitId] = useState<string | null>(null)
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({})
  const [returnTarget, setReturnTarget] = useState<OrderSplitResult | null>(null)

  // ---- Favorites ----
  const [favOpen, setFavOpen] = useState(false)
  const [favVersion, setFavVersion] = useState(0) // bump to refetch catalog

  // ---- Refs for category scroll-jump ----
  const categoryRefs = useRef<Record<string, HTMLElement | null>>({})

  // -------------------------------------------------------------------------
  // Identity bootstrap — §1.2 customer phone from localStorage or session ID
  // -------------------------------------------------------------------------
  useEffect(() => {
    const stored = localStorage.getItem('bizledger-customer-phone')
    if (stored) {
      setCustomerPhone(stored)
    } else {
      const generated = 'session-' + Math.random().toString(36).substring(2, 10)
      localStorage.setItem('bizledger-customer-phone', generated)
      setCustomerPhone(generated)
    }
    setIdentityReady(true)
  }, [])

  // -------------------------------------------------------------------------
  // Catalog fetch — only when identity is ready
  // -------------------------------------------------------------------------
  const catalogUrl = useMemo(() => {
    if (!identityReady || !customerPhone) return null
    const params = new URLSearchParams({ customerPhone })
    if (location) {
      params.set('lat', String(location.lat))
      params.set('lng', String(location.lng))
    }
    return `/api/central-catalog?${params.toString()}`
  }, [identityReady, customerPhone, location?.lat, location?.lng, favVersion])

  const { data: catalogData, loading: catalogLoading, refetch: refetchCatalog } = useFetch<CatalogResponse>(
    catalogUrl,
    [catalogUrl]
  )

  // -------------------------------------------------------------------------
  // Trust score fetch — §3.2
  // -------------------------------------------------------------------------
  const { data: trustData, refetch: refetchTrust } = useFetch<TrustScore>(
    identityReady && customerPhone ? `/api/customer-trust-score?customerPhone=${encodeURIComponent(customerPhone)}` : null,
    [identityReady, customerPhone, favVersion]
  )

  // -------------------------------------------------------------------------
  // Location detection — §1.1 GPS + area-name fallback (Nominatim geocode)
  // -------------------------------------------------------------------------
  const detectLocation = () => {
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported on this device')
      return
    }
    setLocating(true)
    setGeoError(null)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Current Location',
        })
        setLocating(false)
      },
      (err) => {
        setLocating(false)
        const messages: Record<number, string> = {
          1: 'Location permission denied. Try area search instead.',
          2: 'Location unavailable. Try area search instead.',
          3: 'Location request timed out. Try again.',
        }
        setGeoError(messages[err.code] || 'Failed to detect location')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    )
  }

  const searchArea = async () => {
    const q = areaQuery.trim()
    if (!q) return
    setLocating(true)
    setGeoError(null)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`
      )
      const json = await res.json()
      if (Array.isArray(json) && json.length > 0) {
        setLocation({
          lat: parseFloat(json[0].lat),
          lng: parseFloat(json[0].lon),
          label: json[0].display_name?.split(',')[0] || q,
        })
      } else {
        setGeoError(`No match for "${q}". Try a different area name.`)
      }
    } catch {
      setGeoError('Area search failed. Please use GPS instead.')
    } finally {
      setLocating(false)
    }
  }

  const browseAnonymously = () => {
    setLocation(null)
    setGeoError(null)
  }

  // -------------------------------------------------------------------------
  // Derived: filtered + re-grouped catalog when searching
  // -------------------------------------------------------------------------
  const displayedCategories: CatalogCategory[] = useMemo(() => {
    if (!catalogData?.categories) return []
    const q = search.trim().toLowerCase()
    if (!q) return catalogData.categories

    // §1.3 search: filter by name/description, preserve tier ordering, re-group
    const filtered: CatalogProduct[] = []
    for (const cat of catalogData.categories) {
      for (const p of cat.products) {
        if (
          p.name.toLowerCase().includes(q) ||
          (p.description?.toLowerCase().includes(q) ?? false) ||
          p.category.toLowerCase().includes(q) ||
          (p.shopName?.toLowerCase().includes(q) ?? false)
        ) {
          filtered.push(p)
        }
      }
    }

    // Re-sort: top tier first (favorites → sponsored), then bottom by price asc.
    filtered.sort((a, b) => {
      const aTop = a.tier === 'top' ? 0 : 1
      const bTop = b.tier === 'top' ? 0 : 1
      if (aTop !== bTop) return aTop - bTop
      if (aTop === 0) {
        const aFav = a.isFavorite ? 0 : 1
        const bFav = b.isFavorite ? 0 : 1
        if (aFav !== bFav) return aFav - bFav
      }
      return a.salePrice - b.salePrice
    })

    // Group back by category (preserve tier ordering within each group).
    const map = new Map<string, CatalogProduct[]>()
    for (const p of filtered) {
      const arr = map.get(p.category) || []
      arr.push(p)
      map.set(p.category, arr)
    }

    // Categories with top-tier come first; alphabetical within group.
    return Array.from(map.entries())
      .map(([name, products]) => ({
        name,
        products,
        hasTopTier: products.some((p) => p.tier === 'top'),
      }))
      .sort((a, b) => {
        if (a.hasTopTier !== b.hasTopTier) return a.hasTopTier ? -1 : 1
        return a.name.localeCompare(b.name)
      })
  }, [catalogData, search])

  const totalDisplayed = useMemo(
    () => displayedCategories.reduce((n, c) => n + c.products.length, 0),
    [displayedCategories]
  )

  // -------------------------------------------------------------------------
  // Cart operations
  // -------------------------------------------------------------------------
  const addToCart = (p: CatalogProduct) => {
    setCart((prev) => {
      const existing = prev.find((it) => it.productId === p.id)
      if (existing) {
        return prev.map((it) =>
          it.productId === p.id
            ? { ...it, quantity: it.quantity + 1, total: (it.quantity + 1) * it.unitPrice }
            : it
        )
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          unit: p.unit,
          unitPrice: p.salePrice,
          quantity: 1,
          total: p.salePrice,
          storeSlug: p.storeSlug,
          businessId: p.businessId,
          // §1.2 privacy: use shopName only if favorite, else "Local Shop".
          businessName: p.shopName || 'Local Shop',
          isFavorite: p.isFavorite,
          shopName: p.shopName,
          isSponsored: p.isSponsored,
        },
      ]
    })
    toast.success(`${p.name} added to cart`)
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

  const cartCount = cart.reduce((sum, it) => sum + it.quantity, 0)
  const subtotal = cart.reduce((sum, it) => sum + it.total, 0)
  const delivery = 0 // free hyperlocal delivery for demo
  const grandTotal = subtotal + delivery

  // Cart grouped by shop (preserve tier ordering: favorites/sponsored first)
  const cartByShop = useMemo(() => {
    const groups: { businessId: string; businessName: string; isFavorite: boolean; isSponsored: boolean; shopName: string | null; items: CartItem[]; subtotal: number }[] = []
    for (const it of cart) {
      let g = groups.find((x) => x.businessId === it.businessId)
      if (!g) {
        g = {
          businessId: it.businessId,
          businessName: it.businessName,
          isFavorite: it.isFavorite,
          isSponsored: it.isSponsored,
          shopName: it.shopName,
          items: [],
          subtotal: 0,
        }
        groups.push(g)
      }
      g.items.push(it)
      g.subtotal += it.total
    }
    groups.sort((a, b) => {
      const aTop = a.isFavorite || a.isSponsored ? 0 : 1
      const bTop = b.isFavorite || b.isSponsored ? 0 : 1
      if (aTop !== bTop) return aTop - bTop
      return a.businessName.localeCompare(b.businessName)
    })
    return groups
  }, [cart])

  // -------------------------------------------------------------------------
  // Place order — §2.1 POST /api/orders/split
  // -------------------------------------------------------------------------
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
        customerPhone,
        items: cart.map((it) => ({
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          total: it.total,
          storeSlug: it.storeSlug,
          businessId: it.businessId,
          businessName: it.businessName,
        })),
        deliveryCharge: delivery,
        source: 'central_catalog',
      }
      const result = await apiPost('/api/orders/split', body)
      setOrderResult({ splits: result.splits, parentOrders: result.parentOrders })
      setCartOpen(false)
      setCart([])
      toast.success(`Order placed! Split into ${result.splits.length} shop order${result.splits.length > 1 ? 's' : ''}.`)
      // Refresh trust score after a short delay (the API may update on success)
      setTimeout(() => refetchTrust(), 500)
    } catch (e: any) {
      toast.error(e?.message || 'Failed to place order')
    } finally {
      setPlacing(false)
    }
  }

  // -------------------------------------------------------------------------
  // OTP verify — POST /api/orders/[id]/otp
  // -------------------------------------------------------------------------
  const handleVerifyOtp = async (splitId: string) => {
    const otp = (otpInputs[splitId] || '').trim()
    if (otp.length !== 4) {
      toast.error('Enter the 4-digit OTP')
      return
    }
    setVerifyingSplitId(splitId)
    try {
      const result = await apiPost(`/api/orders/${splitId}/otp`, { otp })
      if (result.ok && result.delivered) {
        toast.success('Delivery verified! Payment settled to merchant wallet.')
        // Update local split status
        setOrderResult((prev) => {
          if (!prev) return prev
          return {
            ...prev,
            splits: prev.splits.map((s) =>
              s.id === splitId
                ? {
                    ...s,
                    status: 'delivered',
                    paymentSplit: result.paymentSplit
                      ? {
                          ...s.paymentSplit,
                          settlementStatus: result.paymentSplit.settlementStatus,
                          settledAt: result.paymentSplit.settledAt,
                        } as any
                      : s.paymentSplit,
                  }
                : s
            ),
          }
        })
        setOtpInputs((prev) => ({ ...prev, [splitId]: '' }))
        setTimeout(() => refetchTrust(), 500)
      } else {
        toast.error(result.message || 'Invalid OTP')
      }
    } catch (e: any) {
      toast.error(e?.message || 'OTP verification failed')
    } finally {
      setVerifyingSplitId(null)
    }
  }

  // -------------------------------------------------------------------------
  // Return — handled by ReturnDialog (POST /api/returns)
  // -------------------------------------------------------------------------
  const handleReturned = (splitId: string, result: any) => {
    setOrderResult((prev) => {
      if (!prev) return prev
      return {
        ...prev,
        splits: prev.splits.map((s) =>
          s.id === splitId
            ? {
                ...s,
                status: 'returned',
                paymentSplit: s.paymentSplit
                  ? { ...s.paymentSplit, settlementStatus: 'reversed' } as any
                  : s.paymentSplit,
              }
            : s
        ),
      }
    })
    refetchTrust()
    refetchCatalog()
  }

  // -------------------------------------------------------------------------
  // Reset order — place another
  // -------------------------------------------------------------------------
  const resetOrder = () => {
    setOrderResult(null)
    setOtpInputs({})
    setCustomerName('')
    setCustomerAddress('')
  }

  // -------------------------------------------------------------------------
  // Category scroll-jump
  // -------------------------------------------------------------------------
  const jumpToCategory = (name: string) => {
    setActiveCategory(name)
    const el = categoryRefs.current[name]
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  // -------------------------------------------------------------------------
  // Render: ORDER CONFIRMATION SCREEN
  // -------------------------------------------------------------------------
  if (orderResult) {
    const totalSubtotal = orderResult.splits.reduce((s, x) => s + x.subtotal, 0)
    const totalCommission = orderResult.splits.reduce((s, x) => s + x.commissionAmount, 0)
    const totalMerchant = orderResult.splits.reduce((s, x) => s + x.merchantAmount, 0)

    return (
      <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
        {/* Header */}
        <header className="sticky top-0 z-20 bg-card/80 backdrop-blur-xl border-b border-border">
          <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
            <button
              onClick={resetOrder}
              className="w-9 h-9 rounded-lg hover:bg-muted flex items-center justify-center"
              aria-label="Back to catalog"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className="flex-1">
              <h1 className="font-bold text-foreground">Order Confirmation</h1>
              <p className="text-xs text-muted-foreground">
                {orderResult.splits.length} shop order{orderResult.splits.length > 1 ? 's' : ''} ·{' '}
                {orderResult.splits.reduce((n, s) => n + s.items.length, 0)} items
              </p>
            </div>
            <Badge className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50">
              <CheckCircle2 className="w-3 h-3" />
              Placed
            </Badge>
          </div>
        </header>

        <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-5 space-y-5">
          {/* Success banner with spring animation */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 18 }}
            className="flex flex-col items-center text-center py-4"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1, rotate: [0, 10, -10, 0] }}
              transition={{ delay: 0.1, type: 'spring', stiffness: 400, damping: 12 }}
              className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mb-3"
            >
              <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
            </motion.div>
            <h2 className="text-xl font-bold text-foreground">Order Placed Successfully! 🎉</h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-xs">
              Your cart was auto-split into {orderResult.splits.length} shop order{orderResult.splits.length > 1 ? 's' : ''}.
              Track each shop's delivery below.
            </p>
          </motion.div>

          {/* §2.2 Payment Split card */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-5 shadow-sm"
          >
            <div className="flex items-center gap-2 mb-3">
              <div className="w-9 h-9 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center">
                <Wallet className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div>
                <h3 className="font-bold text-foreground text-sm">Payment Split</h3>
                <p className="text-[11px] text-muted-foreground">2% commission per shop · instant settlement</p>
              </div>
            </div>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between text-muted-foreground">
                <span>Total Order Value</span>
                <span className="tabular">{formatCurrency(totalSubtotal)}</span>
              </div>
              <div className="flex justify-between text-muted-foreground">
                <span>Total Commission (2%)</span>
                <span className="tabular">{formatCurrency(totalCommission)}</span>
              </div>
              <div className="flex justify-between font-bold text-foreground pt-1 border-t border-border">
                <span>Merchant Settlement</span>
                <span className="tabular text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(totalMerchant)}
                </span>
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-[11px] text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-2.5">
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>Payment settled instantly to merchant wallets · No COD delays</span>
            </div>
          </motion.section>

          {/* Per-split tracking + OTP + returns */}
          <section className="space-y-3">
            <h3 className="font-bold text-foreground flex items-center gap-2">
              <Truck className="w-4 h-4 text-emerald-600" />
              Track Your Orders
            </h3>

            {orderResult.splits.map((split, idx) => {
              const statusMeta = SPLIT_STATUS_META[split.status] || SPLIT_STATUS_META.pending
              const isDelivered = split.status === 'delivered'
              const isReturned = split.status === 'returned'
              const otpValue = otpInputs[split.id] || ''
              return (
                <motion.div
                  key={split.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 }}
                  className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-4 shadow-sm"
                >
                  {/* Shop header */}
                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={`w-10 h-10 rounded-lg bg-gradient-to-br ${gradientFor(
                        split.businessId
                      )} flex items-center justify-center text-white font-bold shrink-0`}
                    >
                      {split.businessName.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">
                        {split.businessName}
                        {/* Show favorite star if shop name was visible */}
                        {cart.find((it) => it.businessId === split.businessId)?.isFavorite && (
                          <Star className="inline w-3 h-3 ml-1 text-amber-500 fill-amber-500" />
                        )}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {split.items.length} item{split.items.length > 1 ? 's' : ''} · {formatCurrency(split.subtotal)}
                      </p>
                    </div>
                    <Badge className={statusMeta.badgeClass}>
                      <statusMeta.icon className="w-3 h-3" />
                      {statusMeta.label}
                    </Badge>
                  </div>

                  {/* Items list */}
                  <div className="space-y-1 mb-3 bg-muted/40 rounded-lg p-2.5">
                    {split.items.map((it) => (
                      <div key={it.productId} className="flex justify-between text-xs">
                        <span className="flex-1 truncate text-muted-foreground">
                          {it.name} × {it.quantity}
                        </span>
                        <span className="tabular font-medium text-foreground">
                          {formatCurrency(it.total)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Payment breakdown for this shop */}
                  <div className="grid grid-cols-3 gap-2 mb-3 text-center">
                    <div className="bg-muted/40 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground">Subtotal</p>
                      <p className="text-xs font-bold tabular">{formatCurrency(split.subtotal)}</p>
                    </div>
                    <div className="bg-muted/40 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground">Commission</p>
                      <p className="text-xs font-bold tabular text-amber-600 dark:text-amber-400">
                        {formatCurrency(split.commissionAmount)}
                      </p>
                    </div>
                    <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-lg p-2">
                      <p className="text-[10px] text-muted-foreground">Merchant</p>
                      <p className="text-xs font-bold tabular text-emerald-600 dark:text-emerald-400">
                        {formatCurrency(split.merchantAmount)}
                      </p>
                    </div>
                  </div>

                  {/* Delivery OTP — show OTP for demo (in prod: SMS) */}
                  {!isReturned && (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg p-3 mb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-[10px] text-amber-700 dark:text-amber-300 font-medium">
                            Delivery OTP (Demo)
                          </p>
                          <p className="text-2xl font-bold tracking-[0.3em] text-amber-700 dark:text-amber-300 tabular">
                            {split.deliveryOtp || '----'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-muted-foreground">Share with delivery agent</p>
                          <p className="text-[10px] text-muted-foreground">to confirm delivery</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* OTP verify input (only if pending) */}
                  {!isDelivered && !isReturned && (
                    <div className="flex gap-2">
                      <Input
                        value={otpValue}
                        onChange={(e) =>
                          setOtpInputs((prev) => ({
                            ...prev,
                            [split.id]: e.target.value.replace(/\D/g, '').slice(0, 4),
                          }))
                        }
                        placeholder="Enter OTP from delivery agent"
                        inputMode="numeric"
                        maxLength={4}
                        className="h-10 rounded-xl bg-card tabular tracking-widest"
                      />
                      <Button
                        onClick={() => handleVerifyOtp(split.id)}
                        disabled={verifyingSplitId === split.id || otpValue.length !== 4}
                        className="h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white px-4"
                      >
                        {verifyingSplitId === split.id ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4" />
                        )}
                        Verify
                      </Button>
                    </div>
                  )}

                  {/* Return button — only when delivered (§3.1) */}
                  {isDelivered && (
                    <Button
                      onClick={() => setReturnTarget(split)}
                      variant="outline"
                      className="w-full h-10 rounded-xl border-rose-300 dark:border-rose-800 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Return Order (Instant Refund)
                    </Button>
                  )}

                  {/* Returned status */}
                  {isReturned && (
                    <div className="flex items-center gap-2 text-xs text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 rounded-lg p-2.5">
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>Refund processed · Stock restored to shop inventory</span>
                    </div>
                  )}
                </motion.div>
              )
            })}
          </section>

          {/* Place another order */}
          <div className="pb-8">
            <Button
              onClick={resetOrder}
              className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/20"
            >
              <Plus className="w-4 h-4" />
              Place Another Order
            </Button>
          </div>
        </main>

        {/* Return dialog */}
        <ReturnDialog
          open={!!returnTarget}
          onClose={() => setReturnTarget(null)}
          split={returnTarget}
          customerPhone={customerPhone}
          onReturned={handleReturned}
        />
      </div>
    )
  }

  // -------------------------------------------------------------------------
  // Render: MAIN CATALOG SCREEN
  // -------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col">
      {/* ============================ STICKY HEADER ============================ */}
      <header className="sticky top-0 z-30 bg-card/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-2.5">
          {/* Brand */}
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center text-white shadow-sm shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold text-foreground leading-tight">Shop Local</h1>
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <MapPin className="w-2.5 h-2.5" />
              {location ? location.label || 'Your Area' : 'Set location to start'}
              {catalogData && (
                <span className="ml-1 text-emerald-600 dark:text-emerald-400">
                  · {catalogData.shopsInRange} shops
                </span>
              )}
            </p>
          </div>

          {/* Trust score badge (§3.2) */}
          {trustData && (
            <div
              className={`flex items-center gap-0.5 px-2 h-8 rounded-full text-xs font-semibold ${
                trustData.codLocked
                  ? 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300'
                  : 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'
              }`}
              title={`Trust score: ${trustData.trustScore.toFixed(1)}★ · ${trustData.totalOrders} orders · ${trustData.totalReturns} returns`}
            >
              <Star className={`w-3 h-3 ${trustData.codLocked ? '' : 'fill-amber-500 text-amber-500'}`} />
              {trustData.trustScore.toFixed(1)}
            </div>
          )}

          {/* Favorites button */}
          <button
            onClick={() => setFavOpen(true)}
            className="relative w-10 h-10 rounded-xl bg-card border border-border hover:bg-muted flex items-center justify-center active:scale-95 transition-transform"
            aria-label="My favorite shops"
          >
            <Heart className="w-5 h-5 text-rose-500" />
          </button>

          {/* Cart button */}
          <button
            onClick={() => setCartOpen(true)}
            className="relative w-10 h-10 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform"
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

        {/* COD lock warning (§3.2) */}
        {trustData?.codLocked && (
          <div className="max-w-2xl mx-auto px-4 pb-2">
            <div className="flex items-center gap-2 text-[11px] text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/40 rounded-lg px-2.5 py-1.5">
              <Lock className="w-3 h-3 shrink-0" />
              <span>COD locked due to returns. Prepaid only.</span>
            </div>
          </div>
        )}
      </header>

      {/* ============================ MAIN CONTENT ============================ */}
      <main className="flex-1 max-w-2xl mx-auto w-full px-4 py-4 space-y-4">
        {/* ---------- Location selector ---------- */}
        {!location && (
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-card/80 backdrop-blur-xl border border-border rounded-2xl p-5 shadow-sm text-center"
          >
            <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mx-auto mb-3">
              <MapPinned className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h2 className="text-base font-bold text-foreground">Shop from local stores near you</h2>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              We'll show products from every shop within your 5km area — স্থানীয় দোকান থেকে দ্রুত ডেলিভারি।
            </p>

            <Button
              onClick={detectLocation}
              disabled={locating}
              className="w-full mt-4 h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
            >
              {locating ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Navigation className="w-4 h-4" />
              )}
              Use My Location
            </Button>

            <div className="flex items-center gap-3 my-3">
              <div className="flex-1 h-px bg-border" />
              <span className="text-[11px] text-muted-foreground">or search by area</span>
              <div className="flex-1 h-px bg-border" />
            </div>

            <div className="flex gap-2">
              <Input
                value={areaQuery}
                onChange={(e) => setAreaQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && searchArea()}
                placeholder="e.g. Park Street, Kolkata"
                className="h-11 rounded-xl bg-background"
              />
              <Button
                onClick={searchArea}
                disabled={locating || !areaQuery.trim()}
                variant="outline"
                className="h-11 rounded-xl px-4"
              >
                <Search className="w-4 h-4" />
              </Button>
            </div>

            <button
              onClick={browseAnonymously}
              className="mt-3 text-[11px] text-muted-foreground hover:text-foreground underline"
            >
              Browse all shops anonymously
            </button>

            {geoError && (
              <div className="mt-3 flex items-start gap-2 text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/40 rounded-lg px-3 py-2 text-left">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>{geoError}</span>
              </div>
            )}
          </motion.section>
        )}

        {/* ---------- Location set — change it ---------- */}
        {location && (
          <div className="flex items-center justify-between gap-2 bg-card/80 backdrop-blur-xl border border-border rounded-xl px-3 py-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center shrink-0">
                <MapPin className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{location.label || 'Your Area'}</p>
                <p className="text-[10px] text-muted-foreground tabular">
                  {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
                </p>
              </div>
            </div>
            <button
              onClick={() => setLocation(null)}
              className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium hover:underline shrink-0"
            >
              Change
            </button>
          </div>
        )}

        {/* ---------- Search bar ---------- */}
        {location !== null || catalogData ? (
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products, shops, categories…"
              className="pl-9 h-11 rounded-xl bg-card border-border"
            />
            {search && (
              <button
                onClick={() => setSearch('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center"
                aria-label="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : null}

        {/* ---------- Loading ---------- */}
        {catalogLoading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="w-8 h-8 text-emerald-600 animate-spin" />
            <p className="text-sm text-muted-foreground">Loading products from nearby shops…</p>
          </div>
        )}

        {/* ---------- Empty ---------- */}
        {!catalogLoading && catalogData && displayedCategories.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-16 px-4">
            <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-base font-semibold mb-1">No products found</h3>
            <p className="text-sm text-muted-foreground max-w-xs">
              {search
                ? 'Try a different search term.'
                : catalogData.shopsInRange === 0
                ? 'No shops deliver to your location. Try changing your area.'
                : 'Please check back later.'}
            </p>
            {search && (
              <Button
                onClick={() => setSearch('')}
                variant="outline"
                className="mt-4 h-9 rounded-xl"
              >
                Clear search
              </Button>
            )}
          </div>
        )}

        {/* ---------- Category chips ---------- */}
        {!catalogLoading && displayedCategories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-4 px-4 no-scrollbar">
            <button
              onClick={() => {
                setActiveCategory(null)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 ${
                activeCategory === null
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-card border border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              All
            </button>
            {displayedCategories.map((cat) => (
              <button
                key={cat.name}
                onClick={() => jumpToCategory(cat.name)}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all active:scale-95 flex items-center gap-1 ${
                  activeCategory === cat.name
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-card border border-border text-muted-foreground hover:bg-muted'
                }`}
              >
                {cat.hasTopTier && <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />}
                {cat.name}
              </button>
            ))}
          </div>
        )}

        {/* ---------- §1.3 Search tier separator (only when searching) ---------- */}
        {search && displayedCategories.length > 0 && (
          <SearchTierSummary categories={displayedCategories} />
        )}

        {/* ---------- Products grouped by category ---------- */}
        {!catalogLoading && displayedCategories.length > 0 && (
          <div className="space-y-6">
            {displayedCategories.map((cat) => (
              <section
                key={cat.name}
                ref={(el) => {
                  categoryRefs.current[cat.name] = el
                }}
                className="scroll-mt-32"
              >
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-base font-bold text-foreground flex items-center gap-1.5">
                    {cat.hasTopTier && <Star className="w-4 h-4 fill-amber-500 text-amber-500" />}
                    {cat.name}
                  </h2>
                  <span className="text-[11px] text-muted-foreground">
                    {cat.products.length} item{cat.products.length > 1 ? 's' : ''}
                  </span>
                </div>

                {/* Render top-tier and bottom-tier with visual separator */}
                <ProductTierGroup
                  products={cat.products}
                  cart={cart}
                  onAdd={addToCart}
                  onInc={(pid) => updateQty(pid, 1)}
                  onDec={(pid) => updateQty(pid, -1)}
                />
              </section>
            ))}
          </div>
        )}

        {/* ---------- Footer ---------- */}
        <footer className="mt-8 pt-6 border-t border-border text-center">
          <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
            <span className="font-semibold text-foreground">Shop Local</span>
            <span>·</span>
            <span>Powered by <span className="font-semibold text-emerald-600 dark:text-emerald-400">BizLedger</span></span>
          </div>
          <p className="text-[10px] text-muted-foreground/60 mt-1">
            Hyperlocal marketplace · 5km geo-fence · instant merchant settlement
          </p>
        </footer>
      </main>

      {/* ============================ CART DRAWER ============================ */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCartOpen(false)}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto max-w-2xl bg-background rounded-t-3xl border-t border-border shadow-2xl max-h-[92vh] flex flex-col"
            >
              <div className="pt-3 pb-1 flex justify-center shrink-0">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>

              <div className="flex items-center justify-between px-5 pb-3 border-b border-border shrink-0">
                <div className="flex items-center gap-2">
                  <ShoppingCart className="w-5 h-5 text-emerald-600" />
                  <h3 className="font-bold text-foreground">Your Cart</h3>
                  {cartCount > 0 && (
                    <Badge variant="secondary" className="bg-muted">
                      {cartCount} item{cartCount > 1 ? 's' : ''}
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

              <div className="flex-1 overflow-y-auto px-5 py-3">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center justify-center text-center py-12">
                    <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mb-3">
                      <ShoppingCart className="w-7 h-7 text-muted-foreground" />
                    </div>
                    <p className="font-semibold text-sm">Your cart is empty</p>
                    <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                      Add products from any local shop. We'll auto-split your order at checkout.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Cart grouped by shop */}
                    {cartByShop.map((group) => (
                      <div
                        key={group.businessId}
                        className={`rounded-xl border p-3 ${
                          group.isFavorite || group.isSponsored
                            ? 'border-amber-500/40 bg-amber-500/5'
                            : 'border-border bg-card'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <div
                            className={`w-7 h-7 rounded-lg bg-gradient-to-br ${gradientFor(
                              group.businessId
                            )} flex items-center justify-center text-white text-xs font-bold shrink-0`}
                          >
                            {group.businessName.charAt(0).toUpperCase()}
                          </div>
                          <p className="text-sm font-semibold flex-1 truncate">
                            {group.shopName || 'Local Shop'}
                          </p>
                          {group.isFavorite && (
                            <Badge className="bg-amber-500 text-white border-0 text-[10px] gap-0.5 h-5">
                              <Star className="w-2.5 h-2.5 fill-white" />
                              Favorite
                            </Badge>
                          )}
                          {group.isSponsored && !group.isFavorite && (
                            <Badge className="bg-amber-500 text-white border-0 text-[10px] gap-0.5 h-5">
                              <Crown className="w-2.5 h-2.5" />
                              Sponsored
                            </Badge>
                          )}
                        </div>

                        <div className="space-y-2">
                          {group.items.map((it) => (
                            <div key={it.productId} className="flex items-center gap-2.5">
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium truncate">{it.name}</p>
                                <p className="text-[11px] text-muted-foreground">
                                  {formatCurrency(it.unitPrice)}
                                  {it.unit ? ` / ${it.unit}` : ''}
                                </p>
                              </div>
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
                                  className={`w-7 h-7 rounded-lg text-white flex items-center justify-center active:scale-90 transition-transform ${
                                    group.isFavorite || group.isSponsored
                                      ? 'bg-amber-500 hover:bg-amber-600'
                                      : 'bg-emerald-600 hover:bg-emerald-700'
                                  }`}
                                  aria-label="Increase quantity"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                              </div>
                              <span className="w-16 text-right text-sm font-semibold tabular">
                                {formatCurrency(it.total)}
                              </span>
                            </div>
                          ))}
                        </div>

                        <div className="mt-2 pt-2 border-t border-border/60 flex justify-between text-xs">
                          <span className="text-muted-foreground">Shop subtotal</span>
                          <span className="font-semibold tabular">{formatCurrency(group.subtotal)}</span>
                        </div>
                      </div>
                    ))}

                    {/* Customer info form */}
                    <div className="space-y-2 pt-2">
                      <p className="text-xs font-semibold text-foreground">Delivery Details</p>
                      <Input
                        value={customerName}
                        onChange={(e) => setCustomerName(e.target.value)}
                        placeholder="Your name *"
                        className="h-10 rounded-xl bg-card"
                      />
                      <Input
                        value={customerAddress}
                        onChange={(e) => setCustomerAddress(e.target.value)}
                        placeholder="Delivery address (optional)"
                        className="h-10 rounded-xl bg-card"
                      />
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground bg-muted/40 rounded-lg px-3 py-2">
                        <Phone className="w-3 h-3 shrink-0" />
                        <span>Phone: {customerPhone}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer: totals + place order */}
              {cart.length > 0 && (
                <div className="border-t border-border px-5 py-3 shrink-0 bg-card/60 backdrop-blur-xl">
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">
                      Subtotal · {cartByShop.length} shop{cartByShop.length > 1 ? 's' : ''}
                    </span>
                    <span className="font-semibold tabular">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Delivery</span>
                    <span className="font-semibold text-emerald-600 dark:text-emerald-400">FREE</span>
                  </div>
                  <div className="flex justify-between font-bold text-base mb-3">
                    <span>Total</span>
                    <span className="tabular">{formatCurrency(grandTotal)}</span>
                  </div>
                  <Button
                    onClick={handlePlaceOrder}
                    disabled={placing || !customerName.trim()}
                    className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/20"
                  >
                    {placing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Place Order · Auto-split into {cartByShop.length} shop order{cartByShop.length > 1 ? 's' : ''}
                  </Button>
                  <p className="text-[10px] text-muted-foreground text-center mt-2">
                    Order will be auto-split by shop · Each shop gets its own OTP & delivery
                  </p>
                </div>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ============================ FAVORITES MODAL ============================ */}
      <FavoritesModal
        open={favOpen}
        onClose={() => setFavOpen(false)}
        customerPhone={customerPhone}
        onRefreshCatalog={() => {
          refetchCatalog()
          setFavVersion((v) => v + 1)
        }}
      />

      {/* ============================ RETURN DIALOG ============================ */}
      <ReturnDialog
        open={!!returnTarget}
        onClose={() => setReturnTarget(null)}
        split={returnTarget}
        customerPhone={customerPhone}
        onReturned={handleReturned}
      />
    </div>
  )
}

// ============================================================================
// Sub-component: ProductTierGroup — renders top-tier + bottom-tier with sep
// ============================================================================
function ProductTierGroup({
  products,
  cart,
  onAdd,
  onInc,
  onDec,
}: {
  products: CatalogProduct[]
  cart: CartItem[]
  onAdd: (p: CatalogProduct) => void
  onInc: (pid: string) => void
  onDec: (pid: string) => void
}) {
  const top = products.filter((p) => p.tier === 'top')
  const bottom = products.filter((p) => p.tier === 'bottom')

  const qtyFor = (pid: string) => cart.find((it) => it.productId === pid)?.quantity ?? 0

  return (
    <>
      {top.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {top.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              cartQty={qtyFor(p.id)}
              onAdd={() => onAdd(p)}
              onInc={() => onInc(p.id)}
              onDec={() => onDec(p.id)}
            />
          ))}
        </div>
      )}

      {top.length > 0 && bottom.length > 0 && (
        <div className="flex items-center gap-3 my-4">
          <div className="flex-1 h-px bg-border" />
          <span className="text-[11px] text-muted-foreground whitespace-nowrap">
            More from other local shops
          </span>
          <div className="flex-1 h-px bg-border" />
        </div>
      )}

      {bottom.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {bottom.map((p) => (
            <ProductCard
              key={p.id}
              product={p}
              cartQty={qtyFor(p.id)}
              onAdd={() => onAdd(p)}
              onInc={() => onInc(p.id)}
              onDec={() => onDec(p.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ============================================================================
// Sub-component: SearchTierSummary — §1.3 visual tier summary on search
// ============================================================================
function SearchTierSummary({ categories }: { categories: CatalogCategory[] }) {
  let topCount = 0
  let bottomCount = 0
  for (const cat of categories) {
    for (const p of cat.products) {
      if (p.tier === 'top') topCount++
      else bottomCount++
    }
  }
  if (topCount === 0 && bottomCount === 0) return null

  return (
    <div className="flex items-center gap-2 text-[11px]">
      {topCount > 0 && (
        <Badge className="bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50 gap-0.5">
          <Star className="w-2.5 h-2.5 fill-amber-500 text-amber-500" />
          {topCount} top pick{topCount > 1 ? 's' : ''}
        </Badge>
      )}
      {bottomCount > 0 && (
        <Badge variant="outline" className="gap-0.5">
          <Package className="w-2.5 h-2.5" />
          {bottomCount} more by price
        </Badge>
      )}
    </div>
  )
}

// ============================================================================
// Constants: split status meta
// ============================================================================
const SPLIT_STATUS_META: Record<string, {
  label: string
  icon: typeof Package
  badgeClass: string
}> = {
  pending: {
    label: 'Pending',
    icon: Package,
    badgeClass: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800/50',
  },
  confirmed: {
    label: 'Confirmed',
    icon: Check,
    badgeClass: 'bg-sky-100 dark:bg-sky-950/40 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800/50',
  },
  delivered: {
    label: 'Delivered',
    icon: CheckCircle2,
    badgeClass: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800/50',
  },
  returned: {
    label: 'Returned',
    icon: RotateCcw,
    badgeClass: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/50',
  },
  cancelled: {
    label: 'Cancelled',
    icon: X,
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
}
