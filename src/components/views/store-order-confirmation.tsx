'use client'

import { motion } from 'framer-motion'
import { CheckCircle2, ShoppingBag } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface StoreOrderConfirmationProps {
  orderId: string
  storeName: string
  onPlaceAnother: () => void
}

/**
 * StoreOrderConfirmation
 * Shown inside the public storefront after a customer successfully places an order.
 * Full-screen standalone confirmation (no app chrome).
 */
export function StoreOrderConfirmation({
  orderId,
  storeName,
  onPlaceAnother,
}: StoreOrderConfirmationProps) {
  // Truncate the order id for display (keep first 8 chars + ellipsis if long).
  const shortId = orderId.length > 16 ? `${orderId.slice(0, 8)}…${orderId.slice(-4)}` : orderId

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex flex-col items-center justify-center px-4 py-10">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="relative w-full max-w-sm bg-card/80 backdrop-blur-xl border border-border rounded-3xl shadow-xl p-8 text-center"
      >
        {/* Big green checkmark with spring scale-in + ripple ring */}
        <div className="relative w-20 h-20 mx-auto mb-5 flex items-center justify-center">
          {/* Ripple ring — radiates outward from behind the circle */}
          <motion.div
            initial={{ scale: 0.7, opacity: 0.55 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeOut' }}
            className="absolute inset-0 rounded-full border-2 border-emerald-400/40 pointer-events-none"
          />
          <motion.div
            initial={{ scale: 0, rotate: -25 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.05 }}
            className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 320, damping: 14, delay: 0.18 }}
            >
              <CheckCircle2 className="w-12 h-12 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
            </motion.div>
          </motion.div>
        </div>

        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="text-2xl font-bold text-foreground"
        >
          Order Placed!
        </motion.h1>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32 }}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-muted text-xs text-muted-foreground"
        >
          <span className="font-medium">Order ID:</span>
          <span className="font-mono text-foreground truncate max-w-[160px]" title={orderId}>
            {shortId}
          </span>
        </motion.div>

        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-4 text-sm text-muted-foreground leading-relaxed"
        >
          The shop owner will contact you shortly to confirm your order.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.48 }}
          className="mt-6"
        >
          <Button
            onClick={onPlaceAnother}
            size="lg"
            className="w-full h-12 rounded-xl bg-gradient-to-r from-emerald-600 to-emerald-700 dark:from-emerald-600 dark:to-emerald-800 text-white font-semibold shadow-lg shadow-emerald-600/20 hover:shadow-xl hover:shadow-emerald-600/30 transition-all"
          >
            <ShoppingBag className="w-4 h-4" />
            Place Another Order
          </Button>
        </motion.div>
      </motion.div>

      {/* Footer — store name + BizLedger branding */}
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-8 text-xs text-muted-foreground text-center"
      >
        <span className="font-medium text-foreground/80">{storeName}</span>
        <span className="mx-1.5">·</span>
        Powered by <span className="font-semibold text-emerald-600 dark:text-emerald-400">BizLedger</span>
      </motion.p>
    </div>
  )
}
