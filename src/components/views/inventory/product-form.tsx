'use client'

import { createPortal } from 'react-dom'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost, apiPut, apiDelete } from '@/hooks/use-fetch'
import type { Product, Party } from '@/lib/types'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { useGateTrigger } from '@/store/biometric-gate-store'
import { Package, Tag, Boxes, AlertTriangle, X, Plus, Upload, Camera, Sparkles, Loader2, ChevronRight, Globe, CheckCircle2, FileEdit, Trash2, Calculator } from 'lucide-react'
import { BadgePercent } from 'lucide-react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Switch } from '@/components/ui/switch'
import { motion, AnimatePresence } from 'framer-motion'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  productId?: string | null
}

// §UNIT-SCALABILITY: Comprehensive unit list organized by category.
// Includes "+ Add Custom Unit" for local units (Peti, Basta, Tin, etc.)
const UNIT_CATEGORIES = [
  { label: 'Weight', units: ['gm', 'kg', 'quintal', 'ton'] },
  { label: 'Count', units: ['pcs', 'dozen', 'pair', 'pack', 'bundle', 'carton', 'roll'] },
  { label: 'Volume', units: ['ml', 'ltr', 'gallon'] },
  { label: 'Length', units: ['inch', 'foot', 'meter', 'yard'] },
]
const DEFAULT_UNITS = UNIT_CATEGORIES.flatMap((c) => c.units)

