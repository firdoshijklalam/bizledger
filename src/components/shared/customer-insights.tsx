'use client'

/**
 * §CUSTOMER-INSIGHTS: Product-level customer analytics.
 *
 * Shows 3 tabs:
 * 1. Top Buyers — active customers sorted by spend, top 10% marked VIP
 * 2. Churned — customers who haven't bought in 60+ days
 * 3. Refill Due — customers predicted to need a refill soon
 *
 * Plus a Broadcast button to send targeted WhatsApp/SMS to product buyers.
 */

import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, timeAgo } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, TrendingDown, Clock, Crown, Phone, MessageCircle, Send,
  AlertCircle, CheckCircle2, Package,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store/app-store'

interface BuyerRecord {
  partyId: string
  partyName: string
  partyPhone: string | null
  totalQuantity: number
  totalSpend: number
  purchaseCount: number
  firstPurchase: string
  lastPurchase: string
  avgDaysBetweenPurchases: number
  isVIP?: boolean
  daysSinceLastPurchase?: number
  lastBoughtLabel?: string
  expectedInDays?: number
  avgCycleDays?: number
  status?: string
}

interface InsightsData {
  product: { id: string; name: string; category: string | null; unit: string }
  topBuyers: BuyerRecord[]
  churnedBuyers: BuyerRecord[]
  refillDue: BuyerRecord[]
  summary: {
    totalBuyers: number
    activeCount: number
    churnedCount: number
    refillDueCount: number
    vipCount: number
    totalRevenue: number
    totalQuantitySold: number
  }
}

const TABS = [
  { id: 'top', label: 'Top Buyers', icon: Crown, color: 'text-amber-600' },
  { id: 'churned', label: 'Churned', icon: TrendingDown, color: 'text-red-600' },
  { id: 'refill', label: 'Refill Due', icon: Clock, color: 'text-blue-600' },
] as const

