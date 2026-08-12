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
import { BillingTabs } from './billing/billing-tabs'
import { Input } from '@/components/ui/input'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { phoneticMatch } from '@/lib/transliteration'
import { useCartStore } from '@/store/cart-store'

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  unpaid: 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300',
  partial: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  overdue: 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300',
  hold: 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300',
}

type BillingStatusFilter = 'all' | 'paid' | 'unpaid' | 'overdue' | 'hold'

const isOverdue = (inv: Invoice): boolean => {
  if (inv.status === 'paid') return false
  const created = new Date(inv.createdAt).getTime()
  const daysSince = (Date.now() - created) / 86400000
  return daysSince > 30 && inv.amountDue > 0
}

export function BillingView() {
  const {
    showInvoiceForm, setShowInvoiceForm,
    selectedInvoiceId,
    floatingInvoiceOpen, setFloatingInvoiceOpen,
    pendingQuickAction, clearQuickAction,
    business,
    setActiveView,
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const voiceProps = useVoiceInput<HTMLInputElement>((text) => setSearch(text))
  const [statusFilter, setStatusFilter] = useState<BillingStatusFilter>('all')

  const { data: invoices, loading } = useFetch<Invoice[]>('/api/invoices', [])

  useEffect(() => {
    if (pendingQuickAction?.type === 'new-invoice') {
      // §3: Redirect to Quick Sale POS screen (unified billing interface)
      setActiveView('sale-pad')
      clearQuickAction()
    }
  }, [pendingQuickAction, setActiveView, clearQuickAction])

  const currency = business?.currency || 'INR'

  const counts = useMemo(() => {
    if (!invoices) return { all: 0, paid: 0, unpaid: 0, overdue: 0, hold: 0 }
    return {
      all: invoices.length,
      paid: invoices.filter((i) => i.status === 'paid').length,
      unpaid: invoices.filter((i) => i.status === 'unpaid').length,
      overdue: invoices.filter((i) => isOverdue(i)).length,
      hold: 0, // PRD Part 16: hold = billing drafts (in localStorage); show as 0 unless tracked
    }
  }, [invoices])

  const filtered = useMemo(() => {
    if (!invoices) return []
    let list = invoices
    if (statusFilter === 'paid') list = list.filter((i) => i.status === 'paid')
    else if (statusFilter === 'unpaid') list = list.filter((i) => i.status === 'unpaid')
    else if (statusFilter === 'overdue') list = list.filter((i) => isOverdue(i))
    // 'hold' tab shows billing drafts (handled by BillingTabs component below)
    if (statusFilter !== 'hold' && search.trim()) {
      const q = search.toLowerCase()
      // §1: Use same shared search logic — check invoiceNumber + party.name + phonetic
      list = list.filter((i) => {
        const invMatch = i.invoiceNumber.toLowerCase().includes(q)
        const partyName = (i.party?.name || '').toLowerCase()
        const partyMatch = partyName.includes(q)
        // §1: Phonetic match on party name (e.g. "Abdullah" → "আব্দুল্লাহ")
        const phonetic = i.party?.name ? phoneticMatch(search, i.party.name) : false
        return invMatch || partyMatch || phonetic
      })
    }
    return list
  }, [invoices, statusFilter, search])

  const stats = useMemo(() => {
    if (!invoices) return { total: 0, paid: 0, due: 0 }
    const num = (v: any): number => Number(v) || 0
    return {
      total: invoices.reduce((s, i) => s + num(i.grandTotal), 0),
      paid: invoices.reduce((s, i) => s + num(i.amountPaid), 0),
      due: invoices.reduce((s, i) => s + num(i.amountDue), 0),
    }
  }, [invoices])

  // §1: Direct navigation to Full Invoice screen — no bottom sheet intermediary
  if (selectedInvoiceId) {
    return <InvoicePreview invoiceId={selectedInvoiceId} />
  }

  const FILTER_TABS: Array<{ id: BillingStatusFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'paid', label: 'Paid', count: counts.paid },
    { id: 'unpaid', label: 'Unpaid', count: counts.unpaid },
    { id: 'overdue', label: 'Overdue', count: counts.overdue },
    { id: 'hold', label: 'Hold', count: counts.hold },
  ]

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
        {/* §1: Fix negative outstanding — show Advance in green when Collected > Billed */}
        {stats.due > 0 ? (
          <div className="p-3 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-transparent text-center">
            <p className="text-[11px] text-red-700 dark:text-red-300">Outstanding</p>
            <p className="text-sm font-bold tabular text-red-700 dark:text-red-300">{formatCurrency(stats.due, currency)}</p>
          </div>
        ) : stats.due < 0 ? (
          <div className="p-3 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 border border-transparent text-center">
            <p className="text-[11px] text-emerald-700 dark:text-emerald-300">Advance / Overpaid</p>
            <p className="text-sm font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(Math.abs(stats.due), currency)}</p>
          </div>
        ) : (
          <div className="p-3 rounded-2xl bg-card border border-border text-center">
            <p className="text-[11px] text-muted-foreground">Outstanding</p>
            <p className="text-sm font-bold tabular text-muted-foreground">₹0</p>
          </div>
        )}
      </div>

      {/* New invoice CTA — §1: Navigate to Quick Sale AND create a new cart */}
      <Button onClick={() => {
        useCartStore.getState().createNewCart()
        setActiveView('sale-pad')
      }} className="w-full h-12 text-base">
        <Plus className="w-5 h-5 mr-2" /> {t('bill.newInvoice')}
      </Button>

      {/* Multi-tab hold system (PRD v2 §10.6) */}
      <div className="pt-2">
        <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1.5 px-1">Hold Bills (Drafts)</p>
        <BillingTabs />
      </div>

      {/* Status filter tabs with live counts (PRD Part 16 §1) */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {FILTER_TABS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] flex items-center gap-1.5 ${
              statusFilter === f.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f.label}
            <span className={`px-1.5 py-0.5 rounded-full text-[9px] ${
              statusFilter === f.id ? 'bg-primary-foreground/20' : 'bg-background'
            }`}>{f.count}</span>
          </button>
        ))}
      </div>

      {/* Search (hidden on hold tab since it shows drafts) */}
      {statusFilter !== 'hold' && (
        <Input
          {...voiceProps}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or bill no…"
          className="h-11"
        />
      )}

      {/* Hold tab content */}
      {statusFilter === 'hold' ? (
        <Card className="p-5 text-center">
          <p className="text-sm text-muted-foreground">
            Held bills appear as tabs above. Tap a tab with a yellow dot to resume drafting.
          </p>
        </Card>
      ) : (
        <>
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
            <GroupedInvoiceList invoices={filtered} currency={currency} />
          )}
        </>
      )}

      <InvoiceForm open={showInvoiceForm} onOpenChange={setShowInvoiceForm} />
    </div>
  )
}

