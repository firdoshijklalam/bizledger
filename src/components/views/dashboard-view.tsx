'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { DashboardStats } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META, timeAgo } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Wallet, Heart, AlertTriangle, Package,
  ArrowUpRight, ArrowDownRight, ArrowLeftRight, Users, Receipt, ChevronRight,
} from 'lucide-react'
import { motion } from 'framer-motion'
import {
  Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
  Bar, BarChart, Cell, Legend, Line, ComposedChart,
} from 'recharts'
import { Card } from '@/components/ui/card'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { useMemo, useState } from 'react'

type ChartType = 'revenue' | 'profit' | 'cashflow'

const CHART_OPTIONS: Array<{ id: ChartType; label: string }> = [
  { id: 'revenue', label: 'আয় বনাম ব্যয়' },
  { id: 'profit', label: 'লাভ বনাম লোকসান' },
  { id: 'cashflow', label: 'ক্যাশ ইন/আউট' },
]

export function DashboardView() {
  const { business, setActiveView, setKhataFilter, setInventoryFilter, setSelectedPartyId, triggerQuickAction } = useAppStore()
  const { t } = useI18n()
  const { data, loading } = useFetch<DashboardStats>('/api/dashboard')
  const [chartType, setChartType] = useState<ChartType>('revenue')

  const currency = business?.currency || 'INR'

  if (loading) return <LoadingState />
  if (!data) return <EmptyState icon={Heart} title="No data yet" />

  const metrics = [
    {
      label: t('dash.receivable'),
      value: formatCurrency(data.totalReceivable, currency),
      icon: TrendingUp,
      tint: 'bg-emerald-500',
      bg: 'bg-emerald-50 dark:bg-emerald-950/30',
      text: 'text-emerald-700 dark:text-emerald-300',
      onClick: () => { setKhataFilter('receivable'); setActiveView('khata') },
    },
    {
      label: t('dash.payable'),
      value: formatCurrency(data.totalPayable, currency),
      icon: TrendingDown,
      tint: 'bg-red-500',
      bg: 'bg-red-50 dark:bg-red-950/30',
      text: 'text-red-700 dark:text-red-300',
      onClick: () => { setKhataFilter('payable'); setActiveView('khata') },
    },
    {
      label: t('dash.todaySales'),
      value: formatCurrency(data.todaySales, currency),
      icon: Wallet,
      tint: 'bg-amber-500',
      bg: 'bg-amber-50 dark:bg-amber-950/30',
      text: 'text-amber-700 dark:text-amber-300',
      onClick: () => setActiveView('billing'),
    },
    {
      label: t('dash.health'),
      value: `${data.healthScore}/100`,
      icon: Heart,
      tint: 'bg-teal-500',
      bg: 'bg-teal-50 dark:bg-teal-950/30',
      text: 'text-teal-700 dark:text-teal-300',
      onClick: () => setActiveView('reports'),
    },
    {
      label: t('dash.lowStock'),
      value: String(data.lowStockCount),
      icon: AlertTriangle,
      tint: 'bg-orange-500',
      bg: 'bg-orange-50 dark:bg-orange-950/30',
      text: 'text-orange-700 dark:text-orange-300',
      onClick: () => { setInventoryFilter('low-stock'); setActiveView('inventory') },
    },
    {
      label: t('dash.monthlyRevenue'),
      value: formatCurrency(data.monthlyRevenue, currency),
      icon: Receipt,
      tint: 'bg-purple-500',
      bg: 'bg-purple-50 dark:bg-purple-950/30',
      text: 'text-purple-700 dark:text-purple-300',
      onClick: () => setActiveView('reports'),
    },
  ]

  const healthColor =
    data.healthScore >= 75 ? 'text-emerald-600' : data.healthScore >= 50 ? 'text-amber-600' : 'text-red-600'

  return (
    <div className="space-y-4">
      {/* Hero greeting */}
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 p-5 text-primary-foreground shadow-lg shadow-primary/20"
      >
        <p className="text-xs opacity-80">Namaste, {business?.ownerName?.split(' ')[0] || 'Trader'} 👋</p>
        <h2 className="text-lg font-bold mt-0.5">{business?.name}</h2>
        <div className="flex items-center gap-4 mt-3">
          <div>
            <p className="text-[11px] opacity-75">{t('dash.receivable')}</p>
            <p className="text-lg font-bold tabular">{formatCurrency(data.totalReceivable, currency)}</p>
          </div>
          <div className="w-px h-10 bg-white/20" />
          <div>
            <p className="text-[11px] opacity-75">{t('dash.payable')}</p>
            <p className="text-lg font-bold tabular">{formatCurrency(data.totalPayable, currency)}</p>
          </div>
        </div>
      </motion.div>

      {/* Metric cards grid */}
      <div className="grid grid-cols-2 gap-3">
        {metrics.map((m, i) => {
          const Icon = m.icon
          return (
            <motion.button
              key={m.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
              onClick={m.onClick}
              className="text-left"
            >
              <Card className={`p-4 ${m.bg} border-none hover:shadow-md transition-shadow h-full`}>
                <div className="flex items-start justify-between mb-2">
                  <span className={`w-8 h-8 rounded-lg ${m.tint} text-white flex items-center justify-center`}>
                    <Icon className="w-4 h-4" />
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground leading-tight mb-0.5">{m.label}</p>
                <p className={`text-base font-bold tabular ${m.text}`}>{m.value}</p>
              </Card>
            </motion.button>
          )
        })}
      </div>

      {/* Sales trend chart — multi-chart switcher (PRD v2 §7.2) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold">{t('dash.salesTrend')}</h3>
            <p className="text-[11px] text-muted-foreground">Last 7 days</p>
          </div>
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value as ChartType)}
            className="text-xs bg-muted rounded-lg px-2 py-1.5 border-0 outline-none h-8 font-medium"
          >
            {CHART_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </div>
        <motion.div
          key={chartType}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
          className="h-44 -ml-2"
        >
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'revenue' ? (
              <AreaChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.4} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="exp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f87171" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" strokeWidth={2} fill="url(#rev)" />
                <Area type="monotone" dataKey="expense" stroke="#f87171" strokeWidth={2} fill="url(#exp)" />
              </AreaChart>
            ) : chartType === 'profit' ? (
              <BarChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Bar dataKey="profit" radius={[4, 4, 0, 0]}>
                  {data.salesTrend.map((entry, i) => (
                    <Cell key={i} fill={entry.profit >= 0 ? '#10b981' : '#f87171'} />
                  ))}
                </Bar>
              </BarChart>
            ) : (
              <ComposedChart data={data.salesTrend} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.9 0.005 145)" vertical={false} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10 }} axisLine={false} tickLine={false} width={32} tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(0)}k` : String(v)} />
                <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid oklch(0.9 0.005 145)', fontSize: 12 }} formatter={(v: number) => formatCurrency(v, currency)} />
                <Bar dataKey="revenue" fill="#10b981" radius={[4, 4, 0, 0]} name="Cash In" />
                <Bar dataKey="expense" fill="#f87171" radius={[4, 4, 0, 0]} name="Cash Out" />
                <Line type="monotone" dataKey="profit" stroke="#6366f1" strokeWidth={2} dot={false} name="Net" />
              </ComposedChart>
            )}
          </ResponsiveContainer>
        </motion.div>
      </Card>

      {/* Grade distribution */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3">Customer Quality Distribution</h3>
        <div className="flex items-end justify-between gap-2 h-28">
          {data.gradeDistribution.map((g) => {
            const max = Math.max(...data.gradeDistribution.map((x) => x.count), 1)
            const h = (g.count / max) * 100
            const meta = GRADE_META[g.grade]
            return (
              <div key={g.grade} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-xs font-bold tabular">{g.count}</span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ duration: 0.5 }}
                  className={`w-full rounded-t-md ${meta.bg} min-h-[4px]`}
                  style={{ maxHeight: '80px' }}
                />
                <span className={`text-[10px] font-bold ${meta.color}`}>{g.grade}</span>
              </div>
            )
          })}
        </div>
      </Card>

      {/* Top debtors */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('dash.topDebtors')}</h3>
          <button onClick={() => { setKhataFilter('receivable'); setActiveView('khata') }} className="text-xs text-primary font-medium flex items-center">
            {t('common.viewAll')} <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {data.topDebtors.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No outstanding receivables 🎉</p>
        ) : (
          <div className="space-y-2">
            {data.topDebtors.slice(0, 4).map((d) => {
              const meta = GRADE_META[d.grade]
              return (
                <button
                  key={d.id}
                  onClick={() => { setSelectedPartyId(d.id); setActiveView('khata') }}
                  className="w-full flex items-center gap-3 p-2.5 rounded-xl hover:bg-muted transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-xs font-bold">
                    {d.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                    <p className="text-[11px] text-muted-foreground">{meta.desc}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular text-emerald-600">{formatCurrency(d.balance, currency)}</p>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{d.grade}</span>
                  </div>
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
          <button onClick={() => setActiveView('khata')} className="text-xs text-primary font-medium flex items-center">
            {t('common.viewAll')} <ChevronRight className="w-3 h-3" />
          </button>
        </div>
        {data.recentTransactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No transactions yet</p>
        ) : (
          <div className="space-y-1">
            {data.recentTransactions.slice(0, 5).map((tx) => {
              const isCredit = tx.type === 'credit'
              return (
                <div key={tx.id} className="flex items-center gap-3 p-2 rounded-lg">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center ${isCredit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    {isCredit ? <ArrowDownRight className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-600" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description || tx.type}</p>
                    <p className="text-[11px] text-muted-foreground">{tx.party?.name || '—'} · {timeAgo(tx.createdAt)}</p>
                  </div>
                  <span className={`text-sm font-semibold tabular ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isCredit ? '+' : '-'}{formatCurrency(tx.amount, currency)}
                  </span>
                </div>
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
              <button
                key={a.label}
                onClick={() => {
                  setActiveView(a.view)
                  triggerQuickAction({ id: crypto.randomUUID(), type: a.action })
                }}
                className="flex flex-col items-center gap-1.5 p-2 rounded-xl hover:bg-muted transition-colors min-h-[72px] justify-center"
              >
                <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${a.color}`}>
                  <Icon className="w-5 h-5" />
                </span>
                <span className="text-[10px] font-medium text-center leading-tight">{a.label}</span>
              </button>
            )
          })}
        </div>
      </Card>
    </div>
  )
}
