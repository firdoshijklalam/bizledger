'use client'

import { useAppStore, type OutstandingTab, type OutstandingGradeFilter, type PartySegment, type PartySortBy } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { toNumber } from '@/lib/numeric'
import { motion } from 'framer-motion'
import {
  FileText, FileSpreadsheet, Printer, TrendingUp, TrendingDown,
  IndianRupee, Users, Package, BarChart3, AlertCircle, Receipt,
  Megaphone, Medal, ShoppingCart, Gift, Bell, Ban, ChevronDown, ChevronUp,
  X, Heart,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingState, ErrorState } from '@/components/shared/states'
import { toast } from 'sonner'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useMemo, useState, useEffect } from 'react'
import { buildReportCsv, computeRangeDates, computeGstRangeDates, type ReportType } from '@/lib/reports-csv'
import {
  computeRangeBounds,
  dashboardRangeLabel,
  DASHBOARD_RANGES,
  type DashboardRange,
  type RangeContext,
} from '@/lib/date-ranges'

const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#f97316', '#ef4444']

interface ReportData {
  business: any
  profitLoss: {
    revenue: number; netRevenue: number; discount: number;
    cogs: number; grossProfit: number; indirectExpenses: number;
    expense: number; netProfit: number; gst: number;
    // §P16-STEP3.1-FIX-D/E: Authoritative vs legacy breakdown + COGS accuracy
    authoritativeIndirectExpenses?: number
    legacyIndirectExpenses?: number
    cogsAccuracy?: { snapshotItems: number; legacyFallbackItems: number; isApproximate: boolean }
  }
  gst: { totalGst: number; breakdown: Array<{ rate: number; taxable: number; gst: number }> }
  partyLedger: Array<{ id: string; name: string; type: string; grade: string; balance: number; phone?: string | null; purchaseVolume?: number }>
  outstanding: {
    totalReceivable: number
    totalPayable: number
    receivables: Array<{ name: string; amount: number; grade: string; phone?: string | null }>
    payables: Array<{ name: string; amount: number; phone?: string | null }>
  }
  stockAgeing: Array<{ name: string; stock: number; value: number; threshold: number; status: string }>
  gradeDistribution: Array<{ grade: string; count: number; balance: number }>
  invoiceCount: number
}

// §PHASE-5-D1: PLRange is now an alias for DashboardRange — same shared type
// across Dashboard, History, and Reports. Reports P&L accepts ALL 9 dashboard
// ranges (1d/yesterday/2d/3d/5d/7d/1m/3m/6m/1y/custom) so a dashboard card
// click carrying any of these ranges is faithfully displayed.
// §STEP-4B-VIEW-ALL: PartySegment + OutstandingTab + OutstandingGradeFilter are
// now imported from app-store (single source of truth — shared with the
// Dashboard View-All resolver in src/lib/dashboard-view-all.ts).
type PLRange = DashboardRange
type GSTRange = 'month' | 'last_month' | 'quarter' | 'custom'
type StockMovement = 'all' | 'fast' | 'slow' | 'non-moving'

