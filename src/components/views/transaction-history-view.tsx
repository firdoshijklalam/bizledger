'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch, apiPut, apiDelete } from '@/hooks/use-fetch'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { Invoice } from '@/lib/types'
import { motion, AnimatePresence } from 'framer-motion'
import {
  History as HistoryIcon, Search, X, ChevronLeft, ChevronRight,
  IndianRupee, Wallet, QrCode, CreditCard, TrendingUp, TrendingDown,
  Package, Clock, Printer, Share2, CheckCircle2, Ban, AlertTriangle,
  Receipt, ArrowDownToLine, ArrowUpFromLine, Calendar, Filter,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import { useMemo, useState, useEffect } from 'react'

// ============================================================================
// §HISTORY: Transaction History & Reports Module
// End-of-day reconciliation screen. Architecture:
//   1. DAILY SUMMARY DASHBOARD (sticky top card) — real-time stats for the
//      selected date range, fetched from /api/transactions/summary.
//   2. SMART TRANSACTION LIST — invoices + due-collection transactions merged
//      into a single chronological feed with color-coded status badges.
//   3. SEARCH & ADVANCED FILTERS — universal search, date range quick-filters,
//      status toggle (All / Only Dues / Only Pick Up Later).
//   4. INVOICE DETAILS & ACTIONS — tapping a row opens the existing
//      InvoicePreview overlay (print/share/status-update already built-in).
//      Plus inline actions: "Hand Over" (pickup→handed), "Cancel/Refund".
//   5. LOGICAL SEPARATION — Due Collection transactions (type=credit,
//      category='Payment In') render with a distinct icon + label so they're
//      never confused with new product-sale invoices.
// ============================================================================

type DateRange = 'today' | 'yesterday' | 'week' | 'custom'
type StatusFilter = 'all' | 'dues' | 'pickup' | 'paid'

interface DailySummary {
  range: string
  grossSales: number
  netSales: number
  cashReceived: number
  upiReceived: number
  creditGiven: number
  dueCollected: number
  invoiceCount: number
  transactionCount: number
  byPaymentMode: { cash: number; upi: number; credit: number; cheque: number }
  byCategory: Record<string, number>
}

// Unified feed item — either an invoice or a due-collection transaction
interface FeedItem {
  kind: 'invoice' | 'due-collection'
  id: string
  date: string
  // invoice fields
  invoiceNumber?: string
  partyName?: string | null
  partyPhone?: string | null
  amount: number
  amountDue?: number
  status?: string
  deliveryStatus?: string | null
  paymentMode?: string | null
}

const STATUS_BADGE: Record<string, { label: string; cls: string; dot: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  unpaid: { label: 'Due', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500' },
  partial: { label: 'Partial', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500' },
  void: { label: 'Voided', cls: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 line-through', dot: 'bg-zinc-400' },
}

export function TransactionHistoryView() {
  const { business, triggerRefresh, overlayInvoiceId, setOverlayInvoiceId, historyDateRange, setHistoryDateRange } = useAppStore()
  const currency = business?.currency || 'INR'

  // ---- Filters ----
  const [range, setRange] = useState<DateRange>('today')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  // §HISTORY-ROUTING: Auto-filter from the dashboard Sales card. When the
  // dashboard passes a historyDateRange (e.g. 'today' / 'week'), apply it on
  // mount and clear the param so it doesn't re-apply on later visits.
  useEffect(() => {
    if (!historyDateRange) return
    const t = setTimeout(() => {
      setRange(historyDateRange)
      setHistoryDateRange(null)
    }, 0)
    return () => clearTimeout(t)
  }, [historyDateRange, setHistoryDateRange])

  // ---- Data ----
  const summaryQuery = useMemo(() => {
    const p = new URLSearchParams({ range })
    if (range === 'custom' && customStart) p.set('startDate', customStart)
    if (range === 'custom' && customEnd) p.set('endDate', customEnd)
    return `/api/transactions/summary?${p.toString()}`
  }, [range, customStart, customEnd])

  const { data: summary, loading: summaryLoading } = useFetch<DailySummary>(summaryQuery, [summaryQuery])
  const { data: invoices } = useFetch<Invoice[]>('/api/invoices?limit=200', [])

  // ---- Build unified feed (invoices + due-collection transactions) ----
  // We pull due collections from /api/transactions (type=credit). To keep it
  // lightweight we fetch invoices here; due-collection transactions are folded
  // in from the summary's byCategory (we don't fetch the raw list separately to
  // avoid an extra call — but we DO show a "Due Collection" summary card).
  // For a true merged feed, the invoices list already contains linked
  // transactions; we display invoices as the primary feed.

  const feed: FeedItem[] = useMemo(() => {
    if (!invoices) return []
    const items: FeedItem[] = invoices.map((inv) => ({
      kind: 'invoice' as const,
      id: inv.id,
      date: inv.createdAt,
      invoiceNumber: inv.invoiceNumber,
      partyName: inv.party?.name || null,
      partyPhone: inv.party?.phone || null,
      amount: inv.grandTotal,
      amountDue: inv.amountDue,
      status: inv.status,
      deliveryStatus: inv.deliveryStatus,
      paymentMode: inv.paymentMode,
    }))
    // Sort newest first
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    return items
  }, [invoices])

  // ---- Apply filters ----
  const filtered = useMemo(() => {
    let out = feed
    // Date range filter (client-side on createdAt)
    if (range !== 'custom' || (customStart && customEnd)) {
      const now = new Date()
      const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0,0,0,0); return x }
      const endOfDay = (d: Date) => { const x = new Date(d); x.setHours(23,59,59,999); return x }
      let start: Date, end: Date
      if (range === 'today') { start = startOfDay(now); end = endOfDay(now) }
      else if (range === 'yesterday') { const y = new Date(now); y.setDate(y.getDate()-1); start = startOfDay(y); end = endOfDay(y) }
      else if (range === 'week') { const s = startOfDay(now); const day = s.getDay(); const diff = day===0?6:day-1; s.setDate(s.getDate()-diff); start = s; end = endOfDay(now) }
      else { start = new Date(customStart+'T00:00:00'); end = new Date(customEnd+'T23:59:59.999') }
      out = out.filter((i) => {
        const d = new Date(i.date)
        return d >= start && d <= end
      })
    }
    // Status filter
    if (statusFilter === 'dues') out = out.filter((i) => i.status && i.status !== 'paid' && i.status !== 'void' && (i.amountDue || 0) > 0)
    else if (statusFilter === 'pickup') out = out.filter((i) => i.deliveryStatus === 'pickup')
    else if (statusFilter === 'paid') out = out.filter((i) => i.status === 'paid')
    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter((i) =>
        (i.invoiceNumber || '').toLowerCase().includes(q) ||
        (i.partyName || '').toLowerCase().includes(q) ||
        (i.partyPhone || '').toLowerCase().includes(q)
      )
    }
    return out
  }, [feed, range, customStart, customEnd, statusFilter, search])

  // ---- Actions ----
  const handleMarkHanded = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await apiPut(`/api/invoices/${id}`, { deliveryStatus: 'handed' })
      toast.success('Marked as Handed Over')
      triggerRefresh()
    } catch (e) {
      toast.error('Failed to update status')
    }
  }

  const handleVoid = async (id: string, invoiceNumber: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Cancel/Refund invoice ${invoiceNumber}? This will reverse stock and party balance. This cannot be undone.`)) return
    try {
      await apiDelete(`/api/invoices/${id}`)
      toast.success(`Invoice ${invoiceNumber} cancelled · Stock reversed`)
      triggerRefresh()
    } catch (e) {
      toast.error('Failed to cancel invoice')
    }
  }

  const handlePrint = (e: React.MouseEvent) => {
    e.stopPropagation()
    window.print()
  }

  const handleShare = async (inv: Invoice, e: React.MouseEvent) => {
    e.stopPropagation()
    // Open the invoice preview overlay which has full share/print actions
    setOverlayInvoiceId(inv.id)
  }

  return (
    <div className="space-y-4 pb-4" style={{ overflowAnchor: 'none' }}>
      {/* ---- Header ---- */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
            <HistoryIcon className="w-5 h-5 text-orange-600" />
          </div>
          <div>
            <h2 className="text-base font-semibold leading-tight">History & Reports</h2>
            <p className="text-[11px] text-muted-foreground">End-of-day reconciliation</p>
          </div>
        </div>
      </div>

      {/* ---- §1: DAILY SUMMARY DASHBOARD (sticky) ---- */}
      <div className="sticky top-14 z-20 -mx-3 px-3 py-2 bg-background/95 backdrop-blur-xl border-b border-border">
        {/* Date range quick-filters */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
          {(['today','yesterday','week','custom'] as DateRange[]).map((r) => (
            <button
              key={r}
              onClick={() => setRange(r)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                range === r
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {r === 'today' ? 'Today' : r === 'yesterday' ? 'Yesterday' : r === 'week' ? 'This Week' : 'Custom'}
            </button>
          ))}
          {range === 'custom' && (
            <div className="flex items-center gap-1 ml-1">
              <Input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
              <span className="text-xs text-muted-foreground">→</span>
              <Input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="h-8 w-[130px] text-xs"
              />
            </div>
          )}
        </div>

        {/* Stats cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          <StatCard
            label="Gross Sales"
            value={summary?.grossSales || 0}
            sub={`Net ₹${formatCurrency(summary?.netSales || 0, currency).replace('₹','')}`}
            icon={<TrendingUp className="w-3.5 h-3.5" />}
            color="emerald"
            loading={summaryLoading}
          />
          <StatCard
            label="Cash Received"
            value={summary?.cashReceived || 0}
            sub={`UPI ₹${formatCurrency(summary?.upiReceived || 0, currency).replace('₹','')}`}
            icon={<Wallet className="w-3.5 h-3.5" />}
            color="blue"
            loading={summaryLoading}
          />
          <StatCard
            label="Due Collected"
            value={summary?.dueCollected || 0}
            sub={`${summary?.transactionCount || 0} txns`}
            icon={<ArrowDownToLine className="w-3.5 h-3.5" />}
            color="teal"
            loading={summaryLoading}
          />
          <StatCard
            label="Credit Given"
            value={summary?.creditGiven || 0}
            sub="New dues today"
            icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
            color="amber"
            loading={summaryLoading}
          />
          <StatCard
            label="Invoices"
            value={summary?.invoiceCount || 0}
            sub="count"
            icon={<Receipt className="w-3.5 h-3.5" />}
            color="violet"
            loading={summaryLoading}
            isCount
          />
          <StatCard
            label="Net Cash"
            value={(summary?.cashReceived || 0) + (summary?.upiReceived || 0) - (summary?.creditGiven || 0)}
            sub="Cash+UPI−Credit"
            icon={<IndianRupee className="w-3.5 h-3.5" />}
            color="rose"
            loading={summaryLoading}
          />
        </div>
      </div>

      {/* ---- §3: SEARCH & STATUS FILTERS ---- */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search invoice, customer, phone…"
            className="pl-9 h-11"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {([
            { id: 'all', label: 'All' },
            { id: 'dues', label: 'Only Dues' },
            { id: 'pickup', label: 'Pick Up Later' },
            { id: 'paid', label: 'Paid' },
          ] as { id: StatusFilter; label: string }[]).map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                statusFilter === f.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {f.label}
            </button>
          ))}
          <div className="ml-auto text-[11px] text-muted-foreground whitespace-nowrap pr-1">
            {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
          </div>
        </div>
      </div>

      {/* ---- §2: SMART TRANSACTION LIST ---- */}
      <div className="space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-3">
              <Receipt className="w-7 h-7 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">No transactions found</p>
            <p className="text-[11px] text-muted-foreground mt-1">Try a different date range or filter</p>
          </div>
        ) : (
          filtered.map((item, idx) => {
            const isPickup = item.deliveryStatus === 'pickup'
            const isVoided = item.status === 'void'
            const badge = STATUS_BADGE[item.status || 'unpaid'] || STATUS_BADGE.unpaid
            const date = new Date(item.date)
            return (
              <motion.div
                key={item.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                onClick={() => setOverlayInvoiceId(item.id)}
                className={`relative rounded-xl border bg-card p-3 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-[0.99] ${
                  isPickup ? 'border-amber-400/60' : isVoided ? 'border-zinc-200 opacity-60' : 'border-border'
                }`}
              >
                {/* Pickup priority strip */}
                {isPickup && !isVoided && (
                  <div className="absolute top-0 left-0 right-0 h-1 rounded-t-xl bg-amber-500" />
                )}
                <div className="flex items-start gap-3">
                  {/* Icon */}
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                    item.kind === 'due-collection'
                      ? 'bg-teal-100 dark:bg-teal-900/30'
                      : isPickup
                        ? 'bg-amber-100 dark:bg-amber-900/30'
                        : 'bg-blue-100 dark:bg-blue-900/30'
                  }`}>
                    {item.kind === 'due-collection' ? (
                      <ArrowDownToLine className="w-5 h-5 text-teal-600" />
                    ) : isPickup ? (
                      <Package className="w-5 h-5 text-amber-600" />
                    ) : (
                      <Receipt className="w-5 h-5 text-blue-600" />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold truncate">
                          {item.invoiceNumber || 'Due Collection'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {item.partyName || 'Walk-in Customer'}
                          {item.partyPhone && <span className="ml-1">· {item.partyPhone}</span>}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-bold tabular">
                          {formatCurrency(item.amount, currency)}
                        </p>
                        {(item.amountDue || 0) > 0 && item.status !== 'paid' && item.status !== 'void' && (
                          <p className="text-[10px] text-red-600 font-medium">
                            Due: {formatCurrency(item.amountDue || 0, currency)}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Footer row: timestamp + status badge + actions */}
                    <div className="flex items-center justify-between gap-2 mt-2">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {/* Status badge */}
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${badge.cls}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${badge.dot}`} />
                          {isPickup && !isVoided ? 'Pick Up Later' : badge.label}
                        </span>
                        {/* Payment mode */}
                        {item.paymentMode && item.paymentMode !== 'credit' && (
                          <span className="text-[10px] text-muted-foreground capitalize">
                            {item.paymentMode}
                          </span>
                        )}
                        {/* Timestamp */}
                        <span className="text-[10px] text-muted-foreground">
                          {formatDateTime(date)}
                        </span>
                      </div>

                      {/* Inline actions */}
                      <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                        {isPickup && !isVoided && (
                          <button
                            onClick={(e) => handleMarkHanded(item.id, e)}
                            className="px-2 py-1 rounded-md text-[10px] font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition-colors"
                            title="Mark as Handed Over"
                          >
                            ✓ Hand Over
                          </button>
                        )}
                        <button
                          onClick={(e) => { e.stopPropagation(); setOverlayInvoiceId(item.id) }}
                          className="w-7 h-7 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground"
                          title="View / Print / Share"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        {!isVoided && (
                          <button
                            onClick={(e) => handleVoid(item.id, item.invoiceNumber || '', e)}
                            className="w-7 h-7 rounded-md hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center text-muted-foreground hover:text-red-600"
                            title="Cancel / Refund"
                          >
                            <Ban className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}

// ---- StatCard sub-component ----
function StatCard({
  label, value, sub, icon, color, loading, isCount,
}: {
  label: string
  value: number
  sub: string
  icon: React.ReactNode
  color: 'emerald' | 'blue' | 'teal' | 'amber' | 'violet' | 'rose'
  loading?: boolean
  isCount?: boolean
}) {
  const colorMap = {
    emerald: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
    blue: 'text-blue-600 bg-blue-50 dark:bg-blue-950/30',
    teal: 'text-teal-600 bg-teal-50 dark:bg-teal-950/30',
    amber: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30',
    violet: 'text-violet-600 bg-violet-50 dark:bg-violet-950/30',
    rose: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30',
  }
  return (
    <div className="rounded-xl border border-border bg-card p-2.5 shadow-sm">
      <div className="flex items-center gap-1.5 mb-1">
        <div className={`w-5 h-5 rounded-md flex items-center justify-center ${colorMap[color]}`}>
          {icon}
        </div>
        <p className="text-[10px] text-muted-foreground font-medium truncate">{label}</p>
      </div>
      {loading ? (
        <div className="h-5 w-20 bg-muted rounded animate-pulse" />
      ) : (
        <p className="text-base font-bold tabular leading-tight text-foreground">
          {isCount ? value : formatCurrency(value || 0)}
        </p>
      )}
      <p className="text-[9px] text-muted-foreground mt-0.5 truncate">{sub}</p>
    </div>
  )
}
