'use client'

/**
 * PRD Part 32 §3 — Defaulter Alert Banner
 *
 * Embeddable red banner shown at the top of any view (khata, billing,
 * party detail) when a known defaulter is detected.
 *
 * Props:
 *  - amount        default amount (₹)
 *  - merchantName  merchant who reported the default
 *  - partyName     optional — name of the party the default belongs to
 *  - onDismiss     optional callback fired when the user taps the X
 *
 * Features:
 *  - Pulsing red border (Framer Motion boxShadow keyframes).
 *  - Bold warning text + subtext.
 *  - X dismiss button (top-right).
 *  - "View Details" link → opens a Dialog with full info + advice.
 */

import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  AlertTriangle,
  X,
  Info,
  ShieldAlert,
  Wallet,
  Store,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatCurrency } from '@/lib/utils'

export interface DefaulterAlertBannerProps {
  amount: number
  merchantName: string
  partyName?: string
  onDismiss?: () => void
}

export function DefaulterAlertBanner({
  amount,
  merchantName,
  partyName,
  onDismiss,
}: DefaulterAlertBannerProps) {
  const [open, setOpen] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  const handleDismiss = () => {
    setDismissed(true)
    onDismiss?.()
  }

  return (
    <>
      <motion.div
        role="alert"
        aria-live="assertive"
        initial={{ opacity: 0, y: -8 }}
        animate={{
          opacity: 1,
          y: 0,
          boxShadow: [
            '0 0 0 0 rgba(239,68,68,0.0)',
            '0 0 0 2px rgba(239,68,68,0.55)',
            '0 0 0 0 rgba(239,68,68,0.0)',
          ],
        }}
        transition={{
          opacity: { duration: 0.2 },
          y: { duration: 0.2 },
          boxShadow: {
            duration: 2,
            repeat: Infinity,
            ease: 'easeInOut',
          },
        }}
        className="relative w-full overflow-hidden rounded-lg border border-red-500/40 bg-red-500/15 px-4 py-3 text-red-300"
      >
        <div className="flex items-start gap-3">
          {/* Pulsing warning icon */}
          <motion.span
            aria-hidden
            className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-300"
            animate={{ opacity: [1, 0.55, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <AlertTriangle className="h-4 w-4" />
          </motion.span>

          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold leading-tight text-red-200">
              Warning: Active default of {formatCurrency(amount)} at {merchantName}!
            </p>
            {partyName && (
              <p className="mt-0.5 text-xs leading-snug text-red-300/80">
                {partyName} has an unresolved default reported by another
                merchant in your group.
              </p>
            )}
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="mt-1.5 inline-flex items-center gap-1 rounded text-xs font-medium text-red-200 underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
            >
              <Info className="h-3 w-3" />
              View Details
            </button>
          </div>

          {/* Dismiss X */}
          <button
            type="button"
            aria-label="Dismiss defaulter alert"
            onClick={handleDismiss}
            className="shrink-0 rounded-md p-1 text-red-300/70 transition hover:bg-red-500/15 hover:text-red-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400/50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </motion.div>

      {/* Details Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-red-500/30 bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-red-500/15 text-red-300 ring-2 ring-red-500/30">
              <ShieldAlert className="h-7 w-7" />
            </div>
            <DialogTitle className="text-center text-lg font-semibold text-foreground">
              Active Default Detected
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              This customer has an unresolved default reported by another
              merchant in your shared registry.
            </DialogDescription>
          </DialogHeader>

          {/* Details grid */}
          <div className="space-y-2.5 rounded-lg border border-border bg-background/50 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Wallet className="h-3.5 w-3.5" />
                Default Amount
              </span>
              <Badge
                variant="destructive"
                className="bg-red-500/15 text-red-300 ring-1 ring-red-500/30"
              >
                {formatCurrency(amount)}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs text-muted-foreground">
                <Store className="h-3.5 w-3.5" />
                Reported By
              </span>
              <span className="text-sm font-medium text-foreground">
                {merchantName}
              </span>
            </div>
            {partyName && (
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Customer
                </span>
                <span className="text-sm font-medium text-foreground">
                  {partyName}
                </span>
              </div>
            )}
          </div>

          {/* Advisory */}
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <p className="font-semibold">Recommended Action</p>
            <p className="mt-1 text-amber-200/90">
              Proceed with caution. Consider cash-only transactions or require
              advance payment before extending further credit.
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
