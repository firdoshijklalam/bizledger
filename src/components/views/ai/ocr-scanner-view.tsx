'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import { toNumber } from '@/lib/numeric'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ScanLine, Camera, Upload, CheckCircle2, X, FileText, Loader2,
  AlertTriangle, Edit3, Save, Store, Zap, ArrowLeft, RefreshCw,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useRef, useState, useMemo } from 'react'
import type { Party, Product } from '@/lib/types'

interface OcrResult {
  vendor?: string
  date?: string | null
  invoiceNumber?: string | null
  items: Array<{ name: string; qty: number; price: number; total: number }>
  subtotal?: number
  tax?: number
  cgst?: number
  sgst?: number
  grandTotal?: number
}

// PRD Part 25 §1: Scanning status messages
const SCAN_MESSAGES = [
  'AI is reading invoice items...',
  'Extracting GST values...',
  'Calculating Grand Total...',
  'Matching supplier profile...',
  'Verifying tax breakdown...',
]

export function OcrScannerView() {
  const { business, triggerRefresh } = useAppStore()
  const { data: suppliers } = useFetch<Party[]>('/api/parties?type=supplier', [])
  const { data: allProducts } = useFetch<Product[]>('/api/products', [])

  const [scanning, setScanning] = useState(false)
  const [scanMessageIdx, setScanMessageIdx] = useState(0)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [phase, setPhase] = useState<'upload' | 'scanning' | 'verify'>('upload')
  const [syncing, setSyncing] = useState(false)

  // PRD Part 25 §2: Verification screen editable state
  const [editVendor, setEditVendor] = useState('')
  const [editSupplierId, setEditSupplierId] = useState('')
  const [editDate, setEditDate] = useState('')
  const [editItems, setEditItems] = useState<Array<{ name: string; qty: number; price: number; total: number }>>([])
  const [editCgst, setEditCgst] = useState('0')
  const [editSgst, setEditSgst] = useState('0')
  const [editGrandTotal, setEditGrandTotal] = useState('0')

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const currency = business?.currency || 'INR'

  // PRD Part 25 §1: Animated scanning status messages
  const scanTimerRef = useRef<NodeJS.Timeout | null>(null)
  const startScanMessages = () => {
    setScanMessageIdx(0)
    scanTimerRef.current = setInterval(() => {
      setScanMessageIdx((prev) => (prev + 1) % SCAN_MESSAGES.length)
    }, 1200)
  }
  const stopScanMessages = () => {
    if (scanTimerRef.current) {
      clearInterval(scanTimerRef.current)
      scanTimerRef.current = null
    }
  }

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    setPhase('scanning')
    setScanning(true)
    setResult(null)
    startScanMessages()

    const reader = new FileReader()
    reader.onload = async (e) => {
      const base64 = e.target?.result as string
      setImagePreview(base64)
      try {
        const res = await fetch('/api/ocr', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64 }),
        })
        if (!res.ok) throw new Error('OCR failed')
        const json = await res.json()
        if (json.success && json.data) {
          const data = json.data as OcrResult
          setResult(data)
          // PRD Part 25 §2: Pre-fill verification fields
          setEditVendor(data.vendor || '')
          setEditDate(data.date || '')
          setEditItems(data.items || [])
          setEditCgst(String(data.cgst || (data.tax ?? 0) ? ((data.tax ?? 0) / 2) : 0))
          setEditSgst(String(data.cgst || (data.tax ?? 0) ? ((data.tax ?? 0) / 2) : 0))
          setEditGrandTotal(String(data.grandTotal || 0))
          // Try to match supplier
          const matchedSupplier = suppliers?.find((s) =>
            s.name.toLowerCase().includes((data.vendor || '').toLowerCase()) ||
            (data.vendor || '').toLowerCase().includes(s.name.toLowerCase())
          )
          if (matchedSupplier) setEditSupplierId(matchedSupplier.id)
          toast.success(`${data.items?.length || 0} items extracted`)
          setPhase('verify')
        } else {
          throw new Error('No data returned')
        }
      } catch (err) {
        toast.error('Scan failed: ' + String(err))
        setPhase('upload')
      } finally {
        setScanning(false)
        stopScanMessages()
      }
    }
    reader.readAsDataURL(file)
  }

  const reset = () => {
    setResult(null)
    setImagePreview(null)
    setPhase('upload')
    setEditItems([])
    setEditVendor('')
    setEditSupplierId('')
    setEditDate('')
    setEditCgst('0')
    setEditSgst('0')
    setEditGrandTotal('0')
  }

  // PRD Part 25 §2: Check if item is new (not in inventory)
  const isProductNew = (name: string) => {
    if (!allProducts) return true
    return !allProducts.some((p) =>
      p.name.toLowerCase().includes(name.toLowerCase()) ||
      name.toLowerCase().includes(p.name.toLowerCase())
    )
  }

  // Update item field
  const updateItem = (idx: number, field: 'name' | 'qty' | 'price' | 'total', value: string | number) => {
    setEditItems((prev) => {
      const items = [...prev]
      const numVal = typeof value === 'string' ? Number(value) || 0 : value
      items[idx] = { ...items[idx], [field]: field === 'name' ? value : numVal }
      // Auto-recalculate total if qty or price changes
      if (field === 'qty' || field === 'price') {
        items[idx].total = items[idx].qty * items[idx].price
      }
      return items
    })
  }

  // PRD Part 25 §3.2: Confirm & Sync — Inventory + GST + Khata
  const handleConfirmSync = async () => {
    if (!editItems.length) {
      toast.error('No items to sync')
      return
    }
    setSyncing(true)
    try {
      // 1. Inventory Sync: Update stock for existing products, create new ones
      for (const item of editItems) {
        const existing = allProducts?.find((p) =>
          p.name.toLowerCase().includes(item.name.toLowerCase()) ||
          item.name.toLowerCase().includes(p.name.toLowerCase())
        )
        if (existing) {
          // Restock existing product
          await fetch(`/api/products/${existing.id}/restock`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ quantity: item.qty }),
          })
        } else {
          // Create new product
          await apiPost('/api/products', {
            name: item.name,
            purchasePrice: item.price,
            salePrice: item.price * 1.2, // 20% markup default
            stock: item.qty,
            unit: 'pcs',
            supplierId: editSupplierId || null,
          })
        }
      }

      // 2. Khata Integration: Create transaction for supplier
      if (editSupplierId) {
        await apiPost('/api/transactions', {
          partyId: editSupplierId,
          type: 'debit', // We owe the supplier money
          amount: Number(editGrandTotal) || 0,
          description: `Bill scanned: ${editVendor || 'Supplier'} - ${editItems.length} items`,
          category: 'Purchase',
        })
      }

      // 3. GST Engine: ITC is auto-updated when transaction is created (the transaction type=debit feeds into ITC calc in reports)

      toast.success('✅ Synced: Inventory + GST + Khata updated')
      triggerRefresh()
      reset()
    } catch (e) {
      toast.error('Sync failed: ' + String(e))
    } finally {
      setSyncing(false)
    }
  }

  const calculatedTotal = useMemo(() => {
    // §FRONTEND-NUMERIC-FIX: OCR API may return item.total as a string;
    // coerce via toNumber() to prevent string concatenation (0 + "55" = "055").
    const itemsTotal = editItems.reduce((s, it) => s + toNumber(it.total), 0)
    const tax = Number(editCgst) + Number(editSgst)
    return itemsTotal + tax
  }, [editItems, editCgst, editSgst])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          <ScanLine className="w-4 h-4" /> OCR Bill Scanner
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Scan a supplier bill — AI extracts items, prices, GST & totals. Review, edit & sync to Inventory + Khata.
        </p>
      </div>

      {/* Phase 1: Upload */}
      {phase === 'upload' && (
        <>
          <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => cameraInputRef.current?.click()} className="p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/50 transition-colors flex flex-col items-center gap-2 min-h-[120px] justify-center">
              <Camera className="w-8 h-8 text-primary" />
              <span className="text-sm font-medium">Take Photo</span>
              <span className="text-[10px] text-muted-foreground">Camera</span>
            </button>
            <button onClick={() => fileInputRef.current?.click()} className="p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/50 transition-colors flex flex-col items-center gap-2 min-h-[120px] justify-center">
              <Upload className="w-8 h-8 text-primary" />
              <span className="text-sm font-medium">Upload</span>
              <span className="text-[10px] text-muted-foreground">Gallery</span>
            </button>
          </div>
        </>
      )}

      {/* PRD Part 25 §1: Scanning Loading UI — Animated laser effect + status messages */}
      <AnimatePresence>
        {phase === 'scanning' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-sm">
              {/* Image with laser scan effect */}
              {imagePreview && (
                <div className="relative overflow-hidden rounded-2xl mb-4">
                  <img src={imagePreview} alt="Bill" className="w-full max-h-60 object-contain opacity-70" />
                  {/* Animated laser line */}
                  <motion.div
                    className="absolute left-0 right-0 h-1 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-lg shadow-emerald-400/50"
                    animate={{ top: ['0%', '100%', '0%'] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  />
                  {/* Scan overlay grid */}
                  <div className="absolute inset-0 bg-gradient-to-b from-emerald-500/10 via-transparent to-emerald-500/10" />
                </div>
              )}
              {/* Status message */}
              <div className="text-center">
                <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <AnimatePresence mode="wait">
                  <motion.p
                    key={scanMessageIdx}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="text-sm font-medium text-emerald-400"
                  >
                    {SCAN_MESSAGES[scanMessageIdx]}
                  </motion.p>
                </AnimatePresence>
                <p className="text-[10px] text-muted-foreground mt-1">GLM 5.2 Vision Core is processing…</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRD Part 25 §2: Verification Screen */}
      {phase === 'verify' && result && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {/* Image preview */}
          {imagePreview && (
            <div className="relative">
              <img src={imagePreview} alt="Bill" className="w-full max-h-40 object-contain rounded-xl" />
              <button onClick={reset} className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center" aria-label="Start over">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* §2.1: Supplier Metadata */}
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Store className="w-4 h-4 text-purple-600" />
              <h3 className="text-sm font-semibold">সাপ্লায়ার তথ্য (Supplier Profile)</h3>
            </div>
            <div className="space-y-2">
              <div>
                <Label className="text-[10px] text-muted-foreground">বিল থেকে পাওয়া নাম (Vendor from bill)</Label>
                <Input value={editVendor} onChange={(e) => setEditVendor(e.target.value)} className="h-9 text-sm" placeholder="Auto-detected vendor name" />
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">বিটুবি নেটওয়ার্ক থেকে সিলেক্ট করুন (Match supplier)</Label>
                <select value={editSupplierId} onChange={(e) => setEditSupplierId(e.target.value)} className="w-full h-9 rounded-xl bg-muted px-3 text-sm border-0 outline-none">
                  <option value="">— নতুন সাপ্লায়ার (New) —</option>
                  {(suppliers || []).map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">বিলের তারিখ (Invoice Date)</Label>
                <Input value={editDate} onChange={(e) => setEditDate(e.target.value)} className="h-9 text-sm" placeholder="DD/MM/YYYY" />
              </div>
            </div>
          </Card>

          {/* §2.2: Items Parsing Grid — Editable */}
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold flex items-center gap-1.5">
                <FileText className="w-4 h-4 text-amber-600" /> আইটেম তালিকা ({editItems.length})
              </h3>
              <Edit3 className="w-3.5 h-3.5 text-muted-foreground" />
            </div>
            {/* Table header */}
            <div className="grid grid-cols-12 gap-1 text-[9px] text-muted-foreground uppercase mb-1 px-1">
              <span className="col-span-5">পণ্যের নাম</span>
              <span className="col-span-2 text-center">Qty</span>
              <span className="col-span-2 text-center">দাম</span>
              <span className="col-span-3 text-right">মোট</span>
            </div>
            <div className="space-y-1">
              {editItems.map((item, i) => {
                const isNew = isProductNew(item.name)
                return (
                  <div key={i} className="space-y-0.5">
                    <div className="grid grid-cols-12 gap-1 items-center p-1.5 rounded-lg bg-muted/30">
                      <Input
                        value={item.name}
                        onChange={(e) => updateItem(i, 'name', e.target.value)}
                        className="col-span-5 h-7 text-[11px] bg-card border-0 px-1.5"
                      />
                      <Input
                        value={item.qty}
                        onChange={(e) => updateItem(i, 'qty', e.target.value)}
                        className="col-span-2 h-7 text-[11px] text-center bg-card border-0 px-1"
                        inputMode="decimal"
                      />
                      <Input
                        value={item.price}
                        onChange={(e) => updateItem(i, 'price', e.target.value)}
                        className="col-span-2 h-7 text-[11px] text-center bg-card border-0 px-1"
                        inputMode="numeric"
                      />
                      <span className="col-span-3 text-right text-[11px] font-semibold tabular pr-1">{formatCurrency(item.total, currency)}</span>
                    </div>
                    {/* New product alert */}
                    {isNew && (
                      <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                        <AlertTriangle className="w-2.5 h-2.5 text-amber-600 shrink-0" />
                        <p className="text-[9px] text-amber-700 dark:text-amber-300">New product detected! Will be auto-added to inventory on sync.</p>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>

          {/* §2.3: Taxation & Grand Total */}
          <Card className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
              <Zap className="w-4 h-4 text-amber-600" /> ট্যাক্স ও মোট (GST & Total)
            </h3>
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-[10px] text-muted-foreground">CGST</Label>
                  <Input value={editCgst} onChange={(e) => setEditCgst(e.target.value)} className="h-8 text-sm tabular" inputMode="numeric" />
                </div>
                <div>
                  <Label className="text-[10px] text-muted-foreground">SGST</Label>
                  <Input value={editSgst} onChange={(e) => setEditSgst(e.target.value)} className="h-8 text-sm tabular" inputMode="numeric" />
                </div>
              </div>
              <div>
                <Label className="text-[10px] text-muted-foreground">Grand Total (বিলের মোট)</Label>
                <Input value={editGrandTotal} onChange={(e) => setEditGrandTotal(e.target.value)} className="h-10 text-lg font-bold tabular text-primary" inputMode="numeric" />
              </div>
              {/* Calculated vs scanned reconciliation */}
              <div className="p-2 rounded-lg bg-muted/30 flex justify-between text-[11px]">
                <span className="text-muted-foreground">AI ক্যালকুলেটেড মোট:</span>
                <span className={`font-semibold tabular ${Math.abs(calculatedTotal - Number(editGrandTotal)) < 1 ? 'text-emerald-600' : 'text-amber-600'}`}>
                  {formatCurrency(calculatedTotal, currency)}
                  {Math.abs(calculatedTotal - Number(editGrandTotal)) >= 1 && ' ⚠️'}
                </span>
              </div>
            </div>
          </Card>

          {/* §3.2: Confirm & Sync Button */}
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={reset} className="h-11" disabled={syncing}>
              <RefreshCw className="w-4 h-4 mr-1.5" /> Scan Again
            </Button>
            <Button
              onClick={handleConfirmSync}
              disabled={syncing}
              className="h-11 bg-emerald-600 hover:bg-emerald-700"
            >
              {syncing ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Syncing…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4 mr-1.5" /> Confirm & Sync</>
              )}
            </Button>
          </div>

          {/* Sync info */}
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <p className="text-[10px] text-emerald-700 dark:text-emerald-300 font-medium mb-1">Confirm & Sync করলে যা হবে:</p>
            <div className="space-y-0.5">
              <p className="text-[10px] text-muted-foreground">📦 <strong>Inventory:</strong> স্টক আপডেট হবে (নতুন পণ্য অটো-ক্রিয়েট হবে)</p>
              <p className="text-[10px] text-muted-foreground">🧾 <strong>GST Engine:</strong> ITC (Input Tax Credit)-তে যুক্ত হবে</p>
              <p className="text-[10px] text-muted-foreground">📒 <strong>Khata:</strong> সাপ্লায়ার লেজারে ট্রানজেকশন পোস্ট হবে</p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  )
}
