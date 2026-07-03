'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiDelete } from '@/hooks/use-fetch'
import type { Product } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { Package, Plus, Boxes, AlertTriangle, Search, FileEdit, Trash2, Tag, Lock, EyeOff, Eye, ShieldCheck } from 'lucide-react'
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
import { useGateTrigger } from '@/store/biometric-gate-store'

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
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [productTypeTab, setProductTypeTab] = useState<'all' | 'retail' | 'full' | 'wholesale'>('all')
  // PRD Part 39 §3: Wholesale section is eye-locked until PIN/biometric passes.
  // Session-level unlock — re-locks when user switches away or taps re-lock.
  const [wholesaleUnlocked, setWholesaleUnlocked] = useState(false)
  const triggerGate = useGateTrigger()

  const { data: products, loading, refetch } = useFetch<Product[]>('/api/products', [])

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

  const filtered = useMemo(() => {
    if (!products) return []
    let list = products
    // PRD Part 38: Strict Product Type Isolation — zero mixing of loose and sealed
    if (productTypeTab === 'retail') {
      // ONLY products where Retail/Loose toggle is enabled
      list = list.filter((p) => (p as any).retailEnabled === true)
    } else if (productTypeTab === 'full') {
      // ONLY products that are NOT retail (sealed/full packs)
      list = list.filter((p) => !(p as any).retailEnabled)
    } else if (productTypeTab === 'wholesale') {
      // ONLY products with explicit wholesale price set
      list = list.filter((p) => p.wholesalePrice != null && p.wholesalePrice > 0)
    }
    if (inventoryFilter === 'low-stock') {
      list = list.filter((p) => p.stock <= p.lowStockThreshold)
    }
    if (activeCategory !== 'All') {
      list = list.filter((p) => p.category === activeCategory)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      // PRD Part 26 §4: Phonetic search — match by sound, not just spelling
      list = list.filter((p) => {
        const nameMatch = p.name.toLowerCase().includes(q)
        const skuMatch = (p.sku || '').toLowerCase().includes(q)
        const catMatch = (p.category || '').toLowerCase().includes(q)
        const subCatMatch = (p.subCategory || '').toLowerCase().includes(q)
        // Phonetic: check if any part of the query sounds like the product name
        const queryParts = q.split(/\s+/)
        const nameParts = p.name.toLowerCase().split(/\s+/)
        const phoneticMatch = queryParts.some(qp => {
          if (qp.length < 2) return false
          return nameParts.some(np => {
            // Simple phonetic: same first 3 chars or Levenshtein distance <= 2
            return np.startsWith(qp.substring(0, 3)) ||
              np.includes(qp) ||
              levenshtein(qp, np.substring(0, qp.length)) <= 2
          })
        })
        return nameMatch || skuMatch || catMatch || subCatMatch || phoneticMatch
      })
    }
    return list
  }, [products, inventoryFilter, search, activeCategory, productTypeTab])

  const stats = useMemo(() => {
    if (!products) return { total: 0, lowStock: 0, value: 0 }
    return {
      total: products.length,
      lowStock: products.filter((p) => p.stock <= p.lowStockThreshold).length,
      value: products.reduce((s, p) => s + p.stock * p.purchasePrice, 0),
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

  // PRD Part 39 §3: Wholesale tab is eye-locked. Tapping it triggers the
  // biometric/PIN gate (inventory_price). On success we unlock + switch.
  // Switching to any other tab re-locks wholesale for safety.
  const handleTabSwitch = (tab: 'all' | 'retail' | 'full' | 'wholesale') => {
    if (tab === 'wholesale') {
      if (wholesaleUnlocked) {
        setProductTypeTab('wholesale')
        return
      }
      triggerGate(
        'inventory_price',
        'Unlock wholesale pricing — verify identity to view exclusive bulk rates',
        () => {
          setWholesaleUnlocked(true)
          setProductTypeTab('wholesale')
          toast.success('Wholesale section unlocked', {
            description: 'Exclusive bulk pricing now visible',
          })
        },
        () => {
          toast('Wholesale section stays locked', { description: 'PIN required to view bulk rates' })
        }
      )
      return
    }
    // leaving wholesale — re-lock
    if (productTypeTab === 'wholesale') setWholesaleUnlocked(false)
    setProductTypeTab(tab)
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
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('common.search') + ' products…'}
        className="h-11"
      />

      {/* PRD Part 39: Product Type Tabs — Retail / Full / Wholesale (Strict Isolation, PIN-gated Wholesale) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {([
          { id: 'all', label: 'All Products', icon: '📦' },
          { id: 'retail', label: 'খুচরো (Loose)', icon: '⚖️' },
          { id: 'full', label: 'আস্ত (Sealed)', icon: '📦' },
          { id: 'wholesale', label: 'হোলসেল', icon: '🏭' },
        ] as const).map((tab) => {
          const active = productTypeTab === tab.id
          const locked = tab.id === 'wholesale' && !wholesaleUnlocked
          return (
            <button
              key={tab.id}
              onClick={() => handleTabSwitch(tab.id)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] flex items-center gap-1 ${
                active
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground'
              } ${locked ? 'ring-1 ring-amber-400/60' : ''}`}
            >
              <span>{tab.icon}</span> {tab.label}
              {locked && <Lock className="w-3 h-3 ml-0.5 text-amber-500" />}
              {tab.id === 'wholesale' && wholesaleUnlocked && <ShieldCheck className="w-3 h-3 ml-0.5 text-emerald-400" />}
            </button>
          )
        })}
      </div>

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

      {/* PRD Part 39 §3: Wholesale section header with re-lock when unlocked */}
      {productTypeTab === 'wholesale' && wholesaleUnlocked && (
        <motion.div
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center justify-between p-3 rounded-2xl bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-400/30"
        >
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <div>
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">Wholesale rates unlocked</p>
              <p className="text-[10px] text-muted-foreground">Exclusive bulk pricing visible · session-only</p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs gap-1"
            onClick={() => {
              setWholesaleUnlocked(false)
              setProductTypeTab('all')
              toast('Wholesale section re-locked')
            }}
          >
            <EyeOff className="w-3.5 h-3.5" /> Re-lock
          </Button>
        </motion.div>
      )}

      {/* Product list */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Package}
          title={t('inv.empty')}
          action={
            <Button onClick={() => setShowProductForm(true)} className="h-11">
              <Plus className="w-4 h-4 mr-1.5" /> {t('inv.addProductShort')}
            </Button>
          }
        />
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
                            {/* PRD Part 39: Product type badge — strict per-section labeling */}
                            {productTypeTab === 'retail' && (p as any).retailEnabled && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium">খুচরো · Loose</span>
                            )}
                            {productTypeTab === 'full' && !(p as any).retailEnabled && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium">আস্ত · Sealed</span>
                            )}
                            {productTypeTab === 'wholesale' && p.wholesalePrice && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium">হোলসেল · Bulk</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between mt-2">
                            <div className="flex items-center gap-3 text-xs">
                              <span className={`font-medium ${isLow ? 'text-orange-600' : 'text-foreground'}`}>
                                {p.stock} {p.unit}
                              </span>
                              <span className="text-muted-foreground">·</span>
                              {/* PRD Part 39: Strict price display per product type tab — zero mixing */}
                              {productTypeTab === 'retail' && (p as any).retailEnabled && (p as any).retailSalePrice ? (
                                <span className="font-semibold tabular text-violet-600">
                                  {formatCurrency((p as any).retailSalePrice, currency)}/{(p as any).retailUnit || 'kg'}
                                </span>
                              ) : productTypeTab === 'wholesale' && p.wholesalePrice ? (
                                <span className="font-semibold tabular text-amber-600">
                                  {formatCurrency(p.wholesalePrice, currency)}
                                  <span className="text-[9px] text-muted-foreground ml-0.5">/bulk</span>
                                </span>
                              ) : productTypeTab === 'full' ? (
                                <span className="font-semibold tabular text-teal-600">
                                  {formatCurrency(p.salePrice, currency)}
                                  <span className="text-[9px] text-muted-foreground ml-0.5">/sealed</span>
                                </span>
                              ) : (
                                <span className="font-semibold tabular">{formatCurrency(p.salePrice, currency)}</span>
                              )}
                              {p.mrp && p.mrp > p.salePrice && productTypeTab !== 'retail' && (
                                <span className="text-[10px] text-muted-foreground line-through">{formatCurrency(p.mrp, currency)}</span>
                              )}
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