export function ProductForm({ open, onOpenChange, productId }: Props) {
  const { triggerRefresh, setEditingProductId } = useAppStore()
  const { t } = useI18n()
  const { data: existing } = useFetch<Product>(productId ? `/api/products/${productId}` : null, [productId, open])

  const [name, setName] = useState('')
  const [sku, setSku] = useState('')
  const [category, setCategory] = useState('')
  const [unit, setUnit] = useState('pcs')
  // §CUSTOM-UNITS: User-defined units persisted in localStorage
  const [customUnits, setCustomUnits] = useState<string[]>([])
  const [showCustomUnitInput, setShowCustomUnitInput] = useState(false)
  const [customUnitText, setCustomUnitText] = useState('')

  // Load custom units from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem('bizledger-custom-units')
      if (saved) setCustomUnits(JSON.parse(saved))
    } catch {}
  }, [])

  const allUnits = [...DEFAULT_UNITS, ...customUnits]

  const addCustomUnit = () => {
    const trimmed = customUnitText.trim().toLowerCase()
    if (!trimmed) return
    if (allUnits.includes(trimmed)) { toast.error('Unit already exists'); return }
    const updated = [...customUnits, trimmed]
    setCustomUnits(updated)
    setCustomUnitText('')
    setShowCustomUnitInput(false)
    try { localStorage.setItem('bizledger-custom-units', JSON.stringify(updated)) } catch {}
    setUnit(trimmed)
    toast.success(`Custom unit "${trimmed}" added`)
  }
  const [purchasePrice, setPurchasePrice] = useState('')
  // §LANDED-COST: Supplier price + transport cost = actual purchase price
  const [supplierPrice, setSupplierPrice] = useState('')
  const [transportCost, setTransportCost] = useState('')
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
  const [showPricingPage, setShowPricingPage] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
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
      // §LANDED-COST: Try to split existing purchasePrice into supplier + transport
      // If no split data stored, put everything in supplierPrice
      const pp = existing.purchasePrice || 0
      setSupplierPrice(String(pp))
      setTransportCost('0')
      setPurchasePrice(String(pp))
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
      setSupplierPrice(''); setTransportCost(''); setPurchasePrice(''); setSalePrice(''); setMrp(''); setWholesalePrice('')
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
        // §LANDED-COST: Actual purchase price = supplier price + transport cost
        purchasePrice: (Number(supplierPrice) || 0) + (Number(transportCost) || 0),
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <FormDialogContent
        className="max-w-md"
        // §PORTAL-CLICK-FIX: When the TieredPricingPage portal (createPortal)
        // is open, Radix Dialog with modal={false} treats clicks inside that
        // portal as "outside" the dialog content and closes the entire dialog
        // on pointer-down — BEFORE the button's onClick can fire. This makes
        // every button in the pricing page appear "dead". Suppress the
        // outside-close while the pricing page (or any child portal) is open.
        onPointerDownOutside={(e) => { if (showPricingPage || showDeleteConfirm) e.preventDefault() }}
        onInteractOutside={(e) => { if (showPricingPage || showDeleteConfirm) e.preventDefault() }}
      >
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

          {/* §UNIT-SELECT: Compact dropdown instead of cluttered chip block.
              Shows "Unit: kg ▼" — clicking opens a native select. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Unit</Label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="w-full h-11 px-3 rounded-lg border border-border bg-card text-sm"
              >
                {UNIT_CATEGORIES.map((cat) => (
                  <optgroup key={cat.label} label={cat.label}>
                    {cat.units.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </optgroup>
                ))}
                {customUnits.length > 0 && (
                  <optgroup label="Custom">
                    {customUnits.map((u) => (
                      <option key={u} value={u}>{u}</option>
                    ))}
                  </optgroup>
                )}
              </select>
            </div>
            <div className="space-y-1.5 flex flex-col justify-end">
              {showCustomUnitInput ? (
                <div className="flex gap-1.5">
                  <Input
                    value={customUnitText}
                    onChange={(e) => setCustomUnitText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') addCustomUnit() }}
                    placeholder="e.g. peti, basta"
                    className="h-11 text-sm flex-1"
                    autoFocus
                  />
                  <Button type="button" size="sm" onClick={addCustomUnit} className="h-11">+</Button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowCustomUnitInput(true)}
                  className="h-11 text-[11px] text-primary border border-dashed border-primary/30 rounded-lg hover:bg-primary/5 flex items-center justify-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Custom Unit
                </button>
              )}
            </div>
          </div>

          {/* §LANDED-COST: Refactored purchase price into Landed Cost calculation.
              Supplier Price + Transport & Labor = Actual Purchase Price (auto-calculated).
              The actual purchase price is what gets saved to the DB for profit margins. */}
          <div className="rounded-xl border border-border p-3 space-y-2 bg-muted/30">
            <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
              <Calculator className="w-3.5 h-3.5" /> Landed Cost Calculation
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label htmlFor="sp-base" className="text-[10px]">Supplier Price ₹</Label>
                <Input
                  id="sp-base"
                  value={supplierPrice}
                  onChange={(e) => setSupplierPrice(e.target.value)}
                  className="h-10 text-sm"
                  inputMode="numeric"
                  placeholder="0"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="sp-transport" className="text-[10px]">Transport & Labor ₹</Label>
                <Input
                  id="sp-transport"
                  value={transportCost}
                  onChange={(e) => setTransportCost(e.target.value)}
                  className="h-10 text-sm"
                  inputMode="numeric"
                  placeholder="0"
                />
              </div>
            </div>
            {/* Auto-calculated actual purchase price */}
            <div className="flex items-center justify-between p-2 rounded-lg bg-card border border-border">
              <span className="text-[10px] text-muted-foreground">Actual Purchase Price (auto)</span>
              <span className="text-sm font-bold tabular text-orange-600">
                ₹{(Number(supplierPrice) || 0) + (Number(transportCost) || 0)}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
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

          {/* §DYNAMIC-PRICING: Clickable tile that opens a dedicated full-screen
              pricing manager. No more inline accordion — too cluttered. */}
          {productId && (
            <button
              type="button"
              onClick={() => setShowPricingPage(true)}
              className="w-full flex items-center justify-between p-3 rounded-xl border border-violet-200 dark:border-violet-900/50 bg-violet-50/50 dark:bg-violet-950/20 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
                  <Tag className="w-4 h-4 text-violet-600" />
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold">Tiered / Custom Pricing</p>
                  <p className="text-[10px] text-muted-foreground">Per-buyer & per-group rates</p>
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground" />
            </button>
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

          {/* §DELETE-SAFETY: Delete button at the VERY BOTTOM of the form,
              far from Save/Cancel. Red text, not a red button — less likely
              to be accidentally tapped. Opens a confirmation modal. */}
          {productId && (
            <button
              type="button"
              onClick={() => setShowDeleteConfirm(true)}
              className="w-full py-2.5 mt-4 text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-900/50"
            >
              <Trash2 className="w-3.5 h-3.5 inline mr-1" />
              Delete Product
            </button>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('common.save')}
          </Button>
        </DialogFooter>
      </FormDialogContent>
    </Dialog>

    {/* §DEDICATED-PRICING-PAGE: Full-screen modal for managing tiered/custom
        pricing. Separate from the product form to avoid clutter. */}
    {productId && (
      <TieredPricingPage
        productId={productId}
        open={showPricingPage}
        onOpenChange={setShowPricingPage}
      />
    )}

    {/* §DELETE-SAFETY: Product delete is now a separate dialog with double
        confirmation, NOT in the main footer next to Save. */}
    <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" /> Delete Product?
          </AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete this product and all its custom prices.
            This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel className="h-11">{t('common.cancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              await fetch(`/api/products/${productId}`, { method: 'DELETE' })
              toast.success('Product deleted')
              triggerRefresh()
              onOpenChange(false)
              setEditingProductId(null)
            }}
            className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {t('common.delete')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
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
  // §MULTI-PRICE: Three-tier custom pricing fields (BULK/FULL mode — per bag/box)
  customSalePrice?: number | null
  customMrp?: number | null
  customWholesalePrice?: number | null
  // §RETAIL-ISOLATION: Retail-specific prices (per kg/pcs) — separate from bulk
  customRetailSalePrice?: number | null
  customRetailMrp?: number | null
  buyer?: { id: string; name: string; phone?: string | null; buyerGroup?: string | null } | null
}

function TieredPricingPage({ productId, open, onOpenChange }: { productId: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const { triggerRefresh } = useAppStore()
  const { data: customPrices, refetch: refetchPrices } = useFetch<CustomPriceRow[]>(`/api/products/${productId}/custom-prices`, [productId])
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [])

  // §UNIFIED-FORM: A single form state used for BOTH "Add" and "Edit".
  // When `editingId` is null → Add mode (empty form).
  // When `editingId` is set   → Edit mode (form pre-filled with the row's data).
  // The user can edit BOTH the target entity (buyer/group) AND the prices.
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mode, setMode] = useState<'buyer' | 'group'>('buyer')
  const [selectedBuyerId, setSelectedBuyerId] = useState('')
  const [groupName, setGroupName] = useState('')
  // §MULTI-PRICE: Three-tier custom pricing (mirrors the main Product form)
  // BULK/FULL mode prices (per bag/box)
  const [salePrice, setSalePrice] = useState('')
  const [mrpPrice, setMrpPrice] = useState('')
  const [wholesalePrice, setWholesalePrice] = useState('')
  // §RETAIL-ISOLATION: Retail prices (per kg/pcs) — SEPARATE from bulk
  const [retailSalePrice, setRetailSalePrice] = useState('')
  const [retailMrpPrice, setRetailMrpPrice] = useState('')
  // §GROUP-MEMBERS: Selected customer IDs for group membership
  const [selectedMemberIds, setSelectedMemberIds] = useState<Set<string>>(new Set())
  const [showMemberList, setShowMemberList] = useState(false)

  const isEditMode = editingId !== null

  // §OPEN-FORM-ADD: Open the form in Add mode (empty).
  const openAddForm = () => {
    setEditingId(null)
    setMode('buyer')
    setSelectedBuyerId('')
    setGroupName('')
    setSalePrice('')
    setMrpPrice('')
    setWholesalePrice('')
    setRetailSalePrice('')
    setRetailMrpPrice('')
    setSelectedMemberIds(new Set())
    setShowMemberList(false)
    setShowForm(true)
  }

  // §OPEN-FORM-EDIT: Open the form in Edit mode, pre-filled with the row's data.
  // The user can change the buyer/group AND the prices — full editability.
  const openEditForm = (row: CustomPriceRow) => {
    setEditingId(row.id)
    if (row.buyerId && row.buyer) {
      setMode('buyer')
      setSelectedBuyerId(row.buyerId)
      setGroupName('')
    } else if (row.buyerGroupName) {
      setMode('group')
      setGroupName(row.buyerGroupName)
      setSelectedBuyerId('')
      // §PRE-FILL-MEMBERS: When editing a group, pre-select all customers
      // who are currently in that group.
      const membersInGroup = (parties || [])
        .filter((p) => p.buyerGroup === row.buyerGroupName)
        .map((p) => p.id)
      setSelectedMemberIds(new Set(membersInGroup))
    } else {
      // Fallback: default to buyer mode
      setMode('buyer')
      setSelectedBuyerId('')
      setGroupName('')
    }
    // §MULTI-PRICE: Pre-fill the three BULK price fields from the row's data.
    // Fall back to customPrice (legacy) if the specific field is null.
    setSalePrice(row.customSalePrice != null ? String(row.customSalePrice) : String(row.customPrice))
    setMrpPrice(row.customMrp != null ? String(row.customMrp) : '')
    setWholesalePrice(row.customWholesalePrice != null ? String(row.customWholesalePrice) : '')
    // §RETAIL-ISOLATION: Pre-fill retail-specific prices (separate from bulk)
    setRetailSalePrice(row.customRetailSalePrice != null ? String(row.customRetailSalePrice) : '')
    setRetailMrpPrice(row.customRetailMrp != null ? String(row.customRetailMrp) : '')
    setShowMemberList(false)
    setShowForm(true)
  }

  // §CLOSE-FORM: Close the form and reset state.
  const closeForm = () => {
    setShowForm(false)
    setEditingId(null)
    setSelectedBuyerId('')
    setGroupName('')
    setSalePrice('')
    setMrpPrice('')
    setWholesalePrice('')
    setRetailSalePrice('')
    setRetailMrpPrice('')
    setSelectedMemberIds(new Set())
    setShowMemberList(false)
  }

  // §SUBMIT: Handles BOTH add and edit. If editingId is set → PUT (update).
  // Otherwise → POST (create).
  // §MULTI-PRICE: Sends all price fields (bulk + retail). At least one must be valid.
  // §RETAIL-ISOLATION: Retail prices are sent separately from bulk prices.
  const handleSubmit = async () => {
    const sPrice = salePrice ? Number(salePrice) : NaN
    const mPrice = mrpPrice ? Number(mrpPrice) : NaN
    const wPrice = wholesalePrice ? Number(wholesalePrice) : NaN
    const rsPrice = retailSalePrice ? Number(retailSalePrice) : NaN
    const rmPrice = retailMrpPrice ? Number(retailMrpPrice) : NaN

    // Validate: at least one price must be provided
    if (isNaN(sPrice) && isNaN(mPrice) && isNaN(wPrice) && isNaN(rsPrice) && isNaN(rmPrice)) {
      toast.error('Enter at least one price'); return
    }
    if (!isNaN(sPrice) && sPrice < 0) { toast.error('Invalid sale price'); return }
    if (!isNaN(mPrice) && mPrice < 0) { toast.error('Invalid MRP'); return }
    if (!isNaN(wPrice) && wPrice < 0) { toast.error('Invalid wholesale price'); return }
    if (!isNaN(rsPrice) && rsPrice < 0) { toast.error('Invalid retail sale price'); return }
    if (!isNaN(rmPrice) && rmPrice < 0) { toast.error('Invalid retail MRP'); return }

    if (mode === 'buyer' && !selectedBuyerId) { toast.error('Select a buyer'); return }
    if (mode === 'group' && !groupName.trim()) { toast.error('Enter a group name'); return }

    // Build the price payload — only include fields that are provided
    const pricePayload: Record<string, unknown> = {}
    if (!isNaN(sPrice)) pricePayload.customSalePrice = sPrice
    if (!isNaN(mPrice)) pricePayload.customMrp = mPrice
    if (!isNaN(wPrice)) pricePayload.customWholesalePrice = wPrice
    // §RETAIL-ISOLATION: Include retail-specific prices
    if (!isNaN(rsPrice)) pricePayload.customRetailSalePrice = rsPrice
    if (!isNaN(rmPrice)) pricePayload.customRetailMrp = rmPrice

    try {
      if (isEditMode && editingId) {
        // §EDIT: Update the existing custom price — entity AND/OR prices.
        const updateBody: Record<string, unknown> = { ...pricePayload }
        if (mode === 'buyer') {
          updateBody.buyerId = selectedBuyerId
          updateBody.buyerGroupName = null
        } else {
          updateBody.buyerGroupName = groupName.trim()
          updateBody.buyerId = null
        }
        await fetch(`/api/products/${productId}/custom-prices/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updateBody),
        })
        // §GROUP-MEMBERS: If editing a group, update member assignments.
        if (mode === 'group' && selectedMemberIds.size > 0) {
          await Promise.all(
            Array.from(selectedMemberIds).map((pid) =>
              fetch(`/api/parties/${pid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buyerGroup: groupName.trim() }),
              })
            )
          )
        }
        toast.success('Custom prices updated')
      } else {
        // §ADD: Create a new custom price.
        await apiPost(`/api/products/${productId}/custom-prices`, {
          buyerId: mode === 'buyer' ? selectedBuyerId : null,
          buyerGroupName: mode === 'group' ? groupName.trim() : null,
          ...pricePayload,
          buyerName: mode === 'buyer' ? parties?.find((p) => p.id === selectedBuyerId)?.name : groupName.trim(),
        })
        if (mode === 'group' && selectedMemberIds.size > 0) {
          await Promise.all(
            Array.from(selectedMemberIds).map((pid) =>
              fetch(`/api/parties/${pid}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ buyerGroup: groupName.trim() }),
              })
            )
          )
          toast.success(`Group "${groupName.trim()}" created with ${selectedMemberIds.size} member${selectedMemberIds.size > 1 ? 's' : ''} · Custom prices set`)
        } else {
          toast.success('Custom prices set · Buyer notified')
        }
      }
      closeForm()
      await refetchPrices()
      triggerRefresh()
    } catch (e) {
      toast.error(isEditMode ? 'Failed to update prices' : 'Failed to set custom prices')
    }
  }

  const handleDelete = async (priceId: string) => {
    try {
      await apiDelete(`/api/products/${productId}/custom-prices/${priceId}`)
      toast.success('Custom price removed')
      await refetchPrices()
      triggerRefresh()
    } catch (e) {
      toast.error('Failed to remove')
    }
  }

  const rows = customPrices || []

  // §FULL-SCREEN-MODAL: Dedicated pricing page with full real estate.
  // Replaces the inline accordion that was too cluttered.
  if (!open || typeof document === 'undefined') return null
  return createPortal(
    <div className="fixed inset-0 z-[300] bg-background flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <button
          onClick={() => onOpenChange(false)}
          className="w-10 h-10 flex items-center justify-center rounded-xl hover:bg-muted shrink-0"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 flex-1">
          <div className="w-8 h-8 rounded-lg bg-violet-100 dark:bg-violet-900/40 flex items-center justify-center">
            <Tag className="w-4 h-4 text-violet-600" />
          </div>
          <div>
            <h2 className="text-sm font-semibold">Tiered / Custom Pricing</h2>
            <p className="text-[10px] text-muted-foreground">
              {rows.length > 0 ? `${rows.length} custom price${rows.length > 1 ? 's' : ''} set` : 'Per-buyer & per-group rates'}
            </p>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-3 max-w-2xl w-full mx-auto">
          {rows.length > 0 && (
            <div className="space-y-1.5">
              {rows.map((row) => (
                <div key={row.id} className="flex items-center justify-between gap-2 p-2 rounded-lg bg-card border border-border">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">
                      {row.buyer ? `👤 ${row.buyer.name}` : `👥 ${row.buyerGroupName}`}
                    </p>
                    {row.buyer?.phone && <p className="text-[10px] text-muted-foreground">{row.buyer.phone}</p>}
                    {/* §MULTI-PRICE: Show all price fields (compact badges)
                        §RETAIL-ISOLATION: Retail badges shown in blue, bulk in violet/amber */}
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      {row.customSalePrice != null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium tabular">
                          Sale ₹{row.customSalePrice.toFixed(0)}
                        </span>
                      )}
                      {row.customMrp != null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium tabular">
                          MRP ₹{row.customMrp.toFixed(0)}
                        </span>
                      )}
                      {row.customWholesalePrice != null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium tabular">
                          Ws ₹{row.customWholesalePrice.toFixed(0)}
                        </span>
                      )}
                      {/* §RETAIL-ISOLATION: Retail-specific badges (teal colored) */}
                      {row.customRetailSalePrice != null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium tabular">
                          R.Sale ₹{row.customRetailSalePrice.toFixed(0)}
                        </span>
                      )}
                      {row.customRetailMrp != null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-300 font-medium tabular">
                          R.MRP ₹{row.customRetailMrp.toFixed(0)}
                        </span>
                      )}
                      {/* §LEGACY: If only customPrice is set (old record), show it */}
                      {row.customSalePrice == null && row.customMrp == null && row.customWholesalePrice == null && row.customRetailSalePrice == null && row.customRetailMrp == null && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-medium tabular">
                          ₹{row.customPrice.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {/* §EDIT: Pen icon opens the FULL form (not inline) — allows
                        changing BOTH the entity (buyer/group) AND the prices. */}
                    <button
                      type="button"
                      onClick={() => openEditForm(row)}
                      className="w-6 h-6 rounded-md hover:bg-violet-50 dark:hover:bg-violet-950/30 flex items-center justify-center text-muted-foreground hover:text-violet-600"
                      aria-label="Edit custom price"
                    >
                      <FileEdit className="w-3.5 h-3.5" />
                    </button>
                    {/* §DELETE: Trash icon for removing custom price */}
                    <button
                      type="button"
                      onClick={() => handleDelete(row.id)}
                      className="w-6 h-6 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center text-muted-foreground hover:text-red-600"
                      aria-label="Remove custom price"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {showForm ? (
            <div className="p-3 rounded-lg bg-card border border-violet-200 dark:border-violet-900/50 space-y-2">
              {/* §FORM-HEADER: Dynamic title based on mode + edit state.
                  - Add mode: "Add Custom Price"
                  - Edit buyer: "Edit Buyer Price"
                  - Edit group: "Edit Group Price" */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-violet-600 flex items-center gap-1">
                  {isEditMode ? (
                    <>
                      <FileEdit className="w-3 h-3" />
                      {mode === 'buyer' ? 'Edit Buyer Price' : 'Edit Group Price'}
                    </>
                  ) : (
                    <>
                      <Plus className="w-3 h-3" /> Add Custom Price
                    </>
                  )}
                </p>
                <button type="button" onClick={closeForm} className="w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground" aria-label="Cancel">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* §TAB-SWITCHER: Only shown in ADD mode.
                  In EDIT mode, the entity type (Buyer vs Group) is LOCKED at
                  creation — switching tabs mid-edit causes UX confusion and
                  data mutation errors. Instead, show a read-only badge
                  indicating the locked entity type. */}
              {!isEditMode ? (
                <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
                  <button
                    type="button"
                    onClick={() => { setMode('buyer'); setGroupName(''); setSelectedMemberIds(new Set()) }}
                    className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${mode === 'buyer' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                  >👤 Specific Buyer</button>
                  <button
                    type="button"
                    onClick={() => { setMode('group'); setSelectedBuyerId('') }}
                    className={`flex-1 py-1.5 rounded-md text-[11px] font-medium ${mode === 'group' ? 'bg-card shadow-sm' : 'text-muted-foreground'}`}
                  >👥 Group / Tier</button>
                </div>
              ) : (
                /* §LOCKED-ENTITY-BADGE: Read-only indicator showing the locked
                   entity type in Edit mode. Not clickable — prevents the user
                   from switching a Buyer rule into a Group rule (or vice versa)
                   halfway through editing. */
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-900/50">
                  {mode === 'buyer' ? (
                    <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1">
                      <span>👤</span> Specific Buyer
                    </span>
                  ) : (
                    <span className="text-[11px] font-medium text-violet-700 dark:text-violet-300 flex items-center gap-1">
                      <span>👥</span> Group / Tier
                    </span>
                  )}
                  <span className="text-[9px] text-muted-foreground ml-auto">locked</span>
                </div>
              )}
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
                <div className="space-y-2">
                  <Input
                    value={groupName}
                    onChange={(e) => setGroupName(e.target.value)}
                    placeholder="e.g. Wholesalers, VIP Retailers"
                    className="h-10 text-sm"
                  />
                  {/* §GROUP-MEMBERS: Multi-select customer checklist */}
                  <div className="rounded-lg border border-border overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setShowMemberList(!showMemberList)}
                      className="w-full flex items-center justify-between p-2.5 text-left hover:bg-muted/50"
                    >
                      <span className="text-xs font-medium">
                        {selectedMemberIds.size > 0
                          ? `${selectedMemberIds.size} member${selectedMemberIds.size > 1 ? 's' : ''} selected`
                          : 'Select Customers +'}
                      </span>
                      <ChevronRight className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${showMemberList ? 'rotate-90' : ''}`} />
                    </button>
                    {showMemberList && (
                      <div className="max-h-40 overflow-y-auto scroll-area border-t border-border">
                        {(parties || []).map((p) => (
                          <label
                            key={p.id}
                            className="flex items-center gap-2 p-2 hover:bg-muted/30 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedMemberIds.has(p.id)}
                              onChange={(e) => {
                                setSelectedMemberIds((prev) => {
                                  const next = new Set(prev)
                                  if (e.target.checked) next.add(p.id)
                                  else next.delete(p.id)
                                  return next
                                })
                              }}
                              className="w-4 h-4 rounded accent-violet-600"
                            />
                            <span className="text-xs flex-1 truncate">{p.name}</span>
                            {p.phone && <span className="text-[10px] text-muted-foreground">{p.phone}</span>}
                          </label>
                        ))}
                        {(!parties || parties.length === 0) && (
                          <p className="text-[10px] text-muted-foreground text-center py-3">No customers found</p>
                        )}
                      </div>
                    )}
                  </div>
                  {selectedMemberIds.size > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {Array.from(selectedMemberIds).slice(0, 5).map((id) => {
                        const p = parties?.find((x) => x.id === id)
                        return (
                          <span key={id} className="text-[9px] px-1.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 flex items-center gap-1">
                            {p?.name || 'Unknown'}
                            <button
                              type="button"
                              onClick={() => setSelectedMemberIds((prev) => { const n = new Set(prev); n.delete(id); return n })}
                              className="hover:text-red-600"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </span>
                        )
                      })}
                      {selectedMemberIds.size > 5 && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                          +{selectedMemberIds.size - 5} more
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
              {/* §MULTI-PRICE: Custom pricing mirroring the main Product form.
                  §RETAIL-ISOLATION: Bulk (Full/Wholesale) and Retail (loose/kg) prices
                  are COMPLETELY SEPARATE. A custom price set for a BAG does NOT bleed
                  into the retail (kg) tab. The merchant can set either or both. */}
              <div className="space-y-1.5">
                {/* §BULK-PRICES: Full/Wholesale mode (per bag/box) */}
                <p className="text-[9px] font-semibold text-violet-600 dark:text-violet-400 uppercase tracking-wide">Full / Bulk (per bag/box)</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-16 text-[10px] text-muted-foreground shrink-0">Sale ₹</span>
                  <Input
                    value={salePrice}
                    onChange={(e) => setSalePrice(e.target.value)}
                    placeholder="0"
                    className="h-9 text-sm flex-1"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-16 text-[10px] text-muted-foreground shrink-0">MRP ₹</span>
                  <Input
                    value={mrpPrice}
                    onChange={(e) => setMrpPrice(e.target.value)}
                    placeholder="0 (optional)"
                    className="h-9 text-sm flex-1"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-16 text-[10px] text-muted-foreground shrink-0">Wholesale ₹</span>
                  <Input
                    value={wholesalePrice}
                    onChange={(e) => setWholesalePrice(e.target.value)}
                    placeholder="0 (optional)"
                    className="h-9 text-sm flex-1"
                    inputMode="numeric"
                  />
                </div>
                {/* §RETAIL-PRICES: Retail mode (per kg/pcs) — SEPARATE from bulk */}
                <p className="text-[9px] font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wide mt-2">Retail / Loose (per kg/pcs)</p>
                <div className="flex items-center gap-1.5">
                  <span className="w-16 text-[10px] text-muted-foreground shrink-0">Sale ₹</span>
                  <Input
                    value={retailSalePrice}
                    onChange={(e) => setRetailSalePrice(e.target.value)}
                    placeholder="0 (optional)"
                    className="h-9 text-sm flex-1"
                    inputMode="numeric"
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-16 text-[10px] text-muted-foreground shrink-0">MRP ₹</span>
                  <Input
                    value={retailMrpPrice}
                    onChange={(e) => setRetailMrpPrice(e.target.value)}
                    placeholder="0 (optional)"
                    className="h-9 text-sm flex-1"
                    inputMode="numeric"
                  />
                </div>
                <p className="text-[9px] text-muted-foreground/70 leading-tight">
                  Bulk and Retail prices are independent. If Retail is left blank, the retail tab uses the product's default price (not the bulk custom price).
                </p>
              </div>
              <Button type="button" size="sm" onClick={handleSubmit} className="w-full h-10">
                {isEditMode ? 'Update Prices' : 'Set Custom Prices'}
              </Button>
            </div>
          ) : (
            <Button type="button" variant="outline" size="sm" onClick={openAddForm} className="w-full h-9 text-xs">
              <Plus className="w-3.5 h-3.5 mr-1" /> Add Custom Price
            </Button>
          )}
          <p className="text-[9px] text-muted-foreground leading-tight">
            Hierarchy: Specific Buyer &gt; Group &gt; Default Wholesale. Buyers get a push notification when a price is set for them.
          </p>
      </div>
    </div>,
    document.body
  )
}
