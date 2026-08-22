'use client'

import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, FileCheck, AlertTriangle, CheckCircle, Loader2, Database, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { useGateTrigger } from '@/store/biometric-gate-store'

type Step = 'idle' | 'reading' | 'validating' | 'preview' | 'importing' | 'done' | 'error'

interface PreviewData {
  ok: boolean
  counts: {
    parties: number
    products: number
    invoices: number
    invoiceItems: number
    transactions: number
    categories: number
    customPrices: number
    staff: number
    partyNotes: number
    stockMovements: number
  }
  conflicts: {
    newRecords: number
    existingRecords: number
    byEntity: Record<string, { new: number; existing: number }>
  }
  business: { name: string; id: string }
}

interface ImportResult {
  ok: boolean
  result?: {
    imported: Record<string, number>
    skipped: Record<string, number>
    failed: { errors: string[] }
  }
  error?: string
}

/**
 * §IMPORT-MODAL: Full Import/Restore flow.
 *
 * Steps:
 * 1. Upload — user selects a .json backup file
 * 2. Validate — POST { step: 'validate' } to /api/data-import
 * 3. Preview — POST { step: 'preview' } to /api/data-import (shows new/existing counts)
 * 4. Choose strategy — merge (default) / skip-existing / replace (destructive)
 * 5. Confirm — biometric gate required (data_export gate type)
 * 6. Import — POST { step: 'import' } inside the gate callback
 * 7. Result — show imported/skipped/failed counts
 *
 * §SECURITY:
 * - Only OWNER role can import (enforced server-side via requireRole(['OWNER'])).
 * - Biometric gate (data_export) required before the actual import.
 * - businessId from the backup file is NEVER trusted — server rewrites all
 *   records with the current tenant's businessId.
 */
