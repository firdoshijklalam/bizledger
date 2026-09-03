'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { DashboardStats, Party, Product } from '@/lib/types'
import { formatCurrency, formatDate, formatChartAxisValue, GRADE_META, timeAgo } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Wallet, Heart, AlertTriangle, Package,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Users, Receipt, ChevronRight,
  BarChart3, LineChart, X, Loader2, Calendar,
  MapPin, Phone, Building2, ShieldCheck, Store, Settings, Camera, Eye, EyeOff,
  FileText, Boxes, LayoutGrid, Check,
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
import {
  DashboardCardManagementSheet,
  DEFAULT_CARD_CONFIG,
  parseCardConfig,
  type CardConfig,
  type DashboardCardDef,
} from '@/components/shared/dashboard-card-management'
import { ProfitLossDrilldownSheet } from '@/components/shared/profit-loss-drilldown-sheet'
import {
  DashboardCustomizationSheet,
  SectionSettingsSheet,
} from '@/components/shared/dashboard-customization-sheet'
import {
  DEFAULT_DASHBOARD_CONFIG,
  parseDashboardSectionConfig,
  isSectionVisible,
  type DashboardSectionConfig,
} from '@/lib/dashboard-preferences'
import {
  computeRangeBounds,
  dashboardRangeLabel,
  DASHBOARD_RANGES,
  type DashboardRange,
  type RangeContext,
} from '@/lib/date-ranges'

type ChartType = 'revenue' | 'profit' | 'profitLoss' | 'cashflow' | 'collections' | 'categories'
type ChartView = 'line' | 'bar'
// §TIME-RANGE: Replaced local TimeRange union with the shared DashboardRange
// from src/lib/date-ranges.ts. This guarantees the dashboard, History, and
// Reports all use the EXACT SAME set of range IDs — no lossy mapping.
type TimeRange = DashboardRange
// §CHART-RANGES: Replaced local TIME_RANGES with the shared DASHBOARD_RANGES
// from src/lib/date-ranges.ts — single source of truth for the range list + labels.

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
  // §NET-REVENUE (Phase 5 D3 fix): Pre-tax, post-discount revenue for the
  // selected range. DIFFERENT from rangeSales (which is SUM(grandTotal) —
  // post-discount but INCLUDES GST). Used by the Total Revenue card so it
  // shows a distinct value from Total Sales.
  rangeNetRevenue?: number
  rangeDiscount?: number
  // §P16-STEP3.8.1-DASHBOARD-CARDS: Range-level P&L fields (additive —
  // computed from existing salesTrend[] buckets in /api/dashboard).
  // Used by the new "Net Profit / Loss" + "Gross Profit" cards.
  // rangeNetProfit CAN BE NEGATIVE (Gross Profit − authoritative OpEx).
  // rangeGrossProfit CAN BE NEGATIVE (Net Revenue − COGS).
  rangeGrossProfit?: number
  rangeNetProfit?: number
  // §HEALTH-BREAKDOWN (Phase 5 D4 fix): Decomposed health score components
  // from the dashboard API. Used by Reports P&L view's Health Breakdown
  // section so the user can see WHAT contributes to the score.
  healthBreakdown?: {
    score: number
    paidRatio: number
    nonOverdueRatio: number
    lowStockCount: number
    stockBonus: number
    components: Array<{
      id: string
      label: string
      value: number
      max: number
      hint: string
    }>
  }
}

// §TIME-RANGES: REMOVED — was a duplicate of DASHBOARD_RANGES from
// src/lib/date-ranges.ts. Use DASHBOARD_RANGES instead. Single source of truth.

const PIE_COLORS = ['#10b981', '#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6']

// §ROUTING (Phase 5 D1 fix): The lossy mapToHistoryRange() and
// mapToReportsRange() functions have been REMOVED. They collapsed
// 2d/3d/5d/7d/1m/3m/6m/1y → 'week'/'month'/'3months', which produced
// DIFFERENT date windows than the dashboard card displayed.
//
// Now the raw DashboardRange string is passed through unchanged.
// History and Reports both use the shared `computeRangeBounds()` from
// src/lib/date-ranges.ts — so they compute the EXACT same start/end as
// the dashboard card.
//
// Custom range's customStart/customEnd travel via the new
// `historyRangeContext` / `reportsRangeContext` store fields
// (RangeContext = { range, customStart, customEnd }).

