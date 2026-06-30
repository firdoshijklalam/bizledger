'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost, apiPut } from '@/hooks/use-fetch'
import type { Product, Party } from '@/lib/types'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useGateTrigger } from '@/store/biometric-gate-store'
import { Package, Tag, DollarSign, Boxes, AlertTriangle, X, Plus } from 'lucide-react'
import { BadgePercent } from 'lucide-react'
import { Switch } from '@/components/ui/switch'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId?: string | null
}

const UNITS = ['pcs', 'kg', 'bag', 'box', 'ltr', 'meter']

export function ProductForm({ open, onOpenChange, productId }: Props) {
  const { triggerRefresh, setEditingProductId } = useAppStore()
  const { t } = useI18n()
  const { data: existing } = useFetch<Product>(productId ? `/api/products/${productId}` : null, [productId, open])

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [purchasePrice, setPurchasePrice] = useState('')
  const [salePrice, setSalePrice] = useState('')
  const [mrp, setMrp] = useState('')
  const [wholesalePrice, setWholesalePrice] = useState('')
  const [gstRate, setGstRate] = useState('0')
  const [stock, setStock] = useState('')
  const [lowStockThreshold, setLowStockThreshold] = useState('5')
  const [supplierId, setSupplierId] = useState('')
  // PRD Part 11: Dual-stock + retail config
  const [retailEnabled, setRetailEnabled] = useState(false)
  const [retailUnit, setRetailUnit] = useState('kg')
  const [conversionFactor, setConversionFactor] = useState('')
  const [retailSalePrice, setRetailSalePrice] = useState('')
  const [looseStock, setLooseStock] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [saving, setSaving] = useState(false)

  // Category autocomplete (PRD v2 §9.4) + Supplier linking (PRD v2 §9.3)
  const { data: categories } = useFetch<string[]>('/api/products/categories', [])
  const { data: suppliers } = useFetch<Party[]>('/api/parties?type=supplier', [])

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setSku(existing.sku || '')
      setCategory(existing.category || '')
      setUnit(existing.unit)
      setPurchasePrice(String(existing.purchasePrice))
      setSalePrice(String(existing.salePrice))
      setMrp(existing.mrp ? String(existing.mrp) : '')
      setWholesalePrice(existing.wholesalePrice ? String(existing.wholesalePrice) : '')
      setGstRate(String(existing.gstRate))
      setStock(String(existing.stock))
      setLowStockThreshold(String(existing.lowStockThreshold))
      setSupplierId(existing.supplierId || '')
      setRetailEnabled((existing as any).retailEnabled ?? false)
      setRetailUnit((existing as any).retailUnit || 'kg')
      setConversionFactor((existing as any).conversionFactor ? String((existing as any).conversionFactor) : '')
      setRetailSalePrice((existing as any).retailSalePrice ? String((existing as any).retailSalePrice) : '')
      setLooseStock((existing as any).looseStock ? String((existing as any).looseStock) : '')
      setSubCategory((existing as any).subCategory || '')
    } else if (!productId) {
      setName(''); setSku(''); setCategory(''); setUnit('pcs')
      setPurchasePrice(''); setSalePrice(''); setMrp(''); setWholesalePrice('')
      setGstRate('0'); setStock(''); setLowStockThreshold('5'); setSupplierId('')
      setRetailEnabled(false); setRetailUnit('kg'); setConversionFactor(''); setRetailSalePrice(''); setLooseStock('')
      setSubCategory('')
    }
  }, [existing, productId, open])

  // Auto discount calc
  const discountInfo = (() => {
    const m = Number(mrp)
    const s = Number(salePrice)
    if (m > 0 && s > 0 && s < m) {
      return { flat: m - s, pct: ((m - s) / m) * 100 }
    }
    return null
  })()

  // PRD Part 32 §1.4: Inventory Price Modification gate
  const triggerGate = useGateTrigger()
  const { data: gateSettings } = useFetch<any>('/api/app-settings', [])
  const gateInventoryPriceEnabled = gateSettings?.gateInventoryPrice ?? true
  const isEditingExisting = !!productId

  const performSave = async () => {
    setSaving(true)
    try {
      const payload = {
        name: name.trim(),
        sku: sku.trim(),
        category: category.trim(),
        unit,
        purchasePrice: Number(purchasePrice) || 0,
        salePrice: Number(salePrice) || 0,
        mrp: mrp ? Number(mrp) : null,
        wholesalePrice: wholesalePrice ? Number(wholesalePrice) : null,
        gstRate: Number(gstRate) || 0,
        stock: Number(stock) || 0,
        lowStockThreshold: Number(lowStockThreshold) || 5,
        supplierId: supplierId || null,
        // PRD Part 11: Dual-stock + retail config
        retailEnabled,
        retailUnit: retailEnabled ? retailUnit : null,
        conversionFactor: retailEnabled ? (Number(conversionFactor) || null) : null,
        retailSalePrice: retailEnabled ? (Number(retailSalePrice) || 0) : null,
        looseStock: retailEnabled ? (Number(looseStock) || 0) : 0,
        subCategory: subCategory.trim() || null,
      }
      if (productId) {
        await apiPut(`/api/products/${productId}`, payload)
        toast.success('Product updated')
        setEditingProductId(null)
      } else {
        await apiPost('/api/products', payload)
        toast.success('Product added')
      }
      triggerRefresh()
      onOpenChange(false)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Enter product name')
      return
    }
    // PRD Part 32 §1.4: Inventory Price Modification gate
    // Gate only when EDITING an existing product's purchase price or bulk stock
    if (isEditingExisting && gateInventoryPriceEnabled) {
      triggerGate(
        'inventory_price',
        `Modify purchase price or stock for "${name.trim()}"`,
        () => performSave()
      )
      return
    }
    await performSave()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto scroll-area">
        <DialogHeader>
          <DialogTitle>{productId ? 'Edit Product' : t('inv.addProduct')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="pname" className="text-xs">{t('common.name')} *</Label>
            <div className="relative">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="pname" value={name} onChange={(e) => setName(e.target.value)} className="pl-9 h-11" placeholder="LED Bulb 9W" autoFocus />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku" className="text-xs">SKU</Label>
              <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} className="h-11" placeholder="LED-9W" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cat" className="text-xs">Category</Label>
              <Input
                id="cat"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="h-11"
                placeholder="Electronics"
                list="category-list"
              />
              <datalist id="category-list">
                {(categories || []).map((c) => <option key={c} value={c} />)}
              </datalist>
            </div>
          </div>

          {/* PRD Part 18 §2: subCategory field with dynamic suggestions */}
          <div className="space-y-1.5">
            <Label htmlFor="subcat" className="text-xs">Sub-Category</Label>
            <Input
              id="subcat"
              value={subCategory}
              onChange={(e) => setSubCategory(e.target.value)}
              className="h-11"
              placeholder="e.g. Miniket, Jaya, Ratna"
              list="subcat-list"
            />
            <datalist id="subcat-list">
              {getSubCategorySuggestions(category).map((s) => <option key={s} value={s} />)}
            </datalist>
          </div>

          {/* Supplier linking (PRD v2 §9.3) */}
          <div className="space-y-1.5">
            <Label htmlFor="supplier" className="text-xs">সাপ্লায়ারের নাম (Supplier)</Label>
            <select
              id="supplier"
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full h-11 rounded-xl bg-muted px-3 text-sm border-0 outline-none"
            >
              <option value="">— None —</option>
              {(suppliers || []).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          {/* PRD Part 11 §1: Retail / Loose Product Configuration */}
          <div className="p-3 rounded-xl border border-dashed border-primary/30 bg-primary/5">
            <button
              type="button"
              onClick={() => setRetailEnabled(!retailEnabled)}
              className="w-full flex items-center justify-between"
            >
              <div className="flex items-center gap-2">
                <Plus className={`w-4 h-4 text-primary transition-transform ${retailEnabled ? 'rotate-45' : ''}`} />
                <span className="text-sm font-medium">খুচরো / লুজ প্রোডাক্ট (Retail / Loose)</span>
              </div>
              <Switch checked={retailEnabled} onCheckedChange={setRetailEnabled} />
            </button>
            {retailEnabled && (
              <div className="mt-3 space-y-3">
                {/* Sub-unit selection */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">খুচরো সাব-ইউনিট (Sub-Unit)</Label>
                    <select
                      value={retailUnit}
                      onChange={(e) => setRetailUnit(e.target.value)}
                      className="w-full h-11 rounded-xl bg-muted px-3 text-sm border-0 outline-none"
                    >
                      {['kg', 'gm', 'pcs', 'ltr', 'meter'].map((u) => (
                        <option key={u} value={u}>{u}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">কনভার্সন ফ্যাক্টর (1 {unit} = ? {retailUnit})</Label>
                    <Input
                      value={conversionFactor}
                      onChange={(e) => setConversionFactor(e.target.value)}
                      className="h-11"
                      inputMode="numeric"
                      placeholder="25"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">খুচরো দর (₹ per {retailUnit})</Label>
                    <Input
                      value={retailSalePrice}
                      onChange={(e) => setRetailSalePrice(e.target.value)}
                      className="h-11"
                      inputMode="numeric"
                      placeholder="55"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">খোলা স্টক ({retailUnit})</Label>
                    <Input
                      value={looseStock}
                      onChange={(e) => setLooseStock(e.target.value)}
                      className="h-11"
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                </div>
                {conversionFactor && Number(conversionFactor) > 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    ১ {unit} = {conversionFactor} {retailUnit} · খুচরো মূল্য: ₹{retailSalePrice || '0'}/{retailUnit}
                  </p>
                )}
              </div>
            )}
          </div>

          <div>
            <Label className="text-xs mb-1.5 block">Unit</Label>
            <div className="flex gap-1.5 overflow-x-auto no-scrollbar">
              {UNITS.map((u) => (
                <button
                  key={u}
                  onClick={() => setUnit(u)}
                  className={`px-3 py-2 rounded-lg text-xs font-medium shrink-0 min-h-[40px] ${
                    unit === u ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  {u}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pp" className="text-xs">Purchase ₹</Label>
              <Input id="pp" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp" className="text-xs">Sale ₹</Label>
              <Input id="sp" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="mrp" className="text-xs">MRP</Label>
              <Input id="mrp" value={mrp} onChange={(e) => setMrp(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wp" className="text-xs">Wholesale ₹</Label>
              <Input id="wp" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
          </div>

          {/* Auto discount display */}
          {discountInfo && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-xs">
              <BadgePercent className="w-4 h-4 text-amber-600" />
              <span className="text-amber-700 dark:text-amber-300">
                Discount: <strong>₹{discountInfo.flat.toFixed(0)}</strong> ({discountInfo.pct.toFixed(1)}%)
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="gst" className="text-xs">GST %</Label>
              <Input id="gst" value={gstRate} onChange={(e) => setGstRate(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="stock" className="text-xs">Stock Qty</Label>
              <Input id="stock" value={stock} onChange={(e) => setStock(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="lst" className="text-xs">Low Stock Alert Threshold</Label>
            <Input id="lst" value={lowStockThreshold} onChange={(e) => setLowStockThreshold(e.target.value)} className="h-11" inputMode="numeric" />
          </div>
        </div>

        <DialogFooter className="gap-2">
          {productId && (
            <Button
              variant="destructive"
              onClick={async () => {
                if (confirm(t('inv.deleteConfirm'))) {
                  await fetch(`/api/products/${productId}`, { method: 'DELETE' })
                  toast.success('Product deleted')
                  triggerRefresh()
                  onOpenChange(false)
                  setEditingProductId(null)
                }
              }}
              className="h-11"
            >
              {t('common.delete')}
            </Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// PRD Part 18 §2: dynamic sub-category suggestions based on selected category
function getSubCategorySuggestions(category: string): string[] {
  const c = (category || '').toLowerCase().trim()
  const map: Record<string, string[]> = {
    rice: ['Miniket', 'Jaya', 'Ratna', 'Sona Masuri', 'Basmati', 'Gobindobhog', 'Ponni'],
    cement: ['OPC 53', 'OPC 43', 'PPC', 'PSC', 'White Cement'],
    steel: ['TMT 12mm', 'TMT 16mm', 'TMT 8mm', 'TMT 20mm', 'TMT 10mm'],
    paint: ['Premium Emulsion', 'Distemper', 'Primer', 'Enamel', 'Texture'],
    oil: ['Mustard', 'Sunflower', 'Soybean', 'Refined', 'Coconut'],
    flour: ['Atta', 'Maida', 'Suji', 'Besan'],
    pulse: ['Masoor', 'Moong', 'Chana', 'Toor', 'Urad'],
    electronic: ['LED Bulb', 'Tube Light', 'Fan', 'Switch', 'Wire'],
    electrical: ['LED Bulb', 'Tube Light', 'Fan', 'Switch', 'Wire'],
    plumbing: ['PVC Pipe', 'Tape', 'Faucet', 'Joint', 'Valve'],
    construction: ['Brick', 'Sand', 'Aggregate', 'Cement', 'Steel'],
  }
  if (map[c]) return map[c]
  for (const key of Object.keys(map)) {
    if (c.includes(key)) return map[key]
  }
  return []
}
