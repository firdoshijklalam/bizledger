'use client'

/**
 * §ONLINE-ORDERS: OnlineOrdersView — dedicated page for managing incoming
 * orders from the quick-commerce customer frontend.
 *
 * Features:
 * 1. Tabbed interface: [New/Pending] [Processing] [Out for Delivery] [Completed] [Cancelled]
 * 2. Order cards: Order ID, Customer Name, Phone (call button), Address,
 *    Items list, Total, Payment Mode (COD/Prepaid)
 * 3. Action workflow: Accept → Processing → Out for Delivery → Complete
 * 4. §AUTO-SYNC: When marked "Complete", the backend automatically:
 *    a) Deducts stock from inventory
 *    b) Creates a Khata transaction (credit for COD, cash/UPI for prepaid)
 *    c) Creates an Invoice record
 * 5. §REAL-TIME: WebSocket notifications via useRealtimeOrders hook.
 *    New orders appear instantly + audio notification plays.
 */

import { useAppStore } from '@/store/app-store'
import { useRealtimeOrders } from '@/hooks/use-realtime-orders'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { formatCurrency, timeAgo } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShoppingBag, Phone, MapPin, Package, Clock, CheckCircle2, Truck,
  XCircle, Loader2, Zap, Play, AlertCircle,
} from 'lucide-react'
import { useState, useCallback } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { LoadingState, EmptyState } from '@/components/shared/states'

