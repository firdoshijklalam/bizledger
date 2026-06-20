'use client'

import { useAppStore } from '@/store/app-store'
import { formatCurrency } from '@/lib/utils'
import { motion } from 'framer-motion'
import { ScanLine, Camera, Upload, CheckCircle2, X, FileText } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useRef, useState } from 'react'

interface OcrResult {
  vendor?: string
  date?: string | null
  invoiceNumber?: string | null
  items: Array<{ name: string; qty: number; price: number; total: number }>
  subtotal?: number
  tax?: number
  grandTotal?: number
}

export function OcrScannerView() {
  const { business } = useAppStore()
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState<OcrResult | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)

  const currency = business?.currency || 'INR'

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please select an image file')
      return
    }
    setScanning(true)
    setResult(null)
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
          setResult(json.data)
          toast.success(`Scanned: ${json.data.items?.length || 0} items found`)
        } else {
          throw new Error('No data returned')
        }
      } catch (err) {
        toast.error('Scan failed: ' + String(err))
      } finally {
        setScanning(false)
      }
    }
    reader.readAsDataURL(file)
  }

  const reset = () => {
    setResult(null)
    setImagePreview(null)
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900">
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 flex items-center gap-1.5">
          <ScanLine className="w-4 h-4" /> OCR Bill Scanner
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Scan a supplier bill or receipt — AI extracts items, prices, and totals automatically.
        </p>
      </div>

      {!imagePreview && !result && (
        <>
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => cameraInputRef.current?.click()}
              className="p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/50 transition-colors flex flex-col items-center gap-2 min-h-[120px] justify-center"
            >
              <Camera className="w-8 h-8 text-primary" />
              <span className="text-sm font-medium">Take Photo</span>
              <span className="text-[10px] text-muted-foreground">Camera</span>
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-6 rounded-2xl border-2 border-dashed border-border hover:border-primary hover:bg-muted/50 transition-colors flex flex-col items-center gap-2 min-h-[120px] justify-center"
            >
              <Upload className="w-8 h-8 text-primary" />
              <span className="text-sm font-medium">Upload</span>
              <span className="text-[10px] text-muted-foreground">Gallery</span>
            </button>
          </div>
        </>
      )}

      {scanning && (
        <Card className="p-8 text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm font-medium">Scanning bill…</p>
          <p className="text-xs text-muted-foreground mt-1">AI is reading the image</p>
          {imagePreview && (
            <img src={imagePreview} alt="Bill" className="max-h-40 mx-auto mt-3 rounded-xl" />
          )}
        </Card>
      )}

      {result && !scanning && (
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
          {imagePreview && (
            <div className="relative">
              <img src={imagePreview} alt="Bill" className="w-full max-h-48 object-contain rounded-xl" />
              <button
                onClick={reset}
                className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/50 text-white flex items-center justify-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <h3 className="text-sm font-semibold">Scan Result</h3>
            </div>
            {result.vendor && (
              <div className="mb-3 p-3 rounded-xl bg-muted/50">
                <p className="text-[10px] text-muted-foreground uppercase">Vendor</p>
                <p className="text-sm font-semibold">{result.vendor}</p>
                {result.date && <p className="text-[11px] text-muted-foreground">Date: {result.date}</p>}
                {result.invoiceNumber && <p className="text-[11px] text-muted-foreground">Bill: {result.invoiceNumber}</p>}
              </div>
            )}
            {result.items && result.items.length > 0 ? (
              <div className="space-y-1">
                <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Items ({result.items.length})</p>
                {result.items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-0">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{item.name}</p>
                      <p className="text-[11px] text-muted-foreground">{item.qty} × {formatCurrency(item.price, currency)}</p>
                    </div>
                    <span className="font-semibold tabular">{formatCurrency(item.total, currency)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No items detected</p>
            )}
            {result.grandTotal != null && result.grandTotal > 0 && (
              <div className="mt-3 pt-3 border-t border-border flex justify-between">
                <span className="font-bold">Grand Total</span>
                <span className="font-bold tabular text-primary text-lg">{formatCurrency(result.grandTotal, currency)}</span>
              </div>
            )}
          </Card>

          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={reset} className="h-11">Scan Another</Button>
            <Button
              onClick={() => {
                toast.success('Items imported to draft (demo)')
                reset()
              }}
              className="h-11"
            >
              <FileText className="w-4 h-4 mr-1.5" /> Import Items
            </Button>
          </div>
        </motion.div>
      )}
    </div>
  )
}
