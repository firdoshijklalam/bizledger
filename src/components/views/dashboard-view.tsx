'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { DashboardStats, Party, Product } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META, timeAgo } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Wallet, Heart, AlertTriangle, Package,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Users, Receipt, ChevronRight,
  BarChart3, LineChart, X, Loader2, Calendar,
  MapPin, Phone, Building2, ShieldCheck, Store, Settings, Camera, Eye, EyeOff,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  Bar, BarChart, Cell, Pie, PieChart, Line, LineChart as RechartsLineChart, ComposedChart, ReferenceLine,
} from 'recharts'
import { Card } from '@/components/ui/card'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { LoadingState, EmptyState, ErrorState } from '@/components/shared/states'
import { useScrollRetention } from '@/hooks/use-scroll-retention'
import { useScrollStore } from '@/store/scroll-store'
import { useRealtimeOrders } from '@/hooks/use-realtime-orders'
import { toNumber } from '@/lib/numeric'
import { useMemo, useState, useEffect, useRef } from 'react'

type ChartType = 'revenue' | 'profit' | 'cashflow' | 'collections' | 'categories' | 'inventory'
type ChartView = 'line' | 'bar'
type TimeRange = 'yesterday' | '1d' | '2d' | '3d' | '5d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'custom'

interface ExtendedDashboardStats extends DashboardStats {
  topCategories?: Array<{ name: string; value: number }>
  topProductsBySales?: Array<{ name: string; value: number }>
  // §DATA-BINDING-FIX: Top Buyers (customers by purchase volume) + Top Products by units
  topBuyers?: Array<{ id: string; name: string; value: number }>
  topProductsByUnits?: Array<{ name: string; value: number; revenue: number }>
  inventoryValue?: number
  inventoryTrend?: Array<{ month: string; value: number }>
  // §LOCALIZED-CARD-FILTERS: range-aware totals (computed over the requested range)
  rangeSales?: number
  rangeCollection?: number
  rangeExpense?: number
}

const TIME_RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '1d', label: 'Today' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '2d', label: '2 Days' },
  { id: '3d', label: '3 Days' },
  { id: '5d', label: '5 Days' },
  { id: '7d', label: '7 Days' },
  { id: '1m', label: '1 Month' },
  { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' },
  { id: '1y', label: '1 Year' },
  { id: 'custom', label: 'Custom' },
]

const PIE_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

// §ROUTING: Map a dashboard TimeRange → History DateRange.
// History only has today/yesterday/week/custom, so multi-day ranges collapse to 'week'.
function mapToHistoryRange(r: TimeRange): 'today' | 'yesterday' | 'week' | 'custom' {
  if (r === '1d') return 'today'
  if (r === 'yesterday') return 'yesterday'
  if (r === 'custom') return 'custom'
  return 'week' // 2d/3d/5d/7d/1m/3m/6m/1y → week
}

// §ROUTING: Map a dashboard TimeRange → Reports PLRange.
// P&L has today/week/month/3months/custom.
function mapToReportsRange(r: TimeRange): 'today' | 'week' | 'month' | '3months' | 'custom' {
  if (r === '1d') return 'today'
  if (r === 'yesterday') return 'today' // P&L has no yesterday → today is closest
  if (r === 'custom') return 'custom'
  if (r === '2d' || r === '3d' || r === '5d' || r === '7d') return 'week'
  if (r === '1m') return 'month'
  if (r === '3m' || r === '6m' || r === '1y') return '3months'
  return 'month'
}

