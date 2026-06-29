'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import { motion } from 'framer-motion'
import { TrendingUp, AlertTriangle, ArrowUp, ArrowDown, Package, ShoppingCart } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useState } from 'react'

interface Forecast {
  productId: string
  name: string
  sku: string | null
  currentStock: number
  unit: string
  recentMonthlyAvg: number
  predictedNextMonth: number
  trend: number
  confidence: 'high' | 'medium' | 'low'
  daysUntilOutOfStock: number | null
  needsRestock: boolean
  supplierId?: string | null
  months?: number
}

const CONFIDENCE_COLORS = {
  high: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300',
  medium: 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
  low: 'bg-muted text-muted-foreground',
}

type Timeframe = 1 | 3 | 6

export function ForecastView() {
  const { business, setActiveView } = useAppStore()
  const [timeframe, setTimeframe] = useState<Timeframe>(3)
  const { data, loading } = useFetch<Forecast[]>(`/api/forecast?months=${timeframe}`, [timeframe])
  const currency = business?.currency || 'INR'

  if (loading) return <LoadingState />
  if (!data || data.length === 0) return <EmptyState icon={TrendingUp} title="No forecast data" description="Create some invoices to see demand predictions." />

  const restockNeeded = data.filter((f) => f.needsRestock)

  // Order Forecast Volume button → B2B sourcing with predicted qty (PRD Part 21 §3)
  const handleOrderForecast = (f: Forecast) => {
    setActiveView('sourcing')
    toast.info(`Order ${f.predictedNextMonth} ${f.unit} of ${f.name} from B2B Sourcing`)
  }

  return (
    <div className="space-y-4">
      {/* Timeframe filter chips (PRD Part 21 §1) */}
      <div className="flex items-center gap-2">
        {([1, 3, 6] as Timeframe[]).map((tf) => (
          <button
            key={tf}
            onClick={() => setTimeframe(tf)}
            className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
              timeframe === tf ? 'bg-primary text-primary-foreground shadow-sm' : 'bg-muted text-muted-foreground'
            }`}
          >
            {tf} {tf === 1 ? 'Month' : 'Months'}
          </button>
        ))}
      </div>

      {restockNeeded.length > 0 && (
        <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900">
          <p className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-1.5">
            <AlertTriangle className="w-4 h-4" /> {restockNeeded.length} products need restock soon
          </p>
        </div>
      )}

      <div className="space-y-2">
        {data.map((f, i) => (
          <motion.div
            key={f.productId}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.03 }}
          >
            <Card className={`p-4 ${f.needsRestock ? 'border-red-300 dark:border-red-800' : ''}`}>
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-amber-600" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{f.name}</p>
                    <p className="text-[11px] text-muted-foreground">Stock: {f.currentStock} {f.unit}</p>
                  </div>
                </div>
                <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${CONFIDENCE_COLORS[f.confidence]}`}>
                  {f.confidence}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-[10px] text-muted-foreground">Avg/Month</p>
                  <p className="text-sm font-bold tabular">{f.recentMonthlyAvg}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-[10px] text-muted-foreground">Predicted</p>
                  <p className="text-sm font-bold tabular text-primary">{f.predictedNextMonth}</p>
                </div>
                <div className="p-2 rounded-lg bg-muted/50">
                  <p className="text-[10px] text-muted-foreground">Trend</p>
                  {/* FIXED: 0% trend when no sales (not 100%) (PRD Part 21 §2) */}
                  <p className={`text-sm font-bold tabular flex items-center justify-center gap-0.5 ${
                    f.trend > 0 ? 'text-emerald-600'
                    : f.trend < 0 ? 'text-red-600'
                    : 'text-muted-foreground'
                  }`}>
                    {f.trend > 0 ? <ArrowUp className="w-3 h-3" /> : f.trend < 0 ? <ArrowDown className="w-3 h-3" /> : null}
                    {f.trend}%
                  </p>
                </div>
              </div>
              {f.daysUntilOutOfStock !== null && (
                <p className={`text-[11px] mt-2 ${f.needsRestock ? 'text-red-600 font-medium' : 'text-muted-foreground'}`}>
                  {f.daysUntilOutOfStock <= 0 ? '⚠️ Out of stock!' : `~${f.daysUntilOutOfStock} days until out of stock`}
                </p>
              )}
              {/* Order Forecast Volume button (PRD Part 21 §3) */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleOrderForecast(f)}
                className="w-full mt-2 h-8 text-purple-600 border-purple-300 dark:border-purple-800"
              >
                <ShoppingCart className="w-3 h-3 mr-1" /> Order Forecast Volume ({f.predictedNextMonth} {f.unit})
              </Button>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  )
}
