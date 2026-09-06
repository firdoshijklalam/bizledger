'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch, apiPut, apiDelete } from '@/hooks/use-fetch'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import type { Invoice, Transaction } from '@/lib/types'
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
import {
  computeRangeBounds,
  dashboardRangeLabel,
  DASHBOARD_RANGES,
  type DashboardRange,
  type RangeContext,
} from '@/lib/date-ranges'
import { toNumber } from '@/lib/numeric'

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
// §PHASE-5-D1: History now supports the FULL DashboardRange set (1d/yesterday/
//   2d/3d/5d/7d/1m/3m/6m/1y/custom) — same shared range IDs as the Dashboard.
//   When the dashboard Sales/Collection card is clicked, History receives the
//   EXACT same RangeContext {range, customStart, customEnd} and computes the
//   EXACT same date boundaries via the shared `computeRangeBounds` utility.
//   No more lossy mapping (e.g. dashboard "3 Days" → History "This Week").
// ============================================================================

// §PHASE-5-D1: HistoryRange = DashboardRange. Single shared type across all
// 3 views (Dashboard, History, Reports). Any new range added to DashboardRange
// is automatically supported by History with no extra code.
type DateRange = DashboardRange
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

// §STEP-4B-VIEW-ALL: FeedItem now includes the 'transaction' kind (entered
// from Dashboard Top Payments / Business Activity Transactions View-All).
// Transaction-mode feed items carry txnType + description + category + invoiceId
// instead of invoiceNumber + status + deliveryStatus.
interface FeedItem {
  kind: 'invoice' | 'due-collection' | 'transaction'
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
  // transaction-mode fields (only present when kind === 'transaction')
  txnType?: 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'
  description?: string | null
  category?: string | null
  invoiceId?: string | null
  partyId?: string | null
}

