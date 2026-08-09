'use client'

/**
 * §FULFILLMENT-DASHBOARD: Order Fulfillment & Tracking
 *
 * A centralized page for tracking and fulfilling pending orders.
 * Accessible from the "More" menu → "Fulfillment".
 *
 * §DUAL-TAB:
 *   Tab A: "Store Pick-Ups" — offline POS bills marked 'Pick Up Later'
 *   Tab B: "Online Orders" — orders from the customer app/website
 *
 * §STATUS-PIPELINE:
 *   Pending / To Pack → Ready for Pick-up → Handed Over / Fulfilled
 *
 * §PARTIAL-FULFILLMENT:
 *   Item-level fulfillment. The merchant can hand over a subset of the
 *   total quantity (e.g., 5 of 20 bags). Shows a progress bar (5/20 Fulfilled).
 *
 * §ACTION-BUTTONS on each order card:
 *   - "Mark as Ready": Updates status to ready.
 *   - "Notify Customer": WhatsApp button with pre-filled template.
 *   - "Fulfill/Handover": Opens a modal to confirm quantities + PIN.
 *
 * §PIN-VERIFICATION:
 *   4-digit PIN (last 4 of invoice number or phone) on handover.
 */

import { useAppStore } from '@/store/app-store'
import { useFetch, apiPut } from '@/hooks/use-fetch'
import { formatCurrency, timeAgo } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ClipboardList, Store, ShoppingBag, Package, CheckCircle2, Clock,
  Phone, MessageCircle, ChevronRight, X, Loader2, AlertCircle,
  Truck,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LoadingState, EmptyState } from '@/components/shared/states'

interface FulfillmentItem {
  id: string
  name: string
  quantity: number
  unitPrice: number
  total: number
  fulfilledQty?: number
  product?: { unit?: string } | null
}

interface FulfillmentOrder {
  id: string
  invoiceNumber: string
  deliveryStatus: string | null
  createdAt: string
  grandTotal: number
  amountPaid: number
  amountDue: number
  status: string
  party?: { name: string; phone?: string | null } | null
  items: FulfillmentItem[]
  totalQty: number
  fulfilledQty: number
  fulfillmentPct: number
}

const ORIGIN_TABS = [
  { id: 'store', label: 'Store Pick-Ups', icon: Store, color: 'text-orange-600' },
  { id: 'online', label: 'Online Orders', icon: ShoppingBag, color: 'text-cyan-600' },
] as const

