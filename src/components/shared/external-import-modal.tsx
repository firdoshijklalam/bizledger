'use client'

import { useState, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Upload, FileCheck, AlertTriangle, CheckCircle, Loader2, Database, ArrowRight, ArrowLeft, Download, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'
import { useGateTrigger } from '@/store/biometric-gate-store'
import {
  IMPORTABLE_FIELDS,
  autoDetectColumns,
  parseFile,
  type ImportEntityType,
  type ColumnMappingSuggestion,
} from '@/lib/external-import'

type Step = 'select-type' | 'upload' | 'mapping' | 'preview' | 'importing' | 'done' | 'error'

interface PreviewData {
  ok: boolean
  counts: {
    total: number
    valid: number
    warnings: number
    errors: number
    new: number
    exactMatches: number
    possibleMatches: number
  }
  sampleRows: Array<{
    rowNumber: number
    name: string
    phone: string
    gstin: string
    status: string
    duplicate: string
    duplicateMatch?: string
    errors: string[]
    warnings: string[]
  }>
}

interface ImportResult {
  ok: boolean
  result?: {
    imported: number
    skipped: number
    errors: Array<{ row: number; name: string; problem: string }>
  }
  error?: string
}

const ENTITY_LABELS: Record<ImportEntityType, { title: string; desc: string }> = {
  customers: { title: 'Customers / Parties', desc: 'Import customer names, phones, GSTIN, opening balances' },
  suppliers: { title: 'Suppliers', desc: 'Import supplier names, phones, GSTIN, opening payables' },
  products: { title: 'Products / Inventory', desc: 'Import product names, SKUs, prices, stock' },
  'opening-balances': { title: 'Opening Balances', desc: 'Import customer receivables + supplier payables' },
}

/**
 * §EXTERNAL-IMPORT-MODAL: Full wizard for importing data from external software.
 *
 * Flow:
 * 1. Select entity type (Customers/Suppliers/Products/Opening Balances)
 * 2. Upload file (CSV/JSON)
 * 3. Auto-detect + review column mapping
 * 4. Preview (validation + duplicate detection)
 * 5. Import (biometric gate → atomic import)
 * 6. Result (imported/skipped/errors + downloadable error CSV)
 */
export function ExternalImportModal({ open, onClose, initialType }: { open: boolean; onClose: () => void; initialType?: ImportEntityType }) {
  const { business } = useAppStore()
  const triggerGate = useGateTrigger()
  const [step, setStep] = useState<Step>('select-type')
  const [entityType, setEntityType] = useState<ImportEntityType | null>(initialType || null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [mapping, setMapping] = useState<Record<string, string>>({}) // sourceHeader → bizledgerField
  const [suggestions, setSuggestions] = useState<ColumnMappingSuggestion[]>([])
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const reset = useCallback(() => {
    setStep(initialType ? 'upload' : 'select-type')
    setEntityType(initialType || null)
    setFileName(null)
    setHeaders([])
    setRows([])
    setMapping({})
    setSuggestions([])
    setPreview(null)
    setResult(null)
    setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }, [initialType])

  const handleClose = () => {
    reset()
    onClose()
  }

  // §STEP-1: Select entity type
  const handleSelectType = (type: ImportEntityType) => {
    setEntityType(type)
    setStep('upload')
  }

  // §STEP-2: Upload + parse file (CSV/XLSX/JSON)
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return

    const validExtensions = ['.csv', '.xlsx', '.xls', '.json']
    const ext = f.name.substring(f.name.lastIndexOf('.')).toLowerCase()
    if (!validExtensions.includes(ext)) {
      toast.error('Please select a .csv, .xlsx, or .json file')
      return
    }

    if (f.size > 10 * 1024 * 1024) {
      toast.error('File too large (max 10MB)')
      return
    }

    setFileName(f.name)
    setError(null)

    try {
      // §XLSX-REQUIRES-ARRAYBUFFER: XLSX files must be read as ArrayBuffer
      // (SheetJS needs binary data, not text). CSV/JSON can be read as text.
      let content: string | ArrayBuffer
      if (ext === '.xlsx' || ext === '.xls') {
        content = await f.arrayBuffer()
      } else {
        content = await f.text()
      }

      const parsed = parseFile(f.name, content)

      if (parsed.rows.length === 0) {
        setError('No data rows found in file')
        setStep('error')
        return
      }

      setHeaders(parsed.headers)
      setRows(parsed.rows)

      // §AUTO-DETECT: Suggest column mapping
      if (entityType) {
        const detected = autoDetectColumns(parsed.headers, entityType)
        setSuggestions(detected)
        const initialMapping: Record<string, string> = {}
        detected.forEach((s) => {
          initialMapping[s.sourceHeader] = s.suggestedField || '__ignore__'
        })
        setMapping(initialMapping)
        setStep('mapping')
      }
    } catch (e: any) {
      setError(e.message || 'Failed to parse file')
      setStep('error')
    }
  }

  // §STEP-4: Preview (validate + detect duplicates)
  const handlePreview = async () => {
    if (!entityType) return
    setStep('preview')
    setError(null)

    try {
      const res = await fetch('/api/external-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'preview', entityType, rows, mapping }),
      })
      const json = await res.json()
      if (!res.ok || !json.ok) {
        setError(json.error || 'Preview failed')
        setStep('error')
        return
      }
      setPreview(json)
    } catch (e: any) {
      setError(e.message || 'Preview failed')
      setStep('error')
    }
  }

  // §STEP-5: Import (with biometric gate)
  const handleImport = () => {
    if (!entityType) return
    setStep('importing')
    triggerGate(
      'data_export',
      `Import ${rows.length} ${entityType} into ${business?.name || 'this business'}`,
      async () => {
        try {
          const res = await fetch('/api/external-import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              step: 'import',
              entityType,
              rows,
              mapping,
              strategy: 'add-new',
              sourceFileName: fileName || 'unknown',
              sourceFormat: fileName?.endsWith('.xlsx') ? 'xlsx' : fileName?.endsWith('.json') ? 'json' : 'csv',
            }),
          })
          const json = await res.json()
          if (!res.ok || !json.ok) {
            setError(json.error || 'Import failed')
            setStep('error')
            return
          }
          setResult(json)
          setStep('done')
          toast.success('Import completed')
        } catch (e: any) {
          setError(e.message || 'Import failed')
          setStep('error')
        }
      }
    )
  }

  // §DOWNLOAD-ERROR-REPORT: Generate a CSV of error rows
  const downloadErrorReport = () => {
    if (!result?.result?.errors?.length) return
    const csv = '\uFEFF' + ['Row,Name,Problem'].concat(
      result.result.errors.map((e) => `${e.row},${e.name.replace(/,/g, ';')},${e.problem.replace(/,/g, ';')}`)
    ).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import_errors_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const fields = entityType ? IMPORTABLE_FIELDS[entityType] : []

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
            className="bg-card rounded-2xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Database className="w-5 h-5" /> Import Data
              </h2>
              <button onClick={handleClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {step === 'select-type' && (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">What would you like to import?</p>
                  {(Object.keys(ENTITY_LABELS) as ImportEntityType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => handleSelectType(type)}
                      className="w-full text-left p-3 rounded-xl border border-border hover:bg-muted/50 transition-colors"
                    >
                      <p className="text-sm font-medium">{ENTITY_LABELS[type].title}</p>
                      <p className="text-[11px] text-muted-foreground">{ENTITY_LABELS[type].desc}</p>
                    </button>
                  ))}
                </div>
              )}

              {step === 'upload' && entityType && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <span className="text-muted-foreground">Importing:</span>
                    <span>{ENTITY_LABELS[entityType].title}</span>
                  </div>
                  <div className="text-center py-6">
                    <Upload className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                    <p className="text-sm font-medium mb-1">Select a file to import</p>
                    <p className="text-xs text-muted-foreground mb-4">Supports .csv, .xlsx, and .json (max 10MB, 10,000 rows)</p>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".csv,.xlsx,.xls,.json,application/json,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                      onChange={handleFileSelect}
                      className="hidden"
                    />
                    <Button onClick={() => fileInputRef.current?.click()} className="h-11">
                      <Upload className="w-4 h-4 mr-2" /> Choose File
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Button variant="ghost" size="sm" onClick={() => window.open(`/api/import-templates?type=${entityType}`, '_blank')}>
                      <Download className="w-3.5 h-3.5 mr-1" /> Download Template
                    </Button>
                  </div>
                </div>
              )}

              {step === 'mapping' && entityType && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">Column Mapping</p>
                    <p className="text-xs text-muted-foreground">{fileName} · {rows.length} rows</p>
                  </div>
                  <p className="text-xs text-muted-foreground">Review the auto-detected mapping. Required fields marked with *.</p>

                  <div className="space-y-2 max-h-[40vh] overflow-y-auto scroll-area">
                    {suggestions.map((s) => {
                      const fieldDef = fields.find((f) => f.key === s.suggestedField)
                      const isIgnored = mapping[s.sourceHeader] === '__ignore__'
                      return (
                        <div key={s.sourceHeader} className="flex items-center gap-2 p-2 rounded-lg border border-border">
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium truncate">{s.sourceHeader}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {s.suggestedField ? `${s.reason} (${s.confidence}%)` : 'No auto-match'}
                            </p>
                          </div>
                          <ArrowRight className="w-3 h-3 text-muted-foreground shrink-0" />
                          <select
                            value={mapping[s.sourceHeader] || '__ignore__'}
                            onChange={(e) => setMapping({ ...mapping, [s.sourceHeader]: e.target.value })}
                            className="text-xs border border-border rounded px-2 py-1 bg-background max-w-[40%]"
                          >
                            <option value="__ignore__">Ignore</option>
                            {fields.map((f) => (
                              <option key={f.key} value={f.key}>
                                {f.label}{f.required ? ' *' : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )
                    })}
                  </div>

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep('upload')} className="flex-1 h-10">
                      <ArrowLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button onClick={handlePreview} className="flex-1 h-10">
                      Preview <ArrowRight className="w-4 h-4 ml-1" />
                    </Button>
                  </div>
                </div>
              )}

              {step === 'preview' && preview && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <FileCheck className="w-4 h-4 text-emerald-600" />
                    Preview
                  </div>

                  {/* Counts */}
                  <Card className="p-3 space-y-1.5">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <CountRow label="Total rows" value={preview.counts.total} />
                      <CountRow label="Valid" value={preview.counts.valid} color="emerald" />
                      <CountRow label="Warnings" value={preview.counts.warnings} color="amber" />
                      <CountRow label="Errors" value={preview.counts.errors} color="red" />
                      <CountRow label="New records" value={preview.counts.new} color="emerald" />
                      <CountRow label="Exact matches" value={preview.counts.exactMatches} color="amber" />
                    </div>
                    {preview.counts.possibleMatches > 0 && (
                      <div className="pt-2 border-t border-border">
                        <CountRow label="Possible duplicates (will be skipped)" value={preview.counts.possibleMatches} color="amber" />
                      </div>
                    )}
                  </Card>

                  {/* Sample rows */}
                  {preview.sampleRows.length > 0 && (
                    <Card className="p-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Sample Rows (first 20)</p>
                      <div className="space-y-1 max-h-[30vh] overflow-y-auto scroll-area">
                        {preview.sampleRows.map((r) => (
                          <div key={r.rowNumber} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/30">
                            <span className="text-muted-foreground w-6 shrink-0">{r.rowNumber}</span>
                            <span className="flex-1 truncate">{r.name}</span>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                              r.duplicate === 'NEW' ? 'bg-emerald-100 text-emerald-700'
                              : r.duplicate === 'EXACT_MATCH' ? 'bg-amber-100 text-amber-700'
                              : 'bg-blue-100 text-blue-700'
                            }`}>
                              {r.duplicate === 'NEW' ? 'NEW' : r.duplicate === 'EXACT_MATCH' ? 'EXISTS' : 'POSSIBLE'}
                            </span>
                          </div>
                        ))}
                      </div>
                    </Card>
                  )}

                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setStep('mapping')} className="flex-1 h-10">
                      <ArrowLeft className="w-4 h-4 mr-1" /> Back
                    </Button>
                    <Button onClick={handleImport} className="flex-1 h-10" disabled={preview.counts.valid === 0 && preview.counts.warnings === 0}>
                      Import {preview.counts.new + preview.counts.exactMatches} records
                    </Button>
                  </div>
                </div>
              )}

              {step === 'importing' && (
                <div className="text-center py-6">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">Importing data…</p>
                  <p className="text-[11px] text-muted-foreground/60 mt-1">This may take a moment for large files.</p>
                </div>
              )}

              {step === 'done' && result?.result && (
                <div className="space-y-3">
                  <div className="text-center py-2">
                    <CheckCircle className="w-12 h-12 mx-auto text-emerald-600 mb-2" />
                    <p className="text-sm font-medium">Import Complete</p>
                  </div>
                  <Card className="p-3 space-y-1.5">
                    <CountRow label="Imported" value={result.result.imported} color="emerald" />
                    <CountRow label="Skipped (existing)" value={result.result.skipped} color="amber" />
                    {result.result.errors.length > 0 && (
                      <CountRow label="Errors" value={result.result.errors.length} color="red" />
                    )}
                  </Card>
                  {result.result.errors.length > 0 && (
                    <Button variant="outline" onClick={downloadErrorReport} className="w-full h-10">
                      <Download className="w-4 h-4 mr-2" /> Download Error Report ({result.result.errors.length} rows)
                    </Button>
                  )}
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

function CountRow({ label, value, color }: { label: string; value: number; color?: string }) {
  const colorClass = color === 'emerald' ? 'text-emerald-600'
    : color === 'amber' ? 'text-amber-600'
    : color === 'red' ? 'text-red-600'
    : ''
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}:</span>
      <span className={`font-semibold tabular ${colorClass}`}>{value.toLocaleString()}</span>
    </div>
  )
}