export function ImportBackupModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { business } = useAppStore()
  const triggerGate = useGateTrigger()
  const [step, setStep] = useState<Step>('idle')
  const [file, setFile] = useState<File | null>(null)
  const [parsedData, setParsedData] = useState<any>(null)
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [strategy, setStrategy] = useState<'merge' | 'skip-existing' | 'replace'>('merge')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = () => {
    setStep('idle')
    setFile(null)
    setParsedData(null)
    setPreview(null)
    setError(null)
    setResult(null)
    setStrategy('merge')
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose()
  }

  // §STEP-1: Read file as text
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.endsWith('.json')) {
      toast.error('Please select a .json backup file')
      return
    }
    // §MAX-FILE-SIZE: 50MB (matches server MAX_BODY_SIZE)
    if (f.size > 50 * 1024 * 1024) {
      toast.error('File too large (max 50MB)')
      return
    }
    setFile(f)
    setStep('reading')
    setError(null)
    try {
      const text = await f.text()
      const data = JSON.parse(text)
      setParsedData(data)
      setStep('validating')
      // §STEP-2: Validate
      const validateRes = await fetch('/api/data-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'validate', data }),
      })
      const validateJson = await validateRes.json()
      if (!validateRes.ok || !validateJson.ok) {
        setError(validateJson.error || 'Validation failed')
        setStep('error')
        return
      }
      // §STEP-3: Preview
      const previewRes = await fetch('/api/data-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'preview', data }),
      })
      const previewJson = await previewRes.json()
      if (!previewRes.ok || !previewJson.ok) {
        setError(previewJson.error || 'Preview failed')
        setStep('error')
        return
      }
      setPreview(previewJson)
      setStep('preview')
    } catch (e: any) {
      setError(e.message || 'Failed to read file')
      setStep('error')
    }
  }

  // §STEP-6: Import (with biometric gate)
  const handleImport = () => {
    if (!parsedData || !preview) return
    setStep('importing')
    // §BIO-GATE: Require biometric verification before destructive import
    triggerGate(
      'data_export',
      `Import ${preview.conflicts.newRecords + preview.conflicts.existingRecords} records into ${business?.name || 'this business'}`,
      async () => {
        try {
          const res = await fetch('/api/data-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ step: 'import', data: parsedData, options: { strategy, updateExisting: strategy === 'merge' } }),
          })
          const json = await res.json()
          if (!res.ok || !json.ok) {
            setError(json.error || 'Import failed')
            setStep('error')
            return
          }
          setResult(json)
          setStep('done')
          toast.success('Import completed successfully')
        } catch (e: any) {
          setError(e.message || 'Import failed')
          setStep('error')
        }
      }
    )
  }

  const totalRecords = preview
    ? Object.values(preview.counts).reduce((s, c) => s + c, 0)
    : 0

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card rounded-2xl shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Database className="w-5 h-5" /> Import Backup
              </h2>
              <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {step === 'idle' && (
                <div className="text-center py-6">
                  <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm font-medium mb-1">Select a backup file</p>
                  <p className="text-xs text-muted-foreground mb-4">Choose a BizLedger JSON backup to restore</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json,application/json"
                    onChange={handleFileSelect}
                    className="hidden"
                  />
                  <Button onClick={() => fileInputRef.current?.click()} className="h-11">
                    <Upload className="w-4 h-4 mr-2" /> Choose File
                  </Button>
                </div>
              )}

              {(step === 'reading' || step === 'validating') && (
                <div className="text-center py-6">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">
                    {step === 'reading' ? 'Reading file…' : 'Validating backup…'}
                  </p>
                </div>
              )}

              {step === 'preview' && preview && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                    Backup Valid
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Business: <span className="font-medium text-foreground">{preview.business.name}</span>
                  </div>

                  {/* Record counts */}
                  <Card className="p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Records in Backup</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <Count label="Parties" value={preview.counts.parties} />
                      <Count label="Products" value={preview.counts.products} />
                      <Count label="Invoices" value={preview.counts.invoices} />
                      <Count label="Invoice Items" value={preview.counts.invoiceItems} />
                      <Count label="Transactions" value={preview.counts.transactions} />
                      <Count label="Categories" value={preview.counts.categories} />
                      <Count label="Custom Prices" value={preview.counts.customPrices} />
                      <Count label="Staff" value={preview.counts.staff} />
                      <Count label="Party Notes" value={preview.counts.partyNotes} />
                      <Count label="Stock Movements" value={preview.counts.stockMovements} />
                    </div>
                    <div className="pt-2 border-t border-border flex justify-between text-xs">
                      <span className="text-muted-foreground">Total:</span>
                      <span className="font-semibold">{totalRecords}</span>
                    </div>
                  </Card>

                  {/* Conflict summary */}
                  <Card className="p-3 space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Import Preview</p>
                    <div className="flex justify-between text-xs">
                      <span className="text-emerald-600">New records:</span>
                      <span className="font-semibold text-emerald-600">{preview.conflicts.newRecords}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-amber-600">Existing (will skip):</span>
                      <span className="font-semibold text-amber-600">{preview.conflicts.existingRecords}</span>
                    </div>
                  </Card>

                  {/* Strategy selection */}
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-muted-foreground uppercase">Import Strategy</p>
                    <label className="flex items-start gap-2 p-2 rounded-lg border border-border cursor-pointer hover:bg-muted/50">
                      <input
                        type="radio"
                        name="strategy"
                        checked={strategy === 'merge'}
                        onChange={() => setStrategy('merge')}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-medium">Merge (Recommended)</p>
                        <p className="text-[11px] text-muted-foreground">Add new records, skip existing</p>
                      </div>
                    </label>
                    <label className="flex items-start gap-2 p-2 rounded-lg border border-destructive/30 cursor-pointer hover:bg-destructive/5">
                      <input
                        type="radio"
                        name="strategy"
                        checked={strategy === 'replace'}
                        onChange={() => setStrategy('replace')}
                        className="mt-0.5"
                      />
                      <div>
                        <p className="text-xs font-medium text-destructive">Replace All (Dangerous)</p>
                        <p className="text-[11px] text-muted-foreground">Delete ALL current data, then import. Cannot be undone.</p>
                      </div>
                    </label>
                  </div>

                  <Button onClick={handleImport} className="w-full h-11" disabled={totalRecords === 0}>
                    <ArrowRight className="w-4 h-4 mr-2" />
                    {strategy === 'replace' ? 'Replace All Data' : 'Import Backup'}
                  </Button>
                  {strategy === 'replace' && (
                    <p className="text-[11px] text-destructive text-center">
                      ⚠ This will delete all your current business data before importing.
                    </p>
                  )}
                </div>
              )}

              {step === 'importing' && (
                <div className="text-center py-6">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">Importing data…</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">This may take a moment for large backups.</p>
                </div>
              )}

              {step === 'done' && result?.result && (
                <div className="space-y-3">
                  <div className="text-center py-2">
                    <CheckCircle className="w-12 h-12 mx-auto text-emerald-600 mb-2" />
                    <p className="text-sm font-medium">Import Complete</p>
                  </div>
                  <Card className="p-3 space-y-1.5">
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Imported:</span>
                      <span className="font-semibold text-emerald-600">
                        {Object.values(result.result.imported).reduce((s, c) => s + c, 0)}
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Skipped (existing):</span>
                      <span className="font-semibold text-amber-600">
                        {Object.values(result.result.skipped).reduce((s, c) => s + c, 0)}
                      </span>
                    </div>
                    {result.result.failed.errors.length > 0 && (
                      <div className="flex justify-between text-xs">
                        <span className="text-muted-foreground">Failed:</span>
                        <span className="font-semibold text-destructive">{result.result.failed.errors.length}</span>
                      </div>
                    )}
                  </Card>
                  <Button onClick={handleClose} className="w-full h-11">Done</Button>
                </div>
              )}

              {step === 'error' && error && (
                <div className="space-y-3">
                  <div className="text-center py-2">
                    <AlertTriangle className="w-12 h-12 mx-auto text-destructive mb-2" />
                    <p className="text-sm font-medium">Import Failed</p>
                  </div>
                  <Card className="p-3 border-destructive/30 bg-destructive/5">
                    <p className="text-xs text-destructive">{error}</p>
                  </Card>
                  <Button onClick={reset} variant="outline" className="w-full h-11">Try Again</Button>
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium tabular">{value.toLocaleString()}</span>
    </div>
  )
}
