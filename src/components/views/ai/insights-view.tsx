'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import { TrendingUp, TrendingDown, AlertTriangle, Package, Users, Clock, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LoadingState, EmptyState } from '@/components/shared/states'

interface Insights {
  currency: string
  topProducts: Array<{ id: string; name: string; unit: string; totalSold: number; revenue: number; stock: number }>
  topDebtors: Array<{ id: string; name: string; balance: number; grade: string }>
  stockAlerts: Array<{ id: string; name: string; stock: number; threshold: number; unit: string }>
  revenue: { thisMonth: number; lastMonth: number; growth: number }
  collectionRate: number
  overdueCount: number
  overdueAmount: number
  slowMoving: Array<{ id: string; name: string; stock: number; stockValue: number }>
  summary: { totalParties: number; totalProducts: number; totalInvoices: number; totalTransactions: number }
}

export function InsightsView() {
  const { business } = useAppStore()
  const { data, loading } = useFetch<Insights>('/api/insights', [])
  const currency = business?.currency || 'INR'

  if (loading) return <LoadingState />
  if (!data) return <EmptyState icon={TrendingUp} title="No insights available" />

  return (
    <div className="space-y-4">
      {/* Revenue growth card */}
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="p-5 bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 text-primary-foreground border-none">
          <p className="text-xs opacity-80">Revenue Growth (vs last month)</p>
          <div className="flex items-center gap-2 mt-1">
            <p className="text-2xl font-bold tabular">{formatCurrency(data.revenue.thisMonth, currency)}</p>
            <span className={`text-sm font-bold flex items-center gap-0.5 ${data.revenue.growth >= 0 ? 'text-emerald-200' : 'text-red-200'}`}>
              {data.revenue.growth >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {data.revenue.growth > 0 ? '+' : ''}{data.revenue.growth}%
            </span>
          </div>
          <p className="text-[11px] opacity-70 mt-1">Last month: {formatCurrency(data.revenue.lastMonth, currency)}</p>
        </Card>
      </motion.div>

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <p className="text-[11px] text-muted-foreground">Collection Rate</p>
          </div>
          <p className="text-xl font-bold tabular">{data.collectionRate}%</p>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <p className="text-[11px] text-muted-foreground">Overdue</p>
          </div>
          <p className="text-xl font-bold tabular text-red-600">{data.overdueCount}</p>
          <p className="text-[10px] text-muted-foreground">{formatCurrency(data.overdueAmount, currency)}</p>
        </Card>
      </div>

      {/* Top Products */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Package className="w-4 h-4 text-amber-600" /> Top Selling Products
        </h3>
        {data.topProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No sales yet</p>
        ) : (
          <div className="space-y-2">
            {data.topProducts.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">{p.totalSold} {p.unit} sold</p>
                </div>
                <span className="text-sm font-semibold tabular">{formatCurrency(p.revenue, currency)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Top Debtors */}
      <Card className="p-4">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
          <Users className="w-4 h-4 text-red-600" /> Top Debtors
        </h3>
        {data.topDebtors.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No outstanding balances 🎉</p>
        ) : (
          <div className="space-y-2">
            {data.topDebtors.map((d) => {
              const meta = GRADE_META[d.grade]
              return (
                <div key={d.id} className="flex items-center gap-3">
                  <span className="w-8 h-8 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-xs font-bold text-red-600 shrink-0">
                    {d.name.charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{d.name}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{d.grade}</span>
                  <span className="text-sm font-semibold tabular text-red-600">{formatCurrency(d.balance, currency)}</span>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Stock Alerts */}
      {data.stockAlerts.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-orange-600" /> Stock Alerts ({data.stockAlerts.length})
          </h3>
          <div className="space-y-2">
            {data.stockAlerts.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-orange-600 font-medium tabular">{s.stock} / {s.threshold} {s.unit}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Slow Moving */}
      {data.slowMoving.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" /> Slow-Moving (no sales in 30 days)
          </h3>
          <div className="space-y-2">
            {data.slowMoving.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <span className="flex-1 truncate">{s.name}</span>
                <span className="text-muted-foreground tabular">{formatCurrency(s.stockValue, currency)} tied up</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  )
}
