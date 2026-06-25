'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { DashboardStats } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META, timeAgo } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Wallet, Heart, AlertTriangle, Package,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Users, Receipt, ChevronRight,
  BarChart3, LineChart, X,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  Bar, BarChart, Cell, Pie, PieChart, Line, ComposedChart,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { useScrollRetention } from '@/hooks/use-scroll-retention'
import { useMemo, useState } from 'react'

type ChartType = 'revenue' | 'profit' | 'cashflow' | 'collections' | 'categories' | 'inventory'
type ChartView = 'line' | 'bar'
type TimeRange = '1d' | '2d' | '3d' | '5d' | '7d' | '1m' | '3m' | '6m' | '1y' | 'custom'

interface ExtendedDashboardStats extends DashboardStats {
  topCategories?: Array<{ name: string; value: number }>
  topProductsBySales?: Array<{ name: string; value: number }>
  inventoryValue?: number
  inventoryTrend?: Array<{ month: string; value: number }>
}

const TIME_RANGES: Array<{ id: TimeRange; label: string }> = [
  { id: '1d', label: '1 Day' },
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

export function DashboardView() {
  const { business, setActiveView, setKhataFilter, setInventoryFilter, setSelectedPartyId, setSelectedInvoiceId, triggerQuickAction, setReturnToView } = useAppStore()
  const { t } = useI18n()
  const [chartType, setChartType] = useState<ChartType>('revenue')
  const [chartView, setChartView] = useState<ChartView>('line')
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [showCustomPicker, setShowCustomPicker] = useState(false)
  const [selectedGrade, setSelectedGrade] = useState<string | null>(null)
  const { saveScroll } = useScrollRetention()

  const apiUrl = useMemo(() => {
    if (timeRange === 'custom' && customStart && customEnd) {
      return `/api/dashboard?range=custom&startDate=${customStart}&endDate=${customEnd}`
    }
    return `/api/dashboard?range=${timeRange}`
  }, [timeRange, customStart, customEnd])

  const { data, loading } = useFetch<ExtendedDashboardStats>(apiUrl, [apiUrl])

  const chartOptions: Array<{ id: ChartType; label: string }> = [
    { id: 'revenue', label: t('dash.chart.revenue') },
    { id: 'profit', label: t('dash.chart.profit') },
    { id: 'cashflow', label: t('dash.chart.cashflow') },
    { id: 'collections', label: 'Collections vs Credit' },
    { id: 'categories', label: 'Top Categories' },
    { id: 'inventory', label: 'Inventory Value' },
  ]

  const currency = business?.currency || 'INR'

  if (loading) return <LoadingState />
  if (!data) return <EmptyState icon={Heart} title="No data yet" />

  const metrics = [
    { label: t('dash.receivable'), value: formatCurrency(data.totalReceivable, currency), icon: TrendingUp, tint: 'bg-emerald-500', bg: 'bg-emerald-50 dark:bg-emerald-950/30', text: 'text-emerald-700 dark:text-emerald-300', onClick: () => { setKhataFilter('receivable'); setActiveView('khata') } },
    { label: t('dash.payable'), value: formatCurrency(data.totalPayable, currency), icon: TrendingDown, tint: 'bg-red-500', bg: 'bg-red-50 dark:bg-red-950/30', text: 'text-red-700 dark:text-red-300', onClick: () => { setKhataFilter('payable'); setActiveView('khata') } },
    { label: t('dash.todaySales'), value: formatCurrency(data.todaySales, currency), icon: Wallet, tint: 'bg-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/30', text: 'text-amber-700 dark:text-amber-300', onClick: () => setActiveView('billing') },
    { label: t('dash.health'), value: `${data.healthScore}/100`, icon: Heart, tint: 'bg-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-700 dark:text-teal-300', onClick: () => setActiveView('reports') },
    { label: t('dash.lowStock'), value: String(data.lowStockCount), icon: AlertTriangle, tint: 'bg-orange-500', bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-700 dark:text-orange-300', onClick: () => { setInventoryFilter('low-stock'); setActiveView('inventory') } },
    { label: t('dash.monthlyRevenue'), value: formatCurrency(data.monthlyRevenue, currency), icon: Receipt, tint: 'bg-purple-500', bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-700 dark:text-purple-300', onClick: () => setActiveView('reports') },
  ]

  return (
    <div className="space-y-4">
      {/* Hero greeting */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-2xl bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 p-5 text-primary-foreground shadow-lg shadow-primary/20">
        <p className="text-xs opacity-80">Namaste, {business?.ownerName?.split(' ')[0] || 'Trader'} 👋</p>
        <h2 className="text-lg font-bold mt-0.5">{business?.name}</h2>
        <div className="flex items-center gap-4 mt-3">
          <div><p className="text-[11px] opacity-75">{t('dash.receivable')}</p><p className="text-lg font-bold tabular">{formatCurrency(data.totalReceivable, currency)}</p></div>
          <div className="w-px h-10 bg-white/20" />
          <div><p className="text-[11px] opacity-75">{t('dash.payable')}</p><p className="text-lg font-bold tabular">{formatCurrency(data.totalPayable, currency)}</p></div>
        </div>
      </motion.div>

      {/* Metric cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m, i) => {
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

      {/* Chart — PRD Part 4: Chart toggle + dynamic time-frame + advanced charts */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-sm font-semibold">{t('dash.salesTrend')}</h3>
            <p className="text-[11px] text-muted-foreground">{TIME_RANGES.find((r) => r.id === timeRange)?.label || '7 Days'}</p>
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

        {/* Custom Date Range Picker */}
        <AnimatePresence>
          {showCustomPicker && timeRange === 'custom' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden mb-3">
              <div className="p-3 rounded-xl bg-muted/50 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Custom Date Range</p>
                  <button onClick={() => { setShowCustomPicker(false); setTimeRange('7d') }} className="text-muted-foreground"><X className="w-3.5 h-3.5" /></button>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div><label className="text-[10px] text-muted-foreground">Start Date</label><input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-full h-9 rounded-lg bg-card border border-border px-2 text-xs outline-none" /></div>
                  <div><label className="text-[10px] text-muted-foreground">End Date</label><input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-full h-9 rounded-lg bg-card border border-border px-2 text-xs outline-none" /></div>
                </div>
                {customStart && customEnd && <p className="text-[10px] text-emerald-600">✓ Range applied</p>}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Chart rendering */}
        <motion.div key={chartType + chartView + timeRange} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} className="h-44 -ml-2">
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'revenue' && chartView === 'line' ? (
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity={0.4} /><stop offset="100%" stopColor="#10b981" stopOpacity={0} /></linearGradient><linearGradient id="exp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f87171" stopOpacity={0.3} /><stop offset="100%" stopColor="#f87171" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" />
                <Area type="monotone" dataKey="expense" stroke="#f87171" strokeWidth={2} fill="url(#exp)" />
              </AreaChart>
            ) : chartType === 'revenue' && chartView === 'bar' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Bar dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} name="Revenue" />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} name="Expense" />
              </BarChart>
            ) : chartType === 'profit' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>{data.salesTrend.map((entry, i) => <Cell key={i} fill={entry.profit >= 0 ? '#10b981' : '#f87171'} />)}</Bar>
              </BarChart>
            ) : chartType === 'cashflow' ? (
              <ComposedChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Bar dataKey="revenue" fill="#10b981" radius={[3, 3, 0, 0]} name="Cash In" />
                <Bar dataKey="expense" fill="#f87171" radius={[3, 3, 0, 0]} name="Cash Out" />
                <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} name="Net" />
              </ComposedChart>
            ) : chartType === 'collections' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 9 }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
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
              <AreaChart data={data.inventoryTrend || []} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs><linearGradient id="inv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.4} /><stop offset="100%" stopColor="#8b5cf6" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Area type="monotone" dataKey="value" stroke="#8b5cf6" strokeWidth={2} fill="url(#inv)" name="Stock Value" />
              </AreaChart>
            )}
          </ResponsiveContainer>
        </motion.div>

        {/* Legend */}
        {['revenue', 'cashflow', 'collections'].includes(chartType) && (
          <div className="flex items-center gap-3 mt-2 text-[10px]">
            {chartType === 'revenue' && (<><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500" />Revenue</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400" />Expense</span></>)}
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
                  <button onClick={() => { setSelectedGrade(null); setKhataFilter('all'); setReturnToView('dashboard'); setActiveView('khata') }} className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg">Go to Khata →</button>
                  <button onClick={() => setSelectedGrade(null)} className="text-muted-foreground"><X className="w-4 h-4" /></button>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto scroll-area p-3 space-y-1">
                {(() => {
                  const count = data.gradeDistribution.find((g) => g.grade === selectedGrade)?.count || 0
                  if (count === 0) return <p className="text-sm text-muted-foreground text-center py-8">No customers in this grade</p>
                  return (
                    <>
                      <p className="text-xs text-muted-foreground px-1 mb-2">{count} customer{count !== 1 ? 's' : ''} in this grade</p>
                      {data.topDebtors.filter((d) => d.grade === selectedGrade).map((d) => (
                        <button key={d.id} onClick={() => { setSelectedGrade(null); setReturnToView('dashboard'); setSelectedPartyId(d.id); setActiveView('khata') }} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left">
                          <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700">{d.name.charAt(0)}</span>
                          <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{d.name}</p><p className="text-[11px] text-muted-foreground">Balance: ₹{d.balance}</p></div>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </button>
                      ))}
                      {data.topDebtors.filter((d) => d.grade === selectedGrade).length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Tap "Go to Khata" to see all {count} customers</p>}
                    </>
                  )
                })()}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top debtors */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('dash.topDebtors')}</h3>
          <button onClick={() => { saveScroll(); setKhataFilter('receivable'); setActiveView('khata') }} className="text-xs text-primary font-medium flex items-center">{t('common.viewAll')} <ChevronRight className="w-3 h-3" /></button>
        </div>
        {data.topDebtors.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No outstanding receivables 🎉</p> : (
          <div className="space-y-2">
            {data.topDebtors.slice(0, 4).map((d) => {
              const meta = GRADE_META[d.grade]
              return (
                <button key={d.id} onClick={() => { setReturnToView('dashboard'); setSelectedPartyId(d.id); setActiveView('khata') }} className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted transition-colors text-left">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">{d.name.charAt(0)}</div>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{d.name}</p><p className="text-[11px] text-muted-foreground">{meta.desc}</p></div>
                  <div className="text-right"><p className="text-sm font-semibold tabular text-emerald-600">{formatCurrency(d.balance, currency)}</p><span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{d.grade}</span></div>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Recent transactions */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('dash.recent')}</h3>
          <button onClick={() => { saveScroll(); setActiveView('billing') }} className="text-xs text-primary font-medium flex items-center">{t('common.viewAll')} <ChevronRight className="w-3 h-3" /></button>
        </div>
        {data.recentTransactions.length === 0 ? <p className="text-sm text-muted-foreground py-4 text-center">No transactions yet</p> : (
          <div className="space-y-1">
            {data.recentTransactions.slice(0, 5).map((tx) => {
              const isCredit = tx.type === 'credit'
              return (
                <button key={tx.id} onClick={() => { saveScroll(); if (tx.invoiceId) { setSelectedInvoiceId(tx.invoiceId) } else if (tx.partyId) { setReturnToView('dashboard'); setSelectedPartyId(tx.partyId); setActiveView('khata') } }} className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isCredit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>{isCredit ? <ArrowDownRight className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-600" />}</span>
                  <div className="flex-1 min-w-0"><p className="text-sm font-medium truncate">{tx.description || tx.type}</p><p className="text-[11px] text-muted-foreground">{tx.party?.name || '—'} · {timeAgo(tx.createdAt)}</p></div>
                  <span className={`text-sm font-semibold tabular ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>{isCredit ? '+' : '-'}{formatCurrency(tx.amount, currency)}</span>
                </button>
              )
            })}
          </div>
        )}
      </Card>

      {/* Quick actions */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">{t('dash.quickActions')}</h3>
        <div className="grid grid-cols-4 gap-2">
          {[
            { label: t('khata.addPartyShort'), icon: Users, view: 'khata' as const, action: 'add-party' as const, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30' },
            { label: t('inv.addProductShort'), icon: Package, view: 'inventory' as const, action: 'add-product' as const, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30' },
            { label: t('bill.newInvoiceShort'), icon: Receipt, view: 'billing' as const, action: 'new-invoice' as const, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950/30' },
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
