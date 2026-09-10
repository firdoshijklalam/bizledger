'use client'

import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, timeAgo } from '@/lib/utils'
import { Loader2, AlertTriangle, TrendingUp, ShoppingCart, IndianRupee, Calendar } from 'lucide-react'

// §PARTY-LIFETIME-PROFIT-SECTION: Compact read-only profit summary on the
// customer profile. Shows lifetime revenue, COGS, profit, orders, avg profit,
// and last purchase date. Uses the authoritative accounting formula (same as
// Reports P&L, partitioned by partyId).

interface LifetimeProfit {
  partyId: string
  partyName: string
  totalOrders: number
  grossRevenue: number
  discountAmount: number
  netRevenue: number
  cogs: number
  grossProfit: number
  averageProfitPerOrder: number
  lastPurchaseAt: string | null
  cogsAccuracy: { snapshotItems: number; legacyFallbackItems: number }
  returnsNotDeducted: boolean
}

export function PartyLifetimeProfitSection({ partyId }: { partyId: string }) {
  const { data, loading, error } = useFetch<LifetimeProfit>(
    `/api/parties/${partyId}/lifetime-profit`,
    [partyId]
  )

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-emerald-500" />
          Lifetime Profit
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load profit data</p>
        </div>
      ) : !data ? (
        <p className="text-xs text-muted-foreground text-center py-4">No data</p>
      ) : data.totalOrders === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <ShoppingCart className="w-6 h-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No purchases yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Main profit number */}
          <div className="flex items-center gap-2">
            <div className={`text-2xl font-bold tabular ${data.grossProfit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(data.grossProfit)}
            </div>
            <span className="text-[10px] text-muted-foreground">lifetime profit</span>
          </div>

          {/* Grid of stats */}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <StatItem
              icon={<IndianRupee className="w-3 h-3" />}
              label="Revenue"
              value={formatCurrency(data.netRevenue)}
            />
            <StatItem
              icon={<IndianRupee className="w-3 h-3" />}
              label="COGS"
              value={formatCurrency(data.cogs)}
            />
            <StatItem
              icon={<ShoppingCart className="w-3 h-3" />}
              label="Orders"
              value={String(data.totalOrders)}
            />
            <StatItem
              icon={<TrendingUp className="w-3 h-3" />}
              label="Avg Profit"
              value={formatCurrency(data.averageProfitPerOrder)}
            />
          </div>

          {/* Last purchase */}
          {data.lastPurchaseAt && (
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Calendar className="w-3 h-3" />
              Last purchase: {timeAgo(data.lastPurchaseAt)}
            </div>
          )}

          {/* COGS accuracy disclosure */}
          {data.cogsAccuracy.legacyFallbackItems > 0 && (
            <p className="text-[9px] text-muted-foreground/60">
              {data.cogsAccuracy.snapshotItems} items with historical cost snapshot,
              {' '}{data.cogsAccuracy.legacyFallbackItems} using approximate fallback.
            </p>
          )}

          {/* Returns limitation */}
          {data.returnsNotDeducted && (
            <p className="text-[9px] text-muted-foreground/50">
              Refunds not deducted (returns tracked separately).
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function StatItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 p-2 rounded-lg bg-muted/40">
      <span className="text-muted-foreground shrink-0">{icon}</span>
      <div className="min-w-0">
        <p className="text-[9px] text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-xs font-semibold tabular truncate">{value}</p>
      </div>
    </div>
  )
}
