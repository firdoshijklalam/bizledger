'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Database, Download, Loader2, CheckCircle, AlertTriangle, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ImportHistoryItem {
  id: string
  importType: string
  sourceFileName: string
  sourceFormat: string
  rowCount: number
  importedCount: number
  skippedCount: number
  failedCount: number
  status: string
  createdAt: string
  completedAt: string | null
}

/**
 * §IMPORT-HISTORY-MODAL: Shows a table of all past imports with counts + status.
 * Allows downloading error reports for completed imports with errors.
 */
export function ImportHistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [items, setItems] = useState<ImportHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [errorReports, setErrorReports] = useState<Record<string, any[]>>({})

  useEffect(() => {
    if (!open) return
    let cancelled = false

    const loadHistory = async () => {
      setLoading(true)
      try {
        const res = await fetch('/api/import-history')
        const data = await res.json()
        if (cancelled) return
        const itemsList = data.items || []
        setItems(itemsList)
        setLoading(false)

        // Fetch error reports for items with errors
        for (const item of itemsList) {
          if (item.failedCount > 0 && item.id) {
            try {
              const detailRes = await fetch(`/api/import-history/${item.id}`)
              const detail = await detailRes.json()
              if (detail.errors && !cancelled) {
                setErrorReports((prev) => ({ ...prev, [item.id]: detail.errors }))
              }
            } catch {
              // ignore — error report not critical
            }
          }
        }
      } catch {
        if (!cancelled) setLoading(false)
      }
    }

    loadHistory()
    return () => { cancelled = true }
  }, [open])

  const downloadErrorReport = (item: ImportHistoryItem) => {
    const errors = errorReports[item.id]
    if (!errors || errors.length === 0) return
    const csv = '\uFEFF' + ['Row,Name,Field,Problem,Suggested Fix'].concat(
      errors.map((e: any) => `${e.row},${String(e.name || '').replace(/,/g, ';')},${String(e.field || '').replace(/,/g, ';')},${String(e.problem || '').replace(/,/g, ';')},${String(e.suggestedFix || '').replace(/,/g, ';')}`)
    ).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `import_errors_${item.sourceFileName.replace(/\.[^.]+$/, '')}_${new Date(item.createdAt).toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const statusIcon = (status: string) => {
    if (status === 'COMPLETED') return <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
    if (status === 'ROLLED_BACK' || status === 'FAILED') return <AlertTriangle className="w-3.5 h-3.5 text-red-600" />
    return <Clock className="w-3.5 h-3.5 text-amber-600" />
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-black/50 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="bg-card rounded-2xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
              <h2 className="text-base font-semibold flex items-center gap-2">
                <Database className="w-5 h-5" /> Import History
              </h2>
              <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-muted" aria-label="Close">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4">
              {loading ? (
                <div className="text-center py-8">
                  <Loader2 className="w-8 h-8 mx-auto animate-spin text-primary mb-3" />
                  <p className="text-sm text-muted-foreground">Loading history…</p>
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-8">
                  <Database className="w-12 h-12 mx-auto text-muted-foreground mb-3" />
                  <p className="text-sm text-muted-foreground">No imports yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="p-3 rounded-xl border border-border bg-muted/30">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          {statusIcon(item.status)}
                          <div className="min-w-0">
                            <p className="text-xs font-medium truncate">{item.sourceFileName}</p>
                            <p className="text-[10px] text-muted-foreground">
                              {new Date(item.createdAt).toLocaleString()} · {item.importType} · {item.sourceFormat.toUpperCase()}
                            </p>
                          </div>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded shrink-0 ${
                          item.status === 'COMPLETED' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : item.status === 'ROLLED_BACK' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                        }`}>
                          {item.status}
                        </span>
                      </div>
                      <div className="grid grid-cols-4 gap-1 text-[10px]">
                        <div className="text-center">
                          <p className="text-muted-foreground">Rows</p>
                          <p className="font-semibold tabular">{item.rowCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Imported</p>
                          <p className="font-semibold tabular text-emerald-600">{item.importedCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Skipped</p>
                          <p className="font-semibold tabular text-amber-600">{item.skippedCount}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-muted-foreground">Errors</p>
                          <p className="font-semibold tabular text-red-600">{item.failedCount}</p>
                        </div>
                      </div>
                      {item.failedCount > 0 && errorReports[item.id] && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => downloadErrorReport(item)}
                          className="w-full h-7 mt-2 text-[10px]"
                        >
                          <Download className="w-3 h-3 mr-1" /> Download Error Report ({item.failedCount} rows)
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