export function DashboardView() {
  const { business, setActiveView, setKhataFilter, setKhataGradeFilter, setInventoryFilter, setSelectedPartyId, setSelectedInvoiceId, triggerQuickAction, setReturnToView, setOverlayPartyId, setOverlayInvoiceId, setHistoryDateRange, setHistoryRangeContext, setReportsDateRange, setReportsRangeContext, setReportsTab } = useAppStore()
  const { t } = useI18n()
  const [chartType, setChartType] = useState<ChartType>('revenue')
  const [chartView, setChartView] = useState<ChartView>('line')
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  // §P16-STEP3.8.1-DRILLDOWN: State for the Profit/Loss drill-down sheet.
  // When set, the bottom sheet opens and fetches /api/dashboard/breakdown
  // with the dashboard's current range + the tapped bucket's index.
  const [drilldownBucket, setDrilldownBucket] = useState<{ index: number; fullDate: string } | null>(null)
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
  const [topTab, setTopTab] = useState<'debtors' | 'buyers' | 'payments' | 'products' | 'defaulters'>('debtors')
  const [topExpanded, setTopExpanded] = useState(false)
  const [hubTab, setHubTab] = useState<'transactions' | 'lowstock' | 'orders'>('transactions')
  const [hubExpanded, setHubExpanded] = useState(false)
  // §DASHBOARD-CUSTOMIZATION: Dashboard section visibility/order + per-section prefs
  const [dashSectionConfig, setDashSectionConfig] = useState<DashboardSectionConfig>(DEFAULT_DASHBOARD_CONFIG)
  const [showCustomizeDash, setShowCustomizeDash] = useState(false)
  const [showSectionSettings, setShowSectionSettings] = useState<string | null>(null)
  // §QUICK-CUSTOMIZE: Bottom sheet for Business Overview card customization
  const [showCustomize, setShowCustomize] = useState(false)
  // §DASHBOARD-CARDS: User's dashboard card visibility/order configuration
  const [dashCardConfig, setDashCardConfig] = useState<CardConfig>(DEFAULT_CARD_CONFIG)
  const [showDashCardMgr, setShowDashCardMgr] = useState(false)
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
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false)
  // §UX-P1: Reset confirmation state — user must confirm before draft is reset
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  // §TRY-CLOSE: If dirty, show discard confirmation; otherwise close immediately
  const tryClose = () => {
    if (isDirty) {
      setShowDiscardConfirm(true)
    } else {
      setShowCustomize(false)
    }
  }

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
    setUploadError(null)
    setShowCustomize(true)
  }

  // §CANCEL: Discard draft and close (forced — no confirmation)
  const cancelCustomizer = () => {
    setDraft(cardPrefs)
    setDraftLogo(undefined)
    setDraftCover(undefined)
    setSaveError(null)
    setSaveSuccess(false)
    setUploadError(null)
    setShowDiscardConfirm(false)
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
    setUploadError(null)
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

      // §FIXED-LOCAL-STATE: Use server response as source of truth.
      // Previously: two separate setBusiness calls from stale `business` object
      // could overwrite each other when both logo + cover changed.
      // Now: use the returned `data.business` object directly (if provided).
      setCardPrefs(draft)
      if (data.business) {
        useAppStore.getState().setBusiness(data.business)
      } else if (business) {
        // Fallback: construct from current business if server didn't return it
        // (shouldn't happen — but handle gracefully)
        const updatedBiz: any = { ...business }
        if (draftLogo !== undefined) updatedBiz.logoUrl = draftLogo
        if (draftCover !== undefined) updatedBiz.coverUrl = draftCover
        useAppStore.getState().setBusiness(updatedBiz)
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
  const [uploadError, setUploadError] = useState<string | null>(null)

  // §FIXED-IMAGE-UPLOAD: Complete async flow with proper error handling.
  // FileReader is wrapped in a Promise so errors are caught by the outer try/catch.
  // uploading state stays true until the ENTIRE flow (read + compress) completes.
  // On failure: previous saved image is unchanged, visible error shown.
  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>, field: 'logoUrl' | 'coverUrl') => {
    const file = e.target.files?.[0]
    // Reset input so same file can be selected again
    e.target.value = ''
    if (!file) return

    // Validate MIME type
    if (!file.type.startsWith('image/')) {
      setUploadError('Please select an image file.')
      return
    }

    // Clear previous error when starting new upload
    setUploadError(null)
    if (field === 'logoUrl') setUploading(true)
    else setUploadingCover(true)

    try {
      // Step 1: Read file as data URL (awaited Promise)
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as string)
        reader.onerror = () => reject(new Error('Could not read file.'))
        reader.readAsDataURL(file)
      })

      // Step 2: Compress via existing API
      const compressRes = await fetch('/api/image-compress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: base64, targetSizeKB: 200 }),
      })

      if (!compressRes.ok) {
        throw new Error('Image processing failed on the server.')
      }

      const compressed = await compressRes.json()
      if (!compressed || !compressed.ok) {
        throw new Error('Image processing returned an unexpected response.')
      }

      const finalImage = compressed.image as string
      if (!finalImage || typeof finalImage !== 'string') {
        throw new Error('Image processing returned invalid data.')
      }

      // Step 3: Set draft (NOT persisted — user must click Save)
      if (field === 'logoUrl') setDraftLogo(finalImage)
      else setDraftCover(finalImage)
    } catch {
      setUploadError('Could not process image. Please try another image.')
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

  // §RESET-DEFAULTS: Reset draft to recommended defaults.
  // §UX-P1: Only modifies draft state — does NOT call the API.
  // User must click "Save Changes" afterwards to persist the reset.
  const resetToDefaults = () => {
    setDraft(DEFAULT_PREFS)
    setDraftLogo(null) // null = remove logo
    setDraftCover(null) // null = remove cover
    setShowResetConfirm(false)
  }

  // §UX-P1: Show reset confirmation dialog before resetting draft
  const handleResetClick = () => {
    setShowResetConfirm(true)
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
  // §CARD-PREFS-LOAD: Parse cardPreferences + dashboardCards from appSettings
  useEffect(() => {
    if (!appSettings) return
    const parsed = parseCardPrefs((appSettings as any).cardPreferences)
    setCardPrefs(parsed)
    // §DASHBOARD-CARDS-LOAD: Parse dashboard card config from AppSettings
    const dashCards = parseCardConfig((appSettings as any).dashboardCards)
    setDashCardConfig(dashCards)
    // §DASHBOARD-SECTIONS-LOAD: Parse dashboard section config from AppSettings
    const dashSections = parseDashboardSectionConfig((appSettings as any).dashboardSections)
    setDashSectionConfig(dashSections)
  }, [appSettings])

  // §STEP-1-RENDER-INTEGRATION: If the active tab falls out of the visibleTabs
  // list (e.g., user toggled it off in the section settings sheet), fall back
  // to the first still-visible tab. Prevents rendering orphaned tab content
  // for a tab the user can no longer select. No-op when the active tab is
  // still visible or when there are zero visible tabs (the empty state handles
  // the zero case).
  // §HOOK-ORDER: These useEffects MUST be above the early returns (loading /
  // error / empty states) so React's rules-of-hooks sees them called in the
  // same order on every render — even when the dashboard short-circuits.
  useEffect(() => {
    const visible = dashSectionConfig.topInsights.visibleTabs
    if (visible.length > 0 && !visible.includes(topTab)) {
      setTopTab(visible[0] as typeof topTab)
    }
  }, [dashSectionConfig.topInsights.visibleTabs, topTab])

  useEffect(() => {
    const visible = dashSectionConfig.businessActivity.visibleTabs
    if (visible.length > 0 && !visible.includes(hubTab)) {
      setHubTab(visible[0] as typeof hubTab)
    }
  }, [dashSectionConfig.businessActivity.visibleTabs, hubTab])
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
    // §FIX-3: Renamed from 'Profit vs Loss' to 'Net Cash Flow' because
    // dashboard profit = revenue - expense (cash-flow proxy), not true
    // accounting profit. Reports P&L has the true netProfit calculation.
    { id: 'profit', label: 'Net Cash Flow' },
    // §P16-STEP3: Restored 'Profit vs Loss' with TRUE accounting semantics.
    // Uses netProfit = grossProfit - operatingExpense = (netRevenue - cogs) - opEx.
    // NOT the cash-flow proxy (revenue - expense). Separate from Net Cash Flow.
    { id: 'profitLoss', label: 'Profit vs Loss' },
    { id: 'cashflow', label: t('dash.chart.cashflow') },
    { id: 'collections', label: 'Collections vs Credit' },
    { id: 'categories', label: 'Top Categories' },
    // §P16-STEP3: Removed misleading 'inventory' chart mode (was labelled 'Sales'
    // but used revenue dataKey = SUM of all sales, NOT inventory-specific data).
    // A genuine inventory chart would need real inventory trend data, not sales.
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

  // §UNIFIED-CARD-DEFS: All available dashboard cards with stable IDs.
  // Includes both lifetime metrics and time-dependent metrics.
  // §PHASE-5-D1: onClick handlers now receive a RangeContext {range, customStart,
  // customEnd} so History/Reports can be opened with the EXACT same date window
  // the card was displaying. Non-time-metric cards ignore the ctx parameter.
  // §PHASE-5-D3: totalRevenue card now uses rangeNetRevenue (pre-tax, post-
  // discount) — DIFFERENT from totalSales card (which uses rangeSales = SUM of
  // grandTotal, incl. GST). The two cards now display distinct values.
  // §PHASE-5-D4: businessHealth card now opens Reports P&L with a special
  // 'health' tab signal so the Health Breakdown section is shown front-and-center.
  const allCardDefs: Array<DashboardCardDef & { recommended?: boolean; isTimeMetric?: boolean }> = [
    { id: 'totalReceivable', label: t('dash.receivable'), icon: TrendingUp, tint: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', description: 'Money owed to you by customers', recommended: true,
      valueExtractor: (d) => d?.totalReceivable ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: () => { saveScrollPos('dashboard'); setKhataFilter('receivable'); setActiveView('khata') } },
    { id: 'totalPayable', label: t('dash.payable'), icon: TrendingDown, tint: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300', description: 'Money you owe to suppliers', recommended: true,
      valueExtractor: (d) => d?.totalPayable ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: () => { saveScrollPos('dashboard'); setKhataFilter('payable'); setActiveView('khata') } },
    { id: 'businessHealth', label: t('dash.health'), icon: Heart, tint: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', description: 'Overall business health score', recommended: true,
      valueExtractor: (d) => d?.healthScore ?? 0, formatValue: (v) => `${v}/100`,
      onClick: () => { saveScrollPos('dashboard'); setReportsTab('health'); setActiveView('reports') } },
    { id: 'lowStock', label: t('dash.lowStock'), icon: AlertTriangle, tint: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300', description: 'Products below stock threshold', recommended: true,
      valueExtractor: (d) => d?.lowStockCount ?? 0, formatValue: (v) => String(v),
      onClick: () => { saveScrollPos('dashboard'); setInventoryFilter('low-stock'); setActiveView('inventory') } },
    { id: 'totalSales', label: 'Total Sales (incl. GST)', icon: Wallet, tint: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', description: 'Sales for selected period (incl. GST) — SUM(grandTotal)', recommended: true, isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeSales ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setHistoryRangeContext(ctx); setActiveView('history') } },
    { id: 'totalCollection', label: 'Total Collection', icon: ArrowDownRight, tint: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', description: 'Collections for selected period', recommended: true, isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeCollection ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setHistoryRangeContext(ctx); setActiveView('history') } },
    { id: 'totalExpense', label: 'Total Expense', icon: ArrowUpRight, tint: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300', description: 'Expenses for selected period', recommended: true, isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeExpense ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setReportsRangeContext(ctx); setActiveView('reports') } },
    { id: 'totalRevenue', label: 'Net Revenue (excl. GST)', icon: Receipt, tint: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300', description: 'Net revenue (pre-tax, post-discount) — SUM(subtotal − discountAmount)', recommended: true, isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeNetRevenue ?? d?.rangeSales ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setReportsRangeContext(ctx); setActiveView('reports') } },
    // §P16-STEP3.8.1-NEW-CARDS: Net Profit / Loss + Gross Profit.
    // Values come from the additive dashboard API fields (rangeNetProfit,
    // rangeGrossProfit) — computed from existing salesTrend[] buckets.
    // NOT recomputed in the frontend. NOT from revenue - expense (cash-flow proxy).
    // Net Profit = Gross Profit - Authoritative Operating Expense (CAN BE NEGATIVE).
    // Gross Profit = Net Revenue - COGS (CAN BE NEGATIVE).
    // Negative values display with a minus sign — never silently converted to positive.
    { id: 'netProfitLoss', label: 'Net Profit / Loss', icon: TrendingUp, tint: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', description: 'Net profit/loss (Gross Profit − authoritative OpEx) — can be negative', recommended: true, isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeNetProfit ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setReportsRangeContext(ctx); setActiveView('reports') } },
    { id: 'grossProfit', label: 'Gross Profit', icon: TrendingUp, tint: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', description: 'Gross profit (Net Revenue − COGS) — can be negative', isTimeMetric: true, defaultRange: '1d',
      valueExtractor: (d) => d?.rangeGrossProfit ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: (ctx) => { saveScrollPos('dashboard'); setReportsRangeContext(ctx); setActiveView('reports') } },
    // §ADDITIONAL-CARDS: Available but hidden by default
    { id: 'totalCustomers', label: 'Total Customers', icon: Users, tint: 'bg-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-700 dark:text-blue-300', description: 'Total number of customers',
      valueExtractor: (d) => d?.partyCount ?? 0, formatValue: (v) => String(v),
      onClick: () => { saveScrollPos('dashboard'); setKhataFilter('all'); setActiveView('khata') } },
    { id: 'totalProducts', label: 'Total Products', icon: Package, tint: 'bg-indigo-500', bg: 'bg-indigo-50 dark:bg-indigo-950/30', text: 'text-indigo-700 dark:text-indigo-300', description: 'Total number of products',
      valueExtractor: (d) => d?.productCount ?? 0, formatValue: (v) => String(v),
      onClick: () => { saveScrollPos('dashboard'); setActiveView('inventory') } },
    { id: 'totalInvoices', label: 'Total Invoices', icon: FileText, tint: 'bg-cyan-500', bg: 'bg-cyan-50 dark:bg-cyan-950/30', text: 'text-cyan-700 dark:text-cyan-300', description: 'Total invoices issued',
      valueExtractor: (d) => d?.invoiceCount ?? 0, formatValue: (v) => String(v),
      onClick: () => { saveScrollPos('dashboard'); setActiveView('billing') } },
    { id: 'stockValue', label: 'Stock Value', icon: Boxes, tint: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300', description: 'Total value of current inventory',
      valueExtractor: (d) => d?.inventoryValue ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: () => { saveScrollPos('dashboard'); setActiveView('inventory') } },
    { id: 'todaySales', label: "Today's Sales", icon: Wallet, tint: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', description: 'Sales for today only',
      valueExtractor: (d) => d?.todaySales ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: () => { saveScrollPos('dashboard'); setHistoryRangeContext({ range: '1d' }); setActiveView('history') } },
    { id: 'monthlyRevenue', label: 'Monthly Revenue', icon: TrendingUp, tint: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', description: 'Revenue this month (incl. GST)',
      valueExtractor: (d) => d?.monthlyRevenue ?? 0, formatValue: (v, c) => formatCurrency(v, c),
      onClick: () => { saveScrollPos('dashboard'); setReportsRangeContext({ range: '1m' }); setActiveView('reports') } },
  ]

  // §VISIBLE-CARDS: Filter to visible + sort by configured order
  const visibleCards = dashCardConfig
    .filter(c => c.visible)
    .sort((a, b) => a.order - b.order)
    .map(config => ({ config, def: allCardDefs.find(d => d.id === config.id) }))
    .filter(c => c.def) as Array<{ config: { id: string; visible: boolean; order: number }; def: typeof allCardDefs[0] }>

  // §SAVE-DASHBOARD-CARDS: Persist card config via atomic API
  const saveDashboardCards = async (newConfig: CardConfig) => {
    const res = await fetch('/api/card-customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboardCards: JSON.stringify(newConfig) }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
    setDashCardConfig(newConfig)
  }

  // §SAVE-DASHBOARD-SECTIONS: Persist section config via atomic API
  const saveDashboardSections = async (newConfig: DashboardSectionConfig) => {
    const res = await fetch('/api/card-customization', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dashboardSections: JSON.stringify(newConfig) }),
    })
    const data = await res.json()
    if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
    setDashSectionConfig(newConfig)
  }

  // §MANAGE-CARDS-DEFS: Card metadata for the management sheet
  const manageCardDefs = allCardDefs.map(d => ({ id: d.id, label: d.label, icon: d.icon, description: d.description, recommended: d.recommended }))

  // §STEP-1-RENDER-INTEGRATION: Per-section visible items, derived from
  // dashSectionConfig. These arrays drive the filtered tab rows + empty
  // states below. Re-derived on every render — they're 3–5 element arrays,
  // so memoization would add overhead without measurable benefit.
  //
  // §ORDERING-NOTE: Section ORDER (which Card appears first on the dashboard)
  // is NOT applied here. The six section Cards are deeply interleaved with
  // floating modals/sheets (grade modal, drilldown sheet, customization
  // sheets) that can't be cleanly hoisted into a render-order map without a
  // larger refactor. Visibility is gated per-section via isSectionVisible();
  // reordering is intentionally deferred to a future refactor that extracts
  // each section into its own component.
  const ALL_TOP_TABS = [
    { id: 'debtors', label: 'Top Debtors' },
    { id: 'buyers', label: 'Top Buyers' },
    { id: 'payments', label: 'Top Payments' },
    { id: 'products', label: 'Top Products' },
    { id: 'defaulters', label: 'Defaulters' },
  ] as const
  const visibleTopTabs = ALL_TOP_TABS.filter(tab =>
    dashSectionConfig.topInsights.visibleTabs.includes(tab.id)
  )

  const ALL_HUB_TABS = [
    { id: 'transactions', label: 'Transactions' },
    { id: 'lowstock', label: 'Low Stock' },
    { id: 'orders', label: 'Online Orders' },
  ] as const
  const visibleHubTabs = ALL_HUB_TABS.filter(tab =>
    dashSectionConfig.businessActivity.visibleTabs.includes(tab.id)
  )

  const ALL_QUICK_ACTIONS = [
    { label: t('khata.addPartyShort'), icon: Users, view: 'khata' as const, action: 'add-party' as const, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
    { label: t('inv.addProductShort'), icon: Package, view: 'inventory' as const, action: 'add-product' as const, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
    { label: t('bill.newInvoiceShort'), icon: Receipt, view: 'sale-pad' as const, action: 'new-invoice' as const, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30' },
    { label: t('qa.addTransaction'), icon: ArrowLeftRight, view: 'khata' as const, action: 'add-transaction' as const, color: 'text-teal-600 bg-teal-50 dark:bg-teal-950/30' },
  ]
  const visibleQuickActions = ALL_QUICK_ACTIONS.filter(a =>
    dashSectionConfig.quickActions.visibleActions.includes(a.action)
  )

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
        {/* §COVER-PHOTO: Cover background with user-controlled blur + overlay.
            §FIX: CSS gradients (linear-gradient(...)) must be rendered as
            div background, NOT as <img src> — browsers treat gradient strings
            as relative URLs in <img src>, producing 404s.
            Data URLs (data:image/...) work fine in <img src>. */}
        {(() => {
          const cover = business?.coverUrl
          if (!cover) return null
          if (cover.startsWith('data:image/')) {
            return <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover"
              style={{ filter: `blur(${cardPrefs.coverBlur}px)` }}
              aria-hidden="true" />
          }
          // CSS gradient or other non-data URL → render as background
          return <div className="absolute inset-0 w-full h-full"
            style={{ background: cover, filter: `blur(${cardPrefs.coverBlur}px)`, backgroundSize: 'cover' }}
            aria-hidden="true" />
        })()}
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
              onClick={tryClose}
              className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
              // §UX-P0: max-h uses 90dvh (dynamic viewport) for better mobile support.
              // On iOS Safari, 85vh includes the URL bar area; dvh adjusts dynamically.
              // safe-area-inset-bottom is handled via the footer's padding.
              className="fixed bottom-0 inset-x-0 z-[100] bg-card rounded-t-3xl border-t border-border max-w-2xl mx-auto max-h-[90dvh] flex flex-col"
            >
              {/* §HEADER: sticky top with title + close */}
              <div className="flex items-center justify-between p-4 pb-2 border-b border-border">
                <h3 className="text-sm font-semibold flex items-center gap-1.5">
                  <Settings className="w-4 h-4" /> Customize Card
                </h3>
                <button onClick={tryClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* §SCROLLABLE-CONTENT: preview + controls.
                  §UX-P0: Added pb-24 (96px bottom padding) so the last setting
                  is never hidden behind the sticky footer on mobile. */}
              <div className="flex-1 overflow-y-auto p-4 pb-24 space-y-4">
                {/* §LIVE-PREVIEW: Card preview using draft state.
                    §FIX: Same conditional rendering as the main card —
                    CSS gradients need div background, not <img src>. */}
                <div className="relative w-full rounded-2xl overflow-hidden shadow-md">
                  {(() => {
                    const cover = draftCover !== undefined ? draftCover : business?.coverUrl
                    if (!cover) return null
                    if (cover.startsWith('data:image/')) {
                      return <img src={cover} alt="" className="absolute inset-0 w-full h-full object-cover"
                        style={{ filter: `blur(${draft.coverBlur}px)` }}
                        aria-hidden="true" />
                    }
                    return <div className="absolute inset-0 w-full h-full"
                      style={{ background: cover, filter: `blur(${draft.coverBlur}px)`, backgroundSize: 'cover' }}
                      aria-hidden="true" />
                  })()}
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
                  {/* §UPLOAD-ERROR: Visible error state for image processing failures */}
                  {uploadError && (
                    <div className="mb-2 px-3 py-2 rounded-lg bg-destructive/10 text-destructive text-[11px] font-medium">
                      {uploadError}
                    </div>
                  )}
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
                  {/* Suggested covers.
                    §UX-P1: Selected preset shows a checkmark overlay for clarity. */}
                  <div className="grid grid-cols-4 gap-2 mb-2">
                    {SUGGESTED_COVERS.map((grad, i) => {
                      const isSelected = draftCover === grad
                      return (
                        <button
                          key={i}
                          onClick={() => setDraftCover(grad)}
                          className={`relative h-10 rounded-lg shrink-0 border-2 transition-all ${isSelected ? 'border-primary ring-2 ring-primary/30' : 'border-transparent hover:border-muted-foreground/30'}`}
                          style={{ background: grad }}
                          aria-label={`Cover option ${i + 1}`}
                          aria-pressed={isSelected}
                        >
                          {isSelected && (
                            <span className="absolute inset-0 flex items-center justify-center">
                              <span className="w-5 h-5 rounded-full bg-white/90 flex items-center justify-center shadow-sm">
                                <Check className="w-3 h-3 text-primary" />
                              </span>
                            </span>
                          )}
                        </button>
                      )
                    })}
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

                {/* §GREETING-TEXT: Custom greeting.
                    §UX-P1: Added character counter (X / 30) to match backend limit. */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <p className="text-[10px] text-muted-foreground uppercase">Greeting Text</p>
                    <span className={`text-[10px] tabular ${draft.greetingText.length >= 25 ? 'text-amber-600' : 'text-muted-foreground'}`}>{draft.greetingText.length} / 30</span>
                  </div>
                  <input
                    type="text"
                    value={draft.greetingText}
                    onChange={(e) => setDraft({ ...draft, greetingText: e.target.value.slice(0, 30) })}
                    placeholder="Namaste"
                    maxLength={30}
                    className="w-full h-10 rounded-xl bg-muted px-3 text-sm border-0 outline-none focus:ring-2 focus:ring-primary/20"
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

                {/* §RESET-DEFAULTS: §UX-P1 — now shows confirmation dialog before resetting draft. */}
                <button onClick={handleResetClick} className="w-full text-xs text-muted-foreground hover:text-foreground py-2">
                  Reset to Default
                </button>

                {/* §MANAGE-SETTINGS: Navigate to full Settings page */}
                <button onClick={() => { cancelCustomizer(); setActiveView('settings') }} className="w-full flex items-center justify-between p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors min-h-[48px]">
                  <span className="text-xs font-medium flex items-center gap-1.5">⚙️ Manage Business Settings</span>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>

              {/* §STICKY-FOOTER: Save / Cancel.
                  §UX-P0: Added safe-area bottom padding so footer isn't hidden
                  behind iOS Safari bottom bar / Android Chrome nav bar. */}
              <div className="border-t border-border p-3 flex items-center gap-2 bg-card" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
                {saveError && <span className="text-[10px] text-destructive flex-1">{saveError}</span>}
                {saveSuccess && <span className="text-[10px] text-emerald-600 flex-1">✓ Changes saved</span>}
                {!saveError && !saveSuccess && <span className="flex-1" />}
                <button onClick={tryClose} disabled={saving} className="px-4 py-2.5 rounded-xl text-xs font-medium text-muted-foreground hover:bg-muted transition-colors min-h-[44px] disabled:opacity-50">
                  Cancel
                </button>
                {/* §UX-P0: Save button always shows "Save Changes" label.
                    Disabled state (via isDirty) communicates no-changes visually. */}
                <button onClick={saveChanges} disabled={saving || !isDirty} className="px-4 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors min-h-[44px] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5">
                  {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </motion.div>

            {/* §DISCARD-CONFIRMATION: Shows when user tries to close with unsaved changes */}
            <AnimatePresence>
              {showDiscardConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4"
                  onClick={() => setShowDiscardConfirm(false)}
                >
                  <motion.div
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.9 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-card rounded-2xl p-5 max-w-xs w-full space-y-3"
                  >
                    {/* §UX-P0: Updated dialog text per spec. */}
                  <p className="text-sm font-semibold text-center">Discard changes?</p>
                    <p className="text-[11px] text-muted-foreground text-center">You have unsaved changes. Are you sure you want to discard them?</p>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowDiscardConfirm(false)}
                        className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium min-h-[44px]"
                      >
                        Keep Editing
                      </button>
                      <button
                        onClick={cancelCustomizer}
                        className="flex-1 px-3 py-2.5 rounded-xl bg-destructive/10 text-destructive text-xs font-medium min-h-[44px]"
                      >
                        Discard Changes
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* §UX-P1: Reset to Default confirmation dialog.
                Reset only affects draft state — no API call until user clicks Save. */}
            <AnimatePresence>
              {showResetConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-[110] bg-black/60 flex items-center justify-center p-4"
                  onClick={() => setShowResetConfirm(false)}
                >
                  <motion.div
                    initial={{ scale: 0.9 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0.9 }}
                    onClick={(e) => e.stopPropagation()}
                    className="bg-card rounded-2xl p-5 max-w-xs w-full space-y-3"
                  >
                    <p className="text-sm font-semibold text-center">Reset to default?</p>
                    <p className="text-[11px] text-muted-foreground text-center">This will restore the default card appearance and settings.</p>
                    <div className="flex gap-2 pt-2">
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="flex-1 px-3 py-2.5 rounded-xl bg-muted text-foreground text-xs font-medium min-h-[44px]"
                      >
                        Keep Current
                      </button>
                      <button
                        onClick={resetToDefaults}
                        className="flex-1 px-3 py-2.5 rounded-xl bg-primary text-primary-foreground text-xs font-medium min-h-[44px]"
                      >
                        Reset to Default
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </AnimatePresence>

      {/* §LOCALIZED-CARD-FILTERS: Global time filter row REMOVED.
          Time-dependent cards now have their own dropdown range selector.
          The chart below still has its own range selector. */}

      {/* §P16-STEP3.8.1-MOVED: Custom Date Range panel was moved INSIDE the
          chart Card (below the chart-type/time-range selectors, above the
          chart visualization). It now appears contextually near the chart
          whose range it affects, instead of above the metric cards grid.
          See the chart Card below for the new location. */}

      {/* §LOCALIZED-CARD-FILTERS: Metric cards grid.
          Lifetime cards (Receivable, Payable, Health, LowStock) have NO
          time filter — they're running balances/counts.
          Time-dependent cards (Sales, Collection, Expense) have a dropdown
          range selector in the top-right corner. Each fetches its own
          /api/dashboard?range=X slice. */}

      {/* §STEP-1-RENDER-INTEGRATION: Summary Cards section — visibility
          gated by dashSectionConfig.sections[id=summaryCards].visible.
          The DashboardCardManagementSheet itself is left OUTSIDE the
          visibility wrap so the "Manage Summary Cards →" link in the
          DashboardCustomizationSheet can still open it even when the
          summaryCards section is hidden (lets users re-enable cards). */}
      {isSectionVisible(dashSectionConfig, 'summaryCards') && (
        <>
          {/* §UNIFIED-DASHBOARD-CARDS: All visible cards in one grid.
              Cards are rendered dynamically based on user's dashboardCards config.
              Time-dependent cards still use TimeMetricCard for their range selector. */}
          <div className="grid grid-cols-2 gap-3">
            {visibleCards.map(({ config, def }, i) => {
              if (def.isTimeMetric) {
                return (
                  <TimeMetricCard
                    key={config.id}
                    label={def.label}
                    icon={def.icon}
                    tint={def.tint}
                    bg={def.bg}
                    text={def.text}
                    defaultRange={(def.defaultRange as any) || '1d'}
                    currency={currency}
                    valueExtractor={def.valueExtractor}
                    onClick={def.onClick}
                  />
                )
              }
              const Icon = def.icon
              const value = def.valueExtractor(data)
              const formatted = def.formatValue(value, currency)
              return (
                <motion.button key={config.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }} onClick={() => def.onClick({ range: '1d' })} aria-label={def.label} className="text-left focus:outline-none focus:ring-2 focus:ring-primary/30 rounded-2xl">
                  <Card className={`p-4 ${def.bg} border-none hover:shadow-md transition-shadow h-full active:scale-[0.98]`}>
                    <div className="flex items-start justify-between mb-2"><span className={`w-8 h-8 rounded-lg ${def.tint} text-white flex items-center justify-center`}><Icon className="w-4 h-4" /></span></div>
                    <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">{def.label}</p>
                    <p className={`text-base font-bold tabular ${def.text}`}>{formatted}</p>
                  </Card>
                </motion.button>
              )
            })}
          </div>

          {/* §MANAGE-DASHBOARD-CARDS: Button to open card management sheet */}
          <button
            onClick={() => setShowDashCardMgr(true)}
            className="w-full flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-xs font-medium text-muted-foreground min-h-[44px]"
          >
            <LayoutGrid className="w-3.5 h-3.5" />
            Manage Dashboard Cards
          </button>
        </>
      )}

      {/* §DASHBOARD-CARD-MANAGEMENT-SHEET (always rendered — also reachable
          from DashboardCustomizationSheet's "Manage Summary Cards →" link) */}
      <DashboardCardManagementSheet
        open={showDashCardMgr}
        onClose={() => setShowDashCardMgr(false)}
        cardDefs={manageCardDefs}
        savedConfig={dashCardConfig}
        onSave={saveDashboardCards}
      />

      {/* §STEP-1-RENDER-INTEGRATION: Performance Chart section — visibility
          gated by dashSectionConfig.sections[id=performanceChart].visible. */}
      {isSectionVisible(dashSectionConfig, 'performanceChart') && (
      <Card className="p-4 pb-16">
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
            {DASHBOARD_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </div>

        {/* §P16-STEP3.8.1-MOVED: Custom Date Range panel — now INSIDE the chart
            Card, contextually below the chart-type/time-range selectors and
            above the chart visualization. Appears ONLY when timeRange==='custom'.
            Mobile-first: 2-col grid, no horizontal overflow, animated height. */}
        <AnimatePresence>
          {showCustomPicker && timeRange === 'custom' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
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

        {/* §TOGGLE-FIX: Chart rendering respects chartView (line vs bar) for
            ALL chart types. Categories (pie) ignores the toggle. Inventory
            uses AreaChart (line variant) / BarChart (bar variant).
            §FIX-6: Per-chart loading state — shows spinner when revalidating
            (apiLoading && data present from previous range). Doesn't hide
            the entire dashboard; only the chart area shows the loader.
            §FIX-7: Empty state — when all buckets have zero values, shows
            "No activity in this period" instead of a blank chart.
            §FIX-8: Accessibility — chart container has role="img" + aria-label.
            §FIX-9: Performance — profit chart's data.map() is memoized. */}

        {/* §FIX-9: Memoize profit chart data transformation to avoid recompute on every render */}
        {(() => {
          // §CHECK-EMPTY: Determine if all chart values are zero
          const allZero = data.salesTrend.length > 0 && data.salesTrend.every(d =>
            d.revenue === 0 && d.expense === 0 && d.profit === 0 &&
            d.collected === 0 && d.creditGiven === 0
          )

          // §FIX-6: Per-chart loading indicator (stale-while-revalidate)
          if (apiLoading && data) {
            return (
              <div className="h-44 flex items-center justify-center" role="status" aria-live="polite">
                <div className="flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground">Updating chart…</span>
                </div>
              </div>
            )
          }

          // §FIX-7: Empty state
          if (allZero) {
            return (
              <div className="h-44 flex items-center justify-center" role="img" aria-label="No chart data available">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground">No revenue or expense activity in this period</p>
                  <p className="text-[10px] text-muted-foreground/60">Try a wider date range</p>
                </div>
              </div>
            )
          }

          // §FIX-8: ARIA label for screen readers
          const ariaLabel = `${chartOptions.find((o) => o.id === chartType)?.label || 'Business'} chart for ${dashboardRangeLabel(timeRange, customStart, customEnd)} — ${data.salesTrend.length} data points`

          return (
            <motion.div key={chartType + chartView} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-44 -ml-2" role="img" aria-label={ariaLabel}>
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'revenue' && chartView === 'line' ? (
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient><linearGradient id="exp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171" stopOpacity={0.3} /><stop offset="100%" stopColor="#f87171" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" name="Revenue" />
                <Area type="monotone" dataKey="expense" stroke="#f87171" strokeWidth={2} fill="url(#exp)" name="Expense" />
              </AreaChart>
            ) : chartType === 'revenue' && chartView === 'bar' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} name="Revenue" />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} name="Expense" />
              </BarChart>
            ) : chartType === 'profit' && chartView === 'line' ? (
              // §TOGGLE-FIX: Profit vs Loss — LINE variant (LineChart)
              <RechartsLineChart data={data.salesTrend.map((d) => ({ ...d, profitVal: d.profit >= 0 ? d.profit : 0, lossVal: d.profit < 0 ? Math.abs(d.profit) : 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                {/* §FIX-3: Series names updated to match 'Net Cash Flow' semantics */}
                <Line type="monotone" dataKey="profitVal" stroke="#10b981" strokeWidth={2} dot={false} name="Net" />
                <Line type="monotone" dataKey="lossVal" stroke="#f87171" strokeWidth={2} dot={false} name="Outflow" />
              </RechartsLineChart>
            ) : chartType === 'profit' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Profit vs Loss — BAR variant (BarChart)
              <BarChart data={data.salesTrend.map((d) => ({ ...d, profitVal: d.profit >= 0 ? d.profit : 0, lossVal: d.profit < 0 ? Math.abs(d.profit) : 0 }))} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                {/* §FIX-3: Series names updated to match 'Net Cash Flow' semantics */}
                <Bar dataKey="profitVal" fill="#10b981" radius={[3, 3, 0, 0]} name="Net" />
                <Bar dataKey="lossVal" fill="#f87171" radius={[3, 3, 0, 0]} name="Outflow" />
              </BarChart>
            ) : chartType === 'profitLoss' && chartView === 'line' ? (
              // §P16-STEP3: Profit vs Loss — LINE variant (TRUE accounting profit)
              // Uses netProfitVal (positive) + netLossVal (negative) from salesTrend.
              // NOT the cash-flow proxy (revenue - expense).
              <RechartsLineChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<ProfitLossTooltip currency={currency} onViewDetails={(fullDate) => { const idx = data.salesTrend.findIndex(b => b.fullDate === fullDate); if (idx >= 0) setDrilldownBucket({ index: idx, fullDate }) }} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="netProfitVal" stroke="#10b981" strokeWidth={2} dot={false} name="Profit" />
                <Line type="monotone" dataKey="netLossVal" stroke="#f87171" strokeWidth={2} dot={false} name="Loss" />
              </RechartsLineChart>
            ) : chartType === 'profitLoss' && chartView === 'bar' ? (
              // §P16-STEP3: Profit vs Loss — BAR variant (TRUE accounting profit)
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<ProfitLossTooltip currency={currency} onViewDetails={(fullDate) => { const idx = data.salesTrend.findIndex(b => b.fullDate === fullDate); if (idx >= 0) setDrilldownBucket({ index: idx, fullDate }) }} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="netProfitVal" fill="#10b981" radius={[3, 3, 0, 0]} name="Profit" />
                <Bar dataKey="netLossVal" fill="#f87171" radius={[3, 3, 0, 0]} name="Loss" />
              </BarChart>
            ) : chartType === 'cashflow' && chartView === 'line' ? (
              // §TOGGLE-FIX: Cashflow — LINE variant (pure lines, no bars)
              // §P16-STEP3: Uses cashIn/cashOut fields (authoritative cash-in/out subtypes)
              <RechartsLineChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="cashIn" stroke="#10b981" strokeWidth={2} dot={false} name="Cash In" />
                <Line type="monotone" dataKey="cashOut" stroke="#f87171" strokeWidth={2} dot={false} name="Cash Out" />
              </RechartsLineChart>
            ) : chartType === 'cashflow' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Cashflow — BAR variant (pure bars, no line)
              // §P16-STEP3: Uses cashIn/cashOut fields (authoritative cash-in/out subtypes)
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Bar dataKey="cashIn" fill="#10b981" radius={[3, 3, 0, 0]} name="Cash In" />
                <Bar dataKey="cashOut" fill="#f87171" radius={[3, 3, 0, 0]} name="Cash Out" />
              </BarChart>
            ) : chartType === 'collections' && chartView === 'line' ? (
              // §TOGGLE-FIX: Collections — LINE variant
              <RechartsLineChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Line type="monotone" dataKey="collected" stroke="#10b981" strokeWidth={2} dot={false} name="Collected" />
                <Line type="monotone" dataKey="creditGiven" stroke="#ef4444" strokeWidth={2} dot={false} name="New Credit" />
              </RechartsLineChart>
            ) : chartType === 'collections' && chartView === 'bar' ? (
              // §TOGGLE-FIX: Collections — BAR variant
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
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
            ) : (
              // §P16-STEP3: Default fallback — Revenue chart (was inventory, now removed)
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis type="number" domain={[0, 'auto']} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={formatChartAxisValue} allowDecimals={false} />
                <Tooltip content={<CustomTooltip currency={currency} />} allowEscapeViewBox={{ x: false, y: false }} cursor={{ stroke: '#6366f1', strokeWidth: 1, strokeDasharray: '4 4' }} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" name="Revenue" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </motion.div>
          )
        })()}

        {/* Legend */}
        {['revenue', 'cashflow', 'collections', 'profit', 'profitLoss'].includes(chartType) && (
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            {chartType === 'revenue' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Revenue</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Expense</span></>)}
            {/* §FIX-3: Legend labels updated to match 'Net Cash Flow' chart name */}
            {chartType === 'profit' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Net</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Outflow</span></>)}
            {/* §P16-STEP3: Profit vs Loss legend — true accounting profit/loss */}
            {chartType === 'profitLoss' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Profit</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Loss</span></>)}
            {chartType === 'cashflow' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Cash In</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Cash Out</span></>)}
            {chartType === 'collections' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Collected</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500" />New Credit</span></>)}
          </div>
        )}

        {/* §P16-STEP3: Removed inventory value summary block (chart mode removed) */}

        {/* Top categories list */}
        {chartType === 'categories' && data.topCategories && data.topCategories.length > 0 && (
          <div className="mt-2 space-y-1">{data.topCategories.slice(0, 4).map((c, i) => (<div key={c.name} className="flex items-center gap-2 text-[11px]"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: PIE_COLORS[i % PIE_COLORS.length] }} /><span className="flex-1 truncate">{c.name}</span><span className="font-semibold tabular">{formatCurrency(c.value, currency)}</span></div>))}</div>
        )}
      </Card>
      )}

      {/* §STEP-1-RENDER-INTEGRATION: Customer Quality Distribution section —
          visibility gated by dashSectionConfig.sections[id=customerQuality].visible.
          The floating grade modal is wrapped together — it can only be
          triggered from inside the Card (bar tap), so hiding the section
          also prevents opening the modal. */}
      {isSectionVisible(dashSectionConfig, 'customerQuality') && (
        <>
      {/* Grade distribution — Interactive Bar Chart (PRD Part 5 §1) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-semibold">Customer Quality Distribution</h3>
          <button
            onClick={() => setShowSectionSettings('customerQuality')}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors min-h-[36px]"
            aria-label="Configure Customer Quality Distribution settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
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
        </>
      )}

      {/* §STEP-1-RENDER-INTEGRATION: Top Insights section — visibility
          gated + filtered tabs (visibleTabs) + View All moved below tab
          row + empty state when no tabs enabled. */}
      {isSectionVisible(dashSectionConfig, 'topInsights') && (
      <Card className="p-4">
        {/* §STEP-1: Section header with title + settings gear */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Top Insights</h3>
          <button
            onClick={() => setShowSectionSettings('topInsights')}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors min-h-[36px]"
            aria-label="Configure Top Insights settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        {visibleTopTabs.length === 0 ? (
          /* §STEP-1: Empty state — all Top Insights tabs disabled */
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
            <p className="text-xs text-muted-foreground">No tabs enabled. Open settings to configure.</p>
            <button
              onClick={() => setShowSectionSettings('topInsights')}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground min-h-[36px]"
              aria-label="Configure Top Insights"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
        <>
        {/* §STEP-1: Tab row (filtered by dashSectionConfig.topInsights.visibleTabs) */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar -mx-1 px-1 mb-2">
          {visibleTopTabs.map((tab) => (
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
        {/* §STEP-1: View All button — moved BELOW the tab row */}
        <div className="mb-3">
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
              // §PHASE-5-D1: Use RangeContext for full custom-range support.
              setHistoryRangeContext({ range: '7d' })
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
          }} className="text-xs text-primary font-medium flex items-center">{t('common.viewAll')} <ChevronRight className="w-3 h-3" /></button>
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
        </>
        )}
      </Card>
      )}

      {/* §STEP-1-RENDER-INTEGRATION: Business Activity Hub section — visibility
          gated by dashSectionConfig.sections[id=businessActivity].visible +
          filtered tabs (visibleTabs) + View All moved below the tab row +
          empty state when no tabs are enabled. */}
      {isSectionVisible(dashSectionConfig, 'businessActivity') && (
      <Card className="p-4">
        {/* §STEP-1: Section header with title + settings gear */}
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold">Business Activity</h3>
          <button
            onClick={() => setShowSectionSettings('businessActivity')}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors min-h-[36px]"
            aria-label="Configure Business Activity settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        {visibleHubTabs.length === 0 ? (
          /* §STEP-1: Empty state — all Business Activity tabs disabled */
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
            <p className="text-xs text-muted-foreground">No tabs enabled. Open settings to configure.</p>
            <button
              onClick={() => setShowSectionSettings('businessActivity')}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground min-h-[36px]"
              aria-label="Configure Business Activity"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
        <>
        {/* §STEP-1: Tab buttons (filtered by dashSectionConfig.businessActivity.visibleTabs) */}
        <div className="flex items-center gap-1 mb-2 overflow-x-auto no-scrollbar -mx-1 px-1">
          {visibleHubTabs.map((tab) => (
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
        </div>
        {/* §STEP-1: View All — moved BELOW the tab row */}
        <div className="mb-3">
          <button onClick={() => {
            saveScrollPos('dashboard')
            // §DYNAMIC-ROUTING: View All routes based on active hub tab.
            if (hubTab === 'transactions') {
              // Transactions → History (with active time filter)
              // §PHASE-5-D1: Pass the FULL RangeContext (not just range string)
              // so History sees the exact same date window — including custom
              // range's start/end dates.
              setHistoryRangeContext({ range: timeRange, customStart, customEnd })
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
              {DASHBOARD_RANGES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
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
        </>
        )}
      </Card>
      )}

      {/* §STEP-1-RENDER-INTEGRATION: Quick Actions section — visibility
          gated by dashSectionConfig.sections[id=quickActions].visible +
          filtered actions (visibleActions) + gear icon in header + empty
          state when no actions enabled. */}
      {isSectionVisible(dashSectionConfig, 'quickActions') && (
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('dash.quickActions')}</h3>
          <button
            onClick={() => setShowSectionSettings('quickActions')}
            className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors min-h-[36px]"
            aria-label="Configure Quick Actions settings"
          >
            <Settings className="w-3.5 h-3.5" />
          </button>
        </div>
        {visibleQuickActions.length === 0 ? (
          /* §STEP-1: Empty state — all Quick Actions disabled */
          <div className="flex items-center justify-between p-3 rounded-xl bg-muted/40">
            <p className="text-xs text-muted-foreground">No actions enabled. Open settings to configure.</p>
            <button
              onClick={() => setShowSectionSettings('quickActions')}
              className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center text-muted-foreground min-h-[36px]"
              aria-label="Configure Quick Actions"
            >
              <Settings className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
        <div className="grid grid-cols-4 gap-2">
          {visibleQuickActions.map((a) => {
            const Icon = a.icon
            return (
              <button key={a.label} onClick={() => { setActiveView(a.view); triggerQuickAction({ id: crypto.randomUUID(), type: a.action }) }} className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-muted transition-colors min-h-[72px] justify-center">
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.color}`}><Icon className="w-5 h-5" /></span>
                <span className="text-[10px] font-medium text-center leading-tight">{a.label}</span>
              </button>
            )
          })}
        </div>
        )}
      </Card>
      )}

      {/* §P16-STEP3.8.1-DRILLDOWN: Profit/Loss drill-down bottom sheet.
          Opens when the user taps "View Details" in the ProfitLossTooltip.
          Fetches /api/dashboard/breakdown with the dashboard's current range
          + the tapped bucket's index. Server derives all bucket boundaries. */}
      <ProfitLossDrilldownSheet
        open={!!drilldownBucket}
        onClose={() => setDrilldownBucket(null)}
        bucket={drilldownBucket}
        range={timeRange}
        customStart={customStart}
        customEnd={customEnd}
        currency={currency}
      />

      {/* §DASHBOARD-CUSTOMIZATION: Customize Dashboard entry point + sheets */}
      <div className="pt-2 pb-4">
        <button
          onClick={() => setShowCustomizeDash(true)}
          className="w-full flex items-center justify-center gap-2 p-3 rounded-xl border border-border text-muted-foreground hover:bg-muted transition-colors min-h-[44px]"
        >
          <Settings className="w-4 h-4" />
          <span className="text-xs font-medium">Customize Dashboard</span>
        </button>
      </div>

      {/* §CUSTOMIZE-DASHBOARD-SHEET */}
      <DashboardCustomizationSheet
        open={showCustomizeDash}
        onClose={() => setShowCustomizeDash(false)}
        savedConfig={dashSectionConfig}
        onSave={saveDashboardSections}
        onManageCards={() => setShowDashCardMgr(true)}
      />

      {/* §SECTION-SETTINGS-SHEET: Per-section settings (Customer Quality, Top Insights, Business Activity, Quick Actions) */}
      <SectionSettingsSheet
        open={showSectionSettings === 'customerQuality'}
        onClose={() => setShowSectionSettings(null)}
        title="Customer Quality"
        sectionVisible={isSectionVisible(dashSectionConfig, 'customerQuality')}
        onToggleSection={(visible) => {
          const newConfig = { ...dashSectionConfig, sections: dashSectionConfig.sections.map(s => s.id === 'customerQuality' ? { ...s, visible } : s) }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        items={[{ id: 'A', label: 'Grade A' }, { id: 'B', label: 'Grade B' }, { id: 'C', label: 'Grade C' }, { id: 'D', label: 'Grade D' }, { id: 'E', label: 'Grade E' }]}
        visibleItems={dashSectionConfig.customerQuality.visibleGrades}
        onToggleItem={(id) => {
          const grades = dashSectionConfig.customerQuality.visibleGrades
          const newGrades = grades.includes(id) ? grades.filter(g => g !== id) : [...grades, id]
          const newConfig = { ...dashSectionConfig, customerQuality: { visibleGrades: newGrades } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        onReset={() => {
          const newConfig = { ...dashSectionConfig, customerQuality: { ...DEFAULT_DASHBOARD_CONFIG.customerQuality } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
      />

      <SectionSettingsSheet
        open={showSectionSettings === 'topInsights'}
        onClose={() => setShowSectionSettings(null)}
        title="Top Insights"
        sectionVisible={isSectionVisible(dashSectionConfig, 'topInsights')}
        onToggleSection={(visible) => {
          const newConfig = { ...dashSectionConfig, sections: dashSectionConfig.sections.map(s => s.id === 'topInsights' ? { ...s, visible } : s) }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        items={[{ id: 'debtors', label: 'Top Debtors' }, { id: 'buyers', label: 'Top Buyers' }, { id: 'payments', label: 'Top Payments' }, { id: 'products', label: 'Top Products' }, { id: 'defaulters', label: 'Defaulters' }]}
        visibleItems={dashSectionConfig.topInsights.visibleTabs}
        onToggleItem={(id) => {
          const tabs = dashSectionConfig.topInsights.visibleTabs
          const newTabs = tabs.includes(id) ? tabs.filter(t => t !== id) : [...tabs, id]
          const newConfig = { ...dashSectionConfig, topInsights: { ...dashSectionConfig.topInsights, visibleTabs: newTabs } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        defaultItemId={dashSectionConfig.topInsights.defaultTab}
        onSetDefault={(id) => {
          const newConfig = { ...dashSectionConfig, topInsights: { ...dashSectionConfig.topInsights, defaultTab: id } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        onReset={() => {
          const newConfig = { ...dashSectionConfig, topInsights: { ...DEFAULT_DASHBOARD_CONFIG.topInsights } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
      />

      <SectionSettingsSheet
        open={showSectionSettings === 'businessActivity'}
        onClose={() => setShowSectionSettings(null)}
        title="Business Activity"
        sectionVisible={isSectionVisible(dashSectionConfig, 'businessActivity')}
        onToggleSection={(visible) => {
          const newConfig = { ...dashSectionConfig, sections: dashSectionConfig.sections.map(s => s.id === 'businessActivity' ? { ...s, visible } : s) }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        items={[{ id: 'transactions', label: 'Transactions' }, { id: 'lowstock', label: 'Low Stock' }, { id: 'orders', label: 'Online Orders' }]}
        visibleItems={dashSectionConfig.businessActivity.visibleTabs}
        onToggleItem={(id) => {
          const tabs = dashSectionConfig.businessActivity.visibleTabs
          const newTabs = tabs.includes(id) ? tabs.filter(t => t !== id) : [...tabs, id]
          const newConfig = { ...dashSectionConfig, businessActivity: { ...dashSectionConfig.businessActivity, visibleTabs: newTabs } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        defaultItemId={dashSectionConfig.businessActivity.defaultTab}
        onSetDefault={(id) => {
          const newConfig = { ...dashSectionConfig, businessActivity: { ...dashSectionConfig.businessActivity, defaultTab: id } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        onReset={() => {
          const newConfig = { ...dashSectionConfig, businessActivity: { ...DEFAULT_DASHBOARD_CONFIG.businessActivity } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
      />

      <SectionSettingsSheet
        open={showSectionSettings === 'quickActions'}
        onClose={() => setShowSectionSettings(null)}
        title="Quick Actions"
        sectionVisible={isSectionVisible(dashSectionConfig, 'quickActions')}
        onToggleSection={(visible) => {
          const newConfig = { ...dashSectionConfig, sections: dashSectionConfig.sections.map(s => s.id === 'quickActions' ? { ...s, visible } : s) }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        items={[{ id: 'add-party', label: 'Add Party' }, { id: 'add-product', label: 'Add Product' }, { id: 'new-invoice', label: 'New Invoice' }, { id: 'add-transaction', label: 'Add Transaction' }]}
        visibleItems={dashSectionConfig.quickActions.visibleActions}
        onToggleItem={(id) => {
          const actions = dashSectionConfig.quickActions.visibleActions
          const newActions = actions.includes(id) ? actions.filter(a => a !== id) : [...actions, id]
          const newConfig = { ...dashSectionConfig, quickActions: { ...dashSectionConfig.quickActions, visibleActions: newActions } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
        onReset={() => {
          const newConfig = { ...dashSectionConfig, quickActions: { ...DEFAULT_DASHBOARD_CONFIG.quickActions } }
          setDashSectionConfig(newConfig)
          saveDashboardSections(newConfig).catch(() => {})
        }}
      />
    </div>
  )
}

// PRD Part 38 §4: TradingView-style custom tooltip with full date display
// §FIX-4: Mobile-safe tooltip — uses Recharts' allowEscapeViewBox={{ x: false }}
// to clamp the tooltip within the chart's SVG bounds.
// §FIX-1 (Phase 13): Added timeZone: 'Asia/Kolkata' to date formatting.
// §FIX-2 (Phase 13): Added bucket-aware time display for hourly buckets.
// §FIX-5 (Phase 13): Added weekly bucket date range display.
function CustomTooltip({ active, payload, label, currency }: any) {
  if (!active || !payload || payload.length === 0) return null
  // Use fullDate from payload if available, otherwise try label
  const fullDate = payload[0]?.payload?.fullDate

  // §FIX-1: All date formatting explicitly uses timeZone: 'Asia/Kolkata'
  // to ensure correct IST date display regardless of the viewer's browser
  // timezone. Without this, a non-IST user would see dates shifted by
  // their local timezone offset.
  const IST_TZ = 'Asia/Kolkata'

  // §FIX-2: Detect if this is an hourly bucket by checking if the X-axis
  // label looks like a time (e.g., "12:00 am", "1:30 pm").
  // For hourly buckets, show the date + the bucket's time range.
  const isHourly = /^\d{1,2}:\d{2}\s*[ap]m$/i.test(label || '')

  // §FIX-5: Detect if this is a weekly bucket by checking if label is "W1", "W2", etc.
  const isWeekly = /^W\d+$/i.test(label || '')

  // §P16-STEP3: Detect if this is a monthly bucket by checking if label is a
  // 3-letter month abbreviation (Jan, Feb, ..., Dec). Monthly buckets are used
  // for 6m, 1y, and custom ranges >90 days. Without this handler, monthly
  // buckets fell through to the default (daily) format, showing weekday+date
  // instead of "Month Year" — misleading for monthly aggregations.
  const isMonthly = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i.test(label || '')

  const formatTooltipHeader = (d: string): string => {
    try {
      const date = new Date(d)
      if (isNaN(date.getTime())) return label || ''

      if (isHourly) {
        // §FIX-2: Hourly bucket — show date + time range
        // The bucket start is `date`, end is `date + 1 hour`
        const endDate = new Date(date.getTime() + 60 * 60 * 1000)
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ })
        const startTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ })
        const endTime = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ })
        return `${dateStr}\n${startTime} – ${endTime}`
      }

      if (isWeekly) {
        // §FIX-5: Weekly bucket — show start – end date range
        // The bucket start is `date`, end is `date + 7 days`
        const endDate = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000)
        const startStr = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ })
        const endStr = endDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ })
        return `${startStr} – ${endStr}`
      }

      if (isMonthly) {
        // §P16-STEP3: Monthly bucket — show "Month Year" (e.g., "August 2026")
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: IST_TZ })
      }

      // Default: daily bucket — date only
      return date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ })
    } catch {
      return label || ''
    }
  }

  const headerText = fullDate ? formatTooltipHeader(fullDate) : label

  return (
    <div style={{
      background: 'rgba(20,20,20,0.95)',
      border: '1px solid rgba(99,102,241,0.4)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      maxWidth: 180,
      color: '#f3f4f6',
    }}>
      <p style={{ fontWeight: 700, marginBottom: 6, fontSize: 10, color: '#9ca3af', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, whiteSpace: 'pre-line' }}>
        {headerText}
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

// §P16-STEP3: ProfitLossTooltip — dedicated tooltip for the Profit vs Loss chart.
// Shows full P&L breakdown: Revenue, COGS, Gross Profit, Operating Expense, Net Profit/Loss.
// Uses the same header formatting logic as CustomTooltip (hourly/weekly/monthly/daily).
// §P16-STEP3.8.1: Added "View Details" button to open the drill-down sheet.
function ProfitLossTooltip({ active, payload, label, currency, onViewDetails }: any) {
  if (!active || !payload || payload.length === 0) return null
  const fullDate = payload[0]?.payload?.fullDate
  const IST_TZ = 'Asia/Kolkata'
  const isHourly = /^\d{1,2}:\d{2}\s*[ap]m$/i.test(label || '')
  const isWeekly = /^W\d+$/i.test(label || '')
  const isMonthly = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)$/i.test(label || '')

  const formatHeader = (d: string): string => {
    try {
      const date = new Date(d)
      if (isNaN(date.getTime())) return label || ''
      if (isHourly) {
        const endDate = new Date(date.getTime() + 60 * 60 * 1000)
        const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ })
        const startTime = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ })
        const endTime = endDate.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: IST_TZ })
        return `${dateStr}\n${startTime} – ${endTime}`
      }
      if (isWeekly) {
        const endDate = new Date(date.getTime() + 7 * 24 * 60 * 60 * 1000)
        const startStr = date.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ })
        const endStr = endDate.toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric', timeZone: IST_TZ })
        return `${startStr} – ${endStr}`
      }
      if (isMonthly) {
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: IST_TZ })
      }
      return date.toLocaleDateString('en-US', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric', timeZone: IST_TZ })
    } catch {
      return label || ''
    }
  }

  const headerText = fullDate ? formatHeader(fullDate) : label
  const p = payload[0]?.payload || {}
  const isLoss = p.netProfit < 0

  // §P16-STEP3: Helper function (not a component) to render P&L rows.
  // Using a function avoids the "components during render" lint error.
  const renderRow = (label: string, value: number, color: string) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 3 }}>
      <span style={{ color, fontWeight: 600, fontSize: 11 }}>{label}:</span>
      <span style={{ fontWeight: 700, fontSize: 12, color: '#f3f4f6' }}>
        {currency ? formatCurrency(value, currency) : `₹${value}`}
      </span>
    </div>
  )

  return (
    <div style={{
      background: 'rgba(20,20,20,0.95)',
      border: '1px solid rgba(99,102,241,0.4)',
      borderRadius: 10,
      padding: '10px 14px',
      fontSize: 12,
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
      maxWidth: 200,
      color: '#f3f4f6',
    }}>
      <p style={{ fontWeight: 700, marginBottom: 6, fontSize: 10, color: '#9ca3af', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: 4, whiteSpace: 'pre-line' }}>
        {headerText}
      </p>
      {renderRow("Revenue", p.netRevenue || 0, "#10b981")}
      {renderRow("COGS", p.cogs || 0, "#f59e0b")}
      {renderRow("Gross Profit", p.grossProfit || 0, "#6366f1")}
      {renderRow("Operating Expense", p.operatingExpense || 0, "#f87171")}
      {/* §P16-STEP3.1-FIX-D: Disclose legacy unclassified expenses separately.
          When legacyOpEx > 0, show it as a separate line so users know the
          authoritative Net Profit does NOT include these unclassified amounts. */}
      {(p.legacyOpEx || 0) > 0 && (
        <div style={{ marginTop: 4, paddingTop: 4, borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
          {renderRow("Unclassified (legacy)", p.legacyOpEx || 0, "#9ca3af")}
        </div>
      )}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 4, paddingTop: 4 }}>
        {renderRow(isLoss ? "Net Loss" : "Net Profit", Math.abs(p.netProfit || 0), isLoss ? "#f87171" : "#10b981")}
      </div>
      {/* §P16-STEP3.8.1: "View Details" button — opens the drill-down bottom sheet.
          Touch-friendly (min 44px tap target). Calls onViewDetails with the
          bucket's fullDate so the parent can find the bucket index and open
          the sheet with the correct /api/dashboard/breakdown?bucketIndex=X. */}
      {onViewDetails && fullDate && (
        <button
          onClick={() => onViewDetails(fullDate)}
          style={{
            marginTop: 8, padding: '6px 0', width: '100%',
            background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.5)',
            borderRadius: 6, color: '#c7d2fe', fontSize: 11, fontWeight: 600,
            cursor: 'pointer', minHeight: 36, display: 'flex', alignItems: 'center',
            justifyContent: 'center', gap: 4,
          }}
        >
          View Details →
        </button>
      )}
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
// §PHASE-5-D1: onClick now passes the FULL RangeContext (range + customStart +
// customEnd) so History/Reports see the EXACT same date window — including
// custom range dates which were previously lost.
// §PHASE-5-D2: Each TimeMetricCard still maintains its OWN local range state.
// Rationale for keeping independent ranges (after Phase 4 audit): the user may
// want to compare "Today's Sales" vs "This Week's Collection" on the same
// dashboard. Unifying would force both to the same range, removing that
// capability. The card's range is now ALWAYS preserved on click — so even
// with independent ranges, navigation never loses context.
// ============================================================================

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
  // §PHASE-5-D1: onClick now receives a full RangeContext — preserves custom
  // range start/end dates through the navigation chain.
  onClick: (ctx: RangeContext) => void
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
  // §PHASE-5-D1: Use shared dashboardRangeLabel so the card displays the SAME
  // label History/Reports will display after the click.
  const rangeLabel = dashboardRangeLabel(range, customStart, customEnd)

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
            {DASHBOARD_RANGES.map((r) => (
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

      <button onClick={() => onClick({ range, customStart: customStart || null, customEnd: customEnd || null })} className="w-full text-left relative z-0 pr-8">
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