export function CustomerInsights({ productId }: { productId: string }) {
  const { business } = useAppStore()
  const currency = business?.currency || 'INR'
  const { data, loading } = useFetch<InsightsData>(`/api/products/${productId}/customer-insights`, [productId])
  const [activeTab, setActiveTab] = useState<string>('top')
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [broadcastMsg, setBroadcastMsg] = useState('')

  if (loading) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs text-muted-foreground text-center py-4">Loading customer insights…</p>
      </div>
    )
  }

  if (!data || data.summary.totalBuyers === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Users className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Customer Insights</h3>
        </div>
        <p className="text-xs text-muted-foreground text-center py-4">
          No sales data yet. Customer insights will appear here once this product is sold.
        </p>
      </div>
    )
  }

  const currentList = activeTab === 'top' ? data.topBuyers : activeTab === 'churned' ? data.churnedBuyers : data.refillDue

  const handleBroadcast = () => {
    if (!broadcastMsg.trim()) {
      toast.error('Enter a message to broadcast')
      return
    }
    // Open WhatsApp with pre-filled message for each buyer
    const phoneList = currentList.filter((b) => b.partyPhone).map((b) => b.partyPhone)
    if (phoneList.length === 0) {
      toast.error('No phone numbers found for these buyers')
      return
    }
    const msg = encodeURIComponent(`${broadcastMsg}\n\n— ${business?.name || 'BizLedger'}`)
    // Open WhatsApp web with the first number (user can send to others individually)
    window.open(`https://wa.me/?text=${msg}`, '_blank')
    toast.success(`Broadcast prepared for ${phoneList.length} buyer${phoneList.length > 1 ? 's' : ''}`)
    setBroadcastOpen(false)
    setBroadcastMsg('')
  }

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <Users className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <h3 className="text-sm font-semibold">Customer Insights</h3>
          </div>
          {/* §BROADCAST: Targeted marketing button */}
          <button
            onClick={() => setBroadcastOpen(!broadcastOpen)}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 transition-colors"
          >
            <Send className="w-3 h-3" />
            Broadcast
          </button>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-4 gap-2">
          <div className="text-center">
            <p className="text-lg font-bold tabular text-foreground">{data.summary.totalBuyers}</p>
            <p className="text-[9px] text-muted-foreground">Total Buyers</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold tabular text-emerald-600">{data.summary.activeCount}</p>
            <p className="text-[9px] text-muted-foreground">Active</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold tabular text-amber-600">{data.summary.vipCount}</p>
            <p className="text-[9px] text-muted-foreground">VIP</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold tabular text-blue-600">{data.summary.refillDueCount}</p>
            <p className="text-[9px] text-muted-foreground">Refill Due</p>
          </div>
        </div>

        {/* Revenue + quantity sold */}
        <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/50">
          <p className="text-[10px] text-muted-foreground">
            Revenue: <span className="font-bold text-foreground">{formatCurrency(data.summary.totalRevenue, currency)}</span>
          </p>
          <p className="text-[10px] text-muted-foreground">
            Sold: <span className="font-bold text-foreground">{data.summary.totalQuantitySold} {data.product.unit}</span>
          </p>
        </div>
      </div>

      {/* Broadcast form */}
      <AnimatePresence>
        {broadcastOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-muted/50 border-b border-border space-y-2">
              <p className="text-[10px] text-muted-foreground">
                Send to {currentList.length} buyer{currentList.length > 1 ? 's' : ''} in "{TABS.find((t) => t.id === activeTab)?.label}"
              </p>
              <div className="flex gap-2">
                <input
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                  placeholder="e.g. New stock arrived! Price dropped to ₹..."
                  className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-xs outline-none focus:border-primary"
                />
                <button
                  onClick={handleBroadcast}
                  className="px-3 h-9 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0"
                >
                  Send
                </button>
              </div>
              <div className="flex gap-1.5">
                {['New stock arrived!', 'Price drop — check it out!', 'Special discount for you'].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => setBroadcastMsg(preset)}
                    className="text-[9px] px-2 py-1 rounded-full bg-background border border-border hover:border-primary text-muted-foreground"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const count = tab.id === 'top' ? data.topBuyers.length : tab.id === 'churned' ? data.churnedBuyers.length : data.refillDue.length
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${activeTab === tab.id ? tab.color : ''}`} />
              {tab.label}
              {count > 0 && (
                <span className={`px-1 py-0.5 rounded-full text-[8px] ${
                  activeTab === tab.id ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* List */}
      <div className="max-h-80 overflow-y-auto scroll-area">
        {currentList.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No {activeTab === 'top' ? 'active buyers' : activeTab === 'churned' ? 'churned buyers' : 'refills due'} for this product.
          </p>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              transition={{ duration: 0.15 }}
            >
              {currentList.map((buyer, i) => (
                <BuyerRow
                  key={buyer.partyId}
                  buyer={buyer}
                  rank={i + 1}
                  tab={activeTab}
                  currency={currency}
                  unit={data.product.unit}
                />
              ))}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

// ─── Buyer Row ───────────────────────────────────────────────────────────────

function BuyerRow({
  buyer, rank, tab, currency, unit,
}: {
  buyer: BuyerRecord
  rank: number
  tab: string
  currency: string
  unit: string
}) {
  return (
    <div className="flex items-center gap-3 p-3 border-b border-border/50 hover:bg-muted/30">
      {/* Rank / VIP badge */}
      <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
        buyer.isVIP ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-muted text-muted-foreground'
      }">
        {buyer.isVIP ? <Crown className="w-3.5 h-3.5" /> : rank}
      </div>

      {/* Customer info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium truncate">{buyer.partyName}</p>
          {buyer.isVIP && (
            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              VIP
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-muted-foreground">
            {buyer.purchaseCount} order{buyer.purchaseCount > 1 ? 's' : ''} · {buyer.totalQuantity} {unit}
          </span>
          {tab === 'churned' && buyer.lastBoughtLabel && (
            <span className="text-[10px] text-red-500 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {buyer.lastBoughtLabel}
            </span>
          )}
          {tab === 'refill' && buyer.status && (
            <span className={`text-[10px] flex items-center gap-0.5 ${
              buyer.status === 'overdue' ? 'text-red-600' : buyer.status === 'due-soon' ? 'text-amber-600' : 'text-blue-600'
            }`}>
              {buyer.status === 'overdue' ? <AlertCircle className="w-2.5 h-2.5" /> : <Clock className="w-2.5 h-2.5" />}
              {buyer.status === 'overdue' ? 'Overdue' : buyer.status === 'due-soon' ? `Due in ${buyer.expectedInDays}d` : `In ${buyer.expectedInDays}d`}
            </span>
          )}
        </div>
      </div>

      {/* Total spend + phone */}
      <div className="text-right shrink-0">
        <p className="text-xs font-bold tabular text-foreground">{formatCurrency(buyer.totalSpend, currency)}</p>
        {buyer.partyPhone && (
          <a
            href={`tel:${buyer.partyPhone}`}
            className="text-[10px] text-primary hover:underline flex items-center justify-end gap-0.5 mt-0.5"
          >
            <Phone className="w-2.5 h-2.5" /> {buyer.partyPhone}
          </a>
        )}
      </div>
    </div>
  )
}
