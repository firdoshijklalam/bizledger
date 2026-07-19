'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost, apiPut, apiDelete } from '@/hooks/use-fetch'
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
import { Package, Tag, Boxes, AlertTriangle, X, Plus, Upload, Camera, Sparkles, Loader2, ChevronRight, Globe, CheckCircle2 } from 'lucide-react'
import { BadgePercent } from 'lucide-react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Switch } from '@/components/ui/switch'
import { motion, AnimatePresence } from 'framer-motion'

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
  const [retailMrp, setRetailMrp] = useState('')
  const [looseStock, setLooseStock] = useState('')
  const [subCategory, setSubCategory] = useState('')
  const [description, setDescription] = useState('')
  const [isPublished, setIsPublished] = useState(true)
  const [categoryPath, setCategoryPath] = useState('')
  const [saving, setSaving] = useState(false)

  // §3: Voice input support — register ALL text inputs with global mic
  const nameVoice = useVoiceInput<HTMLInputElement>((text) => setName(text))
  const skuVoice = useVoiceInput<HTMLInputElement>((text) => setSku(text))
  const descVoice = useVoiceInput<HTMLTextAreaElement>((text) => setDescription(text))

  // PRD Part 35 §1: AI auto-fill media dropzone
  const [mediaImage, setMediaImage] = useState<string | null>(null)
  const [aiScanning, setAiScanning] = useState(false)
  const [aiScanned, setAiScanned] = useState(false)
  const [aiSource, setAiSource] = useState<string>('')

  // PRD Part 35 §2: Nested category tree
  const [categoryTree, setCategoryTree] = useState<any[]>([])
  const [showCategoryTree, setShowCategoryTree] = useState(false)
  const [newSubCategories, setNewSubCategories] = useState<{ name: string; level: number }[]>([])
  const { data: treeData, refetch: refetchTree } = useFetch<any[]>('/api/category-tree', [])

  // Handle media upload + AI auto-fill
  const handleMediaUpload = async (file: File) => {
    const reader = new FileReader()
    reader.onload = async (e) => {
      const dataUrl = e.target?.result as string
      setMediaImage(dataUrl)
      setAiScanning(true)
      setAiScanned(false)

      try {
        const res = await fetch('/api/products/ai-autofill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: dataUrl }),
        })
        const result = await res.json()

        if (result.ok && result.data) {
          const d = result.data
          // PRD Part 35 §1.3: Auto-fill fields but keep them editable
          if (d.name) setName(d.name)
          if (d.category) setCategory(d.category)
          if (d.subCategory) setSubCategory(d.subCategory)
          if (d.mrp) setMrp(String(d.mrp))
          if (d.gstRate !== undefined) setGstRate(String(d.gstRate))
          if (d.description) setDescription(d.description)
          if (d.unit) setUnit(d.unit)
          setAiSource(result.source || 'ai')
          setAiScanned(true)
          toast.success('AI auto-filled product details', {
            description: 'Review and edit any field as needed',
          })
        }
      } catch (err) {
        toast.error('AI scan failed — fill manually')
      } finally {
        setAiScanning(false)
      }
    }
    reader.readAsDataURL(file)
  }

  // PRD Part 35 §2: Add a new sub-category level dynamically
  const addSubCategoryLevel = () => {
    setNewSubCategories([...newSubCategories, { name: '', level: newSubCategories.length + 1 }])
  }

  // Build the full category path from category + subCategory + new levels
  const buildCategoryPath = () => {
    const parts = [category, subCategory, ...newSubCategories.map((s) => s.name)].filter(Boolean)
    return parts.join(' > ')
  }

  // PRD Part 35 §2: Persist nested category chain to DB for relational integrity
  const persistCategoryTree = async () => {
    const parts = [
      { name: category.trim(), level: 0 },
      { name: subCategory.trim(), level: 1 },
      ...newSubCategories.filter((s) => s.name.trim()).map((s) => ({ name: s.name.trim(), level: s.level + 1 })),
    ].filter((p) => p.name)

    if (parts.length === 0) return

    let parentId: string | null = null
    for (const part of parts) {
      try {
        const res = await fetch('/api/category-tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: part.name, parentId }),
        })
        if (res.ok) {
          const created = await res.json()
          if (created?.id) parentId = created.id
        }
      } catch {
        // Continue even if category creation fails (might already exist)
      }
    }
  }

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
      setRetailMrp((existing as any).retailMrp ? String((existing as any).retailMrp) : '')
      setLooseStock((existing as any).looseStock ? String((existing as any).looseStock) : '')
      setSubCategory((existing as any).subCategory || '')
    } else if (!productId) {
      setName(''); setSku(''); setCategory(''); setUnit('pcs')
      setPurchasePrice(''); setSalePrice(''); setMrp(''); setWholesalePrice('')
      setGstRate('0'); setStock(''); setLowStockThreshold('5'); setSupplierId('')
      setRetailEnabled(false); setRetailUnit('kg'); setConversionFactor(''); setRetailSalePrice(''); setRetailMrp(''); setLooseStock('')
      setSubCategory('')
      setDescription('')
      setIsPublished(true)
      setMediaImage(null)
      setAiScanned(false)
      setNewSubCategories([])
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
      // PRD Part 35 §2: Persist nested category chain to DB before saving product
      await persistCategoryTree()

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
        retailMrp: retailEnabled ? (Number(retailMrp) || null) : null,
        looseStock: retailEnabled ? (Number(looseStock) || 0) : 0,
        subCategory: subCategory.trim() || null,
        description: description.trim() || null,
        isPublished,
        categoryPath: buildCategoryPath() || null,
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
          {/* PRD Part 35 §1.1: Top-most optional media dropzone */}
          <div className="space-y-1.5">
            <Label className="text-xs flex items-center gap-1.5">
              <Camera className="w-3 h-3" /> প্রোডাক্ট ছবি (AI অটো-ফিলের জন্য — Optional)
            </Label>
            {!mediaImage ? (
              <label className="flex flex-col items-center justify-center gap-1.5 p-5 rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 cursor-pointer hover:bg-primary/10 transition-colors min-h-[100px]">
                <Upload className="w-6 h-6 text-primary/60" />
                <span className="text-xs text-muted-foreground text-center">
                  প্রোডাক্টের ছবি আপলোড করুন<br/>
                  <span className="text-[10px]">AI তাৎক্ষণিকভাবে নাম, ক্যাটাগরি, MRP, GST অটো-ফিল করবে</span>
                </span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) handleMediaUpload(file)
                  }}
                />
              </label>
            ) : (
              <div className="relative rounded-xl overflow-hidden border border-border">
                <img src={mediaImage} alt="Product" className="w-full h-32 object-cover" />
                {aiScanning && (
                  <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center gap-2">
                    <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
                    <p className="text-xs text-white font-medium">GLM 5.2 ভিশন স্ক্যান করছে...</p>
                    <div className="flex gap-1">
                      {[0, 1, 2].map((i) => (
                        <motion.div
                          key={i}
                          className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                          animate={{ opacity: [0.3, 1, 0.3] }}
                          transition={{ duration: 1, repeat: Infinity, delay: i * 0.2 }}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {aiScanned && (
                  <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-medium">
                    <CheckCircle2 className="w-3 h-3" /> AI Filled
                  </div>
                )}
                <button
                  onClick={() => { setMediaImage(null); setAiScanned(false) }}
                  className="absolute top-2 left-2 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            {aiScanned && (
              <p className="text-[10px] text-emerald-600 flex items-center gap-1">
                <Sparkles className="w-3 h-3" />
                AI ফিল্ডগুলো অটো-ফিল করেছে — প্রতিটি বক্স এডিটেবল. {aiSource === 'fallback' && '(সimulated)'}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="pname" className="text-xs">{t('common.name')} *</Label>
            <div className="relative">
              <Package className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="pname" {...nameVoice} value={name} onChange={(e) => setName(e.target.value)} className="pl-9 h-11" placeholder="LED Bulb 9W" autoFocus />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="sku" className="text-xs">SKU</Label>
              <Input id="sku" {...skuVoice} value={sku} onChange={(e) => setSku(e.target.value)} className="h-11" placeholder="LED-9W" />
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

          {/* PRD Part 35 §2: Dynamic nested sub-category tree with (+) button */}
          {newSubCategories.map((sub, idx) => (
            <div key={idx} className="space-y-1.5 ml-4 border-l-2 border-primary/20 pl-3">
              <Label className="text-xs flex items-center gap-1 text-primary">
                <ChevronRight className="w-3 h-3" />
                Sub-Category Level {sub.level}
              </Label>
              <div className="flex gap-2">
                <Input
                  value={sub.name}
                  onChange={(e) => {
                    const updated = [...newSubCategories]
                    updated[idx] = { ...updated[idx], name: e.target.value }
                    setNewSubCategories(updated)
                  }}
                  className="h-11"
                  placeholder={`e.g. Level ${sub.level} sub-category`}
                />
                <button
                  onClick={() => setNewSubCategories(newSubCategories.filter((_, i) => i !== idx))}
                  className="w-11 h-11 rounded-xl bg-muted flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </div>
          ))}

          {/* PRD Part 35 §2.1: Dynamic (+) button for infinite nesting */}
          <button
            onClick={addSubCategoryLevel}
            className="flex items-center gap-1.5 text-xs text-primary font-medium py-1"
          >
            <span className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center">
              <Plus className="w-3 h-3" />
            </span>
            Add Sub-Category Level
          </button>

          {/* Category path preview */}
          {(category || subCategory || newSubCategories.some((s) => s.name)) && (
            <div className="p-2 rounded-lg bg-primary/5 text-[10px] text-muted-foreground">
              <span className="font-medium">Full Path:</span> {buildCategoryPath()}
            </div>
          )}

          {/* PRD Part 35 §1.2: AI-generated description */}
          <div className="space-y-1.5">
            <Label htmlFor="desc" className="text-xs flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-primary" /> Description
              {aiScanned && <span className="text-[9px] text-primary">(AI-generated, editable)</span>}
            </Label>
            <Textarea
              id="desc"
              {...descVoice}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px] text-sm"
              placeholder="Product description will be auto-filled by AI when you upload an image, or type manually."
            />
          </div>

          {/* PRD Part 35 §3.1: Online publishing toggle */}
          <div className="flex items-center justify-between p-3 rounded-xl border border-emerald-500/20 bg-emerald-500/5">
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-emerald-600" />
              <div>
                <p className="text-xs font-medium">Publish to Online Store</p>
                <p className="text-[10px] text-muted-foreground">Auto-list on PWA storefront when saved</p>
              </div>
            </div>
            <Switch checked={isPublished} onCheckedChange={setIsPublished} />
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
                    <Label className="text-xs">Retail MRP (₹ per {retailUnit})</Label>
                    <Input
                      value={retailMrp}
                      onChange={(e) => setRetailMrp(e.target.value)}
                      className="h-11"
                      inputMode="numeric"
                      placeholder="0"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Retail Sale Price (₹ per {retailUnit})</Label>
                    <Input
                      value={retailSalePrice}
                      onChange={(e) => setRetailSalePrice(e.target.value)}
                      className="h-11"
                      inputMode="numeric"
                      placeholder="55"
                    />
                  </div>
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
              <Label htmlFor="mrp" className="text-xs">MRP ₹</Label>
              <Input id="mrp" value={mrp} onChange={(e) => setMrp(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="wp" className="text-xs">Wholesale ₹ <span className="text-[9px] text-muted-foreground">(default)</span></Label>
              <Input id="wp" value={wholesalePrice} onChange={(e) => setWholesalePrice(e.target.value)} className="h-11" inputMode="numeric" />
            </div>
          </div>

          {/* §DYNAMIC-PRICING: Tiered pricing manager — set per-buyer/per-group
              custom prices that override the default wholesale price.
              Resolution: Specific Buyer > Group > Default Wholesale. */}
          {productId && (
            <DynamicPricingManager productId={productId} />
          )}

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

// ============================================================================
// §DYNAMIC-PRICING: Tiered pricing manager.
// Lets a supplier set custom prices per buyer or per group for a product.
// Resolution: Specific Buyer Price > Group Price > Default Wholesale Price.
// ============================================================================
interface CustomPriceRow {
  id: string
  buyerId: string | null
  buyerGroupName: string | null
  customPrice: number
  buyer?: { id: string; name: string; phone?: string | null; buyerGroup?: string | null } | null
}

function DynamicPricingManager({ productId }: { productId: string }) {
  const { triggerRefresh } = useAppStore()
  const { data: customPrices, setData } = useFetch<CustomPriceRow[]>(`/api/products/${productId}/custom-prices`, [productId])
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [])
  const [expanded, setExpanded] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [mode, setMode] = useState<'buyer' | 'group'>('buyer')
  const [selectedBuyerId, setSelectedBuyerId] = useState('')
  const [groupName, setGroupName] = useState('')
  const [newPrice, setNewPrice] = useState('')

  const handleAdd = async () => {
    const price = Number(newPrice)
    if (isNaN(price) || price < 0) { toast.error('Invalid price'); return }
    if (mode === 'buyer' && !selectedBuyerId) { toast.error('Select a buyer'); return }
    if (mode === 'group' && !groupName.trim()) { toast.error('Enter a group name'); return }
    try {
      await apiPost(`/api/products/${productId}/custom-prices`, {
        buyerId: mode === 'buyer' ? selectedBuyerId : null,
        buyerGroupName: mode === 'group' ? groupName.trim() : null,
        customPrice: price,
        buyerName: mode === 'buyer' ? parties?.find((p) => p.id === selectedBuyerId)?.name : groupName.trim(),
      })
      toast.success('Custom price set · Buyer notified')
      setShowAdd(false)
      setNewPrice('')
      setSelectedBuyerId('')
      setGroupName('')
      triggerRefresh()
    } catch (e) {
      toast.error('Failed to set custom price')
    }
  }

  const handleDelete = async (priceId: string) => {
    try {
      await apiDelete(`/api/products/${productId}/custom-prices/${priceId}`)
      toast.success('Custom price removed')
      triggerRefresh()
    } catch (e) {
      toast.error('Failed to remove')
    }
  }

  const rows = customPrices || []

  return (
    <div className="rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 text-left"
      >
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
            <Tag className="w-3.5 h-3.5 text-violet-600" />
          </div>
          <div>
            <p className="text-xs font-semibold">Tiered / Custom Pricing</p>
            <p className="text-[10px] text-muted-foreground">
              {rows.length > 0 ? `${rows.length} custom price${rows.length > 1 ? 's' : ''} set` : 'Per-buyer & per-group rates'}
            </p>
          </div>
        </div>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
                  <div className="min-w-0">
                    <p className="text-xs font-medium truncate">
                      {row.buyer ? `👤 ${row.buyer.name}` : `👥 ${row.buyerGroupName}`}
                    </p>
                    {row.buyer?.phone && <p className="text-[10px] text-muted-foreground">{row.buyer.phone}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-sm font-bold tabular text-violet-600">₹{row.customPrice.toFixed(2)}</span>
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      className="w-6 h-6 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center text-muted-foreground hover:text-red-600"
                      aria-label="Remove custom price"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showAdd ? (
            <div className="p-3 rounded-lg bg-card border border-border space-y-2">
              <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
                <button
                  type="button"
                  onClick={() => setMode('buyer')}
                  className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${mode === 'buyer' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                >👤 Specific Buyer</button>
                <button
                  type="button"
                  onClick={() => setMode('group')}
                  className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${mode === 'group' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                >👥 Group / Tier</button>
              </div>
              {mode === 'buyer' ? (
                <select
                  value={selectedBuyerId}
                  onChange={(e) => setSelectedBuyerId(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg border border-border bg-card text-sm"
                >
                  <option value="">Select buyer…</option>
                  {(parties || []).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}{p.phone ? ` · ${p.phone}` : ''}</option>
                  ))}
                </select>
              ) : (
                <Input
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="e.g. Wholesalers, VIP Retailers"
                  className="h-10 text-sm"
                />
              )}
              <div className="flex items-center gap-2">
                <Input
                  value={newPrice}
                  onChange={(e) => setNewPrice(e.target.value)}
                  placeholder="Custom price ₹"
                  className="h-10 text-sm flex-1"
                  inputMode="numeric"
                />
                <Button type="button" size="sm" onClick={handleAdd} className="h-10">Set</Button>
              </div>
              <button type="button" onClick={() => setShowAdd(false)} className="text-[10px] text-muted-foreground">Cancel</button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={() => setShowAdd(true)} className="w-full h-9 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Custom Price
            </Button>
          )}
          <p className="text-[9px] text-muted-foreground leading-tight">
            Hierarchy: Specific Buyer &gt; Group &gt; Default Wholesale. Buyers get a push notification when a price is set for them.
          </p>
        </div>
      )}
    </div>
  )
}
