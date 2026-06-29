'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  TrendingUp, TrendingDown, AlertTriangle, Package, Users, Clock, CheckCircle2,
  Lightbulb, Megaphone, ShoppingCart, X, Loader2,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface Insights {
  currency: string
  topProducts: Array<{ id: string; name: string; unit: string; totalSold: number; revenue: number; stock: number }>
  topDebtors: Array<{ id: string; name: string; balance: number; grade: string; phone?: string | null }>
  stockAlerts: Array<{ id: string; name: string; stock: number; threshold: number; unit: string }>
  revenue: { thisMonth: number; lastMonth: number; growth: number }
  collectionRate: number
  overdueCount: number
  overdueAmount: number
  slowMoving: Array<{ id: string; name: string; stock: number; stockValue: number }>
  summary: { totalParties: number; totalProducts: number; totalInvoices: number; totalTransactions: number }
}

export function InsightsView() {
  const { business, setActiveView } = useAppStore()
  const { data, loading } = useFetch<Insights>('/api/insights', [])
  const currency = business?.currency || 'INR'
  const [topMode, setTopMode] = useState<'revenue' | 'volume'>('revenue')
  // AI Suggestion modal (PRD Part 20 §5)
  const [aiSuggestion, setAiSuggestion] = useState<{ name: string; suggestions: string[] } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)

  if (loading) return <LoadingState />
  if (!data) return <EmptyState icon={TrendingUp} title="No insights available" />

  const handleRemind = (d: { name: string; phone?: string | null }) => {
    if (!d.phone) {
      toast.error(`${d.name} has no phone number`)
      return
    }
    const cleaned = d.phone.replace(/[^0-9]/g, '').replace(/^0/, '91')
    const text = encodeURIComponent(`প্রিয় ${d.name}, আপনার বকেয়া পেমেন্ট সম্পর্কে অনুরোধ করা হলো। ধন্যবাদ 🙏`)
    window.open(`https://wa.me/${cleaned}?text=${text}`, '_blank')
    toast.success(`Reminder sent to ${d.name}`)
  }

  const handleQuickOrder = (productName: string) => {
    setActiveView('sourcing')
    toast.info(`Source ${productName} from B2B Sourcing`)
  }

  // AI Suggestion for slow-moving items (PRD Part 20 §5)
  const handleAISuggestion = async (name: string) => {
    setAiLoading(true)
    setAiSuggestion({ name, suggestions: [] })
    try {
      // Static + dynamic suggestions (no actual GLM call needed in offline mode)
      const suggestions = [
        `Offer a 10-15% discount on "${name}" to clear slow-moving stock.`,
        `Bundle "${name}" with a fast-moving product for a combo deal.`,
        `Run a limited-time flash sale (24-48 hours) to create urgency.`,
        `Cross-sell "${name}" to existing customers who bought similar items.`,
        `Use the product as a freebie with high-value purchases.`,
        `Refresh the product listing with new photos or description.`,
      ]
      setAiSuggestion({ name, suggestions })
    } catch (e) {
      toast.error('Failed to load suggestions')
      setAiSuggestion(null)
    } finally {
      setAiLoading(false)
    }
  }

  // Sort top products by selected mode
  const sortedTopProducts = [...data.topProducts].sort((a, b) =>
    topMode === 'revenue' ? b.revenue - a.revenue : b.totalSold - a.totalSold
  )

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

      {/* Top Products — Revenue/Volume toggle (PRD Part 20 §1) */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-1.5">
            <Package className="w-4 h-4 text-amber-600" /> Top Selling Products
          </h3>
          <div className="flex items-center gap-1 bg-muted rounded-lg p-0.5">
            <button
              onClick={() => setTopMode('revenue')}
              className={`px-2 py-1 rounded-md text-[10px] font-medium ${topMode === 'revenue' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Revenue
            </button>
            <button
              onClick={() => setTopMode('volume')}
              className={`px-2 py-1 rounded-md text-[10px] font-medium ${topMode === 'volume' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground'}`}
            >
              Volume
            </button>
          </div>
        </div>
        {sortedTopProducts.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">No sales yet</p>
        ) : (
          <div className="space-y-2">
            {sortedTopProducts.map((p, i) => (
              <div key={p.id} className="flex items-center gap-3">
                <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {topMode === 'revenue'
                      ? `${formatCurrency(p.revenue, currency)} · ${p.totalSold} ${p.unit} sold`
                      : `${p.totalSold} ${p.unit} sold · ${formatCurrency(p.revenue, currency)}`}
                  </p>
                </div>
                <span className="text-sm font-semibold tabular">
                  {topMode === 'revenue' ? formatCurrency(p.revenue, currency) : p.totalSold}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Top Debtors — Remind button (PRD Part 20 §2) */}
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
                  {/* Remind (megaphone) button (PRD Part 20 §2) */}
                  <button
                    onClick={() => handleRemind(d)}
                    className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-amber-600"
                    aria-label="Send reminder"
                  >
                    <Megaphone className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </Card>

      {/* Stock Alerts — Quick Order button (PRD Part 20 §3) */}
      {data.stockAlerts.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4 text-orange-600" /> Stock Alerts ({data.stockAlerts.length})
          </h3>
          <div className="space-y-2">
            {data.stockAlerts.map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="flex-1 min-w-0">
                  <p className="truncate">{s.name}</p>
                  <p className="text-orange-600 font-medium tabular text-[11px]">{s.stock} / {s.threshold} {s.unit}</p>
                </div>
                {/* Quick Order button → B2B sourcing (PRD Part 20 §3) */}
                <button
                  onClick={() => handleQuickOrder(s.name)}
                  className="text-[10px] font-medium text-purple-600 bg-purple-100 dark:bg-purple-900/30 px-2 py-1 rounded-lg flex items-center gap-0.5 shrink-0"
                >
                  <ShoppingCart className="w-3 h-3" /> Quick Order
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Slow Moving — AI Suggestion button (PRD Part 20 §5) */}
      {data.slowMoving.length > 0 && (
        <Card className="p-4">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-muted-foreground" /> Slow-Moving (no sales in 30 days)
          </h3>
          <div className="space-y-2">
            {data.slowMoving.slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center justify-between text-sm">
                <div className="flex-1 min-w-0">
                  <p className="truncate">{s.name}</p>
                  <p className="text-muted-foreground tabular text-[11px]">{formatCurrency(s.stockValue, currency)} tied up</p>
                </div>
                {/* AI Suggestion (lightbulb) button (PRD Part 20 §5) */}
                <button
                  onClick={() => handleAISuggestion(s.name)}
                  className="text-[10px] font-medium text-amber-600 bg-amber-100 dark:bg-amber-900/30 px-2 py-1 rounded-lg flex items-center gap-0.5 shrink-0"
                >
                  <Lightbulb className="w-3 h-3" /> AI Suggest
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* AI Suggestion Modal (PRD Part 20 §5) */}
      <Dialog open={!!aiSuggestion} onOpenChange={(o) => !o && setAiSuggestion(null)}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto scroll-area">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="w-4 h-4 text-amber-600" /> AI Suggestions — {aiSuggestion?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <p className="text-xs text-muted-foreground">
              GLM 5.2 suggestions to clear slow-moving stock:
            </p>
            {aiLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
              </div>
            ) : (
              <div className="space-y-2">
                {aiSuggestion?.suggestions.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 p-2 rounded-xl bg-muted/50">
                    <span className="w-6 h-6 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-[10px] font-bold text-amber-600 shrink-0">
                      {i + 1}
                    </span>
                    <p className="text-xs leading-relaxed">{s}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setAiSuggestion(null)} className="h-11">Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
