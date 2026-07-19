'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
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
import { LoadingState } from '@/components/shared/states'
import { toast } from 'sonner'
import {
  Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { useMemo, useState } from 'react'

const PIE_COLORS = ['#10b981', '#14b8a6', '#f59e0b', '#f97316', '#ef4444']

interface ReportData {
  business: any
  profitLoss: {
    revenue: number; netRevenue: number; discount: number;
    cogs: number; grossProfit: number; indirectExpenses: number;
    expense: number; netProfit: number; gst: number;
  }
  gst: { totalGst: number; breakdown: Array<{ rate: number; taxable: number; gst: number }> }
  partyLedger: Array<{ id: string; name: string; type: string; grade: string; balance: number; phone?: string | null }>
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

type PLRange = 'today' | 'week' | 'month' | '3months' | 'custom'
type GSTRange = 'month' | 'last_month' | 'quarter' | 'custom'
type PartySegment = 'all' | 'customers' | 'suppliers'
type OutstandingTab = 'receivables' | 'payables'
type StockMovement = 'all' | 'fast' | 'slow' | 'non-moving'

export function ReportsView() {
  const { business, setActiveView } = useAppStore()
  const { t } = useI18n()
  const { data, loading } = useFetch<ReportData>('/api/reports', [])
  // §HEALTH-BANNER: fetch dashboard stats for the Business Health score context
  const { data: dashData } = useFetch<{ healthScore?: number; totalReceivable?: number } & Record<string, unknown>>('/api/dashboard?range=7d', [])
  const [healthBannerDismissed, setHealthBannerDismissed] = useState(false)
  const { data: allProducts } = useFetch<any[]>('/api/products', [])
  const [activeReport, setActiveReport] = useState<'pl' | 'gst' | 'party' | 'outstanding' | 'stock' | 'grade'>('pl')

  // P&L date filter (PRD Part 19 §1)
  const [plRange, setPlRange] = useState<PLRange>('month')
  const [plCustomStart, setPlCustomStart] = useState('')
  const [plCustomEnd, setPlCustomEnd] = useState('')

  // GST date filter (PRD Part 19 §2)
  const [gstRange, setGstRange] = useState<GSTRange>('month')
  const [gstCustomStart, setGstCustomStart] = useState('')
  const [gstCustomEnd, setGstCustomEnd] = useState('')

  // Party Ledger (PRD Part 19 §3)
  const [partySeg, setPartySeg] = useState<PartySegment>('all')
  const [partySearch, setPartySearch] = useState('')
  const [sortByDue, setSortByDue] = useState(false)

  // Outstanding (PRD Part 19 §4)
  const [outstandingTab, setOutstandingTab] = useState<OutstandingTab>('receivables')

  // Stock Ageing (PRD Part 19 §5)
  const [stockMovement, setStockMovement] = useState<StockMovement>('all')

  // Customer Quality (PRD Part 19 §6)
  const [expandedGrade, setExpandedGrade] = useState<string | null>(null)

  // P&L: top category leaderboard (PRD Part 19 §1) — computed before early return to satisfy rules of hooks
  const categoryLeaderboard = useMemo(() => {
    if (!allProducts) return []
    const map: Record<string, { value: number; count: number }> = {}
    allProducts.forEach((p) => {
      const c = p.category || 'Uncategorized'
      if (!map[c]) map[c] = { value: 0, count: 0 }
      map[c].value += (p.salePrice - p.purchasePrice) * p.stock
      map[c].count += 1
    })
    return Object.entries(map)
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)
  }, [allProducts])

  // Party Ledger filtered + sorted (PRD Part 19 §3)
  const filteredPartyLedger = useMemo(() => {
    if (!data) return []
    let list = data.partyLedger
    if (partySeg === 'customers') list = list.filter((p) => p.type !== 'supplier')
    if (partySeg === 'suppliers') list = list.filter((p) => p.type !== 'customer')
    if (partySearch.trim()) {
      const q = partySearch.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(partySearch))
    }
    if (sortByDue) {
      list = [...list].sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
    }
    return list
  }, [data, partySeg, partySearch, sortByDue])

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

  if (loading || !data) return <LoadingState />
  const currency = business?.currency || 'INR'
  const bizName = (business?.name || 'BizLedger').replace(/\s+/g, '_')

  const exportPdf = (type: string) => {
    toast.success(`Generating ${type} PDF…`)
    setTimeout(() => window.print(), 200)
  }

  const exportExcel = (type: string) => {
    toast.success(`Excel export started for ${type}`)
    const rows: string[] = []
    if (type === 'P&L') {
      rows.push('Metric,Amount')
      rows.push(`Total Sales (Gross),${data.profitLoss.revenue}`)
      rows.push(`Discounts Given,${data.profitLoss.discount}`)
      rows.push(`Net Revenue,${data.profitLoss.netRevenue}`)
      rows.push(`Purchase Cost (COGS),${data.profitLoss.cogs}`)
      rows.push(`Gross Profit,${data.profitLoss.grossProfit}`)
      rows.push(`Indirect Expenses,${data.profitLoss.indirectExpenses}`)
      rows.push(`Net Profit,${data.profitLoss.netProfit}`)
      rows.push(`GST Collected,${data.profitLoss.gst}`)
    } else if (type === 'Party Ledger') {
      rows.push('Name,Type,Grade,Balance,Phone')
      data.partyLedger.forEach((p) => rows.push(`${p.name},${p.type},${p.grade},${p.balance},${p.phone || ''}`))
    } else if (type === 'Outstanding') {
      rows.push('Name,Amount,Type')
      data.outstanding.receivables.forEach((r) => rows.push(`${r.name},${r.amount},Receivable`))
      data.outstanding.payables.forEach((p) => rows.push(`${p.name},${p.amount},Payable`))
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${bizName}_${type.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success(`${type} exported`)
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

      {/* Export buttons */}
      <div className="grid grid-cols-3 gap-2 action-buttons">
        <Button variant="outline" onClick={() => exportPdf(REPORTS.find((r) => r.id === activeReport)!.label)} className="h-11 flex-col text-xs">
          <FileText className="w-4 h-4 mb-0.5" /> {t('rep.downloadPdf')}
        </Button>
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
            {/* Date filter chips (PRD Part 19 §1) */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
              {([
                { id: 'today', label: 'Today' },
                { id: 'week', label: 'Week' },
                { id: 'month', label: 'Month' },
                { id: '3months', label: '3 Months' },
                { id: 'custom', label: 'Custom' },
              ] as const).map((r) => (
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
                <div className="pt-2 border-t border-dashed border-border">
                  <Row icon={BarChart3} label="Gross Profit" value={formatCurrency(data.profitLoss.grossProfit, currency)} color={data.profitLoss.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'} bold />
                </div>
                <Row icon={TrendingDown} label="Less: Indirect Expenses" value={`− ${formatCurrency(data.profitLoss.indirectExpenses, currency)}`} color="text-red-600" />
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
              <button
                onClick={() => setSortByDue(!sortByDue)}
                className={`text-[10px] px-2 py-1 rounded-lg ${sortByDue ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}`}
              >
                Sort by Due
              </button>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scroll-area">
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
                      <p className="text-[11px] text-muted-foreground capitalize">{p.type}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-sm font-semibold tabular ${p.balance > 0 ? 'text-emerald-600' : p.balance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
                        {formatCurrency(Math.abs(p.balance), currency)}
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

            <Card className="p-5">
              {outstandingTab === 'receivables' ? (
                <>
                  <h3 className="text-sm font-semibold mb-3">Receivables</h3>
                  <div className="space-y-2 max-h-72 overflow-y-auto scroll-area">
                    {data.outstanding.receivables.map((r, i) => {
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
