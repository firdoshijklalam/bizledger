/**
 * §REAL-TIME: Order Notifications WebSocket Service.
 *
 * This mini-service runs on port 3003 and provides real-time order
 * push notifications to the admin app's Online Orders page.
 *
 * §ARCHITECTURE:
 *   1. External Quick-Commerce frontend POSTs a new order to
 *      /api/public/orders (the Next.js API route).
 *   2. The API route saves the order to the DB, then sends a POST
 *      to this service's /new-order endpoint.
 *   3. This service emits a 'new-order' Socket.io event to all
 *      connected admin clients (filtered by businessId).
 *   4. The admin app's Online Orders page listens for this event
 *      and instantly shows the new order + plays a notification sound.
 *
 * §GATEWAY: The frontend connects via io("/?XTransformPort=3003") which
 * Caddy routes to this service's port 3003.
 *
 * §FALLBACK: If this service is down, orders are still saved to the DB.
 * The admin app will see them on next page load (polling fallback).
 */

import { createServer } from 'http'
import { Server } from 'socket.io'

const PORT = 3003

const httpServer = createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ status: 'ok', service: 'order-notifications', port: PORT }))
    return
  }

  // §NEW-ORDER: Called by /api/public/orders when a new order is placed.
  // Emits a 'new-order' event to all admin clients for that business.
  if (req.url?.startsWith('/new-order')) {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      try {
        const order = JSON.parse(body)
        const { orderId, customerName, grandTotal, itemCount, businessId } = order

        // Emit to all admin clients subscribed to this business
        io.to(`business:${businessId}`).emit('new-order', {
          orderId,
          customerName,
          grandTotal,
          itemCount,
          businessId,
          timestamp: new Date().toISOString(),
        })

        console.log(`[Order Notifications] Emitted new-order event for business ${businessId}: ${customerName} ₹${grandTotal} (${itemCount} items)`)

        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ emitted: true }))
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'Invalid JSON' }))
      }
    })
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  path: '/',
})

// Connection handler
io.on('connection', (socket) => {
  console.log(`[Order Notifications] Admin client connected: ${socket.id}`)

  // §SUBSCRIBE: Admin client subscribes to a specific business's order events.
  socket.on('subscribe', (businessId: string) => {
    socket.join(`business:${businessId}`)
    console.log(`[Order Notifications] Client ${socket.id} subscribed to business:${businessId}`)
  })

  socket.on('disconnect', () => {
    console.log(`[Order Notifications] Admin client disconnected: ${socket.id}`)
  })
})

httpServer.listen(PORT, () => {
  console.log(`[Order Notifications] WebSocket service running on port ${PORT}`)
  console.log(`[Order Notifications] Admin clients connect via io('/?XTransformPort=${PORT}')`)
  console.log(`[Order Notifications] Order webhook: POST http://localhost:${PORT}/new-order`)
})

// §GRACEFUL-SHUTDOWN
process.on('SIGTERM', () => {
  console.log('[Order Notifications] SIGTERM received, shutting down...')
  io.close(() => {
    httpServer.close(() => {
      process.exit(0)
    })
  })
})