export function DashboardView() {
  const { business, setActiveView, setKhataFilter, setKhataGradeFilter, setInventoryFilter, setSelectedPartyId, setSelectedInvoiceId, triggerQuickAction, setReturnToView, setOverlayPartyId, setOverlayInvoiceId, setHistoryDateRange, setReportsDateRange, setReportsTab } = useAppStore()
  const { t } = useI18n()
  const [chartType, setChartType] = useState<ChartType>('revenue')
  const [chartView, setChartView] = useState<ChartView>('line')
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
  const [topTab, setTopTab] = useState<'debtors' | 'buyers' | 'payments' | 'products' | 'defaulters'>('debtors')
  const [topExpanded, setTopExpanded] = useState(false)
  const [hubTab, setHubTab] = useState<'transactions' | 'lowstock' | 'orders'>('transactions')
  const [hubExpanded, setHubExpanded] = useState(false)
  // §QUICK-CUSTOMIZE: Bottom sheet for Business Overview card customization
  const [showCustomize, setShowCustomize] = useState(false)
  // §CARD-PREFS: Business-level preferences persisted via AppSettings.cardPreferences
  // Falls back to defaults when null, missing keys, or malformed JSON.
  const DEFAULT_PREFS = {
    showOwner: true,
    showAddress: true,
    showPhone: true,
    showGstin: true,
    greetingText: 'Namaste',
    coverBlur: 8,
    coverOverlay: 0.35,
  }
  const [cardPrefs, setCardPrefs] = useState(DEFAULT_PREFS)
  // §DRAFT-STATE: Local draft for the customization sheet. Changes are NOT
  // persisted until the user clicks "Save Changes". Cancel discards the draft.
  const [draft, setDraft] = useState(DEFAULT_PREFS)
  const [draftLogo, setDraftLogo] = useState<string | null | undefined>(undefined) // undefined = no change
  const [draftCover, setDraftCover] = useState<string | null | undefined>(undefined)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const parseCardPrefs = (raw: any) => {
    const defaults = DEFAULT_PREFS
    if (!raw) return defaults
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
      return {
        showOwner: parsed.showOwner ?? defaults.showOwner,
        showAddress: parsed.showAddress ?? defaults.showAddress,
        showPhone: parsed.showPhone ?? defaults.showPhone,
        showGstin: parsed.showGstin ?? defaults.showGstin,
        greetingText: typeof parsed.greetingText === 'string' ? parsed.greetingText.slice(0, 30) : defaults.greetingText,
        coverBlur: typeof parsed.coverBlur === 'number' ? Math.max(0, Math.min(20, parsed.coverBlur)) : defaults.coverBlur,
        coverOverlay: typeof parsed.coverOverlay === 'number' ? Math.max(0, Math.min(0.9, parsed.coverOverlay)) : defaults.coverOverlay,
      }
    } catch {
      return defaults
    }
  }

  // §OPEN-CUSTOMIZER: Initialize draft from current saved state
  const openCustomizer = () => {
    setDraft(cardPrefs)
    setDraftLogo(undefined) // undefined = no change from saved
    setDraftCover(undefined)
    setSaveError(null)
    setSaveSuccess(false)
    setShowCustomize(true)
  }

  // §CANCEL: Discard draft and close
  const cancelCustomizer = () => {
    setDraft(cardPrefs)
    setDraftLogo(undefined)
    setDraftCover(undefined)
    setSaveError(null)
    setSaveSuccess(false)
    setShowCustomize(false)
  }

  // §SAVE: Persist ALL draft changes in ONE atomic API call.
  // Uses POST /api/card-customization which wraps Business + AppSettings
  // updates inside a single Prisma $transaction. If any part fails,
  // everything rolls back — no partial-save state.
  const saveChanges = async () => {
    setSaving(true)
    setSaveError(null)
    setSaveSuccess(false)
    try {
      // Build request body — only include fields that changed
      const payload: Record<string, unknown> = {}
      if (draftLogo !== undefined) payload.logoUrl = draftLogo
      if (draftCover !== undefined) payload.coverUrl = draftCover
      // Always send cardPreferences (it's the full draft state)
      payload.cardPreferences = JSON.stringify(draft)

      const res = await fetch('/api/card-customization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')

      // §UPDATE-LOCAL-STATE: No page reload — update Zustand store + local prefs
      setCardPrefs(draft)
      if (draftLogo !== undefined && business) {
        useAppStore.getState().setBusiness({ ...business, logoUrl: draftLogo })
      }
      if (draftCover !== undefined && business) {
        useAppStore.getState().setBusiness({ ...business, coverUrl: draftCover })
      }
      setSaveSuccess(true)
      // Close sheet after short delay so user sees success
      setTimeout(() => {
        setShowCustomize(false)
        setSaveSuccess(false)
      }, 800)
    } catch {
      setSaveError('Could not save changes')
    } finally {
      setSaving(false)
    }
  }

  // §DIRTY-STATE: Check if draft differs from saved state
  const isDirty = (() => {
    if (draftLogo !== undefined) return true
    if (draftCover !== undefined) return true
    return JSON.stringify(draft) !== JSON.stringify(cardPrefs)
  })()

  // §IMAGE-UPLOAD-DRAFT: Compress image and set in draft (NOT persisted yet)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const coverInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadingCover, setUploadingCover] = useState(false)
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'coverUrl') => {
    const file = e.target.files?.[0]
    if (!file) return
    if (field === 'logoUrl') setUploading(true)
    else setUploadingCover(true)
    try {
      const reader = new FileReader()
      reader.onload = async () => {
        const base64 = reader.result as string
        // Compress via existing API
        const compressRes = await fetch('/api/image-compress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64, targetSizeKB: 200 }),
        })
        const compressed = await compressRes.json()
        const finalImage = compressed.ok ? compressed.image : base64
        // Set in draft (NOT persisted — user must click Save)
        if (field === 'logoUrl') setDraftLogo(finalImage)
        else setDraftCover(finalImage)
      }
      reader.readAsDataURL(file)
    } catch {
      // best-effort
    } finally {
      if (field === 'logoUrl') setUploading(false)
      else setUploadingCover(false)
    }
  }

  // §SUGGESTED-COVERS: CSS gradient-based covers (no external assets needed)
  const SUGGESTED_COVERS = [
    'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    'linear-gradient(135deg, #0f172a 0%, #1e3a5f 100%)',
    'linear-gradient(135deg, #064e3b 0%, #10b981 100%)',
    'linear-gradient(135deg, #7c2d12 0%, #f59e0b 100%)',
    'linear-gradient(135deg, #1e293b 0%, #475569 100%)',
    'linear-gradient(135deg, #581c87 0%, #c026d3 100%)',
    'linear-gradient(135deg, #0c4a6e 0%, #38bdf8 100%)',
    'linear-gradient(135deg, #166534 0%, #84cc16 100%)',
  ]

  // §RESET-DEFAULTS: Reset draft to recommended defaults
  const resetToDefaults = () => {
    setDraft(DEFAULT_PREFS)
    setDraftLogo(null) // null = remove logo
    setDraftCover(null) // null = remove cover
  }

  const { saveScroll } = useScrollRetention()
  const { save: saveScrollPos, restore: restoreScrollPos } = useScrollStore()

  // PRD Part 7 §3: restore scroll position on mount
  useEffect(() => {
    restoreScrollPos('dashboard')
  }, [restoreScrollPos])

  // PRD Part 7 §3: save scroll position when leaving the view
  useEffect(() => {
    return () => {
      saveScrollPos('dashboard')
    }
  }, [saveScrollPos])

  // PRD Part 7 §3: helper that saves scroll synchronously before navigating to party detail
  const saveScrollAndOpenParty = (partyId: string) => {
    saveScrollPos('dashboard')
    // §2: Open as overlay — preserves dashboard scroll, no tab switch
    setOverlayPartyId(partyId)
  }

  const apiUrl = useMemo(() => {
    if (timeRange === 'custom' && customStart && customEnd) {
      return `/api/dashboard?range=custom&startDate=${customStart}&endDate=${customEnd}`
    }
    return `/api/dashboard?range=${timeRange}`
  }, [timeRange, customStart, customEnd])

  // §DASHBOARD-TIMEOUT: 30s timeout — the backend maxDuration is 30s and the
  // dashboard runs 8 parallel queries on Neon PostgreSQL (each ~2s due to
  // network RTT). The default 10s useFetch timeout was too short, causing
  // intermittent "Dashboard request timed out" errors. This is a targeted
  // increase for the dashboard ONLY — other API calls keep the default 10s.
  const { data, loading: apiLoading, error: apiError, refetch } = useFetch<ExtendedDashboardStats>(apiUrl, [apiUrl], { timeoutMs: 30000 })
  // §HERO-PROFILE: fetch userRole for the role tag (Owner/Admin/Sales)
  const { data: appSettings } = useFetch<any>('/api/app-settings', [])
  // §CARD-PREFS-LOAD: Parse cardPreferences from appSettings
  useEffect(() => {
    if (!appSettings) return
    const parsed = parseCardPrefs((appSettings as any).cardPreferences)
    setCardPrefs(parsed)
  }, [appSettings])
  // §GRADE-BOTTOM-SHEET: fetch all parties so the grade distribution bottom
  // sheet can show ALL customers in a grade (not just topDebtors which is
  // sliced to 5). Cached by TanStack Query so this is instant on re-open.
  const { data: allParties } = useFetch<Party[]>('/api/parties?limit=200', [])

  // PRD Part 38 §4.2: Keep scroll position locked during time filter changes.
  // Save scroll before data changes, restore immediately after.
  const scrollPosRef = useRef(0)
  // §PERFORMANCE: With TanStack Query, cached data shows instantly (stale-while-
  // revalidate). The full-screen loading overlay only shows on the VERY FIRST
  // load when there's no cached data. Filter changes update data in-place
  // without a loading screen — the old values stay visible until the new ones
  // arrive, then snap in. This eliminates the "page reload" UX.
  const loading = apiLoading && !data
  // §ERROR-VS-EMPTY: Distinguish a real error from a legitimate empty result.
  // Previously, ANY failure (DB error, timeout, 401, 500) left `data === null`
  // and showed "No data yet" — which misled users into thinking their business
  // had no data, when in fact the request had failed. Now we surface the error
  // with a Retry button instead.
  const isTimeout = apiError?.includes('timed out')
  const isAuthError = apiError?.includes('HTTP 401')

  const chartOptions: Array<{ id: ChartType; label: string }> = [
    { id: 'revenue', label: t('dash.chart.revenue') },
    { id: 'profit', label: t('dash.chart.profit') },
    { id: 'cashflow', label: t('dash.chart.cashflow') },
    { id: 'collections', label: 'Collections vs Credit' },
    { id: 'categories', label: 'Top Categories' },
    { id: 'inventory', label: 'Inventory Value' },
  ]

  const currency = business?.currency || 'INR'

  if (loading) {
    // PRD Part 38 §3: Don't unmount — show overlay loader while keeping scroll
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center min-h-[200px]">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </div>
    )
  }
  // §ERROR-VS-EMPTY: If the API failed (DB error, timeout, 5xx, 401), show
  // an ErrorState with Retry — NOT "No data yet". A failed request must not
  // be misclassified as an empty dataset.
  if (!data && apiError) {
    return (
      <ErrorState
        message={isTimeout
          ? 'Dashboard request timed out. Please check your connection and try again.'
          : isAuthError
            ? 'Your session has expired. Please sign in again.'
            : `Unable to load dashboard: ${apiError}`}
        onRetry={isAuthError ? () => { if (typeof window !== 'undefined') window.location.replace('/login') } : refetch}
      />
    )
  }
  // §EMPTY: Only show "No data yet" when the request succeeded but genuinely
  // returned no data (e.g., a brand-new business with zero transactions).
  if (!data && !apiLoading) return <EmptyState icon={Heart} title="No data yet" />
  if (!data) return <LoadingState />

  // §LOCALIZED-CARD-FILTERS: Lifetime metric cards (no time filter — these are
  // running balances/counts, not time-dependent). Time-dependent cards (Sales,
  // Collection, Expense) are rendered separately as TimeMetricCard components
  // with their own dropdown range selector.
  const lifetimeMetrics = [
    { label: t('dash.receivable'), value: formatCurrency(data.totalReceivable, currency), icon: TrendingUp, tint: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', onClick: () => { saveScrollPos('dashboard'); setKhataFilter('receivable'); setActiveView('khata') } },
    { label: t('dash.payable'), value: formatCurrency(data.totalPayable, currency), icon: TrendingDown, tint: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300', onClick: () => { saveScrollPos('dashboard'); setKhataFilter('payable'); setActiveView('khata') } },
    { label: t('dash.health'), value: `${data.healthScore}/100`, icon: Heart, tint: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', onClick: () => { saveScrollPos('dashboard'); setActiveView('reports') } },
    { label: t('dash.lowStock'), value: String(data.lowStockCount), icon: AlertTriangle, tint: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300', onClick: () => { saveScrollPos('dashboard'); setInventoryFilter('low-stock'); setActiveView('inventory') } },
  ]

  return (
    <div className="space-y-4">
      {/* §HERO-PROFILE: Interactive business profile card.
          Removed redundant receivable/payable (shown in grid cards below).
          Now shows business metadata (avatar, location, phone, GSTIN, role).
          Clickable → navigates to Settings → Profile tab to edit. */}
      <motion.button
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        onClick={openCustomizer}
        aria-label="Manage business profile"
        className="relative w-full text-left rounded-2xl overflow-hidden shadow-lg shadow-primary/20 active:scale-[0.98] transition-transform"
      >
        {/* §COVER-PHOTO: Cover background with user-controlled blur + overlay */}
        {business?.coverUrl ? (
          <img src={business.coverUrl} alt="" className="absolute inset-0 w-full h-full object-cover"
            style={{ filter: `blur(${cardPrefs.coverBlur}px)` }}
            aria-hidden="true" />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900"
          style={{ opacity: cardPrefs.coverOverlay + 0.55 }} />
        <div className="relative p-4 text-primary-foreground">
        <div className="flex items-center gap-3">
          {/* Circular avatar — business logo or initials fallback */}
          <div className="w-14 h-14 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 overflow-hidden border-2 border-white/30">
            {business?.logoUrl ? (
              <img src={business.logoUrl} alt={business?.name || 'Business'} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xl font-bold">
                {(business?.name || 'B').charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {cardPrefs.showOwner && (
                <p className="text-xs opacity-80">{cardPrefs.greetingText || 'Namaste'}, {business?.ownerName?.split(' ')[0] || 'Trader'} 👋</p>
              )}
              {/* User role tag */}
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-white/20 backdrop-blur-sm flex items-center gap-0.5">
                <ShieldCheck className="w-2.5 h-2.5" />
                {(appSettings?.userRole || 'owner').charAt(0).toUpperCase() + (appSettings?.userRole || 'owner').slice(1)}
              </span>
            </div>
            <h2 className="text-base font-bold truncate">{business?.name}</h2>
            {/* Business metadata row: location • phone */}
            <div className="flex items-center gap-3 mt-1 text-[10px] opacity-90">
              {cardPrefs.showAddress && business?.address && (
                <span className="flex items-center gap-0.5 min-w-0">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{business.address.split(',').slice(-2).join(',').trim()}</span>
                </span>
              )}
              {cardPrefs.showPhone && business?.phone && (
                <span className="flex items-center gap-0.5 shrink-0">
                  <Phone className="w-3 h-3" />
                  <span>{business.phone}</span>
                </span>
              )}
            </div>
            {/* GSTIN line (if registered and visible) */}
            {cardPrefs.showGstin && business?.gstin && (
              <div className="flex items-center gap-0.5 mt-0.5 text-[10px] opacity-75">
                <Building2 className="w-3 h-3 shrink-0" />
                <span className="truncate">GSTIN: {business.gstin}</span>
              </div>
            )}
          </div>
        </div>
        {/* §MANAGE-ACTION: Bottom row with Manage action */}
        <div className="flex items-center justify-end mt-3 pt-2 border-t border-white/10">
          <span className="text-[11px] font-medium opacity-90 flex items-center gap-0.5">
            Manage
            <ChevronRight className="w-3.5 h-3.5" />
          </span>
        </div>
        </div>
      </motion.button>

      {/* §BUSINESS-CARD-EDITOR: Bottom sheet with live preview + draft/save model */}
      <AnimatePresence>
        {showCustomize && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={cancelCustomizer}
              className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              className="fixed bottom-0 inset-x-0 z-[100] bg-card rounded-t-3xl border-t border-border max-w-2xl mx-auto max-h-[85vh] flex flex-col"
            >
              {/* §HEADER: sticky top with title + close */}
              <div className="flex items-center justify-between p-4 pb-2 border-b border-border">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Settings className="w-4 h-4" /> Customize Card
                </h3>
                <button onClick={cancelCustomizer} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* §SCROLLABLE-CONTENT: preview + controls */}
              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {/* §LIVE-PREVIEW: Card preview using draft state */}
                <div className="relative w-full rounded-2xl overflow-hidden shadow-md">
                  {(draftCover !== undefined ? draftCover : business?.coverUrl) ? (
                    <img
                      src={(draftCover !== undefined ? draftCover : business?.coverUrl) as string}
                      alt="" className="absolute inset-0 w-full h-full object-cover"
                      style={{ filter: `blur(${draft.coverBlur}px)` }}
                      aria-hidden="true"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900"
                    style={{ opacity: draft.coverOverlay + 0.55 }} />
                  <div className="relative p-4 text-primary-foreground">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center shrink-0 overflow-hidden border-2 border-white/30">
                        {(draftLogo !== undefined ? draftLogo : business?.logoUrl) ? (
                          <img src={(draftLogo !== undefined ? draftLogo : business?.logoUrl) as string} alt="Logo" className="w-full h-full object-cover" />
                        ) : (
                          <span className="text-base font-bold">{(business?.name || 'B').charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        {draft.showOwner && (
                          <p className="text-xs opacity-80">{draft.greetingText || 'Namaste'}, {business?.ownerName?.split(' ')[0] || 'Trader'} 👋</p>
                        )}
                        <h2 className="text-sm font-bold truncate">{business?.name}</h2>
                        <div className="flex items-center gap-2 mt-0.5 text-[9px] opacity-90">
                          {draft.showAddress && business?.address && (
                            <span className="flex items-center gap-0.5 min-w-0"><MapPin className="w-2.5 h-2.5 shrink-0" /><span className="truncate">{business.address.split(',').slice(-2).join(',').trim()}</span></span>
                          )}
                          {draft.showPhone && business?.phone && (
                            <span className="flex items-center gap-0.5 shrink-0"><Phone className="w-2.5 h-2.5" /><span>{business.phone}</span></span>
                          )}
                        </div>
                        {draft.showGstin && business?.gstin && (
                          <div className="flex items-center gap-0.5 mt-0.5 text-[9px] opacity-75"><Building2 className="w-2.5 h-2.5 shrink-0" /><span className="truncate">GSTIN: {business.gstin}</span></div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* §PROFILE-PHOTO: Change + Remove */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-2">Profile Photo</p>
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-full bg-muted overflow-hidden flex items-center justify-center shrink-0">
                      {(draftLogo !== undefined ? draftLogo : business?.logoUrl) ? (
                        <img src={(draftLogo !== undefined ? draftLogo : business?.logoUrl) as string} alt="Logo" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-lg font-bold text-muted-foreground">{(business?.name || 'B').charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => handleImageSelect(e, 'logoUrl')} className="hidden" />
                    <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors min-h-[40px] disabled:opacity-50">
                      {uploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                      {uploading ? 'Processing...' : 'Change'}
                    </button>
                    {draftLogo !== undefined && (
                      <button onClick={() => setDraftLogo(null)} className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors min-h-[40px]">
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* §COVER-PHOTO: Suggested + Custom + Remove */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-2">Cover Photo</p>
                  {/* Suggested covers */}
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {SUGGESTED_COVERS.map((grad, i) => (
                      <button
                        key={i}
                        onClick={() => setDraftCover(grad)}
                        className={`h-10 rounded-lg shrink-0 border-2 transition-colors ${draftCover === grad ? 'border-primary' : 'border-transparent'}`}
                        style={{ background: grad }}
                        aria-label={`Cover option ${i + 1}`}
                      />
                    ))}
                  </div>
                  {/* Custom upload */}
                  <div className="flex items-center gap-2">
                    <input ref={coverInputRef} type="file" accept="image/*" onChange={(e) => handleImageSelect(e, 'coverUrl')} className="hidden" />
                    <button onClick={() => coverInputRef.current?.click()} disabled={uploadingCover} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors min-h-[40px] disabled:opacity-50">
                      {uploadingCover ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
                      {uploadingCover ? 'Processing...' : 'Upload Custom'}
                    </button>
                    {draftCover !== undefined && (
                      <button onClick={() => setDraftCover(null)} className="px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-xs font-medium hover:bg-destructive/20 transition-colors min-h-[40px]">
                        Remove
                      </button>
                    )}
                  </div>
                </div>

                {/* §COVER-BLUR: Slider 0–20 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted-foreground uppercase">Cover Blur</p>
                    <span className="text-[10px] text-muted-foreground">{draft.coverBlur < 4 ? 'Low' : draft.coverBlur < 12 ? 'Medium' : 'High'} ({draft.coverBlur}px)</span>
                  </div>
                  <input type="range" min={0} max={20} value={draft.coverBlur} onChange={(e) => setDraft({ ...draft, coverBlur: Number(e.target.value) })} className="w-full h-8 accent-primary" />
                </div>

                {/* §COVER-OVERLAY: Slider 0–0.9 */}
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-[10px] text-muted-foreground uppercase">Overlay / Readability</p>
                    <span className="text-[10px] text-muted-foreground">{Math.round(draft.coverOverlay * 100)}%</span>
                  </div>
                  <input type="range" min={0} max={0.9} step={0.05} value={draft.coverOverlay} onChange={(e) => setDraft({ ...draft, coverOverlay: Number(e.target.value) })} className="w-full h-8 accent-primary" />
                </div>

                {/* §GREETING-TEXT: Custom greeting */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-1.5">Greeting Text</p>
                  <input
                    type="text"
                    value={draft.greetingText}
                    onChange={(e) => setDraft({ ...draft, greetingText: e.target.value.slice(0, 30) })}
                    placeholder="Namaste"
                    maxLength={30}
                    className="w-full h-10 rounded-xl bg-muted px-3 text-sm border-0 outline-none"
                  />
                </div>

                {/* §VISIBILITY-TOGGLES */}
                <div>
                  <p className="text-[10px] text-muted-foreground uppercase mb-2">Show on Card</p>
                  <div className="space-y-1">
                    {([
                      { key: 'showOwner' as const, label: 'Owner Name' },
                      { key: 'showAddress' as const, label: 'Address' },
                      { key: 'showPhone' as const, label: 'Phone' },
                      { key: 'showGstin' as const, label: 'GSTIN' },
                    ]).map(({ key, label }) => (
                      <button key={key} onClick={() => setDraft({ ...draft, [key]: !draft[key] })} className="w-full flex items-center justify-between py-2 min-h-[40px]">
                        <span className="text-xs font-medium">{label}</span>
                        <span className={`w-9 h-5 rounded-full flex items-center transition-colors ${draft[key] ? 'bg-primary justify-end' : 'bg-muted justify-start'}`}>
                          <span className="w-4 h-4 rounded-full bg-white shadow-sm mx-0.5 flex items-center justify-center">
                            {draft[key] ? <Eye className="w-2.5 h-2.5 text-primary" /> : <EyeOff className="w-2.5 h-2.5 text-muted-foreground" />}
                          </span>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* §RESET-DEFAULTS */}
                <button onClick={resetToDefaults} className="w-full text-xs text-muted-foreground hover:text-foreground py-2">
                  Reset to recommended defaults
                </button>

                {/* §MANAGE-SETTINGS: Navigate to full Settings page */}
                <button onClick={() => { cancelCustomizer(); setActiveView('settings') }} className="w-full flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors min-h-[48px]">
                  <span className="text-xs font-medium flex items-center gap-1.5">⚙️ Manage Business Settings</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* §STICKY-FOOTER: Save / Cancel */}
              <div className="border-t border-border p-3 flex items-center gap-2 bg-card">
                {saveError && <span className="text-[10px] text-destructive flex-1">{saveError}</span>}
                {saveSuccess && <span className="text-[10px] text-emerald-600 flex-1">✓ Changes saved</span>}
                {!saveError && !saveSuccess && <span className="flex-1" />}
                <button onClick={cancelCustomizer} disabled={saving} className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors min-h-[44px] disabled:opacity-50">
                  Cancel
                </button>
                <button onClick={saveChanges} disabled={saving || !isDirty} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50 flex items-center gap-1.5">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'No changes'}
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* §LOCALIZED-CARD-FILTERS: Global time filter row REMOVED.
          Time-dependent cards now have their own dropdown range selector.
          The chart below still has its own range selector. */}

      {/* Custom Date Range Picker — used by the chart's range selector */}
      <AnimatePresence>
        {showCustomPicker && timeRange === 'custom' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="p-3 rounded-xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-purple-700 dark:text-purple-300">📅 Custom Date Range</p>
                <button onClick={() => { setShowCustomPicker(false); setTimeRange('7d') }} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground">Start Date</label>
                  <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-full h-9 rounded-lg bg-card border border-border px-2 text-xs outline-none" />
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground">End Date</label>
                  <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-full h-9 rounded-lg bg-card border border-border px-2 text-xs outline-none" />
                </div>
              </div>
              {customStart && customEnd && <p className="text-[10px] text-emerald-600">✓ Range applied — data will filter to selected dates</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* §LOCALIZED-CARD-FILTERS: Metric cards grid.
          Lifetime cards (Receivable, Payable, Health, LowStock) have NO
          time filter — they're running balances/counts.
          Time-dependent cards (Sales, Collection, Expense) have a dropdown
          range selector in the top-right corner. Each fetches its own
          /api/dashboard?range=X slice. */}

      {/* Lifetime metric cards (no time filter) */}
      <div className="grid grid-cols-2 gap-3">
        {lifetimeMetrics.map((m, i) => {
          const Icon = m.icon
          return (
            <motion.button key={m.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} onClick={m.onClick} className="text-left">
              <Card className={`p-4 ${m.bg} border-none hover:shadow-md transition-shadow h-full`}>
                <div className="flex items-start justify-between mb-2"><span className={`w-8 h-8 rounded-lg ${m.tint} text-white flex items-center justify-center`}><Icon className="w-4 h-4" /></span></div>
                <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">{m.label}</p>
                <p className={`text-base font-bold tabular ${m.text}`}>{m.value}</p>
              </Card>
            </motion.button>
          )
        })}
      </div>

      {/* Time-dependent metric cards (with localized dropdown filter) */}
      <div className="grid grid-cols-2 gap-3">
        <TimeMetricCard
          label="Total Sales"
          icon={Wallet}
          tint="bg-amber-500"
          bg="bg-amber-50 dark:bg-amber-950/30"
          text="text-amber-700 dark:text-amber-300"
          defaultRange="1d"
          currency={currency}
          valueExtractor={(d) => d?.rangeSales ?? 0}
          onClick={(r) => {
            // §ROUTING: Total Sales → History & Reports (sales volume)
            saveScrollPos('dashboard')
            setHistoryDateRange(mapToHistoryRange(r))
            setActiveView('history')
          }}
        />
        <TimeMetricCard
          label="Total Collection"
          icon={ArrowDownRight}
          tint="bg-teal-500"
          bg="bg-teal-50 dark:bg-teal-950/30"
          text="text-teal-700 dark:text-teal-300"
          defaultRange="1d"
          currency={currency}
          valueExtractor={(d) => d?.rangeCollection ?? 0}
          onClick={(r) => {
            // §ROUTING: Total Collection → History & Reports (collections feed)
            saveScrollPos('dashboard')
            setHistoryDateRange(mapToHistoryRange(r))
            setActiveView('history')
          }}
        />
        <TimeMetricCard
          label="Total Expense"
          icon={ArrowUpRight}
          tint="bg-red-500"
          bg="bg-red-50 dark:bg-red-950/30"
          text="text-red-700 dark:text-red-300"
          defaultRange="1d"
          currency={currency}
          valueExtractor={(d) => d?.rangeExpense ?? 0}
          onClick={(r) => {
            // §ROUTING: Total Expense → Profit & Loss (expense breakdown)
            saveScrollPos('dashboard')
            setReportsDateRange(mapToReportsRange(r))
            setActiveView('reports')
          }}
        />
        <TimeMetricCard
          label="Total Revenue"
          icon={Receipt}
          tint="bg-purple-500"
          bg="bg-purple-50 dark:bg-purple-950/30"
          text="text-purple-700 dark:text-purple-300"
          defaultRange="1d"
          currency={currency}
          valueExtractor={(d) => d?.rangeSales ?? 0}
          onClick={(r) => {
            // §ROUTING: Total Revenue → Profit & Loss (revenue analysis)
            saveScrollPos('dashboard')
            setReportsDateRange(mapToReportsRange(r))
            setActiveView('reports')
          }}
        />
      </div>

      {/* Chart — PRD Part 4: Chart toggle + dynamic time-frame + advanced charts */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">{chartOptions.find((o) => o.id === chartType)?.label || 'Business Analytics'}</h3>
          </div>
          {chartType !== 'categories' && (
            <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
              <button onClick={() => setChartView('line')} className={`px-2 py-1 rounded-md transition-colors ${chartView === 'line' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} aria-label="Line chart view"><LineChart className="w-4 h-4" /></button>
              <button onClick={() => setChartView('bar')} className={`px-2 py-1 rounded-md transition-colors ${chartView === 'bar' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`} aria-label="Bar chart view"><BarChart3 className="w-4 h-4" /></button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1.5 mb-3">
          <select value={chartType} onChange={(e) => setChartType(e.target.value as ChartType)} className="text-xs bg-muted rounded-lg px-2 py-1.5 border-0 outline-none h-8 font-medium flex-1 min-w-0">
            {chartOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          <select value={timeRange} onChange={(e) => { const val = e.target.value as TimeRange; setTimeRange(val); if (val === 'custom') setShowCustomPicker(true) }} className="text-xs bg-muted rounded-lg px-2 py-1.5 border-0 outline-none h-8 font-medium shrink-0">
            {TIME_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {/* §TOGGLE-FIX: Chart rendering respects chartView (line vs bar) for
            ALL chart types. Categories (pie) ignores the toggle. Inventory
            uses AreaChart (line variant) / BarChart (bar variant). */}
        <motion.div key={chartType + chartView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-44 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'revenue' && chartView === 'line' ? (
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient><linearGradient id="exp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171" stopOpacity={0.3} /><stop offset="100%" stopColor="#f87171" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" name="Revenue" />
                <Area type="monotone" dataKey="expense" stroke="#f87171" strokeWidth={2} fill="url(#exp)" name="Expense" />
              </AreaChart>
            ) : chartType === 'revenue' && chartView === 'bar' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} name="Revenue" />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} name="Expense" />
              </BarChart>
            ) : chartType === 'profit' && chartView === 'line' ? (
              // §TOGGLE-FIX: Profit vs Loss — LINE variant (LineChart)
              <RechartsLineChart data={data.salesTrend.map((d) => ({ ...d, profitVal: d.profit >= 0 ? d.profit : 0, lossVal: d.profit < 0 ? Math.abs(d.profit) : 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="profitVal" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
                <Line type="monotone" dataKey="lossVal" stroke="#f87171" strokeWidth={2} dot={false} name="Loss" />
              </RechartsLineChart>
            ) : chartType === 'profit' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Profit vs Loss — BAR variant (BarChart)
              <BarChart data={data.salesTrend.map((d) => ({ ...d, profitVal: d.profit >= 0 ? d.profit : 0, lossVal: d.profit < 0 ? Math.abs(d.profit) : 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="profitVal" fill="#10b981" radius={[3, 3, 0, 0]} name="Profit" />
                <Bar dataKey="lossVal" fill="#f87171" radius={[3, 3, 0, 0]} name="Loss" />
              </BarChart>
            ) : chartType === 'cashflow' && chartView === 'line' ? (
              // §TOGGLE-FIX: Cashflow — LINE variant (pure lines, no bars)
              <RechartsLineChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} dot={false} name="Cash In" />
                <Line type="monotone" dataKey="expense" stroke="#f87171" strokeWidth={2} dot={false} name="Cash Out" />
                <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} name="Net" />
              </RechartsLineChart>
            ) : chartType === 'cashflow' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Cashflow — BAR variant (pure bars, no line)
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} name="Cash In" />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} name="Cash Out" />
                <Bar dataKey="profit" fill="#6366f1" radius={[3, 3, 0, 0]} name="Net" />
              </BarChart>
            ) : chartType === 'collections' && chartView === 'line' ? (
              // §TOGGLE-FIX: Collections — LINE variant
              <RechartsLineChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} dot={false} name="Collected" />
                <Line type="monotone" dataKey="creditGiven" stroke="#ef4444" strokeWidth={2} dot={false} name="New Credit" />
              </RechartsLineChart>
            ) : chartType === 'collections' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Collections — BAR variant
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="collected" fill="#10b981" radius={[3, 3, 0, 0]} name="Collected" />
                <Bar dataKey="creditGiven" fill="#ef4444" radius={[3, 3, 0, 0]} name="New Credit" />
              </BarChart>
            ) : chartType === 'categories' ? (
              <PieChart>
                <Pie data={data.topCategories || []} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label={(e: any) => e.name} labelLine={false} style={{ fontSize: 9 }}>
                  {(data.topCategories || []).map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: number) => formatCurrency(v, currency)} />
              </PieChart>
            ) : chartView === 'line' ? (
              // §TOGGLE-FIX: Inventory — LINE variant (AreaChart)
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="inv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="#8b5cf6" strokeWidth={2} fill="url(#inv)" name="Inventory Sales" />
              </AreaChart>
            ) : (
              // §TOGGLE-FIX: Inventory — BAR variant
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="revenue" fill="#8b5cf6" radius={[3, 3, 0, 0]} name="Inventory Sales" />
              </BarChart>
            )}
          </ResponsiveContainer>
        </motion.div>

        {/* Legend */}
        {['revenue', 'cashflow', 'collections', 'profit'].includes(chartType) && (
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            {chartType === 'revenue' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Revenue</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Expense</span></>)}
            {chartType === 'profit' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Profit</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Loss</span></>)}
            {chartType === 'cashflow' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />In</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Out</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500" />Net</span></>)}
            {chartType === 'collections' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Collected</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />New Credit</span></>)}
          </div>
        )}

        {/* Inventory value summary */}
        {chartType === 'inventory' && data.inventoryValue != null && (
          <div className="mt-2 p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30 text-center"><p className="text-[10px] text-muted-foreground">Current Stock Value</p><p className="text-sm font-bold tabular text-purple-700 dark:text-purple-300">{formatCurrency(data.inventoryValue, currency)}</p></div>
        )}

        {/* Top categories list */}
        {chartType === 'categories' && data.topCategories && data.topCategories.length > 0 && (
          <div className="mt-2 space-y-1">{data.topCategories.slice(0, 4).map((c, i) => (<div key={c.name} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /><span className="flex-1 truncate">{c.name}</span><span className="font-semibold tabular">{formatCurrency(c.value, currency)}</span></div>))}</div>
        )}
      </Card>

      {/* Grade distribution — Interactive Bar Chart (PRD Part 5 §1) */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-1">Customer Quality Distribution</h3>
        <p className="text-[10px] text-muted-foreground mb-3">Tap a bar to view customers</p>
        <div className="h-36 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data.gradeDistribution} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} onClick={(e: any) => { if (e && e.activeLabel) setSelectedGrade(e.activeLabel) }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
              <XAxis dataKey="grade" tick={{ fontSize: 12, fontWeight: 'bold' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={24} allowDecimals={false} />
              <Tooltip cursor={{ fill: 'oklch(0.9 0.005 145 / 0.3)' }} contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => [`${v} customers`, 'Count']} />
              <Bar dataKey="count" radius={[6, 6, 0, 0]} cursor="pointer">
                {data.gradeDistribution.map((_, i) => <Cell key={i} fill={['#10b981', '#14b8a6', '#f59e0b', '#f97316', '#ef4444'][i] || '#6366f1'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Floating modal for grade-filtered customers (PRD Part 5 §2) */}
      <AnimatePresence>
        {selectedGrade && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setSelectedGrade(null)} className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center">
            <motion.div initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', stiffness: 400, damping: 32 }} onClick={(e) => e.stopPropagation()} className="bg-card rounded-t-3xl sm:rounded-3xl border-t sm:border border-border w-full max-w-md max-h-[70vh] flex flex-col">
              <div className="flex items-center justify-between p-4 border-b border-border">
                <div className="flex items-center gap-2"><span className={`text-xs font-bold px-2 py-0.5 rounded-full ${GRADE_META[selectedGrade]?.bg} ${GRADE_META[selectedGrade]?.color}`}>Grade {selectedGrade}</span><span className="text-sm font-semibold">{GRADE_META[selectedGrade]?.desc}</span></div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setKhataGradeFilter(selectedGrade); setSelectedGrade(null); setKhataFilter('all'); setReturnToView('dashboard'); setActiveView('khata') }} className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg">Go to Khata →</button>
                  <button onClick={() => setSelectedGrade(null)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-area p-3 space-y-1">
                {(() => {
                  const count = data.gradeDistribution.find((g) => g.grade === selectedGrade)?.count || 0
                  if (count === 0) return <p className="text-sm text-muted-foreground text-center py-8">No customers in this grade</p>
                  // §FIX: use allParties (full list) instead of topDebtors (sliced to 5)
                  const gradeParties = (allParties || []).filter((p) => p.qualityGrade === selectedGrade)
                  return (
                    <>
                      <p className="text-xs text-muted-foreground px-1 mb-2">{count} customer{count !== 1 ? 's' : ''} in this grade</p>
                      {gradeParties.map((p) => (
                        <button key={p.id} onClick={() => { saveScrollPos('dashboard'); setSelectedGrade(null); setOverlayPartyId(p.id) }} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left">
                          <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700">{p.name.charAt(0)}</span>
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[11px] text-muted-foreground">Balance: {formatCurrency(p.balance, currency)}</p></div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </button>
                      ))}
                      {gradeParties.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Tap "Go to Khata" to see all {count} customers</p>}
                    </>
                  )
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {([
              { id: 'debtors', label: 'Top Debtors' },
              { id: 'buyers', label: 'Top Buyers' },
              { id: 'payments', label: 'Top Payments' },
              { id: 'products', label: 'Top Products' },
              { id: 'defaulters', label: 'Defaulters' },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setTopTab(tab.id)}
                className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-medium transition-all ${
                  topTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button onClick={() => {
            saveScrollPos('dashboard')
            // §DYNAMIC-ROUTING: View All routes based on active tab.
            if (topTab === 'debtors') {
              // Top Debtors → Outstanding Payments (Receivables)
              setActiveView('reports')
              setReportsTab('outstanding')
            } else if (topTab === 'buyers') {
              // Top Buyers → Party Ledger (sorted by sales volume)
              setActiveView('reports')
              setReportsTab('party')
            } else if (topTab === 'payments') {
              // Top Payments → History/Transactions (payments received)
              setHistoryDateRange('week')
              setActiveView('history')
            } else if (topTab === 'products') {
              // Top Products → Inventory
              setInventoryFilter('all')
              setActiveView('inventory')
            } else if (topTab === 'defaulters') {
              // Defaulters → Outstanding Payments (Grade D & E)
              setKhataGradeFilter('D') // pre-filter to D (E also shown in outstanding)
              setActiveView('reports')
              setReportsTab('outstanding')
            } else {
              setKhataFilter('all')
              setActiveView('khata')
            }
          }} className="text-xs text-primary font-medium flex items-center shrink-0 ml-2">{t('common.viewAll')} <ChevronRight className="w-3 h-3" /></button>
        </div>

        {/* Tab content */}
        {topTab === 'debtors' && (
          <div className="space-y-2">
            {data.topDebtors.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No outstanding receivables 🎉</p> : (
              <>
                {data.topDebtors.slice(0, 5).map((d) => {
                  const meta = GRADE_META[d.grade]
                  return (
                    <button key={d.id} onClick={() => { saveScrollAndOpenParty(d.id) }} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted transition-colors text-left">
                      <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{d.name.charAt(0)}</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{d.name}</p><p className="text-[11px] text-muted-foreground">{meta.desc}</p></div>
                      <div className="text-right"><p className="text-sm font-semibold tabular text-emerald-600">{formatCurrency(d.balance, currency)}</p><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{d.grade}</span></div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        )}

        {topTab === 'buyers' && (
          <div className="space-y-2">
            {data.topBuyers && data.topBuyers.length > 0 ? (
              <>
                {data.topBuyers.slice(0, 5).map((b, i) => (
                  <button key={b.id} onClick={() => { saveScrollPos('dashboard'); setOverlayPartyId(b.id) }} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted transition-colors text-left">
                    <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center text-xs font-bold text-emerald-600">#{i + 1}</div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{b.name}</p><p className="text-[11px] text-muted-foreground">Top buyer</p></div>
                    <p className="text-sm font-semibold tabular">{formatCurrency(b.value, currency)}</p>
                  </button>
                ))}
              </>
            ) : <p className="text-sm text-muted-foreground py-4 text-center">No buyer data yet</p>}
          </div>
        )}

        {topTab === 'payments' && (
          <div className="space-y-2">
            {data.recentTransactions.filter(t => t.type === 'credit').slice(0, 5).map((tx) => (
              <div key={tx.id} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted">
                <div className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"><ArrowDownRight className="w-4 h-4 text-emerald-600" /></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{tx.description || 'Payment'}</p><p className="text-[11px] text-muted-foreground">{timeAgo(tx.createdAt)}</p></div>
                <p className="text-sm font-semibold tabular text-emerald-600">+{formatCurrency(tx.amount, currency)}</p>
              </div>
            ))}
            {data.recentTransactions.filter(t => t.type === 'credit').length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No payments yet</p>}
          </div>
        )}

        {topTab === 'products' && (
          <div className="space-y-2">
            {data.topProductsByUnits && data.topProductsByUnits.length > 0 ? (
              <>
                {data.topProductsByUnits.slice(0, 5).map((p, i) => (
                  <div key={i} className="flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold" style={{ background: PIE_COLORS[i % PIE_COLORS.length] + '20', color: PIE_COLORS[i % PIE_COLORS.length] }}>#{i + 1}</div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{p.name}</p><p className="text-[11px] text-muted-foreground">{p.value} units sold · {formatCurrency(p.revenue, currency)}</p></div>
                    <p className="text-sm font-semibold tabular">{p.value}</p>
                  </div>
                ))}
              </>
            ) : <p className="text-sm text-muted-foreground py-4 text-center">No product sales data yet</p>}
          </div>
        )}

        {topTab === 'defaulters' && (
          <div className="space-y-2">
            {data.topDebtors.filter(d => d.grade === 'E' || d.grade === 'D').length > 0 ? (
              <>
                {data.topDebtors.filter(d => d.grade === 'E' || d.grade === 'D').slice(0, 5).map((d) => {
                  const meta = GRADE_META[d.grade]
                  return (
                    <button key={d.id} onClick={() => { saveScrollAndOpenParty(d.id) }} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted text-left">
                      <div className="w-9 h-9 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xs font-bold text-red-600">!</div>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{d.name}</p><p className="text-[11px] text-muted-foreground">{meta.desc}</p></div>
                      <div className="text-right"><p className="text-sm font-semibold tabular text-red-600">{formatCurrency(d.balance, currency)}</p><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{d.grade}</span></div>
                    </button>
                  )
                })}
              </>
            ) : <p className="text-sm text-muted-foreground py-4 text-center">No defaulters 🎉</p>}
          </div>
        )}
      </Card>

      {/* PRD Part 38: Multi-Tab Dynamic Hub (Recent Transactions / Low Stock / Online Orders) */}
      <Card className="p-4">
        {/* Tab buttons */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto no-scrollbar -mx-1 px-1">
          {([
            { id: 'transactions', label: 'Transactions' },
            { id: 'lowstock', label: 'Low Stock' },
            { id: 'orders', label: 'Online Orders' },
          ] as const).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setHubTab(tab.id)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                hubTab === tab.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
          <div className="ml-auto shrink-0">
            <button onClick={() => {
              saveScrollPos('dashboard')
              // §DYNAMIC-ROUTING: View All routes based on active hub tab.
              if (hubTab === 'transactions') {
                // Transactions → History (with active time filter)
                setHistoryDateRange(mapToHistoryRange(timeRange))
                setActiveView('history')
              } else if (hubTab === 'lowstock') {
                // Low Stock → Inventory (with low-stock filter, no time param)
                setInventoryFilter('low-stock')
                setActiveView('inventory')
              } else if (hubTab === 'orders') {
                // §FIX: Online Orders → dedicated Online Orders view.
                setActiveView('online-orders')
              } else {
                setKhataFilter('all')
                setActiveView('khata')
              }
            }} className="text-xs text-primary font-medium flex items-center">
              View All <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* §FILTER-DROPDOWN: Interactive date range picker for the hub.
            Transactions + Orders respect this filter. Low Stock tab hides
            it completely (stock is real-time, not historical). */}
        {hubTab !== 'lowstock' && (
          <div className="flex items-center gap-1 mb-2">
            <Calendar className="w-3 h-3 text-muted-foreground shrink-0" />
            <select
              value={timeRange}
              onChange={(e) => { const val = e.target.value as TimeRange; setTimeRange(val); if (val === 'custom') setShowCustomPicker(true) }}
              className="text-[10px] bg-muted rounded-md px-1.5 py-0.5 border-0 outline-none font-medium text-muted-foreground cursor-pointer"
            >
              {TIME_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </div>
        )}

        {/* Tab 1: Recent Transactions with Cash Flow Summary */}
        {hubTab === 'transactions' && (
          <div>
            {/* Cash Flow Summary indicators */}
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800">
                <p className="text-[9px] text-muted-foreground">Total In</p>
                <p className="text-sm font-bold tabular text-emerald-600">
                  +{formatCurrency(data.recentTransactions.filter(t => t.type === 'credit').reduce((s, t) => s + toNumber(t.amount), 0), currency)}
                </p>
              </div>
              <div className="p-2 rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
                <p className="text-[9px] text-muted-foreground">Total Out</p>
                <p className="text-sm font-bold tabular text-red-600">
                  -{formatCurrency(data.recentTransactions.filter(t => t.type !== 'credit').reduce((s, t) => s + toNumber(t.amount), 0), currency)}
                </p>
              </div>
            </div>
            {/* Transaction list */}
            {data.recentTransactions.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No transactions in this period</p>
            ) : (
              <div className="space-y-1">
                {data.recentTransactions.slice(0, 5).map((tx) => {
                  const isCredit = tx.type === 'credit'
                  return (
                    <button key={tx.id} onClick={() => { saveScrollPos('dashboard'); if (tx.invoiceId) { setOverlayInvoiceId(tx.invoiceId) } else if (tx.partyId) { setOverlayPartyId(tx.partyId) } }} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left">
                      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isCredit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>{isCredit ? <ArrowDownRight className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-600" />}</span>
                      <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{tx.description || tx.type}</p><p className="text-[11px] text-muted-foreground">{(tx as any)?.party?.name || "—"} · {timeAgo(tx.createdAt)}</p></div>
                      <span className={`text-sm font-semibold tabular shrink-0 ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>{isCredit ? '+' : '-'}{formatCurrency(tx.amount, currency)}</span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Low Stock Alert */}
        {hubTab === 'lowstock' && (
          <div>
            {data.lowStockCount === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">All products well stocked ✅</p>
            ) : (
              <LowStockList currency={currency} onNavigate={() => { saveScrollPos('dashboard'); setInventoryFilter('low-stock'); setActiveView('inventory') }} />
            )}
          </div>
        )}

        {/* Tab 3: Online Orders */}
        {hubTab === 'orders' && (
          <OnlineOrdersList currency={currency} onNavigate={() => { saveScrollPos('dashboard'); setActiveView('khata') }} />
        )}
      </Card>

      {/* Quick actions */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">{t('dash.quickActions')}</h3>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: t('khata.addPartyShort'), icon: Users, view: 'khata' as const, action: 'add-party' as const, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
            { label: t('inv.addProductShort'), icon: Package, view: 'inventory' as const, action: 'add-product' as const, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
            { label: t('bill.newInvoiceShort'), icon: Receipt, view: 'sale-pad' as const, action: 'new-invoice' as const, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30' },
            { label: t('qa.addTransaction'), icon: ArrowLeftRight, view: 'khata' as const, action: 'add-transaction' as const, color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/30' },
          ].map((a) => {
            const Icon = a.icon
            return (
              <button key={a.label} onClick={() => { setActiveView(a.view); triggerQuickAction({ id: crypto.randomUUID(), type: a.action }) }} className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-muted transition-colors min-h-[72px] justify-center">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.color}`}><Icon className="w-5 h-5" /></span>
                <span className="text-[10px] font-medium text-center leading-tight">{a.label}</span>
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

// PRD Part 38 §4: TradingView-style custom tooltip with full date display
function CustomTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload || payload.length === 0) return null
  // Use fullDate from payload if available, otherwise try label
  const fullDate = payload[0]?.payload?.fullDate
  const formatFullDate = (d: string) => {
    try {
      const date = new Date(d)
      if (isNaN(date.getTime())) return label || ''
      return date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
    } catch {
      return label || ''
    }
  }
  return (
    <div style={{
      background: 'rgba(20,20,20,0.95)',
      border: '1px solid rgba(99,102,241,0.4)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      maxWidth: 220,
      color: '#f3f4f6',
    }}>
      <p style={{ fontWeight: 700, marginBottom: 6, fontSize: 10, color: '#9ca3af', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4 }}>
        {fullDate ? formatFullDate(fullDate) : label}
      </p>
      {payload.map((entry: any, i: number) => (
        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 3 }}>
          <span style={{ color: entry.color, fontWeight: 600, fontSize: 11 }}>{entry.name}:</span>
          <span style={{ fontWeight: 700, fontSize: 12, color: '#f3f4f6' }}>
            {currency ? formatCurrency(entry.value, currency) : `₹${entry.value}`}
          </span>
        </div>
      ))}
    </div>
  )
}

// PRD Part 38: Low Stock List component for Multi-Tab Hub
function LowStockList({ currency, onNavigate }: { currency: string; onNavigate: () => void }) {
  const { data: products } = useFetch<Product[]>('/api/products', [])
  if (!products) return <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
  const lowStock = products.filter(p => p.stock <= p.lowStockThreshold)
  if (lowStock.length === 0) return <p className="text-sm text-muted-foreground py-4 text-center">All products well stocked ✅</p>
  return (
    <div className="space-y-1">
      {lowStock.slice(0, 6).map((p) => (
        <button key={p.id} onClick={onNavigate} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left">
          <span className="w-8 h-8 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4 text-orange-600" />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{p.name}</p>
            <p className="text-[11px] text-muted-foreground">{p.category || 'Uncategorized'}</p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-sm font-bold tabular text-orange-600">{p.stock} {p.unit}</p>
            <p className="text-[10px] text-muted-foreground">Min: {p.lowStockThreshold}</p>
          </div>
        </button>
      ))}
      {/* §UI-REDUNDANCY: Removed duplicate 'View All in Inventory →' button.
          The top-right 'View All >' button in the header handles navigation. */}
    </div>
  )
}

// PRD Part 38: Online Orders List component for Multi-Tab Hub
// §REAL-TIME: Uses useRealtimeOrders hook for instant WebSocket notifications.
// When a customer places an order on the external Quick-Commerce frontend,
// the order appears here instantly + plays a notification sound.
function OnlineOrdersList({ currency, onNavigate }: { currency: string; onNavigate: () => void }) {
  const { business } = useAppStore()
  const { orders, isConnected } = useRealtimeOrders(business?.id)
  if (!orders) return <p className="text-sm text-muted-foreground py-4 text-center">Loading...</p>
  if (orders.length === 0) return (
    <div className="py-4 text-center space-y-1">
      <p className="text-sm text-muted-foreground">No online orders yet 🛒</p>
      {/* §REAL-TIME: Show WebSocket connection status */}
      <p className="text-[10px] text-muted-foreground/60 flex items-center justify-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
        {isConnected ? 'Live — waiting for orders' : 'Reconnecting...'}
      </p>
    </div>
  )
  return (
    <div className="space-y-1">
      {orders.slice(0, 5).map((order) => (
        <div key={order.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
          <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
            order.status === 'pending' ? 'bg-amber-100 dark:bg-amber-900/30' :
            order.status === 'confirmed' ? 'bg-blue-100 dark:bg-blue-900/30' :
            order.status === 'delivered' ? 'bg-emerald-100 dark:bg-emerald-900/30' :
            'bg-red-100 dark:bg-red-900/30'
          }`}>
            <Package className={`w-4 h-4 ${
              order.status === 'pending' ? 'text-amber-600' :
              order.status === 'confirmed' ? 'text-blue-600' :
              order.status === 'delivered' ? 'text-emerald-600' :
              'text-red-600'
            }`} />
          </span>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{order.customerName || 'Customer'}</p>
            <p className="text-[11px] text-muted-foreground">{order.status} · {timeAgo(order.createdAt)}</p>
          </div>
          <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(order.grandTotal, currency)}</span>
        </div>
      ))}
      {/* §UI-REDUNDANCY: Removed duplicate 'View All Orders →' button.
          The top-right 'View All >' button in the header handles navigation. */}
    </div>
  )
}

// ============================================================================
// §LOCALIZED-CARD-FILTERS: TimeMetricCard — a metric card with its own range
// dropdown in the top-right corner. Fetches /api/dashboard?range=X and extracts
// the value via valueExtractor. Used for time-dependent metrics (Sales,
// Collection, Expense). Lifetime metrics (Receivable, Payable, Health, LowStock)
// do NOT use this — they have no time dimension.
// ============================================================================

const CARD_RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '1d', label: '1 Day (Today)' },
  { id: '2d', label: '2 Days' },
  { id: '3d', label: '3 Days' },
  { id: '5d', label: '5 Days' },
  { id: '7d', label: '1 Week' },
  { id: '1m', label: '1 Month' },
  { id: '6m', label: '6 Months' },
  { id: '1y', label: '1 Year' },
  { id: 'custom', label: 'Custom Range' },
]

function TimeMetricCard({
  label, icon: Icon, tint, bg, text, defaultRange, currency, valueExtractor, onClick,
}: {
  label: string
  icon: typeof Wallet
  tint: string
  bg: string
  text: string
  defaultRange: TimeRange
  currency: string
  valueExtractor: (d: ExtendedDashboardStats | null | undefined) => number
  onClick: (range: TimeRange) => void
}) {
  const [range, setRange] = useState<TimeRange>(defaultRange)
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')

  const apiUrl = useMemo(() => {
    if (range === 'custom' && customStart && customEnd) {
      return `/api/dashboard?range=custom&startDate=${customStart}&endDate=${customEnd}`
    }
    return `/api/dashboard?range=${range}`
  }, [range, customStart, customEnd])

  const { data } = useFetch<ExtendedDashboardStats>(apiUrl, [apiUrl], { timeoutMs: 30000 })
  const value = valueExtractor(data)
  const rangeLabel = CARD_RANGES.find((r) => r.id === range)?.label || ''

  return (
    <Card className={`p-4 ${bg} border-none hover:shadow-md transition-shadow h-full relative`}>
      {/* Dropdown trigger — top-right corner. z-20 sits above the card button.
          stopPropagation on the wrapper prevents the card's onClick from
          firing when the dropdown trigger is tapped. */}
      <div className="absolute top-2 right-2 z-20" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="w-6 h-6 rounded-md bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/20 flex items-center justify-center text-muted-foreground transition-colors"
              aria-label="Select date range"
            >
              <Calendar className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {CARD_RANGES.map((r) => (
              <DropdownMenuItem
                key={r.id}
                onSelect={() => setRange(r.id)}
                className={range === r.id ? 'font-bold' : ''}
              >
                {r.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button onClick={() => onClick(range)} className="w-full text-left relative z-0 pr-8">
        <div className="flex items-start mb-2">
          <span className={`w-8 h-8 rounded-lg ${tint} text-white flex items-center justify-center`}>
            <Icon className="w-4 h-4" />
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">{label}</p>
        <p className={`text-base font-bold tabular ${text}`}>{formatCurrency(value, currency)}</p>
        <p className="text-[9px] text-muted-foreground/70 mt-0.5 truncate">{rangeLabel}</p>
      </button>

      {/* Custom date picker — inline when Custom selected */}
      {range === 'custom' && (
        <div className="mt-2 space-y-1" onClick={(e) => e.stopPropagation()}>
          <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-full h-7 rounded bg-card border border-border px-1.5 text-[10px] outline-none" />
          <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-full h-7 rounded bg-card border border-border px-1.5 text-[10px] outline-none" />
        </div>
      )}
    </Card>
  )
}