const STATUS_TABS = [
  { id: 'pending', label: 'To Pack', icon: Package, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
  { id: 'ready', label: 'Ready', icon: Clock, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30' },
  { id: 'handed', label: 'Fulfilled', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
] as const

export function FulfillmentView() {
  const { business } = useAppStore()
  const currency = business?.currency || 'INR'
  const [originTab, setOriginTab] = useState<'store' | 'online'>('store')
  const [statusTab, setStatusTab] = useState<string>('pending')
  const [handoverOrder, setHandoverOrder] = useState<FulfillmentOrder | null>(null)

  // Fetch orders based on origin + status
  const { data, loading, refetch } = useFetch<{ items: FulfillmentOrder[] }>(
    `/api/fulfillment/list?origin=${originTab}&status=${statusTab}`,
    [originTab, statusTab],
  )

  const orders = data?.items || []

  const handleMarkReady = async (orderId: string) => {
    try {
      await apiPut(`/api/fulfillment/${orderId}/ready`, {})
      toast.success('Order marked as ready for pick-up')
      refetch()
    } catch {
      toast.error('Failed to update status')
    }
  }

  const handleNotify = (order: FulfillmentOrder) => {
    if (!order.party?.phone) {
      toast.error('No phone number for this customer')
      return
    }
    const phone = order.party.phone.replace(/[^0-9]/g, '')
    const msg = encodeURIComponent(
      `Hello ${order.party.name}, your order ${order.invoiceNumber} is ready for pick-up at ${business?.name || 'our store'}. ` +
      `Total: ${formatCurrency(order.grandTotal, currency)}. Please collect at your convenience.`
    )
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank')
    toast.success(`WhatsApp opened for ${order.party.name}`)
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-lg bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
          <ClipboardList className="w-4 h-4 text-orange-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold">Fulfillment</h2>
          <p className="text-[10px] text-muted-foreground">Track & fulfill pending orders</p>
        </div>
      </div>

      {/* Origin tabs (Store Pick-Ups / Online Orders) */}
      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-muted">
        {ORIGIN_TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => { setOriginTab(tab.id); setStatusTab('pending') }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-md text-xs font-medium transition-colors ${
                originTab === tab.id ? 'bg-card shadow-sm' : 'text-muted-foreground'
              }`}
            >
              <Icon className={`w-3.5 h-3.5 ${originTab === tab.id ? tab.color : ''}`} />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Status pipeline tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto scroll-area pb-1">
        {STATUS_TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <button
              key={tab.id}
              onClick={() => setStatusTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium whitespace-nowrap transition-colors ${
                statusTab === tab.id
                  ? tab.color
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Order list */}
      {loading ? (
        <LoadingState text="Loading orders…" />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No orders here"
          description={
            statusTab === 'pending'
              ? 'No pending orders to pack.'
              : statusTab === 'ready'
              ? 'No orders ready for pick-up.'
              : 'No fulfilled orders yet.'
          }
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence mode="popLayout">
            {orders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                currency={currency}
                onMarkReady={() => handleMarkReady(order.id)}
                onNotify={() => handleNotify(order)}
                onHandover={() => setHandoverOrder(order)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Handover modal */}
      <AnimatePresence>
        {handoverOrder && (
          <HandoverModal
            order={handoverOrder}
            currency={currency}
            onClose={() => setHandoverOrder(null)}
            onSuccess={() => {
              setHandoverOrder(null)
              refetch()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Order Card ─────────────────────────────────────────────────────────────

function OrderCard({
  order, currency, onMarkReady, onNotify, onHandover,
}: {
  order: FulfillmentOrder
  currency: string
  onMarkReady: () => void
  onNotify: () => void
  onHandover: () => void
}) {
  const isPending = order.deliveryStatus === 'pickup'
  const isReady = order.deliveryStatus === 'ready'
  const isHanded = order.deliveryStatus === 'handed'
  const isPartial = order.fulfilledQty > 0 && order.fulfilledQty < order.totalQty

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      {/* Header: customer + invoice */}
      <div className="flex items-center justify-between gap-2 p-3 border-b border-border/50">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="text-sm font-semibold truncate">
              {order.party?.name || 'Walk-in Customer'}
            </p>
            {isPartial && (
              <span className="text-[8px] font-bold px-1 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                PARTIAL
              </span>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            {order.invoiceNumber} · {timeAgo(order.createdAt)}
          </p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold tabular">{formatCurrency(order.grandTotal, currency)}</p>
          <p className="text-[10px] text-muted-foreground">
            {order.amountDue > 0 ? `${formatCurrency(order.amountDue, currency)} due` : 'Paid'}
          </p>
        </div>
      </div>

      {/* Items + fulfillment progress */}
      <div className="p-3 space-y-1.5">
        {order.items.map((item) => {
          const pct = item.quantity > 0 ? Math.round(((item.fulfilledQty || 0) / item.quantity) * 100) : 0
          return (
            <div key={item.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.name}</p>
                {/* §PROGRESS-BAR: Shows fulfillment ratio per item */}
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-amber-500' : 'bg-transparent'
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-[9px] tabular text-muted-foreground shrink-0">
                    {item.fulfilledQty || 0}/{item.quantity} {item.product?.unit || ''}
                  </span>
                </div>
              </div>
            </div>
          )
        })}

        {/* §OVERALL-PROGRESS: Total fulfillment ratio */}
        {order.fulfilledQty > 0 && (
          <div className="flex items-center gap-2 pt-1.5 mt-1 border-t border-border/30">
            <span className="text-[10px] text-muted-foreground">Overall:</span>
            <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  order.fulfillmentPct === 100 ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
                style={{ width: `${order.fulfillmentPct}%` }}
              />
            </div>
            <span className="text-[10px] font-medium tabular">
              {order.fulfilledQty}/{order.totalQty} ({order.fulfillmentPct}%)
            </span>
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1.5 p-2 border-t border-border/50 bg-muted/30">
        {isPending && (
          <Button size="sm" variant="outline" onClick={onMarkReady} className="h-8 text-[11px] flex-1">
            <Package className="w-3 h-3 mr-1" /> Mark as Ready
          </Button>
        )}
        {order.party?.phone && (
          <button
            onClick={onNotify}
            className="h-8 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 flex items-center gap-1"
          >
            <MessageCircle className="w-3 h-3" /> Notify
          </button>
        )}
        {!isHanded && (
          <Button size="sm" onClick={onHandover} className="h-8 text-[11px] flex-1">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            {isPartial ? 'Hand Over More' : 'Fulfill / Hand Over'}
          </Button>
        )}
        {isHanded && (
          <span className="flex-1 text-center text-[11px] font-medium text-emerald-600 flex items-center justify-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Fulfilled
          </span>
        )}
      </div>
    </motion.div>
  )
}

// ─── Handover Modal (Partial Fulfillment + PIN) ─────────────────────────────

function HandoverModal({
  order, currency, onClose, onSuccess,
}: {
  order: FulfillmentOrder
  currency: string
  onClose: () => void
  onSuccess: () => void
}) {
  const { business } = useAppStore()
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [pin, setPin] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // §PIN-HINT: Show the last 4 digits of invoice number as a hint
  const invoiceLast4 = order.invoiceNumber.replace(/[^0-9]/g, '').slice(-4)
  const phoneLast4 = (order.party?.phone || '').replace(/[^0-9]/g, '').slice(-4)

  const handleSubmit = async () => {
    const items = order.items
      .map((item) => ({
        id: item.id,
        qty: Number(quantities[item.id] || 0),
      }))
      .filter((i) => i.qty > 0)

    if (items.length === 0) {
      toast.error('Enter at least one quantity to hand over')
      return
    }

    setSubmitting(true)
    try {
      const res = await fetch(`/api/fulfillment/${order.id}/handover`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items, pin: pin || undefined }),
      })
      const data = await res.json()

      if (!res.ok) {
        toast.error(data.error || 'Handover failed')
        setSubmitting(false)
        return
      }

      if (data.fullyFulfilled) {
        toast.success('Order fully fulfilled! ✓')
      } else {
        toast.success(`Partial handover: ${data.fulfilledQty}/${data.totalQty} (${data.fulfillmentPct}%)`)
      }
      onSuccess()
    } catch {
      toast.error('Handover failed')
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[200] bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4"
    >
      <motion.div
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-card w-full max-w-md rounded-t-3xl sm:rounded-2xl border border-border max-h-[85dvh] overflow-y-auto scroll-area"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-card z-10">
          <div>
            <h3 className="text-sm font-semibold">Hand Over Items</h3>
            <p className="text-[10px] text-muted-foreground">{order.invoiceNumber} · {order.party?.name}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Items with quantity inputs */}
        <div className="p-4 space-y-3">
          <p className="text-[10px] text-muted-foreground">
            Enter the quantity being handed over now. This adds to any previously fulfilled quantity.
          </p>
          {order.items.map((item) => {
            const remaining = item.quantity - (item.fulfilledQty || 0)
            return (
              <div key={item.id} className="flex items-center gap-2 p-2 rounded-lg bg-muted/50">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.name}</p>
                  <p className="text-[10px] text-muted-foreground">
                    Ordered: {item.quantity} · Fulfilled: {item.fulfilledQty || 0} · <span className="font-medium text-amber-600">Remaining: {remaining}</span>
                  </p>
                </div>
                <Input
                  type="number"
                  inputMode="numeric"
                  placeholder="0"
                  value={quantities[item.id] || ''}
                  onChange={(e) => setQuantities({ ...quantities, [item.id]: e.target.value })}
                  className="w-20 h-9 text-sm text-center"
                  max={remaining}
                  min={0}
                />
              </div>
            )
          })}

          {/* §PIN-VERIFICATION */}
          <div className="pt-3 border-t border-border">
            <p className="text-[10px] font-medium text-muted-foreground mb-1.5">
              🔒 Verification PIN (optional)
            </p>
            <p className="text-[9px] text-muted-foreground/70 mb-2">
              Enter the last 4 digits of the invoice number or customer phone to verify the recipient.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="text"
                inputMode="numeric"
                maxLength={4}
                placeholder="4-digit PIN"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/[^0-9]/g, ''))}
                className="w-32 h-10 text-center text-lg font-bold tracking-widest"
              />
              <div className="text-[10px] text-muted-foreground">
                {invoiceLast4.length === 4 && <p>Invoice: <span className="font-mono font-bold">{invoiceLast4}</span></p>}
                {phoneLast4.length === 4 && <p>Phone: <span className="font-mono font-bold">{phoneLast4}</span></p>}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-4 border-t border-border sticky bottom-0 bg-card">
          <Button variant="outline" onClick={onClose} className="flex-1 h-11">Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting} className="flex-1 h-11">
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <CheckCircle2 className="w-4 h-4 mr-1" />}
            Confirm Hand Over
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}
