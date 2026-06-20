'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Invoice } from '@/lib/types'
import { formatCurrency, formatDate } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Receipt, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { useEffect, useMemo, useState } from 'react'
import { InvoiceForm } from './billing/invoice-form'
import { InvoicePreview } from './billing/invoice-preview'
import { Input } from '@/components/ui/input'

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  unpaid: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  partial: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
}

export function BillingView() {
  const {
    showInvoiceForm, setShowInvoiceForm,
    selectedInvoiceId,
    pendingQuickAction, clearQuickAction,
    business,
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')

  const { data: invoices, loading } = useFetch<Invoice[]>('/api/invoices', [])

  useEffect(() => {
    if (pendingQuickAction?.type === 'new-invoice') {
      setShowInvoiceForm(true)
      clearQuickAction()
    }
  }, [pendingQuickAction, setShowInvoiceForm, clearQuickAction])

  const currency = business?.currency || 'INR'

  const filtered = useMemo(() => {
    if (!invoices) return []
    if (!search.trim()) return invoices
    const q = search.toLowerCase()
    return invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(q) || (i.party?.name || '').toLowerCase().includes(q))
  }, [invoices, search])

  const stats = useMemo(() => {
    if (!invoices) return { total: 0, paid: 0, due: 0 }
    return {
      total: invoices.reduce((s, i) => s + i.grandTotal, 0),
      paid: invoices.reduce((s, i) => s + i.amountPaid, 0),
      due: invoices.reduce((s, i) => s + i.amountDue, 0),
    }
  }, [invoices])

  if (selectedInvoiceId) {
    return <InvoicePreview invoiceId={selectedInvoiceId} />
  }

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="p-3 rounded-2xl bg-card border border-border text-center">
          <p className="text-[11px] text-muted-foreground">Total Billed</p>
          <p className="text-sm font-bold tabular">{formatCurrency(stats.total, currency)}</p>
        </div>
        <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-transparent text-center">
          <p className="text-[11px] text-emerald-700 dark:text-emerald-300">Collected</p>
          <p className="text-sm font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(stats.paid, currency)}</p>
        </div>
        <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-transparent text-center">
          <p className="text-[11px] text-red-700 dark:text-red-300">Outstanding</p>
          <p className="text-sm font-bold tabular text-red-700 dark:text-red-300">{formatCurrency(stats.due, currency)}</p>
        </div>
      </div>

      {/* New invoice CTA */}
      <Button onClick={() => setShowInvoiceForm(true)} className="w-full h-12 text-base">
        <Plus className="w-5 h-5 mr-2" /> {t('bill.newInvoice')}
      </Button>

      {/* Search */}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t('common.search') + ' invoices…'}
        className="h-11"
      />

      {/* Invoice list */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={t('bill.empty')}
          description="Create your first invoice to start tracking sales."
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((inv, i) => (
              <motion.div
                key={inv.id}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02 }}
                layout
              >
                <Card className="p-3.5 hover:shadow-md transition-shadow">
                  <button
                    onClick={() => useAppStore.getState().setSelectedInvoiceId(inv.id)}
                    className="w-full flex items-center gap-3 text-left"
                  >
                    <div className="w-11 h-11 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                      <Receipt className="w-5 h-5 text-orange-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold truncate">{inv.invoiceNumber}</p>
                        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[inv.status]}`}>
                          {inv.status}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {inv.party?.name || 'Walk-in'} · {formatDate(inv.createdAt)}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-bold tabular">{formatCurrency(inv.grandTotal, currency)}</p>
                      {inv.amountDue > 0 && (
                        <p className="text-[10px] text-red-600">Due: {formatCurrency(inv.amountDue, currency)}</p>
                      )}
                    </div>
                  </button>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      <InvoiceForm open={showInvoiceForm} onOpenChange={setShowInvoiceForm} />
    </div>
  )
}