const TABS = [
  { id: 'pending', label: 'New', icon: Clock, color: 'text-amber-600 bg-amber-100 dark:bg-amber-900/30' },
  { id: 'processing', label: 'Processing', icon: Package, color: 'text-blue-600 bg-blue-100 dark:bg-blue-900/30' },
  { id: 'out_for_delivery', label: 'Out for Delivery', icon: Truck, color: 'text-purple-600 bg-purple-100 dark:bg-purple-900/30' },
  { id: 'completed', label: 'Completed', icon: CheckCircle2, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/30' },
  { id: 'cancelled', label: 'Cancelled', icon: XCircle, color: 'text-red-600 bg-red-100 dark:bg-red-900/30' },
] as const

export function OnlineOrdersView() {
  const { business } = useAppStore()
  const { orders, isConnected } = useRealtimeOrders(business?.id)
  const [activeTab, setActiveTab] = useState<string>('pending')
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const currency = business?.currency || 'INR'

  const filteredOrders = orders.filter((o: any) => o.status === activeTab)

  // §COUNTS: Count orders per tab for badge display
  const counts = TABS.reduce((acc, tab) => {
    acc[tab.id] = orders.filter((o: any) => o.status === tab.id).length
    return acc
  }, {} as Record<string, number>)

  const updateStatus = useCallback(async (orderId: string, status: string) => {
    setUpdatingId(orderId)
    try {
      const res = await fetch(`/api/customer-orders/${orderId}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to update')

      if (status === 'completed' && data.synced) {
        toast.success('✅ Order Completed & Synced!', {
          description: `Stock deducted · ${data.synced.partyName}'s khata updated · Invoice ${data.synced.invoiceId?.substring(0, 8)} created`,
          duration: 5000,
        })
      } else {
        const labels: Record<string, string> = {
          processing: 'Order Accepted — Processing',
          out_for_delivery: 'Marked as Out for Delivery',
          completed: 'Order Completed',
          cancelled: 'Order Cancelled',
        }
        toast.success(labels[status] || `Status updated to ${status}`)
      }

      // Refresh the orders list
      window.location.reload()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update order status')
    } finally {
      setUpdatingId(null)
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold flex items-center gap-2">
            <ShoppingBag className="w-5 h-5 text-primary" />
            Online Orders
          </h2>
          <p className="text-xs text-muted-foreground">
            {isConnected ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live — real-time notifications active
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/40" />
                Reconnecting...
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {TABS.map((tab) => {
          const Icon = tab.icon
          const isActive = activeTab === tab.id
          const count = counts[tab.id] || 0
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all min-h-[40px] ${
                isActive
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {count > 0 && (
                <span className={`ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-bold ${
                  isActive ? 'bg-primary-foreground/20' : 'bg-foreground/10'
                }`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Orders list */}
      {!orders ? (
        <LoadingState />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title={`No ${TABS.find((t) => t.id === activeTab)?.label || ''} orders`}
          subtitle="New orders from the customer app will appear here instantly"
        />
      ) : (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {filteredOrders.map((order: any) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                layout
              >
                <OrderCard
                  order={order}
                  currency={currency}
                  updatingId={updatingId}
                  onUpdate={updateStatus}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}

// ─── Order Card ─────────────────────────────────────────────────────────────

function OrderCard({
  order, currency, updatingId, onUpdate,
}: {
  order: any
  currency: string
  updatingId: string | null
  onUpdate: (orderId: string, status: string) => void
}) {
  const items: Array<{ name: string; quantity: number; unitPrice: number; total: number }> =
    order.items ? (typeof order.items === 'string' ? JSON.parse(order.items) : order.items) : []

  const isUpdating = updatingId === order.id

  return (
    <Card className="p-4 space-y-3">
      {/* Header: Order ID + Status + Payment Mode */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-bold">#{order.id.substring(0, 8).toUpperCase()}</p>
          <p className="text-[11px] text-muted-foreground">{timeAgo(order.createdAt)}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
            order.paymentMode === 'prepaid'
              ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
              : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
          }`}>
            {order.paymentMode === 'prepaid' ? 'PREPAID' : 'COD'}
          </span>
          <span className={`text-[9px] font-bold px-2 py-0.5 rounded-full ${
            order.status === 'pending' ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' :
            order.status === 'processing' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
            order.status === 'out_for_delivery' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300' :
            order.status === 'completed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' :
            'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
          }`}>
            {order.status.replace(/_/g, ' ').toUpperCase()}
          </span>
        </div>
      </div>

      {/* Customer Info */}
      <div className="space-y-1.5 text-sm">
        <p className="font-semibold">{order.customerName}</p>
        <div className="flex items-center gap-2">
          {order.customerPhone && (
            <>
              <a
                href={`tel:${order.customerPhone}`}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Phone className="w-3 h-3" /> {order.customerPhone}
              </a>
              <a
                href={`tel:${order.customerPhone}`}
                className="w-7 h-7 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center hover:bg-emerald-200 dark:hover:bg-emerald-900/50 transition-colors"
                aria-label="Quick call"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
              </a>
            </>
          )}
        </div>
        {order.customerAddress && (
          <p className="text-xs text-muted-foreground flex items-start gap-1">
            <MapPin className="w-3 h-3 mt-0.5 shrink-0" />
            <span className="line-clamp-2">{order.customerAddress}</span>
          </p>
        )}
      </div>

      {/* Items */}
      <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center justify-between text-xs">
            <span className="flex-1 truncate">
              <span className="font-medium">{item.quantity}×</span> {item.name}
            </span>
            <span className="text-muted-foreground tabular shrink-0 ml-2">
              {formatCurrency(item.total, currency)}
            </span>
          </div>
        ))}
      </div>

      {/* Total */}
      <div className="flex items-center justify-between pt-1 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {items.length} item(s) + {formatCurrency(order.deliveryCharge, currency)} delivery
        </span>
        <span className="text-base font-bold tabular">{formatCurrency(order.grandTotal, currency)}</span>
      </div>

      {/* Synced indicator */}
      {order.syncedTransactionId && (
        <div className="flex items-center gap-1.5 text-[10px] text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="w-3 h-3" />
          Synced to Khata + Inventory · Invoice #{order.syncedInvoiceId?.substring(0, 8).toUpperCase()}
        </div>
      )}

      {/* Action Buttons */}
      {order.status !== 'completed' && order.status !== 'cancelled' && (
        <div className="flex gap-2 pt-1">
          {order.status === 'pending' && (
            <Button
              onClick={() => onUpdate(order.id, 'processing')}
              disabled={isUpdating}
              className="flex-1 h-9 text-xs bg-blue-600 hover:bg-blue-700"
              size="sm"
            >
              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Play className="w-3.5 h-3.5 mr-1" />}
              Accept Order
            </Button>
          )}
          {order.status === 'processing' && (
            <Button
              onClick={() => onUpdate(order.id, 'out_for_delivery')}
              disabled={isUpdating}
              className="flex-1 h-9 text-xs bg-purple-600 hover:bg-purple-700"
              size="sm"
            >
              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Truck className="w-3.5 h-3.5 mr-1" />}
              Ready for Delivery
            </Button>
          )}
          {order.status === 'out_for_delivery' && (
            <Button
              onClick={() => onUpdate(order.id, 'completed')}
              disabled={isUpdating}
              className="flex-1 h-9 text-xs bg-emerald-600 hover:bg-emerald-700"
              size="sm"
            >
              {isUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <CheckCircle2 className="w-3.5 h-3.5 mr-1" />}
              Complete
            </Button>
          )}
          <Button
            onClick={() => onUpdate(order.id, 'cancelled')}
            disabled={isUpdating}
            variant="outline"
            className="h-9 text-xs text-red-600 border-red-300 hover:bg-red-50 dark:hover:bg-red-950/30"
            size="sm"
          >
            <XCircle className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}
    </Card>
  )
}
