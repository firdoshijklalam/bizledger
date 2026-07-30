'use client'

/**
 * §REAL-TIME: useRealtimeOrders — WebSocket hook for instant order notifications.
 *
 * Connects to the Order Notifications WebSocket mini-service (port 3003)
 * via the gateway (io("/?XTransformPort=3003")). When a new order is placed
 * on the external Quick-Commerce frontend, this hook instantly receives it
 * and:
 *   1. Prepends the new order to the local orders list.
 *   2. Plays a notification sound.
 *   3. Shows a toast notification.
 *
 * §FALLBACK: If the WebSocket service is down, orders are still fetched via
 * the REST API (/api/customer-orders) on mount. The WebSocket is only for
 * real-time push — the REST fetch is the source of truth.
 *
 * Usage:
 *   const { orders, isConnected, refetch } = useRealtimeOrders(businessId)
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { io, Socket } from 'socket.io-client'
import { useFetch } from '@/hooks/use-fetch'

interface RealtimeOrder {
  id: string
  customerName: string
  customerPhone?: string
  customerAddress?: string
  items: any[]
  subtotal: number
  deliveryCharge: number
  grandTotal: number
  status: string
  source: string
  createdAt: string
}

interface NewOrderEvent {
  orderId: string
  customerName: string
  grandTotal: number
  itemCount: number
  businessId: string
  timestamp: string
}

export function useRealtimeOrders(businessId: string | null | undefined) {
  const { data: initialOrders, refetch } = useFetch<RealtimeOrder[]>('/api/customer-orders', [])
  // §REALTIME-ORDERS: realtimeOrders holds orders received via WebSocket.
  // Combined with initialOrders (from REST), deduped by id.
  const [realtimeOrders, setRealtimeOrders] = useState<RealtimeOrder[]>([])
  // §OVERRIDE: Status overrides applied locally (e.g., after status update API call).
  // Keyed by orderId → { status, ...extra }
  const [statusOverrides, setStatusOverrides] = useState<Record<string, any>>({})
  const [isConnected, setIsConnected] = useState(false)
  const socketRef = useRef<Socket | null>(null)

  // WebSocket connection
  useEffect(() => {
    if (!businessId) return

    // §GATEWAY: Connect via the Caddy gateway using XTransformPort.
    // The path is always "/" so Caddy can forward to the correct port.
    const socket = io('/?XTransformPort=3003', {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    })
    socketRef.current = socket

    socket.on('connect', () => {
      setIsConnected(true)
      // §SUBSCRIBE: Join the business-specific room to receive only this
      // business's order events.
      socket.emit('subscribe', businessId)
    })

    socket.on('disconnect', () => {
      setIsConnected(false)
    })

    socket.on('connect_error', () => {
      setIsConnected(false)
      // §FALLBACK: WebSocket failed — REST polling will still work.
      // The mini-service might not be running in dev.
    })

    // §NEW-ORDER: Real-time order push from the external Quick-Commerce frontend.
    socket.on('new-order', (event: NewOrderEvent) => {
      // Fetch the full order details
      fetch('/api/customer-orders').then((r) => r.json()).then((allOrders: RealtimeOrder[]) => {
        const newOrder = allOrders.find((o) => o.id === event.orderId)
        if (newOrder) {
          setRealtimeOrders((prev) => {
            // Avoid duplicates
            if (prev.some((o) => o.id === newOrder.id)) return prev
            return [newOrder, ...prev]
          })
        }
      })

      // §NOTIFICATION: Show toast + play sound
      toast.success('🛒 New Online Order!', {
        description: `${event.customerName} · ₹${event.grandTotal} · ${event.itemCount} item(s)`,
        duration: 6000,
      })

      // §SOUND: Play a notification sound (simple beep via Web Audio API)
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)()
        const oscillator = audioContext.createOscillator()
        const gain = audioContext.createGain()
        oscillator.connect(gain)
        gain.connect(audioContext.destination)
        oscillator.frequency.value = 880 // A5 note
        oscillator.type = 'sine'
        gain.gain.setValueAtTime(0.3, audioContext.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5)
        oscillator.start()
        oscillator.stop(audioContext.currentTime + 0.5)
      } catch {}
    })

    return () => {
      socket.disconnect()
      socketRef.current = null
    }
  }, [businessId])

  // §MERGE: Combine REST orders with realtime orders, dedupe by id.
  // Realtime orders take priority (they're newer).
  // Apply status overrides (from local updateOrderStatus calls).
  const allOrderIds = new Set(realtimeOrders.map((o) => o.id))
  const restOrders = (initialOrders || []).filter((o) => !allOrderIds.has(o.id))
  const orders = [...realtimeOrders, ...restOrders].map((o: any) =>
    statusOverrides[o.id] ? { ...o, ...statusOverrides[o.id] } : o
  )

  const manualRefetch = useCallback(async () => {
    await refetch()
  }, [refetch])

  // §SPA-UPDATE: Update an order's status in local state without a full reload.
  // This is used after a status update API call succeeds.
  const updateOrderStatus = useCallback((orderId: string, status: string, extra?: any) => {
    setStatusOverrides((prev) => ({
      ...prev,
      [orderId]: { status, ...extra },
    }))
  }, [])

  return { orders, isConnected, refetch: manualRefetch, updateOrderStatus }
}
