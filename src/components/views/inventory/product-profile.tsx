'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiDelete } from '@/hooks/use-fetch'
import type { Product, ProductImage } from '@/lib/types'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  ArrowLeft, FileEdit, Trash2, Package, Tag, Boxes, BadgePercent,
  AlertTriangle, Plus, Minus, TrendingUp, ShoppingCart, Award,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CompareSuppliersModal } from '@/components/shared/compare-suppliers-modal'

interface ProductWithImages extends Product {
  images?: ProductImage[]
}

export function ProductProfile({ productId }: { productId: string }) {
  const { setSelectedProductId, setEditingProductId, business, triggerRefresh } = useAppStore()
  const { t } = useI18n()
  const { data: product, refetch } = useFetch<ProductWithImages>(`/api/products/${productId}`, [productId])
  const [showDelete, setShowDelete] = useState(false)
  const [showRestock, setShowRestock] = useState(false)
  const [restockQty, setRestockQty] = useState('')
  const [showCompare, setShowCompare] = useState(false)

  if (!product) return null
  const currency = business?.currency || 'INR'
  const isLow = product.stock <= product.lowStockThreshold
  const discountInfo = product.mrp && product.mrp > product.salePrice
    ? { flat: product.mrp - product.salePrice, pct: ((product.mrp - product.salePrice) / product.mrp) * 100 }
    : null

  const handleRestock = async () => {
    const qty = Number(restockQty)
    if (!qty || qty <= 0) {
      toast.error('Enter a valid quantity')
      return
    }
    try {
      const res = await fetch(`/api/products/${productId}/restock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty }),
      })
      if (!res.ok) throw new Error('Restock failed')
      toast.success(`Added ${qty} ${product.unit} to stock`)
      setRestockQty('')
      setShowRestock(false)
      refetch()
      triggerRefresh()
    } catch (e) {
      toast.error('Failed: ' + String(e))
    }
  }

  const handleDelete = async () => {
    try {
      await apiDelete(`/api/products/${productId}`)
      toast.success('Product deleted')
      triggerRefresh()
      setSelectedProductId(null)
    } catch (e) {
      toast.error('Failed to delete')
    }
    setShowDelete(false)
  }

  const primaryImage = product.images?.find((img) => img.isPrimary) || product.images?.[0]

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      {/* Back button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setSelectedProductId(null)}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1 truncate">{product.name}</h2>
      </div>

      {/* Image gallery / hero */}
      <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-950/40 dark:to-amber-900/30 aspect-[4/3] flex items-center justify-center">
        {primaryImage ? (
          <img src={primaryImage.url} alt={product.name} className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Package className="w-16 h-16 text-amber-600/50" />
            <span className="text-4xl font-bold text-amber-700/30">{product.name.charAt(0).toUpperCase()}</span>
          </div>
        )}
        {isLow && (
          <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-1 rounded-full bg-red-500 text-white flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> LOW STOCK
          </span>
        )}
      </div>

      {/* Name + price */}
      <div className="text-center">
        <h1 className="text-xl font-bold">{product.name}</h1>
        <div className="flex items-center justify-center gap-2 mt-1">
          <span className="text-2xl font-bold tabular text-primary">{formatCurrency(product.salePrice, currency)}</span>
          {product.mrp && product.mrp > product.salePrice && (
            <span className="text-sm text-muted-foreground line-through">{formatCurrency(product.mrp, currency)}</span>
          )}
        </div>
        {discountInfo && (
          <span className="inline-block mt-1 text-[11px] font-medium px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300">
            <BadgePercent className="w-3 h-3 inline mr-0.5" /> ছাড়: ₹{discountInfo.flat.toFixed(0)} ({discountInfo.pct.toFixed(1)}%)
          </span>
        )}
      </div>

      {/* Highlights grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4 text-center">
          <Boxes className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground uppercase">Current Stock</p>
          <p className={`text-lg font-bold tabular ${isLow ? 'text-orange-600' : ''}`}>{product.stock}</p>
          <p className="text-[10px] text-muted-foreground">{product.unit}</p>
        </Card>
        <Card className="p-4 text-center">
          <Tag className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground uppercase">Category</p>
          <p className="text-sm font-bold">{product.category || '—'}</p>
        </Card>
        <Card className="p-4 text-center">
          <Package className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground uppercase">SKU</p>
          <p className="text-sm font-bold">{product.sku || '—'}</p>
        </Card>
        <Card className="p-4 text-center">
          <TrendingUp className="w-5 h-5 text-primary mx-auto mb-1" />
          <p className="text-[10px] text-muted-foreground uppercase">GST Rate</p>
          <p className="text-sm font-bold tabular">{product.gstRate}%</p>
        </Card>
      </div>

      {/* Price details */}
      <Card className="p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Purchase Price</span>
          <span className="tabular font-medium">{formatCurrency(product.purchasePrice, currency)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Sale Price</span>
          <span className="tabular font-medium">{formatCurrency(product.salePrice, currency)}</span>
        </div>
        {product.mrp && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">MRP</span>
            <span className="tabular font-medium">{formatCurrency(product.mrp, currency)}</span>
          </div>
        )}
        {product.wholesalePrice && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Wholesale Price</span>
            <span className="tabular font-medium">{formatCurrency(product.wholesalePrice, currency)}</span>
          </div>
        )}
        <div className="flex justify-between pt-2 border-t border-border">
          <span className="text-muted-foreground">Low Stock Alert</span>
          <span className="tabular font-medium text-orange-600">{product.lowStockThreshold} {product.unit}</span>
        </div>
      </Card>

      {/* Action buttons */}
      <div className="space-y-2">
        <Button
          onClick={() => setShowRestock(true)}
          className="w-full h-12 text-base bg-emerald-600 hover:bg-emerald-700"
        >
          <Plus className="w-5 h-5 mr-2" /> Restock
        </Button>
        {/* PRD Part 18 §3: Compare Suppliers button */}
        <Button
          onClick={() => setShowCompare(true)}
          variant="outline"
          className="w-full h-12 text-base text-purple-600 border-purple-300 dark:border-purple-800 hover:bg-purple-50 dark:hover:bg-purple-950/30"
        >
          <Award className="w-5 h-5 mr-2" /> Compare Suppliers
        </Button>
        <Button
          onClick={() => setEditingProductId(productId)}
          variant="outline"
          className="w-full h-12 text-base"
        >
          <FileEdit className="w-5 h-5 mr-2" /> Edit Product
        </Button>
        <Button
          onClick={() => setShowDelete(true)}
          variant="outline"
          className="w-full h-12 text-base text-destructive border-destructive/30 hover:bg-destructive/5"
        >
          <Trash2 className="w-5 h-5 mr-2" /> Delete Product
        </Button>
      </div>

      {/* Restock dialog */}
      <Dialog open={showRestock} onOpenChange={setShowRestock}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restock — {product.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="p-3 rounded-xl bg-muted/50 text-sm">
              <p className="text-muted-foreground text-xs">Current Stock</p>
              <p className="text-lg font-bold tabular">{product.stock} {product.unit}</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Quantity to add ({product.unit})</Label>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRestockQty(String(Math.max(0, (Number(restockQty) || 0) - 1)))}
                  className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0"
                  aria-label="Decrease by 1"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <Input
                  value={restockQty}
                  onChange={(e) => setRestockQty(e.target.value)}
                  className="h-11 flex-1 text-center text-lg font-bold tabular"
                  inputMode="numeric"
                  placeholder="0"
                  autoFocus
                />
                <button
                  onClick={() => setRestockQty(String((Number(restockQty) || 0) + 1))}
                  className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0"
                  aria-label="Increase by 1"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
              {/* Quick add buttons */}
              <div className="flex gap-2 mt-2">
                {[10, 25, 50, 100].map((n) => (
                  <button
                    key={n}
                    onClick={() => setRestockQty(String((Number(restockQty) || 0) + n))}
                    className="flex-1 py-2 rounded-lg bg-muted hover:bg-accent text-xs font-medium"
                  >
                    +{n}
                  </button>
                ))}
              </div>
            </div>
            {restockQty && Number(restockQty) > 0 && (
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 text-sm text-center">
                <span className="text-muted-foreground">New stock will be: </span>
                <span className="font-bold tabular text-emerald-600">{product.stock + Number(restockQty)} {product.unit}</span>
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowRestock(false)} className="h-11">Cancel</Button>
            <Button onClick={handleRestock} className="h-11 flex-1 bg-emerald-600 hover:bg-emerald-700">
              <Plus className="w-4 h-4 mr-1.5" /> Add to Stock
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={showDelete} onOpenChange={setShowDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="w-4 h-4 text-destructive" /> {t('inv.delete')}
            </AlertDialogTitle>
            <AlertDialogDescription>{t('inv.deleteConfirm')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Compare Suppliers Modal (PRD Part 18 §3) */}
      <CompareSuppliersModal
        open={showCompare}
        onClose={() => setShowCompare(false)}
        productName={product.name}
        productId={product.id}
        quantity={Math.max(10, Math.ceil(product.lowStockThreshold) * 2)}
      />
    </motion.div>
  )
}
