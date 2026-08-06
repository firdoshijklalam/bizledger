'use client'

/**
 * §CUSTOMER-INSIGHTS: Product-level customer analytics.
 *
 * Shows 3 tabs:
 * 1. Top Buyers — active customers sorted by spend, top 10% marked VIP
 * 2. Churned — customers who haven't bought in 60+ days
 * 3. Refill Due — customers predicted to need a refill soon
 *
 * §GRANULAR-BROADCAST: When the user clicks "Broadcast", the list enters
 * Selection Mode — each buyer row shows a checkbox. The merchant can
 * tick/untick specific buyers, use Select All / Deselect All, and the
 * send button text updates dynamically ("Send to 3 selected buyers").
 *
 * §SMART-TEMPLATES: Quick-action chips use template variables that are
 * dynamically replaced per buyer:
 *   {{customer_name}} → the buyer's name (e.g., "Amit Trading")
 *   {{product_name}}  → the current product's name (e.g., "Plastic Chair")
 * Example: "Hello {{customer_name}}, the price for {{product_name}} has dropped!"
 *   → "Hello Amit Trading, the price for Plastic Chair has dropped!"
 */

import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, timeAgo } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users, TrendingDown, Clock, Crown, Phone, MessageCircle, Send,
  AlertCircle, CheckCircle2, Package, CheckSquare, Square, X,
} from 'lucide-react'
import { useState, useMemo, useEffect } from 'react'
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

// §SMART-TEMPLATES: Quick-action chips with template variables.
// {{customer_name}} and {{product_name}} are replaced per-buyer when sending.
const MESSAGE_TEMPLATES = [
  'New stock of {{product_name}} arrived! Restock now.',
  'Price drop on {{product_name}} — check it out!',
  'Hi {{customer_name}}, special discount on {{product_name}} for you!',
  '{{customer_name}}, your usual {{product_name}} is back in stock. Shall I reserve some?',
]