export function ReportsView() {
  // §STEP-4B-VIEW-ALL: Pull new context fields set by Dashboard View-All actions.
  // Each is one-shot — consumed on mount, then cleared.
  const { business, setActiveView, reportsDateRange, setReportsDateRange, reportsRangeContext, setReportsRangeContext, reportsTab, setReportsTab, reportsOutstandingTab, setReportsOutstandingTab, reportsOutstandingGradeFilter, setReportsOutstandingGradeFilter, reportsPartySortBy, setReportsPartySortBy, reportsPartySegment, setReportsPartySegment } = useAppStore()
  const { t } = useI18n()

  // Active report tab — declared FIRST because the reportsUrl useMemo below
  // depends on it. (React Hooks rule: hooks must be called in the same order
  // every render, but the dependencies inside useMemo can reference any
  // variable declared above the useMemo call.)
  // §PHASE-5-D4: 'health' is a NEW pseudo-tab that scrolls the user to the
  // Health Breakdown section (rendered inside the P&L tab). It's NOT a real
  // report tab — set as 'pl' but a separate `showHealthBreakdown` flag controls
  // the section's prominent display.
  const [activeReport, setActiveReport] = useState<'pl' | 'gst' | 'party' | 'outstanding' | 'stock' | 'grade'>('pl')
  // §PHASE-5-D4: When the dashboard Business Health card is clicked, this flag
  // is set true on mount to expand the Health Breakdown section prominently.
  const [showHealthBreakdown, setShowHealthBreakdown] = useState(false)

  // P&L date filter (PRD Part 19 §1)
  // §PHASE-5-D1: Default plRange is now '1m' (1 Month) using the shared
  // DashboardRange type — was 'month' (legacy). Same semantic.
  const [plRange, setPlRange] = useState<PLRange>('1m')
  const [plCustomStart, setPlCustomStart] = useState('')
  const [plCustomEnd, setPlCustomEnd] = useState('')

  // GST date filter (PRD Part 19 §2)
  const [gstRange, setGstRange] = useState<GSTRange>('month')
  const [gstCustomStart, setGstCustomStart] = useState('')
  const [gstCustomEnd, setGstCustomEnd] = useState('')

  // §REPORTS-URL: Build the /api/reports URL with date-range query params
  // for the currently active report. The API filters invoices + transactions
  // by the start/end dates. When the active report is not P&L or GST (which
  // are the only date-filterable reports), no date params are sent.
  //
  // §PHASE-5-D1: P&L now uses the NEW `?range=X&startDate=...&endDate=...`
  // path — the Reports API uses `computeRangeBounds` (shared utility) to
  // compute the SAME date boundaries as the Dashboard card. This eliminates
  // the timezone drift bug where Reports used `Date.UTC(...)` but Dashboard
  // used `new Date().setHours()` (local-time). Now both use IST-aligned
  // boundaries from the same utility.
  //
  // GST continues to use the legacy `?start=YYYY-MM-DD&end=YYYY-MM-DD` path
  // because GST's range presets (month/last_month/quarter) are calendar-based
  // and not part of DashboardRange. This is unchanged behavior.
  const reportsUrl = useMemo(() => {
    const params = new URLSearchParams()
    if (activeReport === 'pl') {
      // §PHASE-5-D1: Pass range + customStart/customEnd directly. Reports API
      // recognizes `range` and computes the same boundaries as Dashboard.
      params.set('range', plRange)
      if (plRange === 'custom') {
        if (plCustomStart) params.set('startDate', plCustomStart)
        if (plCustomEnd) params.set('endDate', plCustomEnd)
      }
    } else if (activeReport === 'gst') {
      const { start, end } = computeGstRangeDates(gstRange, gstCustomStart, gstCustomEnd)
      if (start) params.set('start', start)
      if (end) params.set('end', end)
    }
    const qs = params.toString()
    return qs ? `/api/reports?${qs}` : '/api/reports'
  }, [activeReport, plRange, plCustomStart, plCustomEnd, gstRange, gstCustomStart, gstCustomEnd])

  // §REPORTS-TIMEOUT: Reports API may take up to 30s on production Neon PostgreSQL
  // with large datasets. The default 10s useFetch timeout is too short — use 30s
  // matching the API route's maxDuration=30.
  const { data, loading, error, refetch } = useFetch<ReportData>(reportsUrl, [reportsUrl], { timeoutMs: 30000 })
  // §HEALTH-BANNER: fetch dashboard stats for the Business Health score context
  // §PHASE-5-D4: Now also fetches `healthBreakdown` for the new Health Breakdown
  // section. The fetch is unchanged — just typing widened.
  const { data: dashData } = useFetch<{ healthScore?: number; totalReceivable?: number; healthBreakdown?: any } & Record<string, unknown>>('/api/dashboard?range=7d', [])
  const [healthBannerDismissed, setHealthBannerDismissed] = useState(false)
  const { data: allProducts } = useFetch<any[]>('/api/products', [])

  // §REPORTS-ROUTING: Auto-select a report tab passed from the dashboard
  // (e.g. 'outstanding' from Top Debtors, 'party' from Top Buyers).
  // §PHASE-5-D4: If reportsTab === 'health' (Business Health card click),
  // we set activeReport='pl' AND setShowHealthBreakdown(true) so the Health
  // Breakdown section is prominently expanded at the top of P&L.
  useEffect(() => {
    if (!reportsTab) return
    const t = setTimeout(() => {
      if (reportsTab === 'health') {
        setActiveReport('pl')
        setShowHealthBreakdown(true)
      } else {
        setActiveReport(reportsTab as any)
      }
      setReportsTab(null)
    }, 0)
    return () => clearTimeout(t)
  }, [reportsTab, setReportsTab, setActiveReport])

  // §REPORTS-ROUTING (Phase 5 D1): Consume the FULL RangeContext from the
  // dashboard Expense/Revenue card click — {range, customStart, customEnd}.
  // This preserves custom range dates which were previously lost (Phase 4 D1).
  // Applies on mount, then clears the param.
  useEffect(() => {
    if (!reportsRangeContext) return
    const ctx = reportsRangeContext
    const t = setTimeout(() => {
      setPlRange(ctx.range)
      setPlCustomStart(ctx.customStart || '')
      setPlCustomEnd(ctx.customEnd || '')
      // §PHASE-5-D4: Health card click sets 'pl' tab AND shows breakdown.
      // For other cards (Expense/Revenue), just navigate to P&L.
      setActiveReport('pl')
      setReportsRangeContext(null)
    }, 0)
    return () => clearTimeout(t)
  }, [reportsRangeContext, setReportsRangeContext, setPlRange, setPlCustomStart, setPlCustomEnd, setActiveReport])

  // §LEGACY-REPORTS-DATE-RANGE: For any callers still using the old
  // `reportsDateRange` field (older code paths, deep links), preserve backward
  // compat by mapping legacy strings to DashboardRange IDs.
  // 'today' → '1d', 'week' → '7d', 'month' → '1m', '3months' → '3m'.
  useEffect(() => {
    if (!reportsDateRange) return
    const t = setTimeout(() => {
      const legacyMap: Record<string, PLRange> = {
        today: '1d', week: '7d', month: '1m', '3months': '3m', custom: 'custom',
      }
      setPlRange(legacyMap[reportsDateRange] || '1m')
      setReportsDateRange(null)
    }, 0)
    return () => clearTimeout(t)
  }, [reportsDateRange, setReportsDateRange, setPlRange])

  // Party Ledger (PRD Part 19 §3)
  // §STEP-4B-VIEW-ALL: `partySortMode` replaces the boolean `sortByDue` toggle.
  // Supports 'name' (default), 'due' (legacy sortByDue=true), and
  // 'purchaseVolume' (entered from Dashboard Top Buyers View-All).
  const [partySeg, setPartySeg] = useState<PartySegment>('all')
  const [partySearch, setPartySearch] = useState('')
  const [partySortMode, setPartySortMode] = useState<'name' | 'due' | 'purchaseVolume'>('name')

  // Outstanding (PRD Part 19 §4)
  // §STEP-4B-VIEW-ALL: `outstandingGradeFilter` filters the receivables list by
  // quality grade. 'all' = no filter (default); 'D+E' = show D and E only
  // (entered from Dashboard Defaulters View-All).
  const [outstandingTab, setOutstandingTab] = useState<OutstandingTab>('receivables')
  const [outstandingGradeFilter, setOutstandingGradeFilterState] = useState<OutstandingGradeFilter>('all')

  // Stock Ageing (PRD Part 19 §5)
  const [stockMovement, setStockMovement] = useState<StockMovement>('all')

  // Customer Quality (PRD Part 19 §6)
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)

  // §STEP-4B-VIEW-ALL: Consume one-shot navigation context from Dashboard
  // Top Debtors / Defaulters / Top Buyers View-All. Each field is applied on
  // mount, then cleared so it doesn't persist into the next visit. These MUST
  // be declared AFTER the local state setters they reference (React Hooks
  // immutability rule — can't access a variable before it's declared).
  useEffect(() => {
    if (reportsOutstandingTab) {
      const t = setTimeout(() => {
        setOutstandingTab(reportsOutstandingTab)
        setReportsOutstandingTab(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [reportsOutstandingTab, setReportsOutstandingTab, setOutstandingTab])

  useEffect(() => {
    if (reportsOutstandingGradeFilter) {
      const t = setTimeout(() => {
        setOutstandingGradeFilterState(reportsOutstandingGradeFilter)
        setReportsOutstandingGradeFilter(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [reportsOutstandingGradeFilter, setReportsOutstandingGradeFilter, setOutstandingGradeFilterState])

  useEffect(() => {
    if (reportsPartySegment) {
      const t = setTimeout(() => {
        setPartySeg(reportsPartySegment)
        setReportsPartySegment(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [reportsPartySegment, setReportsPartySegment, setPartySeg])

  useEffect(() => {
    if (reportsPartySortBy) {
      const t = setTimeout(() => {
        setPartySortMode(reportsPartySortBy)
        setReportsPartySortBy(null)
      }, 0)
      return () => clearTimeout(t)
    }
  }, [reportsPartySortBy, setReportsPartySortBy, setPartySortMode])

  // P&L: top category leaderboard (PRD Part 19 §1) — computed before early return to satisfy rules of hooks
  const categoryLeaderboard = useMemo(() => {
    if (!allProducts) return []
    const map: Record<string, { value: number; count: number }> = {}
    allProducts.forEach((p) => {
      const c = p.category || 'Uncategorized'
      if (!map[c]) map[c] = { value: 0, count: 0 }
      map[c].value += (toNumber(p.salePrice) - toNumber(p.purchasePrice)) * toNumber(p.stock)
      map[c].count += 1
    })
    return Object.entries(map)
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [allProducts])

  // Party Ledger filtered + sorted (PRD Part 19 §3)
  // §STEP-4B-VIEW-ALL: `partySortMode` supports 'name' (default), 'due'
  // (sort by |balance| desc), and 'purchaseVolume' (sort by purchaseVolume
  // desc — entered from Dashboard Top Buyers View-All). 'purchaseVolume' uses
  // the `purchaseVolume` field returned by /api/reports (computed from
  // sales/retail non-void invoices in the requested range).
  const filteredPartyLedger = useMemo(() => {
    if (!data) return []
    let list = data.partyLedger
    if (partySeg === 'customers') list = list.filter((p) => p.type !== 'supplier')
    if (partySeg === 'suppliers') list = list.filter((p) => p.type !== 'customer')
    if (partySearch.trim()) {
      const q = partySearch.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(partySearch))
    }
    if (partySortMode === 'due') {
      list = [...list].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    } else if (partySortMode === 'purchaseVolume') {
      list = [...list].sort((a, b) => (b.purchaseVolume ?? 0) - (a.purchaseVolume ?? 0))
    }
    return list
  }, [data, partySeg, partySearch, partySortMode])

  // §STEP-4B-VIEW-ALL: Filter receivables by grade when outstandingGradeFilter
  // is set. 'all' = no filter; 'D' = Grade D only; 'E' = Grade E only;
  // 'D+E' = Grade D OR E (entered from Dashboard Defaulters View-All).
  // The Dashboard "Defaulters" insight represents D+E (not just D).
  const filteredReceivables = useMemo(() => {
    if (!data) return []
    if (outstandingGradeFilter === 'all') return data.outstanding.receivables
    if (outstandingGradeFilter === 'D+E') {
      return data.outstanding.receivables.filter((r) => r.grade === 'D' || r.grade === 'E')
    }
    return data.outstanding.receivables.filter((r) => r.grade === outstandingGradeFilter)
  }, [data, outstandingGradeFilter])

  // Stock Ageing movement filter (PRD Part 19 §5)
  const stockAgeing = data?.stockAgeing
  const filteredStockAgeing = useMemo(() => {
    if (!stockAgeing) return []
    if (stockMovement === 'all') return stockAgeing
    if (stockMovement === 'fast') return stockAgeing.filter((s) => s.status === 'good')
    if (stockMovement === 'slow') return stockAgeing.filter((s) => s.status === 'medium')
    if (stockMovement === 'non-moving') return stockAgeing.filter((s) => s.stock > 0 && s.value / s.stock > 100)
    return stockAgeing
  }, [stockAgeing, stockMovement])

  // §ERROR-FIRST: Check error BEFORE loading — if the request timed out or
  // failed, show the ErrorState with a Retry button instead of getting stuck
  // on "Loading…" forever. This is critical because TanStack Query sets
  // `loading=false` + `error=<msg>` when the AbortController fires, and the
  // previous `if (loading || !data)` guard would skip the error state and
  // show LoadingState indefinitely (since !data is true when the query failed).
  if (error) return <ErrorState message={error} onRetry={() => refetch()} />
  if (loading || !data) return <LoadingState />
  const currency = business?.currency || 'INR'
  const bizName = (business?.name || 'BizLedger').replace(/\s+/g, '_')

  const exportPdf = (type: string) => {
    toast.success(`Generating ${type} PDF…`)
    setTimeout(() => window.print(), 200)
  }

  const exportExcel = (label: string) => {
    // §REPORT-TYPE-MAP: Map the human-readable report label to the ReportType
    // enum understood by buildReportCsv. All 6 report types are now supported
    // — previously GST/Stock/Customer Quality produced empty CSVs.
    const reportId = REPORTS.find((r) => r.label === label)?.id as ReportType | undefined
    if (!reportId) {
      toast.error(`Unknown report type: ${label}`)
      return
    }
    toast.success(`CSV export started for ${label}`)
    // §CSV-BUILD: Delegate to the shared helper which handles:
    //   - All 6 report types (P&L, GST, Party, Outstanding, Stock, Grade)
    //   - RFC 4180 escape (commas, quotes, newlines)
    //   - UTF-8 BOM (so Excel renders Bengali correctly)
    const csv = buildReportCsv(reportId, data as any)
    // §ENCODING: The CSV string already starts with the UTF-8 BOM (\uFEFF).
    // Blob with type 'text/csv;charset=utf-8' ensures the BOM is preserved.
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bizName}_${label.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${label} exported`)
  }

  const REPORTS = [
    { id: 'pl', label: t('rep.pl'), icon: TrendingUp },
    { id: 'gst', label: t('rep.gst'), icon: IndianRupee },
    { id: 'party', label: t('rep.partyLedger'), icon: Users },
    { id: 'outstanding', label: t('rep.outstanding'), icon: AlertCircle },
    { id: 'stock', label: t('rep.stockAgeing'), icon: Package },
    { id: 'grade', label: t('rep.gradeDist'), icon: BarChart3 },
  ] as const

  // P&L: bar chart data with net loss highlight (uses netRevenue, not gross)
  const plChartData = [
    { name: 'Net Revenue', value: data.profitLoss.netRevenue, color: '#10b981' },
    { name: 'COGS', value: data.profitLoss.cogs, color: '#f97316' },
    { name: 'Indirect Exp', value: data.profitLoss.indirectExpenses, color: '#f87171' },
    { name: 'Net Profit', value: data.profitLoss.netProfit, color: data.profitLoss.netProfit >= 0 ? '#10b981' : '#ef4444' },
  ]

  // P&L: expense breakdown pie chart (real COGS vs Indirect, not estimated)
  const expenseBreakdown = [
    { name: 'Purchase Cost (COGS)', value: data.profitLoss.cogs },
    { name: 'Indirect Expenses', value: data.profitLoss.indirectExpenses },
  ].filter((e) => e.value > 0)

  // GST breakdown: CGST/SGST/IGST split (PRD Part 19 §2)
  const intraStateSplit = data.gst.totalGst * 0.5
  const interStateSplit = data.gst.totalGst // full IGST
  const itcEstimate = data.gst.totalGst * 0.4 // 40% input tax credit estimate
  const netTaxPayable = Math.max(0, data.gst.totalGst - itcEstimate)

  // Grade distribution with parties (PRD Part 19 §6)
  const gradeParties = (grade: string) => data.partyLedger.filter((p) => p.grade === grade)

  // Customer Quality actions
  const handleRemind = (phone: string | null | undefined, name: string) => {
    if (!phone) {
      toast.error(`${name} has no phone number`)
      return
    }
    const cleaned = phone.replace(/[^0-9]/g, '').replace(/^0/, '91')
    const text = encodeURIComponent(`প্রিয় ${name}, আপনার বকেয়া পেমেন্ট সম্পর্কে অনুরোধ করা হলো। ধন্যবাদ 🙏`)
    window.open(`https://wa.me/${cleaned}?text=${text}`, '_blank')
    toast.success(`Reminder sent to ${name}`)
  }

  const handleOfferGreet = (name: string, type: 'offer' | 'greet') => {
    toast.success(`${type === 'offer' ? 'Offer' : 'Greeting'} message prepared for ${name}`)
  }
  const handleAlertRestrict = (name: string, type: 'alert' | 'restrict') => {
    toast[type === 'alert' ? 'error' : 'warning'](`${type === 'alert' ? 'Alert' : 'Restriction'} applied to ${name}`)
  }

  return (
    <div className="space-y-4">
      {/* Report selector */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {REPORTS.map((r) => {
          const Icon = r.icon
          return (
            <button
              key={r.id}
              onClick={() => setActiveReport(r.id as any)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] ${
                activeReport === r.id ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
              }`}
            >
              <Icon className="w-3.5 h-3.5" /> {r.label}
            </button>
          )
        })}
      </div>

      {/* §EXPORT-BUTTONS: Only 2 buttons — "Export CSV" (contextual per-report CSV download)
          and "Print" (browser print-to-PDF). The old "Download PDF" button was removed
          because it was a duplicate of Print (both called window.print()). */}
      <div className="grid grid-cols-2 gap-2 action-buttons">
        <Button variant="outline" onClick={() => exportExcel(REPORTS.find((r) => r.id === activeReport)!.label)} className="h-11 flex-col text-xs">
          <FileSpreadsheet className="w-4 h-4 mb-0.5" /> {t('rep.exportExcel')}
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="h-11 flex-col text-xs">
          <Printer className="w-4 h-4 mb-0.5" /> {t('rep.print')}
        </Button>
      </div>

      {/* Report content */}
      <motion.div
        key={activeReport}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="print-area space-y-4"
      >
        {activeReport === 'pl' && (
          <>
            {/* §HEALTH-BANNER: dismissible context banner explaining the
                Business Health score the user clicked to get here. */}
            {dashData?.healthScore != null && !healthBannerDismissed && (
              <div className="relative rounded-xl border border-teal-200 dark:border-teal-900/50 bg-teal-50 dark:bg-teal-950/30 p-3 pr-9">
                <button
                  onClick={() => setHealthBannerDismissed(true)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-md hover:bg-teal-100 dark:hover:bg-teal-900/50 flex items-center justify-center text-teal-700 dark:text-teal-300"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-lg bg-teal-100 dark:bg-teal-900/50 flex items-center justify-center shrink-0">
                    <Heart className="w-4 h-4 text-teal-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-teal-800 dark:text-teal-200">
                      Business Health Score: {dashData.healthScore}/100
                    </p>
                    <p className="text-[11px] text-teal-700 dark:text-teal-300 leading-tight mt-0.5">
                      {dashData.healthScore >= 80
                        ? 'Profitability is good'
                        : dashData.healthScore >= 60
                          ? 'Profitability is stable'
                          : 'Profitability needs attention'}
                      {(dashData.totalReceivable ?? 0) > 0 ? ' — check outstanding dues to improve the score.' : ' — keep up the good work.'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* §PHASE-5-D4: Health Breakdown section.
                Shown when the Business Health card was clicked (showHealthBreakdown=true).
                Displays the score's 3 components so the user understands WHAT
                contributes to the score and WHAT to improve:
                  1. Invoice Payment Rate (50 pts max)
                  2. Customer Non-Overdue Rate (30 pts max)
                  3. Stock Health (20 pts max)
                Each component shows: label, value/max, hint with concrete numbers.
                User can dismiss to hide this section. */}
            {showHealthBreakdown && dashData?.healthBreakdown && (
              <div className="relative rounded-xl border border-teal-200 dark:border-teal-900/50 bg-card p-4 pr-9 space-y-3">
                <button
                  onClick={() => setShowHealthBreakdown(false)}
                  className="absolute top-2 right-2 w-6 h-6 rounded-md hover:bg-muted flex items-center justify-center text-muted-foreground"
                  aria-label="Dismiss"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <div className="flex items-center gap-2">
                  <Heart className="w-4 h-4 text-teal-600" />
                  <h3 className="text-sm font-semibold">Business Health Breakdown</h3>
                  <span className="text-xs font-bold text-teal-700 dark:text-teal-300 ml-auto pr-6">
                    {dashData.healthBreakdown.score}/100
                  </span>
                </div>
                <div className="space-y-2.5">
                  {dashData.healthBreakdown.components?.map((c: any) => (
                    <div key={c.id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium">{c.label}</span>
                        <span className="tabular text-muted-foreground">{c.value}/{c.max} pts</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                        <div
                          className="h-full bg-teal-500 rounded-full transition-all"
                          style={{ width: `${Math.min(100, (c.value / c.max) * 100)}%` }}
                        />
                      </div>
                      <p className="text-[10px] text-muted-foreground leading-tight">{c.hint}</p>
                    </div>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground pt-2 border-t border-border">
                  Score = Payment Rate (50) + Non-Overdue Rate (30) + Stock Health (20). Improve each component to raise your overall score.
                </p>
              </div>
            )}
            {/* Date filter chips (PRD Part 19 §1)
                §PHASE-5-D1: Now uses the FULL DASHBOARD_RANGES list — same range
                IDs as the Dashboard. When the user clicks an Expense/Revenue card
                with "3 Days" selected, Reports P&L opens showing "3 Days" (not
                "Week" as before, which meant a different window). */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {DASHBOARD_RANGES.map((r) => (
                <button
                  key={r.id}
                  onClick={() => setPlRange(r.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                    plRange === r.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {plRange === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={plCustomStart} onChange={(e) => setPlCustomStart(e.target.value)} className="h-9 text-xs" />
                <Input type="date" value={plCustomEnd} onChange={(e) => setPlCustomEnd(e.target.value)} className="h-9 text-xs" />
              </div>
            )}

            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-4">{t('rep.pl')}</h3>
              <div className="space-y-2.5">
                {/* §ACCOUNTING FLOW:
                    Total Sales (subtotal)
                    − Discounts Given
                    = Net Revenue
                    − Purchase Cost (COGS)
                    = Gross Profit
                    − Indirect Expenses
                    = Net Profit
                    Numbers add up/subtract visibly so shopkeepers trust the math. */}
                <Row icon={TrendingUp} label="Total Sales (Gross)" value={formatCurrency(data.profitLoss.revenue, currency)} color="text-emerald-600" />
                <Row icon={IndianRupee} label="Less: Discounts Given" value={`− ${formatCurrency(data.profitLoss.discount, currency)}`} color="text-purple-600" />
                <div className="pt-2 border-t border-dashed border-border">
                  <Row icon={TrendingUp} label="Net Revenue" value={formatCurrency(data.profitLoss.netRevenue, currency)} color="text-emerald-600" bold />
                </div>
                <Row icon={Package} label="Less: Purchase Cost (COGS)" value={`− ${formatCurrency(data.profitLoss.cogs, currency)}`} color="text-orange-600" />
                {/* §P16-STEP3.1-FIX-E: COGS accuracy disclosure — show warning when
                    legacy InvoiceItems (NULL purchasePriceSnapshot) use approximate
                    fallback pricing. Only shown when legacyFallbackItems > 0. */}
                {data.profitLoss.cogsAccuracy?.isApproximate && (
                  <p className="text-[10px] text-amber-600 dark:text-amber-400 pl-6">
                    ⚠ {data.profitLoss.cogsAccuracy.legacyFallbackItems} item(s) use approximate cost (no historical snapshot)
                  </p>
                )}
                <div className="pt-2 border-t border-dashed border-border">
                  <Row icon={BarChart3} label="Gross Profit" value={formatCurrency(data.profitLoss.grossProfit, currency)} color={data.profitLoss.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} bold />
                </div>
                <Row icon={TrendingDown} label="Less: Indirect Expenses" value={`− ${formatCurrency(data.profitLoss.indirectExpenses, currency)}`} color="text-red-600" />
                {/* §P16-STEP3.1-FIX-D: Disclose authoritative vs legacy OpEx breakdown.
                    When legacyIndirectExpenses > 0, show the split so users know
                    how much is authoritative vs unclassified legacy. */}
                {(data.profitLoss.legacyIndirectExpenses || 0) > 0 && (
                  <div className="pl-6 space-y-0.5">
                    <p className="text-[10px] text-muted-foreground">
                      Authoritative: {formatCurrency(data.profitLoss.authoritativeIndirectExpenses || 0, currency)}
                    </p>
                    <p className="text-[10px] text-amber-600 dark:text-amber-400">
                      ⚠ Unclassified (legacy): {formatCurrency(data.profitLoss.legacyIndirectExpenses || 0, currency)}
                    </p>
                  </div>
                )}
                <div className="pt-3 border-t-2 border-border">
                  <Row icon={BarChart3} label="Net Profit" value={formatCurrency(data.profitLoss.netProfit, currency)} color={data.profitLoss.netProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} bold />
                </div>
                {/* GST shown separately (collected on behalf of govt, not part of profit) */}
                <div className="pt-2 mt-1 bg-amber-50 dark:bg-amber-950/20 rounded-lg p-2.5">
                  <Row icon={IndianRupee} label="GST Collected (liability)" value={formatCurrency(data.profitLoss.gst, currency)} color="text-amber-600" />
                </div>
              </div>
            </Card>

            {/* Revenue vs Expense bar chart (red highlight for net loss) */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold mb-3">Revenue vs Expense</h3>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={plChartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                    <Tooltip contentStyle={{ borderRadius: 12, fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {plChartData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {data.profitLoss.netProfit < 0 && (
                <p className="text-xs text-red-600 font-medium text-center mt-2">⚠ Net Loss — expenses exceed revenue</p>
              )}
            </Card>

            {/* Expense Breakdown pie chart */}
            {expenseBreakdown.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3">Expense Breakdown</h3>
                {/* §PIE-FIX: Removed inline `label` prop (drew text ON the pie
                    slices → overlapped/clipped behind the chart graphic).
                    Chart is now label-free; a custom legend list below shows
                    color dot + name + amount + percentage with proper spacing. */}
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={expenseBreakdown} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}>
                        {expenseBreakdown.map((_, i) => <Cell key={i} fill={PIE_COLORS[i]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => formatCurrency(v, currency)} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                {/* Custom legend — proper spacing, no overlap with chart */}
                <div className="mt-3 space-y-2">
                  {expenseBreakdown.map((e, i) => {
                    const total = expenseBreakdown.reduce((s, x) => s + x.value, 0) || 1
                    const pct = ((e.value / total) * 100).toFixed(0)
                    return (
                      <div key={e.name} className="flex items-center gap-2 text-xs">
                        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: PIE_COLORS[i] }} />
                        <span className="flex-1 truncate text-muted-foreground">{e.name}</span>
                        <span className="font-semibold tabular">{formatCurrency(e.value, currency)}</span>
                        <span className="text-muted-foreground tabular w-8 text-right">{pct}%</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}

            {/* Top Category leaderboard with medals (PRD Part 19 §1) */}
            {categoryLeaderboard.length > 0 && (
              <Card className="p-5">
                <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
                  <Medal className="w-4 h-4 text-amber-600" /> Top Categories
                </h3>
                <div className="space-y-2">
                  {categoryLeaderboard.map((cat, i) => {
                    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`
                    return (
                      <div key={cat.name} className="flex items-center gap-3 p-2 rounded-xl bg-muted/50">
                        <span className="text-lg shrink-0">{medal}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{cat.name}</p>
                          <p className="text-[11px] text-muted-foreground">{cat.count} products</p>
                        </div>
                        <span className="text-sm font-bold tabular text-primary">{formatCurrency(cat.value, currency)}</span>
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
          </>
        )}

        {activeReport === 'gst' && (
          <>
            {/* Date filter chips (PRD Part 19 §2) */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {([
                { id: 'month', label: 'This Month' },
                { id: 'last_month', label: 'Last Month' },
                { id: 'quarter', label: 'Quarter' },
                { id: 'custom', label: 'Custom' },
              ] as const).map((r) => (
                <button
                  key={r.id}
                  onClick={() => setGstRange(r.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                    gstRange === r.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {gstRange === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <Input type="date" value={gstCustomStart} onChange={(e) => setGstCustomStart(e.target.value)} className="h-9 text-xs" />
                <Input type="date" value={gstCustomEnd} onChange={(e) => setGstCustomEnd(e.target.value)} className="h-9 text-xs" />
              </div>
            )}

            <Card className="p-5">
              <div className="text-center py-2 mb-4">
                <p className="text-xs text-muted-foreground">Total GST Collected</p>
                <p className="text-3xl font-bold tabular text-amber-600">{formatCurrency(data.gst.totalGst, currency)}</p>
              </div>

              {/* CGST/SGST/IGST split (PRD Part 19 §2) */}
              <div className="grid grid-cols-2 gap-2 mb-4">
                <div className="p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30">
                  <p className="text-[10px] text-muted-foreground">Intra-State (CGST+SGST)</p>
                  <p className="text-sm font-bold tabular text-blue-700 dark:text-blue-300">{formatCurrency(intraStateSplit, currency)}</p>
                  <p className="text-[9px] text-muted-foreground">CGST 9% + SGST 9%</p>
                </div>
                <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/30">
                  <p className="text-[10px] text-muted-foreground">Inter-State (IGST)</p>
                  <p className="text-sm font-bold tabular text-purple-700 dark:text-purple-300">{formatCurrency(interStateSplit, currency)}</p>
                  <p className="text-[9px] text-muted-foreground">IGST 18% (full)</p>
                </div>
              </div>

              {/* ITC vs Output Tax Net Tax Payable calculator (PRD Part 19 §2) */}
              <div className="p-3 rounded-xl bg-muted/50 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Output Tax (Sales)</span>
                  <span className="tabular font-medium">{formatCurrency(data.gst.totalGst, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Input Tax Credit (ITC)</span>
                  <span className="tabular font-medium text-emerald-600">-{formatCurrency(itcEstimate, currency)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-border font-bold">
                  <span>Net Tax Payable</span>
                  <span className="tabular text-amber-600">{formatCurrency(netTaxPayable, currency)}</span>
                </div>
              </div>

              {data.gst.breakdown.length > 0 && (
                <div className="space-y-2 mt-4">
                  <p className="text-xs font-semibold text-muted-foreground uppercase">Rate-wise Breakdown</p>
                  {data.gst.breakdown.map((b) => (
                    <div key={b.rate} className="flex items-center justify-between p-3 rounded-xl bg-muted/50 text-sm">
                      <div>
                        <p className="font-medium">{b.rate}% GST</p>
                        <p className="text-[11px] text-muted-foreground">Taxable: {formatCurrency(b.taxable, currency)}</p>
                      </div>
                      <p className="font-semibold tabular text-amber-600">{formatCurrency(b.gst, currency)}</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}

        {activeReport === 'party' && (
          <Card className="p-5">
            {/* Summary cards (PRD Part 19 §3) */}
            <div className="grid grid-cols-2 gap-2 mb-4">
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30">
                <p className="text-[10px] text-emerald-700 dark:text-emerald-300">Total Receivable</p>
                <p className="text-sm font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(data.outstanding.totalReceivable, currency)}</p>
              </div>
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/30">
                <p className="text-[10px] text-red-700 dark:text-red-300">Total Payable</p>
                <p className="text-sm font-bold tabular text-red-700 dark:text-red-300">{formatCurrency(data.outstanding.totalPayable, currency)}</p>
              </div>
            </div>

            {/* Segmented filter */}
            <div className="flex items-center gap-1 mb-3 bg-muted rounded-lg p-1">
              {(['all', 'customers', 'suppliers'] as const).map((seg) => (
                <button
                  key={seg}
                  onClick={() => setPartySeg(seg)}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium capitalize ${partySeg === seg ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
                >
                  {seg}
                </button>
              ))}
            </div>

            {/* Inline search */}
            <Input
              value={partySearch}
              onChange={(e) => setPartySearch(e.target.value)}
              placeholder="Search parties…"
              className="h-10 mb-3 text-sm"
            />

            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">{t('rep.partyLedger')} ({filteredPartyLedger.length})</h3>
              {/* §STEP-4B-VIEW-ALL: Sort selector — cycle through 'name' → 'due' →
                  'purchaseVolume'. When entered from Dashboard Top Buyers View-All,
                  `partySortMode` starts as 'purchaseVolume' so the buyer ranking
                  is preserved. The button is highlighted when not 'name'. */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setPartySortMode(partySortMode === 'name' ? 'due' : partySortMode === 'due' ? 'purchaseVolume' : 'name')}
                  className={`text-[10px] px-2 py-1 rounded-lg ${partySortMode !== 'name' ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
                >
                  Sort: {partySortMode === 'name' ? 'Name' : partySortMode === 'due' ? 'By Due' : 'By Purchase Vol.'}
                </button>
              </div>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-area">
              {filteredPartyLedger.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {partySearch.trim()
                    ? `No parties match "${partySearch}"`
                    : partySeg === 'customers'
                    ? 'No customers yet — add your first customer from Khata'
                    : partySeg === 'suppliers'
                    ? 'No suppliers yet — add your first supplier from Khata'
                    : 'No parties yet — add your first customer or supplier from Khata'}
                </div>
              )}
              {filteredPartyLedger.map((p) => {
                const meta = GRADE_META[p.grade]
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      useAppStore.getState().setSelectedPartyId(p.id)
                      useAppStore.getState().setActiveView('khata')
                    }}
                    className="w-full flex items-center gap-3 p-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left"
                  >
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700 text-sm shrink-0">
                      {p.name.charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-[11px] text-muted-foreground capitalize">
                        {p.type}
                        {/* §STEP-4B-VIEW-ALL: When sorted by purchaseVolume,
                            show the purchase volume as a subtitle so the ranking
                            metric is visible (matches Dashboard Top Buyers). */}
                        {partySortMode === 'purchaseVolume' && (p.purchaseVolume ?? 0) > 0 && (
                          <span className="ml-1 text-emerald-600">· {formatCurrency(p.purchaseVolume ?? 0, currency)} bought</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold tabular ${p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {formatCurrency(Math.abs(p.balance), currency)}
                      </p>
                      {/* §UX: Explicit subtitle text — never rely solely on color */}
                      <p className={`text-[10px] font-medium ${p.balance > 0 ? 'text-emerald-600/70' : p.balance < 0 ? 'text-red-600/70' : 'text-muted-foreground'}`}>
                        {p.balance > 0 ? 'Due' : p.balance < 0 ? 'Payable' : 'Settled'}
                      </p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{p.grade}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </Card>
        )}

        {activeReport === 'outstanding' && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Card className="p-4 bg-emerald-50 dark:bg-emerald-950/30 border-transparent">
                <p className="text-xs text-emerald-700 dark:text-emerald-300">{t('rep.totalReceivable')}</p>
                <p className="text-xl font-bold tabular text-emerald-700 dark:text-emerald-300">{formatCurrency(data.outstanding.totalReceivable, currency)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{data.outstanding.receivables.length} parties</p>
              </Card>
              <Card className="p-4 bg-red-50 dark:bg-red-950/30 border-transparent">
                <p className="text-xs text-red-700 dark:text-red-300">{t('rep.totalPayable')}</p>
                <p className="text-xl font-bold tabular text-red-700 dark:text-red-300">{formatCurrency(data.outstanding.totalPayable, currency)}</p>
                <p className="text-[10px] text-muted-foreground mt-1">{data.outstanding.payables.length} suppliers</p>
              </Card>
            </div>

            {/* Dual-tab (PRD Part 19 §4) */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <button
                onClick={() => setOutstandingTab('receivables')}
                className={`flex-1 py-2 rounded-md text-xs font-medium ${outstandingTab === 'receivables' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                Receivables (পাবো)
              </button>
              <button
                onClick={() => setOutstandingTab('payables')}
                className={`flex-1 py-2 rounded-md text-xs font-medium ${outstandingTab === 'payables' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
              >
                Payables (দেবো)
              </button>
            </div>

            {/* §STEP-4B-VIEW-ALL: Grade filter banner. Shown when the user
                arrived from Dashboard Defaulters View-All (grade='D+E') or
                selected a grade filter manually. Dismissible — clears the
                filter so all receivables are shown again. */}
            {outstandingTab === 'receivables' && outstandingGradeFilter !== 'all' && (
              <div className="flex items-center justify-between gap-2 p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
                <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                  Filtered to Grade {outstandingGradeFilter} · {filteredReceivables.length} {filteredReceivables.length === 1 ? 'party' : 'parties'}
                </p>
                <button
                  onClick={() => setOutstandingGradeFilterState('all')}
                  className="text-[10px] px-2 py-1 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/70 transition-colors"
                >
                  Clear filter
                </button>
              </div>
            )}

            <Card className="p-5">
              {outstandingTab === 'receivables' ? (
                <>
                  <h3 className="text-sm font-semibold mb-3">
                    Receivables
                    {/* §STEP-4B-VIEW-ALL: Show the filtered count alongside the
                        total when a grade filter is active. */}
                    {outstandingGradeFilter !== 'all' && (
                      <span className="ml-1 text-[11px] text-muted-foreground font-normal">
                        ({filteredReceivables.length} of {data.outstanding.receivables.length})
                      </span>
                    )}
                  </h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto scroll-area">
                    {filteredReceivables.length === 0 && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        {outstandingGradeFilter !== 'all'
                          ? `✓ No receivables in Grade ${outstandingGradeFilter}.`
                          : '✓ No outstanding receivables — all customers have paid their dues.'}
                      </div>
                    )}
                    {filteredReceivables.map((r, i) => {
                      const party = data.partyLedger.find((p) => p.name === r.name)
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/50"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <span className={`w-1.5 h-1.5 rounded-full ${GRADE_META[r.grade]?.bg}`} />
                            <button
                              onClick={() => { if (party) { useAppStore.getState().setSelectedPartyId(party.id); useAppStore.getState().setActiveView('khata') } }}
                              className="truncate text-left hover:text-primary"
                            >
                              {r.name}
                            </button>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-semibold tabular text-emerald-600">{formatCurrency(r.amount, currency)}</span>
                            {/* Remind button (megaphone) (PRD Part 19 §4) */}
                            <button
                              onClick={() => handleRemind(r.phone, r.name)}
                              className="w-7 h-7 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600"
                              aria-label="Send reminder"
                            >
                              <Megaphone className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <>
                  <h3 className="text-sm font-semibold mb-3">Payables</h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto scroll-area">
                    {data.outstanding.payables.length === 0 && (
                      <div className="text-center py-6 text-sm text-muted-foreground">
                        ✓ No outstanding payables — all suppliers have been paid.
                      </div>
                    )}
                    {data.outstanding.payables.map((p, i) => {
                      const party = data.partyLedger.find((pp) => pp.name === p.name)
                      return (
                        <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg bg-muted/50">
                          <button
                            onClick={() => { if (party) { useAppStore.getState().setSelectedPartyId(party.id); useAppStore.getState().setActiveView('khata') } }}
                            className="truncate text-left hover:text-primary"
                          >
                            {p.name}
                          </button>
                          <span className="font-semibold tabular text-red-600">{formatCurrency(p.amount, currency)}</span>
                        </div>
                      )
                    })}
                  </div>
                </>
              )}
            </Card>
          </div>
        )}

        {activeReport === 'stock' && (
          <Card className="p-5">
            {/* Movement filter (PRD Part 19 §5) */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1 mb-3">
              {([
                { id: 'all', label: 'All' },
                { id: 'fast', label: 'Fast Moving' },
                { id: 'slow', label: 'Slow Moving' },
                { id: 'non-moving', label: 'Non-Moving' },
              ] as const).map((m) => (
                <button
                  key={m.id}
                  onClick={() => setStockMovement(m.id)}
                  className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium ${
                    stockMovement === m.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <h3 className="text-sm font-semibold mb-4">{t('rep.stockAgeing')}</h3>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-area">
              {filteredStockAgeing.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {stockMovement === 'all'
                    ? 'No products yet — add your first product from Inventory'
                    : `No ${stockMovement === 'fast' ? 'fast-moving' : stockMovement === 'slow' ? 'slow-moving' : 'non-moving'} products found`}
                </div>
              )}
              {filteredStockAgeing.map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between p-3 rounded-xl bg-muted/50"
                >
                  <div className="min-w-0 flex-1">
                    <button
                      onClick={() => {
                        const product = allProducts?.find((p: any) => p.name === s.name)
                        if (product) {
                          useAppStore.getState().setSelectedProductId(product.id)
                          useAppStore.getState().setActiveView('inventory')
                        }
                      }}
                      className="text-left hover:text-primary"
                    >
                      <p className="text-sm font-medium">{s.name}</p>
                      <p className="text-[11px] text-muted-foreground">{s.stock} units · {formatCurrency(s.value, currency)}</p>
                    </button>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${
                      s.status === 'low' ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                      : s.status === 'medium' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300'
                      : 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300'
                    }`}>
                      {s.status.toUpperCase()}
                    </span>
                    {/* Source Order button → B2B sourcing (PRD Part 19 §5) */}
                    <button
                      onClick={() => {
                        useAppStore.getState().setActiveView('sourcing')
                        toast.info(`Source ${s.name} from B2B Sourcing`)
                      }}
                      className="w-7 h-7 rounded-lg bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600"
                      aria-label="Source order"
                    >
                      <ShoppingCart className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}

        {activeReport === 'grade' && (
          <Card className="p-5">
            <h3 className="text-sm font-semibold mb-4">{t('rep.gradeDist')}</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data.gradeDistribution}
                    dataKey="count"
                    nameKey="grade"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    label={(e: any) => `${e.grade}: ${e.count}`}
                  >
                    {data.gradeDistribution.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Customer Quality: grade drill-down expandable lists (PRD Part 19 §6) */}
            <div className="space-y-2 mt-4">
              {data.gradeDistribution.map((g, i) => {
                const meta = GRADE_META[g.grade]
                const parties = gradeParties(g.grade)
                const expanded = expandedGrade === g.grade
                return (
                  <div key={g.grade} className="rounded-xl bg-muted/30 overflow-hidden">
                    <button
                      onClick={() => setExpandedGrade(expanded ? null : g.grade)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted/50 transition-colors"
                    >
                      <span className="w-3 h-3 rounded-full" style={{ background: PIE_COLORS[i] }} />
                      <div className="flex-1 text-left">
                        <span className={`text-sm font-bold ${meta.color}`}>Grade {g.grade}</span>
                        <span className="text-[11px] text-muted-foreground ml-2">{meta.desc}</span>
                      </div>
                      <span className="text-sm font-semibold tabular">{g.count}</span>
                      {expanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
                    </button>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        className="border-t border-border"
                      >
                        {parties.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-3">No parties in this grade</p>
                        ) : (
                          parties.map((p) => (
                            <div key={p.id} className="flex items-center gap-2 p-2 hover:bg-muted/30">
                              <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center text-[10px] font-bold">
                                {p.name.charAt(0)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate">{p.name}</p>
                                <p className="text-[10px] text-muted-foreground">
                                  {formatCurrency(Math.abs(p.balance), currency)}
                                </p>
                              </div>
                              {/* Grade A & B: Offer/Greet button (PRD Part 19 §6) */}
                              {(g.grade === 'A' || g.grade === 'B') && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleOfferGreet(p.name, 'offer')}
                                    className="text-[9px] px-2 py-1 rounded-md bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 flex items-center gap-0.5"
                                  >
                                    <Gift className="w-2.5 h-2.5" /> Offer
                                  </button>
                                  <button
                                    onClick={() => handleOfferGreet(p.name, 'greet')}
                                    className="text-[9px] px-2 py-1 rounded-md bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 flex items-center gap-0.5"
                                  >
                                    <Bell className="w-2.5 h-2.5" /> Greet
                                  </button>
                                </div>
                              )}
                              {/* Grade D & E: Alert/Restrict button (PRD Part 19 §6) */}
                              {(g.grade === 'D' || g.grade === 'E') && (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleAlertRestrict(p.name, 'alert')}
                                    className="text-[9px] px-2 py-1 rounded-md bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300 flex items-center gap-0.5"
                                  >
                                    <AlertCircle className="w-2.5 h-2.5" /> Alert
                                  </button>
                                  <button
                                    onClick={() => handleAlertRestrict(p.name, 'restrict')}
                                    className="text-[9px] px-2 py-1 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 flex items-center gap-0.5"
                                  >
                                    <Ban className="w-2.5 h-2.5" /> Restrict
                                  </button>
                                </div>
                              )}
                            </div>
                          ))
                        )}
                      </motion.div>
                    )}
                  </div>
                )
              })}
            </div>
          </Card>
        )}
      </motion.div>

      {/* Recent Invoices section REMOVED from all tabs (PRD Part 19 §7) */}
    </div>
  )
}

function Row({
  icon: Icon, label, value, color, bold,
}: { icon: any; label: string; value: string; color: string; bold?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`w-8 h-8 rounded-lg bg-muted flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </span>
      <span className={`flex-1 text-sm ${bold ? 'font-semibold' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`tabular ${bold ? 'text-lg font-bold' : 'text-sm font-semibold'} ${color}`}>{value}</span>
    </div>
  )
}