const STATUS_BADGE: Record<string, { label: string; cls: string; dot: string }> = {
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-emerald-500' },
  unpaid: { label: 'Due', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300', dot: 'bg-red-500' },
  partial: { label: 'Partial', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-amber-500' },
  void: { label: 'Voided', cls: 'bg-zinc-200 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 line-through', dot: 'bg-zinc-400' },
}

export function TransactionHistoryView() {
  // §STEP-4B-VIEW-ALL: `historyViewMode` is set by Dashboard Top Payments /
  // Business Activity Transactions View-All. 'payments' shows only credit
  // transactions; 'transactions' shows all credit+debit; 'invoices' (default)
  // shows the existing invoice feed. Cleared after consumption.
  const { business, triggerRefresh, overlayInvoiceId, setOverlayInvoiceId, historyDateRange, setHistoryDateRange, historyRangeContext, setHistoryRangeContext, historyViewMode, setHistoryViewMode } = useAppStore()
  const currency = business?.currency || 'INR'

  // §STEP-4B-VIEW-ALL: Local viewMode state. Initialized to 'invoices' (the
  // existing default). When `historyViewMode` is set from the store (via
  // Dashboard View-All), it overrides this on mount, then clears the store.
  const [viewMode, setViewMode] = useState<'invoices' | 'payments' | 'transactions'>('invoices')

  useEffect(() => {
    if (!historyViewMode) return
    const t = setTimeout(() => {
      setViewMode(historyViewMode)
      setHistoryViewMode(null)
    }, 0)
    return () => clearTimeout(t)
  }, [historyViewMode, setHistoryViewMode])

  // ---- Filters ----
  // §PHASE-5-D1: Default range is now '1d' (Today) using the shared DashboardRange
  // type — was 'today' (legacy). Same semantic, just renamed to match the
  // shared type so the dashboard card click's range ID is accepted directly.
  const [range, setRange] = useState<DateRange>('1d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [search, setSearch] = useState('')

  // §HISTORY-ROUTING (Phase 5 D1): Consume the FULL RangeContext from the
  // dashboard card click — {range, customStart, customEnd}. This preserves
  // custom range dates which were previously lost (Phase 4 bug D1).
  // Applies on mount, then clears the param so it doesn't re-apply on later visits.
  useEffect(() => {
    if (!historyRangeContext) return
    const ctx = historyRangeContext
    const t = setTimeout(() => {
      setRange(ctx.range)
      setCustomStart(ctx.customStart || '')
      setCustomEnd(ctx.customEnd || '')
      setHistoryRangeContext(null)
    }, 0)
    return () => clearTimeout(t)
  }, [historyRangeContext, setHistoryRangeContext])

  // §LEGACY-HISTORY-DATE-RANGE: For any callers still using the old
  // `historyDateRange` field (e.g. deep links, older code paths), preserve
  // backward compat by mapping to the new range string. 'today' → '1d',
  // 'week' → '7d'. This keeps the old API working without breaking the new path.
  useEffect(() => {
    if (!historyDateRange) return
    const t = setTimeout(() => {
      const mapped: DateRange = historyDateRange === 'today' ? '1d' : historyDateRange === 'week' ? '7d' : historyDateRange === 'yesterday' ? 'yesterday' : 'custom'
      setRange(mapped)
      setHistoryDateRange(null)
    }, 0)
    return () => clearTimeout(t)
  }, [historyDateRange, setHistoryDateRange])

  // ---- Data ----
  // §PHASE-5-D1: API call sends `range` (DashboardRange string) directly —
  // no lossy mapping. The backend `/api/transactions/summary` accepts the
  // full DashboardRange set and computes the same boundaries as the Dashboard.
  const summaryQuery = useMemo(() => {
    const p = new URLSearchParams({ range })
    if (range === 'custom' && customStart) p.set('startDate', customStart)
    if (range === 'custom' && customEnd) p.set('endDate', customEnd)
    return `/api/transactions/summary?${p.toString()}`
  }, [range, customStart, customEnd])

  const { data: summary, loading: summaryLoading } = useFetch<DailySummary>(summaryQuery, [summaryQuery])
  const { data: invoices } = useFetch<Invoice[]>('/api/invoices?limit=200', [])
  // §STEP-4B-VIEW-ALL: Fetch the authoritative transactions list when the user
  // entered via Dashboard Top Payments or Business Activity Transactions
  // View-All. Reuses the SAME /api/transactions endpoint used everywhere else
  // (Khata, Dashboard recentTransactions, etc.) — no second data model.
  // Fetched only when viewMode is NOT 'invoices' to avoid an extra request
  // for the default invoice feed.
  // §USEFETCH-AUTO-EXTRACT: useFetch auto-extracts `.items` from paginated
  // responses ({ items, total, hasMore }) → returns the array directly.
  // So the type is `Transaction[]`, not `{ items: Transaction[]; ... }`.
  const { data: transactionsData } = useFetch<Transaction[]>(
    viewMode === 'invoices' ? null : '/api/transactions?limit=200',
    [viewMode],
  )

  // ---- Build unified feed (invoices + due-collection transactions) ----
  // We pull due collections from /api/transactions (type=credit). To keep it
  // lightweight we fetch invoices here; due-collection transactions are folded
  // in from the summary's byCategory (we don't fetch the raw list separately to
  // avoid an extra call — but we DO show a "Due Collection" summary card).
  // For a true merged feed, the invoices list already contains linked
  // transactions; we display invoices as the primary feed.

  // ---- Build feed ----
  // §STEP-4B-VIEW-ALL: When viewMode is 'payments' or 'transactions', build
  // a transaction-based feed (NOT invoices). This is the authoritative source
  // for Top Payments / Business Activity Transactions — same /api/transactions
  // endpoint used by Khata, Dashboard recentTransactions, etc. NO second data
  // model, NO duplicated accounting logic.
  //
  // 'payments' → only type='credit' transactions (matches Dashboard Top
  //   Payments: data.recentTransactions.filter(t => t.type === 'credit'))
  // 'transactions' → all credit + debit transactions (matches Dashboard
  //   Business Activity Transactions: data.recentTransactions)
  // 'invoices' → existing invoice feed (unchanged)
  const feed: FeedItem[] = useMemo(() => {
    if (viewMode !== 'invoices') {
      // §TRANSACTION-FEED: Build from /api/transactions items.
      // §USEFETCH-AUTO-EXTRACT: transactionsData is the items array directly
      // (useFetch auto-extracts .items from { items, total, hasMore }).
      const txns = transactionsData ?? []
      const filtered = viewMode === 'payments'
        ? txns.filter((t) => t.type === 'credit')
        : txns // 'transactions' → all
      return filtered.map((t): FeedItem => ({
        kind: 'transaction',
        id: t.id,
        date: t.createdAt,
        txnType: t.type,
        partyName: (t as any).party?.name || null,
        amount: toNumber(t.amount),
        description: t.description || null,
        category: t.category || null,
        invoiceId: t.invoiceId || null,
        partyId: t.partyId || null,
      }))
    }
    // §INVOICE-FEED: Existing invoice-based feed (default).
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
  }, [invoices, viewMode, transactionsData])

  // ---- Apply filters ----
  // §PHASE-5-D1: Use shared computeRangeBounds — same utility the Dashboard
  // and Reports APIs use. This GUARANTEES the client-side feed filter uses
  // the EXACT same date window as the server-side summary API call.
  // §STEP-4B-VIEW-ALL: Status filter is hidden for 'payments'/'transactions'
  // modes (transactions don't have invoice statuses). Search + date range
  // filter still apply.
  const filtered = useMemo(() => {
    let out = feed
    // Date range filter (client-side on createdAt)
    if (range !== 'custom' || (customStart && customEnd)) {
      const bounds = computeRangeBounds(range, customStart, customEnd)
      if (bounds) {
        const startMs = bounds.start.getTime()
        const endMs = bounds.end.getTime()
        out = out.filter((i) => {
          const t = new Date(i.date).getTime()
          return t >= startMs && t <= endMs
        })
      }
    }
    // Status filter — invoice-only (no-op for transaction feed)
    if (viewMode === 'invoices') {
      if (statusFilter === 'dues') out = out.filter((i) => i.status && i.status !== 'paid' && i.status !== 'void' && (i.amountDue || 0) > 0)
      else if (statusFilter === 'pickup') out = out.filter((i) => i.deliveryStatus === 'pickup')
      else if (statusFilter === 'paid') out = out.filter((i) => i.status === 'paid')
    }
    // Search
    if (search.trim()) {
      const q = search.trim().toLowerCase()
      out = out.filter((i) => {
        if (i.kind === 'transaction') {
          return (i.description || '').toLowerCase().includes(q) ||
                 (i.partyName || '').toLowerCase().includes(q) ||
                 (i.category || '').toLowerCase().includes(q)
        }
        return (i.invoiceNumber || '').toLowerCase().includes(q) ||
               (i.partyName || '').toLowerCase().includes(q) ||
               (i.partyPhone || '').toLowerCase().includes(q)
      })
    }
    return out
  }, [feed, range, customStart, customEnd, statusFilter, search, viewMode])

  // §STEP-4B-VIEW-ALL: Transaction-mode summary stats. Computed from the
  // filtered transaction feed (NOT from the invoice-based DailySummary).
  // Mirrors Dashboard Top Payments (Total In = sum of credit amounts) and
  // Business Activity Transactions (Total In + Total Out).
  const txnSummary = useMemo(() => {
    if (viewMode === 'invoices') return null
    let totalIn = 0
    let totalOut = 0
    let count = 0
    for (const item of filtered) {
      if (item.kind !== 'transaction') continue
      if (item.txnType === 'credit') totalIn += item.amount
      else if (item.txnType === 'debit' || item.txnType === 'expense') totalOut += item.amount
      count++
    }
    return { totalIn, totalOut, count }
  }, [filtered, viewMode])

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
        {/* Date range quick-filters
            §PHASE-5-D1: Now uses the FULL DASHBOARD_RANGES list — same range
            IDs as the Dashboard. When the user clicks a Sales/Collection card
            with "3 Days" selected, History opens showing "3 Days" (not "This
            Week" as before). Each chip uses dashboardRangeLabel() so the
            label matches what the Dashboard card displayed. */}
        <div className="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
          {DASHBOARD_RANGES.map((r) => (
            <button
              key={r.id}
              onClick={() => setRange(r.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                range === r.id
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {r.label}
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

        {/* §STEP-4B-VIEW-ALL: Context banner for transaction-mode views. */}
        {viewMode === 'payments' && (
          <div className="mb-2 flex items-center justify-between gap-2 p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
            <p className="text-xs font-medium text-emerald-800 dark:text-emerald-200">
              Showing payment transactions (credit only) for {dashboardRangeLabel(range)}
            </p>
            <button
              onClick={() => setViewMode('invoices')}
              className="text-[10px] px-2 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-900/70 transition-colors"
            >
              ← Back to invoices
            </button>
          </div>
        )}
        {viewMode === 'transactions' && (
          <div className="mb-2 flex items-center justify-between gap-2 p-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
            <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
              Showing all transactions (credit + debit) for {dashboardRangeLabel(range)}
            </p>
            <button
              onClick={() => setViewMode('invoices')}
              className="text-[10px] px-2 py-1 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 hover:bg-blue-200 dark:hover:bg-blue-900/70 transition-colors"
            >
              ← Back to invoices
            </button>
          </div>
        )}

        {/* Stats cards */}
        {viewMode === 'invoices' ? (
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
        ) : (
          // §STEP-4B-VIEW-ALL: Transaction-mode summary — mirrors Dashboard
          // Top Payments (Total In) + Business Activity Transactions (In+Out).
          // Computed from the filtered transaction feed (txnSummary).
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <StatCard
              label="Total In"
              value={txnSummary?.totalIn ?? 0}
              sub={`${txnSummary?.count ?? 0} txns`}
              icon={<ArrowDownToLine className="w-3.5 h-3.5" />}
              color="emerald"
            />
            {viewMode === 'transactions' && (
              <StatCard
                label="Total Out"
                value={txnSummary?.totalOut ?? 0}
                sub="debit + expense"
                icon={<ArrowUpFromLine className="w-3.5 h-3.5" />}
                color="rose"
              />
            )}
            <StatCard
              label="Net Cash"
              value={(txnSummary?.totalIn ?? 0) - (txnSummary?.totalOut ?? 0)}
              sub="In − Out"
              icon={<IndianRupee className="w-3.5 h-3.5" />}
              color="violet"
            />
            <StatCard
              label="Transactions"
              value={txnSummary?.count ?? 0}
              sub="records"
              icon={<Receipt className="w-3.5 h-3.5" />}
              color="blue"
              isCount
            />
          </div>
        )}
      </div>

      {/* ---- §3: SEARCH & STATUS FILTERS ---- */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={viewMode === 'invoices' ? 'Search invoice, customer, phone…' : 'Search party, description, category…'}
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
        {/* §STEP-4B-VIEW-ALL: Status filter is invoice-only. Hidden for
            'payments'/'transactions' modes (transactions don't have statuses). */}
        {viewMode === 'invoices' && (
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
        )}
        {viewMode !== 'invoices' && (
          <div className="flex items-center justify-end text-[11px] text-muted-foreground whitespace-nowrap pr-1">
            {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
          </div>
        )}
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
            // §STEP-4B-VIEW-ALL: Transaction-mode feed item — render with
            // credit/debit semantics (color, icon, sign) instead of invoice
            // status badges. Clicking opens the linked invoice (if any) or
            // the linked party (otherwise no-op).
            if (item.kind === 'transaction') {
              const isCredit = item.txnType === 'credit'
              const date = new Date(item.date)
              const handleClick = () => {
                if (item.invoiceId) {
                  setOverlayInvoiceId(item.invoiceId)
                } else if (item.partyId) {
                  useAppStore.getState().setOverlayPartyId(item.partyId)
                }
              }
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(idx * 0.02, 0.3) }}
                  onClick={handleClick}
                  className="relative rounded-xl border bg-card p-3 shadow-sm cursor-pointer hover:shadow-md transition-all active:scale-[0.99] border-border"
                >
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      isCredit
                        ? 'bg-emerald-100 dark:bg-emerald-900/30'
                        : 'bg-rose-100 dark:bg-rose-900/30'
                    }`}>
                      {isCredit
                        ? <ArrowDownToLine className="w-5 h-5 text-emerald-600" />
                        : <ArrowUpFromLine className="w-5 h-5 text-rose-600" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold truncate">
                            {item.partyName || (item.description || (isCredit ? 'Payment In' : 'Payment Out'))}
                          </p>
                          {item.description && item.partyName && (
                            <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                          )}
                          {item.category && (
                            <p className="text-[10px] text-muted-foreground capitalize">{item.category}</p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <p className={`text-sm font-bold tabular ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {isCredit ? '+' : '−'}{formatCurrency(item.amount, currency)}
                          </p>
                          {item.invoiceId && (
                            <p className="text-[10px] text-muted-foreground">linked invoice</p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-wrap mt-2">
                        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                          isCredit
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isCredit ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                          {isCredit ? 'CREDIT' : (item.txnType || '').toUpperCase()}
                        </span>
                        <span className="text-[10px] text-muted-foreground">{formatDateTime(date)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )
            }
            // §INVOICE-FEED-ITEM: Existing invoice rendering (unchanged)
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
