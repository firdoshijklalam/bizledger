'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiDelete } from '@/hooks/use-fetch'
import type { Product } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { toNumber } from '@/lib/numeric'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, Plus, AlertTriangle, Search, Trash2, Tag, TrendingUp, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { useEffect, useMemo, useState } from 'react'
import { ProductForm } from './inventory/product-form'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { ProductProfile } from './inventory/product-profile'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { usePhoneticSearch } from '@/hooks/use-phonetic-search'
import type { DashboardRange, RangeContext } from '@/lib/date-ranges'
import { dashboardRangeLabel } from '@/lib/date-ranges'

// PRD Part 26 §4: Simple Levenshtein distance for phonetic matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n; if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i-1][j]+1, dp[i][j-1]+1, dp[i-1][j-1]+(a[i-1]===b[j-1]?0:1))
  return dp[m][n]
}

export function InventoryView() {
  const {
    inventoryFilter, setInventoryFilter,
    showProductForm, setShowProductForm,
    editingProductId, setEditingProductId,
    selectedProductId, setSelectedProductId,
    pendingQuickAction, clearQuickAction,
    business,
    // §STEP-4B-VIEW-ALL: sortBy + statsRange carried from Dashboard Top Products /
    // Top Revenue Products View-All.
    inventorySortBy, setInventorySortBy,
    inventoryStatsRange, setInventoryStatsRange,
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const voiceProps = useVoiceInput<HTMLInputElement>((text) => setSearch(text))
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('All')
  // §STEP-4B-VIEW-ALL: Local sort state. Initialized to 'default'. When
  // `inventorySortBy` is set from the store (via Dashboard View-All), it
  // overrides this on mount, then clears the store. The user can dismiss the
  // sort context with the "Clear sort" button (returns to 'default').
  const [sortBy, setSortBy] = useState<'default' | 'unitsSold' | 'revenue'>('default')
  // §STEP-4B-VIEW-ALL: Local stats range. Used to fetch allProductStats from
  // /api/dashboard?range=X&includeAllProductStats=true. Default to '1y' when
  // not set (preserves existing behavior for direct Inventory visits).
  const [statsRange, setStatsRange] = useState<RangeContext>({ range: '1y' })

  useEffect(() => {
    if (inventorySortBy && inventorySortBy !== 'default') {
      const t = setTimeout(() => {
        setSortBy(inventorySortBy)
        setInventorySortBy(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [inventorySortBy, setInventorySortBy, setSortBy])

  useEffect(() => {
    if (inventoryStatsRange) {
      const t = setTimeout(() => {
        setStatsRange(inventoryStatsRange)
        setInventoryStatsRange(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [inventoryStatsRange, setInventoryStatsRange, setStatsRange])

  const { data: rawProducts, loading, refetch } = useFetch<Product[]>('/api/products', [])
  // §STEP-4B-VIEW-ALL: Fetch authoritative per-product sales stats when the
  // user entered via Dashboard Top Products / Top Revenue Products View-All.
  // Reuses /api/dashboard with ?includeAllProductStats=true — same source as
  // the dashboard's topProductsByUnits, just un-sliced. NOT a second data
  // model; NOT a duplicated sales calculation. Fetched only when sortBy is
  // not 'default' to avoid an extra request for normal Inventory visits.
  const statsUrl = useMemo(() => {
    if (sortBy === 'default') return null
    const p = new URLSearchParams({
      range: statsRange.range,
      includeAllProductStats: 'true',
    })
    if (statsRange.range === 'custom' && statsRange.customStart) p.set('startDate', statsRange.customStart)
    if (statsRange.range === 'custom' && statsRange.customEnd) p.set('endDate', statsRange.customEnd)
    return `/api/dashboard?${p.toString()}`
  }, [sortBy, statsRange])
  const { data: statsData } = useFetch<{ allProductStats?: Array<{ name: string; units: number; revenue: number }> }>(statsUrl, [statsUrl])

  // §SEARCH-CONSISTENCY: Parse searchTags JSON string → array, same as the
  // Global Search overlay does. Ensures usePhoneticSearch hook works consistently.
  const products = useMemo(() => {
    if (!rawProducts) return []
    return rawProducts.map((p: any) => ({
      ...p,
      searchTags: p.searchTags
        ? (typeof p.searchTags === 'string'
            ? (() => { try { return JSON.parse(p.searchTags) } catch { return [] } })()
            : p.searchTags)
        : [],
    }))
  }, [rawProducts])

  useEffect(() => {
    if (pendingQuickAction?.type === 'add-product') {
      setShowProductForm(true)
      clearQuickAction()
    }
  }, [pendingQuickAction, setShowProductForm, clearQuickAction])

  const currency = business?.currency || 'INR'

  const categories = useMemo(() => {
    if (!products) return ['All']
    const cats = Array.from(new Set(products.map((p) => p.category).filter(Boolean))) as string[]
    return ['All', ...cats]
  }, [products])

  // §1: Use SHARED usePhoneticSearch hook — same logic as Global Search
  // Checks: name + searchTags (aliases) + sku + category + subCategory + phonetic
  const phoneticFiltered = usePhoneticSearch(products, search, {
    searchFields: ['sku', 'category', 'subCategory'],
  })

  const filtered = useMemo(() => {
    let list = phoneticFiltered
    if (inventoryFilter === 'low-stock') {
      list = list.filter((p) => p.stock <= p.lowStockThreshold)
    }
    if (activeCategory !== 'All') {
      list = list.filter((p) => p.category === activeCategory)
    }
    // §STEP-4B-VIEW-ALL: Sort by unitsSold or revenue using authoritative
    // stats from /api/dashboard?includeAllProductStats. Products not in the
    // stats map get 0 (they had no sales in the range) — appended at the
    // bottom. This gives the COMPLETE product dataset sorted by the dashboard's
    // ranking metric (preserving the insight context).
    if (sortBy !== 'default' && statsData?.allProductStats) {
      const statsMap = new Map(statsData.allProductStats.map((s) => [s.name, s]))
      list = [...list].sort((a, b) => {
        const av = sortBy === 'unitsSold' ? (statsMap.get(a.name)?.units ?? 0) : (statsMap.get(a.name)?.revenue ?? 0)
        const bv = sortBy === 'unitsSold' ? (statsMap.get(b.name)?.units ?? 0) : (statsMap.get(b.name)?.revenue ?? 0)
        return bv - av
      })
    }
    return list
  }, [phoneticFiltered, inventoryFilter, activeCategory, sortBy, statsData])

  const stats = useMemo(() => {
    if (!products) return { total: 0, lowStock: 0, value: 0 }
    return {
      total: products.length,
      lowStock: products.filter((p) => p.stock <= p.lowStockThreshold).length,
      // §FRONTEND-NUMERIC-FIX: purchasePrice may arrive as string from /api/products;
      // coerce via toNumber() to prevent string concatenation in stock value sum.
      value: products.reduce((s, p) => s + toNumber(p.stock) * toNumber(p.purchasePrice), 0),
    }
  }, [products])

  // Show product profile when a product is selected
  if (selectedProductId) {
    return (
      <>
        <ProductProfile productId={selectedProductId} />
        <ProductForm
          open={showProductForm || !!editingProductId}
          onOpenChange={(o) => { setShowProductForm(o); if (!o) setEditingProductId(null) }}
          productId={editingProductId}
        />
      </>
    )
  }

  const confirmDelete = async () => {
    if (!deleteId) return
    try {
      await apiDelete(`/api/products/${deleteId}`)
      toast.success('Product deleted')
      refetch()
    } catch (e) {
      toast.error('Failed to delete')
    }
    setDeleteId(null)
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-2xl bg-card border border-border text-center">
          <p className="text-[11px] text-muted-foreground">{t('inv.allProducts')}</p>
          <p className="text-lg font-bold tabular">{stats.total}</p>
        </div>
        <div className="p-3 rounded-2xl bg-orange-50 dark:bg-orange-950/30 border border-transparent text-center">
          <p className="text-[11px] text-orange-700 dark:text-orange-300">{t('inv.lowStock')}</p>
          <p className="text-lg font-bold tabular text-orange-700 dark:text-orange-300">{stats.lowStock}</p>
        </div>
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-transparent text-center">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300">Stock Value</p>
          <p className="text-sm font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(stats.value, currency)}</p>
        </div>
      </div>

      {/* Add Product button — at top (PRD Part 2 §3) */}
      <Button onClick={() => setShowProductForm(true)} className="w-full h-11">
        <Plus className="w-4 h-4 mr-1.5" /> {t('inv.addProduct')}
      </Button>

      {/* Search */}
      <Input
        {...voiceProps}
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('common.search') + ' products…'}
        className="h-11"
      />

      {/* Filter pills */}
      <div className="flex items-center gap-2">
        {(['all', 'low-stock'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setInventoryFilter(f)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] ${
              inventoryFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f === 'all' ? t('inv.allProducts') : t('inv.lowStock')}
          </button>
        ))}
      </div>

      {/* §STEP-4B-VIEW-ALL: Sort context banner. Shown when the user arrived
          from Dashboard Top Products / Top Revenue Products View-All. Indicates
          the sort metric + the date range the stats are computed for. The
          "Clear sort" button returns to the default product ordering. */}
      {sortBy !== 'default' && (
        <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-medium text-amber-800 dark:text-amber-200 flex items-center gap-1.5">
            <TrendingUp className="w-3.5 h-3.5" />
            Sorted by {sortBy === 'unitsSold' ? 'Units Sold' : 'Revenue'} · {dashboardRangeLabel(statsRange.range)}
          </p>
          <button
            onClick={() => setSortBy('default')}
            className="text-[10px] px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/70 transition-colors flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Clear sort
          </button>
        </div>
      )}

      {/* Category filter chips (PRD Part 18 §1) */}
      {categories.length > 1 && (
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
      )}

      {/* Product list */}
      {loading ? (
        <LoadingState />
      ) : (!products || products.length === 0) ? (
        // §2 Condition A: Database is completely empty → "No products yet"
        <EmptyState
          icon={Package}
          title={t('inv.empty')}
          action={
            <Button onClick={() => setShowProductForm(true)} className="h-11">
              <Plus className="w-4 h-4 mr-1.5" /> {t('inv.addProductShort')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        // §2 Condition B: Products exist but search returned nothing → "No results found"
        <div className="text-center py-12">
          <Package className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No products found for &ldquo;{search}&rdquo;</p>
          <button onClick={() => setSearch('')} className="text-xs text-primary mt-2 hover:underline">
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((p, i) => {
              const isLow = p.stock <= p.lowStockThreshold
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  layout
                >
                  <button
                    onClick={() => setSelectedProductId(p.id)}
                    className="w-full text-left"
                  >
                    <Card className={`p-3.5 ${isLow ? 'border-orange-300 dark:border-orange-800' : ''} hover:shadow-md transition-shadow`}>
                      <div className="flex items-start gap-3">
                        <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
                          isLow ? 'bg-orange-100 dark:bg-orange-900/30' : 'bg-amber-100 dark:bg-amber-900/30'
                        }`}>
                          {isLow ? <AlertTriangle className="w-5 h-5 text-orange-600" /> : <Package className="w-5 h-5 text-amber-600" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {p.category && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground flex items-center gap-0.5">
                                <Tag className="w-2.5 h-2.5" />{p.category}
                              </span>
                            )}
                            {(p as any).subCategory && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                                {(p as any).subCategory}
                              </span>
                            )}
                            {p.sku && <span className="text-[10px] text-muted-foreground">{p.sku}</span>}
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-3 text-xs">
                              <span className={`font-medium ${isLow ? 'text-orange-600' : 'text-foreground'}`}>
                                {p.stock} {p.unit}
                              </span>
                              <span className="text-muted-foreground">·</span>
                              <span className="font-semibold tabular">{formatCurrency(p.salePrice, currency)}</span>
                              {p.mrp && toNumber(p.mrp) > toNumber(p.salePrice) && (
                                <span className="text-[10px] text-muted-foreground line-through">{formatCurrency(p.mrp, currency)}</span>
                              )}
                              {/* §STEP-4B-VIEW-ALL: When sorted by unitsSold/revenue,
                                  show the ranking metric so the sort context is visible. */}
                              {sortBy !== 'default' && statsData?.allProductStats && (() => {
                                const s = statsData.allProductStats.find((x) => x.name === p.name)
                                if (!s) return null
                                return (
                                  <>
                                    <span className="text-muted-foreground">·</span>
                                    <span className="text-emerald-600 font-medium">
                                      {sortBy === 'unitsSold' ? `${s.units} sold` : `${formatCurrency(s.revenue, currency)} rev`}
                                    </span>
                                  </>
                                )
                              })()}
                            </div>
                            {isLow && (
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300">
                                LOW STOCK
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </Card>
                  </button>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <ProductForm
        open={showProductForm || !!editingProductId}
        onOpenChange={(o) => { setShowProductForm(o); if (!o) setEditingProductId(null) }}
        productId={editingProductId}
      />

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" /> {t('inv.delete')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('inv.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