// ============================================================================
// §UX-POLISH: Grouped invoice list with date-based sticky section headers.
// Groups invoices into "Today", "Yesterday", and specific date labels
// (e.g. "17 July 2026"). Each invoice card shows an item-count indicator
// so identical Walk-in bills (e.g. two ₹110 bills) can be differentiated.
// ============================================================================

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

function getDateLabel(date: Date): { label: string; sortKey: number } {
  const now = new Date()
  const today = startOfDay(now).getTime()
  const yesterday = today - 86400000
  const invoiceDay = startOfDay(date).getTime()
  if (invoiceDay === today) return { label: 'Today', sortKey: today }
  if (invoiceDay === yesterday) return { label: 'Yesterday', sortKey: yesterday }
  // Specific date: e.g. "17 July 2026"
  const label = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  return { label, sortKey: invoiceDay }
}

function GroupedInvoiceList({ invoices, currency }: { invoices: Invoice[]; currency: string }) {
  // Group invoices by date label, preserving newest-first order
  const groups = useMemo(() => {
    const map = new Map<string, { label: string; sortKey: number; items: Invoice[] }>()
    for (const inv of invoices) {
      const d = new Date(inv.createdAt)
      const { label, sortKey } = getDateLabel(d)
      const key = String(sortKey)
      if (!map.has(key)) map.set(key, { label, sortKey, items: [] })
      map.get(key)!.items.push(inv)
    }
    // Sort groups newest first; within each group keep newest first (invoices
    // are already sorted desc from the API, but sort defensively)
    const arr = Array.from(map.values()).sort((a, b) => b.sortKey - a.sortKey)
    for (const g of arr) {
      g.items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }
    return arr
  }, [invoices])

  let globalIndex = 0

  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.sortKey}>
          {/* §Sticky date header */}
          <div className="sticky top-14 z-10 -mx-1 px-2 py-1 bg-background/95 backdrop-blur-sm">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
                {group.label}
              </p>
              <span className="text-[10px] text-muted-foreground">
                {group.items.length} {group.items.length === 1 ? 'bill' : 'bills'}
              </span>
            </div>
          </div>
          <div className="space-y-2 mt-1.5">
            <AnimatePresence>
              {group.items.map((inv) => {
                const idx = globalIndex++
                const itemCount = inv.items?.length || 0
                return (
                  <motion.div
                    key={inv.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(idx * 0.02, 0.4) }}
                    layout
                  >
                    <Card className="p-3.5 hover:shadow-md transition-shadow">
                      <button
                        onClick={() => {
                          useAppStore.getState().setSelectedInvoiceId(inv.id)
                        }}
                        className="w-full flex items-center gap-3 text-left"
                      >
                        <div className="w-11 h-11 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                          <Receipt className="w-5 h-5 text-orange-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-semibold truncate">{inv.invoiceNumber}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_COLORS[inv.status] || STATUS_COLORS.unpaid}`}>
                              {inv.status}
                            </span>
                          </div>
                          {/* §ITEM-COUNT: includes item count so identical Walk-in
                              bills (e.g. two ₹110) can be differentiated. */}
                          <p className="text-[11px] text-muted-foreground truncate">
                            {inv.party?.name || 'Walk-in'}
                            {itemCount > 0 && <span className="text-muted-foreground/70"> • {itemCount} {itemCount === 1 ? 'Item' : 'Items'}</span>}
                            {' · '}{formatDate(inv.createdAt)}
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
                )
              })}
            </AnimatePresence>
          </div>
        </div>
      ))}
    </div>
  )
}
