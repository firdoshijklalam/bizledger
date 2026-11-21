'use client'

/**
 * PRD Part 32 §2 — External Biometric Scanner Simulator
 *
 * Real USB-OTG fingerprint scanners (Mantra MFS100 / Morpho) cannot be
 * accessed directly from a web browser — they require a native SDK +
 * driver. This component simulates the external scanner so the rest of
 * the biometric ecosystem (recognition → floating widget → defaulter
 * alert) can be exercised end-to-end in the demo environment.
 *
 * Layout:
 *  - Floating Action Button (FAB) fixed bottom-left, above the bottom nav.
 *  - Tap FAB → opens a Dialog titled "External Biometric Scanner (USB OTG)".
 *  - Dialog body explains the USB-OTG scenario and lists the first 5
 *    registered customers (fetched from `/api/parties?type=customer`).
 *  - Tapping a customer simulates a 1.5s scan (animated laser lines),
 *    then calls POST /api/biometric { action: 'recognize', hash: 'sim-<id>' }
 *    and checks /api/defaulter-registry?phone=<phone>. If an active
 *    defaulter is found, attaches `defaulterAlert` to the floating widget.
 *  - Toasts: "Scan complete — {name} recognized" (success) or
 *    "Warning: Active default detected" (warning).
 *  - "Register New Fingerprint" button → toast instructing the user to
 *    open a customer profile.
 *  - FAB is only rendered when `externalScannerEnabled` is true in
 *    `/api/app-settings`.
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ScanLine,
  Fingerprint,
  Loader2,
  Usb,
  UserPlus,
  CheckCircle2,
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { toast } from 'sonner'
import { useBiometricGateStore } from '@/store/biometric-gate-store'
import { useFetch } from '@/hooks/use-fetch'
import { cn } from '@/lib/utils'

interface Party {
  id: string
  name: string
  phone: string | null
  balance: number
  qualityGrade?: string
}

interface DefaulterLookupResponse {
  count: number
  defaulters: Array<{
    id: string
    partyName: string
    partyPhone: string | null
    defaultAmount: number
    merchantName: string
    merchantArea: string | null
    status: string
  }>
}

interface AppSettings {
  externalScannerEnabled?: boolean
}

const SCAN_DURATION_MS = 1500

export function ExternalScannerSimulator() {
  const { showFloatingWidget } = useBiometricGateStore()

  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [open, setOpen] = useState(false)
  const [scanningId, setScanningId] = useState<string | null>(null)

  // Fetch app-settings once on mount to decide whether to render.
  useEffect(() => {
    let cancelled = false
    fetch('/api/app-settings')
      .then((r) => (r.ok ? r.json() : null))
      .then((s: AppSettings | null) => {
        if (!cancelled) setEnabled(Boolean(s?.externalScannerEnabled))
      })
      .catch(() => {
        if (!cancelled) setEnabled(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Load first 5 customers whenever the dialog opens (useFetch handles
  // loading + data state internally and only fires when URL is non-null).
  const { data: partiesList, loading: loadingParties } = useFetch<Party[]>(
    open ? '/api/parties?type=customer' : null,
    [open]
  )
  const parties: Party[] = Array.isArray(partiesList)
    ? partiesList.slice(0, 5)
    : []

  const handleSimulateScan = useCallback(
    async (party: Party) => {
      setScanningId(party.id)

      // 1. Visual: laser-line scan animation (SCAN_DURATION_MS).
      await new Promise((resolve) => setTimeout(resolve, SCAN_DURATION_MS))

      // 2. Call /api/biometric (recognize). Even if the API returns
      //    recognized: false (because no fingerprint was ever registered
      //    for this hash), we trust the user's manual pick in demo mode.
      try {
        await fetch('/api/biometric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'recognize',
            hash: 'sim-' + party.id,
          }),
        })
      } catch {
        /* non-fatal — we still show the floating widget for the demo */
      }

      // 3. Check the shared defaulter registry by phone.
      let defaulterAlert: { amount: number; merchantName: string } | null = null
      if (party.phone) {
        try {
          const res = await fetch(
            `/api/defaulter-registry?phone=${encodeURIComponent(party.phone)}`
          )
          if (res.ok) {
            const data: DefaulterLookupResponse = await res.json()
            const active = (data.defaulters || []).find(
              (d) => d.status === 'active'
            )
            if (active) {
              defaulterAlert = {
                amount: active.defaultAmount,
                merchantName: active.merchantName,
              }
            }
          }
        } catch {
          /* non-fatal */
        }
      }

      // 4. Show the floating customer widget.
      showFloatingWidget({
        partyId: party.id,
        partyName: party.name,
        defaulterAlert,
      })

      // 5. Close modal + toast.
      setScanningId(null)
      setOpen(false)

      if (defaulterAlert) {
        toast.warning('Warning: Active default detected', {
          description: `${party.name} has an unresolved default of ₹${defaulterAlert.amount.toLocaleString(
            'en-IN'
          )} at ${defaulterAlert.merchantName}.`,
        })
      } else {
        toast.success(`Scan complete — ${party.name} recognized`, {
          description: 'Tap the floating widget to open their khata.',
        })
      }
    },
    [showFloatingWidget]
  )

  // Still resolving whether the scanner is enabled — render nothing.
  if (enabled === null) return null
  if (!enabled) return null

  return (
    <>
      {/* Floating Action Button */}
      <motion.button
        type="button"
        aria-label="Open external biometric scanner simulator"
        onClick={() => setOpen(true)}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 320, damping: 22 }}
        whileTap={{ scale: 0.9 }}
        className="fixed bottom-24 left-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-500/30 bg-card/90 text-emerald-300 shadow-lg backdrop-blur-xl transition-colors hover:bg-card"
      >
        {/* emerald pulsing glow */}
        <span
          aria-hidden
          className="absolute inset-0 -z-10 animate-ping rounded-full bg-emerald-500/20"
        />
        <ScanLine className="h-6 w-6 animate-pulse" />
      </motion.button>

      {/* Scanner Modal */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md border-border bg-card/95 backdrop-blur-xl">
          <DialogHeader>
            <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300 ring-2 ring-emerald-500/20">
              <Fingerprint className="h-7 w-7" />
            </div>
            <DialogTitle className="text-center text-lg font-semibold text-foreground">
              External Biometric Scanner (USB OTG)
            </DialogTitle>
            <DialogDescription className="text-center text-sm text-muted-foreground">
              Connect Mantra MFS100 / Morpho SDK via USB OTG. In demo mode,
              pick a registered fingerprint to simulate a scan.
            </DialogDescription>
          </DialogHeader>

          {/* Simulated device status pill */}
          <div className="flex items-center justify-center gap-2 rounded-md border border-border bg-background/60 px-3 py-1.5 text-xs text-muted-foreground">
            <Usb className="h-3.5 w-3.5 text-emerald-300" />
            <span>Device:&nbsp;</span>
            <span className="font-medium text-emerald-300">Mantra MFS100 (simulated)</span>
            <span className="ml-1 inline-flex h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-emerald-300">Ready</span>
          </div>

          {/* Customer list — pick a fingerprint to "scan" */}
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Registered Fingerprints ({parties.length})
            </p>

            {loadingParties ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading customers…
              </div>
            ) : parties.length === 0 ? (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">
                No customers found. Add a customer first to register their fingerprint.
              </div>
            ) : (
              <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                {parties.map((p) => {
                  const isScanning = scanningId === p.id
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        disabled={scanningId !== null}
                        onClick={() => handleSimulateScan(p)}
                        className={cn(
                          'group relative flex w-full items-center gap-3 overflow-hidden rounded-lg border border-border bg-background/50 px-3 py-2.5 text-left transition',
                          'hover:border-emerald-500/40 hover:bg-emerald-500/5',
                          'disabled:cursor-not-allowed disabled:opacity-70',
                          isScanning && 'border-emerald-500/60 bg-emerald-500/10'
                        )}
                      >
                        {/* Laser-line scan overlay */}
                        <AnimatePresence>
                          {isScanning && (
                            <>
                              <motion.div
                                aria-hidden
                                className="pointer-events-none absolute inset-0 z-10 bg-emerald-500/5"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                exit={{ opacity: 0 }}
                              />
                              <motion.div
                                aria-hidden
                                className="pointer-events-none absolute left-0 right-0 z-20 h-0.5 bg-emerald-400 shadow-[0_0_12px_2px_rgba(16,185,129,0.65)]"
                                initial={{ top: '0%' }}
                                animate={{ top: ['0%', '100%', '0%'] }}
                                transition={{
                                  duration: SCAN_DURATION_MS / 1000,
                                  ease: 'easeInOut',
                                }}
                              />
                            </>
                          )}
                        </AnimatePresence>

                        <Avatar className="h-9 w-9 border border-border bg-emerald-500/10">
                          <AvatarFallback className="bg-emerald-500/10 text-xs font-semibold text-emerald-300">
                            {p.name.charAt(0).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {p.name}
                          </p>
                          <p className="truncate text-xs text-muted-foreground">
                            {p.phone || 'No phone'}
                          </p>
                        </div>

                        {isScanning ? (
                          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-300">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Scanning…
                          </span>
                        ) : (
                          <Fingerprint className="h-4 w-4 text-emerald-300/70 transition group-hover:text-emerald-300" />
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <DialogFooter className="flex-col gap-2 sm:flex-col sm:gap-2">
            <Button
              type="button"
              variant="outline"
              className="w-full border-dashed"
              onClick={() => {
                toast.info('Open a customer profile to register their fingerprint.', {
                  description:
                    'Tap any customer in Khata → use "Register Fingerprint" in their profile.',
                })
              }}
            >
              <UserPlus className="mr-2 h-4 w-4" />
              Register New Fingerprint
            </Button>
            <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>
                Recognized customers appear as a floating widget for one-tap khata access.
              </span>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