export function CustomerInsights({ productId }: { productId: string }) {
  const { business } = useAppStore()
  const currency = business?.currency || 'INR'
  const { data, loading } = useFetch<InsightsData>(`/api/products/${productId}/customer-insights`, [productId])
  const [activeTab, setActiveTab] = useState<string>('top')
  // §SELECTION-MODE: When broadcastOpen is true, the list enters selection mode.
  // selectedIds tracks which buyer partyIds are ticked.
  const [broadcastOpen, setBroadcastOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [broadcastMsg, setBroadcastMsg] = useState('')
  // §REMAINING-BUYERS: State (not ref) for buyers that haven't been messaged
  // yet, so the "Open next buyer" button re-renders when the list changes.
  const [remainingBuyers, setRemainingBuyers] = useState<BuyerRecord[]>([])

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

  // §SELECTION-MODE: Toggle a buyer's selection
  const toggleBuyer = (partyId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(partyId)) next.delete(partyId)
      else next.add(partyId)
      return next
    })
  }

  // §SELECT-ALL: Select all buyers in the current tab
  const selectAll = () => {
    setSelectedIds(new Set(currentList.map((b) => b.partyId)))
  }

  // §DESELECT-ALL: Clear all selections
  const deselectAll = () => {
    setSelectedIds(new Set())
  }

  // §SELECTED-BUYERS: The list of buyers matching the selected IDs
  const selectedBuyers = currentList.filter((b) => selectedIds.has(b.partyId))
  const selectedCount = selectedBuyers.length
  const allSelected = currentList.length > 0 && selectedCount === currentList.length

  // §SMART-TEMPLATE-RENDER: Replace {{customer_name}} and {{product_name}}
  // variables in the message template for a specific buyer.
  const renderTemplate = (template: string, buyer: BuyerRecord): string => {
    return template
      .replace(/\{\{customer_name\}\}/g, buyer.partyName)
      .replace(/\{\{product_name\}\}/g, data.product.name)
  }

  // §HANDLE-BROADCAST: Send personalized WhatsApp messages to each selected
  // buyer. Opens WhatsApp with the FIRST recipient's message pre-filled.
  // The merchant can then send to others individually using the generated
  // list (shown as a toast with a link).
  const handleBroadcast = () => {
    if (!broadcastMsg.trim()) {
      toast.error('Enter a message to broadcast')
      return
    }
    if (selectedCount === 0) {
      toast.error('Select at least one buyer to broadcast to')
      return
    }
    const buyersWithPhone = selectedBuyers.filter((b) => b.partyPhone)
    if (buyersWithPhone.length === 0) {
      toast.error('No phone numbers found for selected buyers')
      return
    }

    // §OPEN-WHATSAPP: Open WhatsApp for the FIRST selected buyer with their
    // personalized message. The merchant sends, then can open the next one.
    const firstBuyer = buyersWithPhone[0]
    const phone = firstBuyer.partyPhone!.replace(/[^0-9]/g, '')
    const personalizedMsg = renderTemplate(broadcastMsg, firstBuyer)
    const fullMsg = `${personalizedMsg}\n\n— ${business?.name || 'BizLedger'}`
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(fullMsg)}`, '_blank')

    // §REMAINING-BUYERS: Show a toast with the count of remaining buyers
    // and provide a way to open the next one.
    const remaining = buyersWithPhone.length - 1
    if (remaining > 0) {
      toast.success(
        `WhatsApp opened for ${firstBuyer.partyName}. ${remaining} more buyer${remaining > 1 ? 's' : ''} to message.`,
        { duration: 6000 }
      )
      // Store the remaining buyers in a ref so the merchant can open them one by one
      setRemainingBuyers(buyersWithPhone.slice(1))
    } else {
      toast.success(`WhatsApp opened for ${firstBuyer.partyName}`)
    }

    // Don't close the broadcast panel — the merchant may want to send to more
    // buyers. Just clear the selection if all were sent.
  }

  // §OPEN-NEXT-BUYER: Open WhatsApp for the next remaining buyer.
  const openNextBuyer = () => {
    if (remainingBuyers.length === 0) {
      toast.info('All selected buyers have been messaged!')
      return
    }
    const [next, ...rest] = remainingBuyers
    if (!next || !next.partyPhone) {
      setRemainingBuyers(rest)
      toast.info('Skipped (no phone) — moving to next buyer')
      return
    }
    const phone = next.partyPhone.replace(/[^0-9]/g, '')
    const personalizedMsg = renderTemplate(broadcastMsg, next)
    const fullMsg = `${personalizedMsg}\n\n— ${business?.name || 'BizLedger'}`
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(fullMsg)}`, '_blank')

    setRemainingBuyers(rest)
    if (rest.length > 0) {
      toast.success(`WhatsApp opened for ${next.partyName}. ${rest.length} more to go.`, { duration: 6000 })
    } else {
      toast.success(`WhatsApp opened for ${next.partyName}. All done! 🎉`)
      setBroadcastOpen(false)
      setBroadcastMsg('')
      setSelectedIds(new Set())
    }
  }

  // §ENTER-SELECTION-MODE: When broadcast is opened, auto-select all buyers
  // in the current tab (merchant can deselect individual ones).
  const enterBroadcastMode = () => {
    setBroadcastOpen(true)
    // Auto-select all buyers with phone numbers (those without phones can't be messaged)
    setSelectedIds(new Set(currentList.filter((b) => b.partyPhone).map((b) => b.partyId)))
  }

  // §EXIT-SELECTION-MODE: Close broadcast and clear selection
  const exitBroadcastMode = () => {
    setBroadcastOpen(false)
    setSelectedIds(new Set())
    setBroadcastMsg('')
    setRemainingBuyers([])
  }

  // §TAB-SWITCH: When switching tabs during selection mode, re-select all
  // buyers with phones in the new tab.
  const handleTabSwitch = (tabId: string) => {
    setActiveTab(tabId)
    if (broadcastOpen) {
      const newList = tabId === 'top' ? data.topBuyers : tabId === 'churned' ? data.churnedBuyers : data.refillDue
      setSelectedIds(new Set(newList.filter((b) => b.partyPhone).map((b) => b.partyId)))
    }
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
          {broadcastOpen ? (
            // §EXIT-BROADCAST: Close button when in selection mode
            <button
              onClick={exitBroadcastMode}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-muted text-muted-foreground text-[11px] font-medium hover:bg-muted/80 transition-colors"
            >
              <X className="w-3 h-3" />
              Cancel
            </button>
          ) : (
            <button
              onClick={enterBroadcastMode}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 transition-colors"
            >
              <Send className="w-3 h-3" />
              Broadcast
            </button>
          )}
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

      {/* Broadcast form (selection mode) */}
      <AnimatePresence>
        {broadcastOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="p-3 bg-muted/50 border-b border-border space-y-2">
              {/* §DYNAMIC-LABEL: Shows how many buyers are selected */}
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-muted-foreground">
                  {selectedCount === 0
                    ? 'Select buyers to message'
                    : `Send to ${selectedCount} selected buyer${selectedCount > 1 ? 's' : ''}`}
                </p>
                {/* §SELECT-ALL / DESELECT-ALL master toggle */}
                <button
                  onClick={allSelected ? deselectAll : selectAll}
                  className="text-[10px] font-medium text-primary hover:underline flex items-center gap-1"
                >
                  {allSelected ? (
                    <><CheckSquare className="w-3 h-3" /> Deselect All</>
                  ) : (
                    <><CheckSquare className="w-3 h-3" /> Select All</>
                  )}
                </button>
              </div>
              {/* Message input */}
              <div className="flex gap-2">
                <input
                  value={broadcastMsg}
                  onChange={(e) => setBroadcastMsg(e.target.value)}
                  placeholder="Type your message… Use {{customer_name}} and {{product_name}} for personalization"
                  className="flex-1 h-9 px-3 rounded-lg border border-border bg-background text-xs outline-none focus:border-primary"
                />
                <button
                  onClick={handleBroadcast}
                  disabled={selectedCount === 0}
                  className="px-3 h-9 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
              {/* §SMART-TEMPLATES: Quick-action chips with template variables */}
              <div className="flex flex-wrap gap-1.5">
                {MESSAGE_TEMPLATES.map((template) => (
                  <button
                    key={template}
                    onClick={() => setBroadcastMsg(template)}
                    className="text-[9px] px-2 py-1 rounded-full bg-background border border-border hover:border-primary text-muted-foreground max-w-full truncate"
                    title={template}
                  >
                    {template.length > 40 ? template.substring(0, 40) + '…' : template}
                  </button>
                ))}
              </div>
              {/* §TEMPLATE-HELP: Hint about available variables */}
              <p className="text-[9px] text-muted-foreground/70">
                💡 Variables: <code className="text-emerald-600">{`{{customer_name}}`}</code>, <code className="text-emerald-600">{`{{product_name}}`}</code> — auto-replaced per buyer
              </p>
              {/* §OPEN-NEXT: Button to open WhatsApp for the next remaining buyer */}
              {remainingBuyers.length > 0 && (
                <button
                  onClick={openNextBuyer}
                  className="w-full py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-[10px] font-medium hover:bg-emerald-100 dark:hover:bg-emerald-950/50 flex items-center justify-center gap-1"
                >
                  <MessageCircle className="w-3 h-3" />
                  Open WhatsApp for next buyer ({remainingBuyers.length} remaining)
                </button>
              )}
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
              onClick={() => handleTabSwitch(tab.id)}
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
                  productName={data.product.name}
                  // §SELECTION-MODE props
                  selectionMode={broadcastOpen}
                  isSelected={selectedIds.has(buyer.partyId)}
                  onToggleSelect={() => toggleBuyer(buyer.partyId)}
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
  buyer, rank, tab, currency, unit, productName,
  selectionMode, isSelected, onToggleSelect,
}: {
  buyer: BuyerRecord
  rank: number
  tab: string
  currency: string
  unit: string
  productName: string
  // §SELECTION-MODE props
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}) {
  // §WHATSAPP-QUICK-ACTION: Open a direct WhatsApp chat with this buyer,
  // pre-filled with a product-specific restock/discount message.
  const handleWhatsApp = () => {
    if (!buyer.partyPhone) return
    const phone = buyer.partyPhone.replace(/[^0-9]/g, '')
    const msg = encodeURIComponent(
      `Hi ${buyer.partyName}, regarding your purchase of ${productName} —\n\n` +
      (tab === 'refill'
        ? `It's been a while since your last order. New stock available! Would you like to restock?`
        : tab === 'churned'
        ? `We miss you! Here's a special discount on your next order.`
        : `Thank you for being a valued customer!`)
    )
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
  }

  return (
    <div
      className={`flex items-center gap-3 p-3 border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors ${
        selectionMode && isSelected ? 'bg-emerald-50 dark:bg-emerald-950/20' : ''
      }`}
      onClick={selectionMode ? onToggleSelect : undefined}
    >
      {/* §CHECKBOX: Shown only in selection mode. Replaces the rank/VIP badge. */}
      {selectionMode ? (
        <button
          onClick={(e) => { e.stopPropagation(); onToggleSelect() }}
          className="w-7 h-7 flex items-center justify-center shrink-0"
          aria-label={isSelected ? `Deselect ${buyer.partyName}` : `Select ${buyer.partyName}`}
        >
          {isSelected ? (
            <CheckSquare className="w-5 h-5 text-emerald-600" />
          ) : (
            <Square className="w-5 h-5 text-muted-foreground" />
          )}
        </button>
      ) : (
        /* Rank / VIP badge (normal mode) */
        <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${
          buyer.isVIP ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' : 'bg-muted text-muted-foreground'
        }`}>
          {buyer.isVIP ? <Crown className="w-3.5 h-3.5" /> : rank}
        </div>
      )}

      {/* Customer info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium truncate">{buyer.partyName}</p>
          {buyer.isVIP && !selectionMode && (
            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
              VIP
            </span>
          )}
          {/* §NO-PHONE: Show a warning badge if the buyer has no phone number */}
          {selectionMode && !buyer.partyPhone && (
            <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-muted text-muted-foreground">
              no phone
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          <span className="text-[10px] text-muted-foreground">
            {buyer.purchaseCount} order{buyer.purchaseCount > 1 ? 's' : ''} · {buyer.totalQuantity} {unit}
          </span>
          {/* §LAST-BOUGHT: Show when the buyer last purchased this product */}
          {buyer.lastBoughtLabel && (
            <span className="text-[10px] text-muted-foreground/70">
              · last: {buyer.lastBoughtLabel}
            </span>
          )}
          {/* §REFILL-INFO: Show avg cycle on refill tab */}
          {tab === 'refill' && buyer.avgCycleDays && (
            <span className="text-[10px] text-blue-600 dark:text-blue-400">
              · avg {buyer.avgCycleDays}d cycle
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
          {/* §CHURNED-INFO: Show how long since last purchase */}
          {tab === 'churned' && buyer.lastBoughtLabel && (
            <span className="text-[10px] text-red-500 flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {buyer.lastBoughtLabel}
            </span>
          )}
        </div>
      </div>

      {/* Total spend + quick actions */}
      <div className="text-right shrink-0 flex flex-col items-end gap-1">
        <p className="text-xs font-bold tabular text-foreground">{formatCurrency(buyer.totalSpend, currency)}</p>
        {/* §QUICK-ACTIONS: Hide WhatsApp/Call buttons in selection mode to
            keep the row clean. The checkbox is the primary action then. */}
        {!selectionMode && (
          <div className="flex items-center gap-1">
            {buyer.partyPhone && (
              <button
                onClick={(e) => { e.stopPropagation(); handleWhatsApp() }}
                className="w-6 h-6 rounded-md flex items-center justify-center text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                aria-label={`WhatsApp ${buyer.partyName}`}
                title={`WhatsApp ${buyer.partyName}`}
              >
                <MessageCircle className="w-3 h-3" />
              </button>
            )}
            {buyer.partyPhone && (
              <a
                href={`tel:${buyer.partyPhone}`}
                onClick={(e) => e.stopPropagation()}
                className="w-6 h-6 rounded-md flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors"
                aria-label={`Call ${buyer.partyName}`}
                title={`Call ${buyer.partyName}`}
              >
                <Phone className="w-3 h-3" />
              </a>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
