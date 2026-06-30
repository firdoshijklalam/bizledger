'use client'

/**
 * PRD Part 32 §1 — Biometric Action Gate Modal
 *
 * Globally-mounted modal that watches `useBiometricGateStore.openGate`.
 * When a gate is requested (owner switch, high-value discount, data export,
 * inventory price mod, danger zone), this modal opens and asks the user to
 * verify via fingerprint (simulated on web) or PIN.
 *
 * Flow:
 *  - Default: animated fingerprint + "Simulate Fingerprint Scan" button.
 *  - PIN fallback: 6-digit InputOTP (REGEXP_ONLY_DIGITS).
 *  - 2 wrong attempts (across either method) → 2-minute module lockdown +
 *    Telegram alert banner with live countdown.
 *  - On success: green CheckCircle2 scale-in for 600ms, then resolveSuccess().
 *  - On failure: red shake animation + "Fingerprint not recognized. Attempt N of 2."
 *  - Auto-clears lockdown when `lockdownUntil` passes.
 */

import { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ShieldCheck,
  Percent,
  Download,
  Tag,
  AlertTriangle,
  Fingerprint,
  CheckCircle2,
  MessageCircle,
  Lock,
  Loader2,
  KeyRound,
  ScanLine,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from '@/components/ui/input-otp'
import { REGEXP_ONLY_DIGITS } from 'input-otp'
import { toast } from 'sonner'
import { useBiometricGateStore, type GateType } from '@/store/biometric-gate-store'
import { cn } from '@/lib/utils'

interface GateMeta {
  title: string
  Icon: React.ComponentType<{ className?: string }>
  /** container classes for the icon box */
  iconBox: string
}

const GATE_META: Record<GateType, GateMeta> = {
  owner_switch: {
    title: 'Owner Mode Re-switching',
    Icon: ShieldCheck,
    iconBox: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  },
  high_value_discount: {
    title: 'High-Value Discount Approval',
    Icon: Percent,
    iconBox: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  },
  data_export: {
    title: 'Data Export Security',
    Icon: Download,
    iconBox: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  },
  inventory_price: {
    title: 'Inventory Price Modification',
    Icon: Tag,
    iconBox: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  },
  danger_zone: {
    title: 'Danger Zone Authentication',
    Icon: AlertTriangle,
    iconBox: 'bg-red-500/10 text-red-400 ring-red-500/20',
  },
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function BiometricGateModal() {
  const {
    openGate,
    failedAttempts,
    lockdownUntil,
    resolveSuccess,
    resolveCancel,
    registerFailure,
    clearLockdown,
  } = useBiometricGateStore()

  const [mode, setMode] = useState<'biometric' | 'pin'>('biometric')
  const [verifying, setVerifying] = useState(false)
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)
  const [success, setSuccess] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(0)
  // Remember the gate so we can keep showing the lockdown banner after the
  // store nulls `openGate` upon entering lockdown (see registerFailure in store).
  const [rememberedGate, setRememberedGate] =
    useState<typeof openGate>(null)

  // Reset transient UI state when a fresh gate opens.
  useEffect(() => {
    if (openGate) {
      setRememberedGate(openGate)
      setMode('biometric')
      setPin('')
      setSuccess(false)
      setErrorMsg(null)
      setShake(false)
      setVerifying(false)
    }
  }, [openGate])

  // Lockdown countdown — also clears lockdown when it expires.
  useEffect(() => {
    if (!lockdownUntil) {
      setSecondsLeft(0)
      return
    }
    const tick = () => {
      const remaining = Math.max(
        0,
        Math.ceil((lockdownUntil - Date.now()) / 1000)
      )
      setSecondsLeft(remaining)
      if (remaining === 0) {
        clearLockdown()
        setRememberedGate(null)
        toast.success('Lockdown ended. You may retry verification.')
      }
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [lockdownUntil, clearLockdown])

  const isLocked = !!lockdownUntil && Date.now() < lockdownUntil
  // Show the modal either when the store has an open gate, or when we just
  // entered lockdown while a gate was active (so we can show the banner).
  const visibleGate = openGate ?? (isLocked ? rememberedGate : null)

  const triggerShake = useCallback(() => {
    setShake(true)
    const t = setTimeout(() => setShake(false), 500)
    return () => clearTimeout(t)
  }, [])

  const handleSuccess = useCallback(() => {
    setSuccess(true)
    setErrorMsg(null)
    setVerifying(false)
    setTimeout(() => {
      resolveSuccess()
      setSuccess(false)
    }, 600)
  }, [resolveSuccess])

  const handleFailure = useCallback(
    (msg: string) => {
      triggerShake()
      setVerifying(false)
      setErrorMsg(msg)
      registerFailure()
    },
    [registerFailure, triggerShake]
  )

  // Biometric scan — simulates a 1.5s scan, then calls the gate API.
  const handleBiometric = useCallback(async () => {
    if (!visibleGate || verifying || success) return
    setVerifying(true)
    setErrorMsg(null)
    // simulate sensor scan delay
    await new Promise((r) => setTimeout(r, 1500))
    try {
      const res = await fetch('/api/biometric/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          gateType: visibleGate.gateType,
          method: 'biometric',
          staffName: 'Owner',
        }),
      })
      const data = await res.json()
      if (data.locked) {
        // Backend says we're locked — registerFailure will trigger local lockdown
        handleFailure(data.message || 'Module locked down.')
        return
      }
      if (data.verified) {
        toast.success('Biometric verified — access granted')
        handleSuccess()
      } else {
        handleFailure(
          `Fingerprint not recognized. Attempt ${failedAttempts + 1} of 2.`
        )
      }
    } catch (e) {
      handleFailure('Sensor error. Try again.')
    }
  }, [
    visibleGate,
    verifying,
    success,
    failedAttempts,
    handleFailure,
    handleSuccess,
  ])

  // PIN verify — fires when InputOTP completes.
  const handlePinComplete = useCallback(
    async (value: string) => {
      if (!visibleGate) return
      setVerifying(true)
      setErrorMsg(null)
      try {
        const res = await fetch('/api/biometric/gate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            gateType: visibleGate.gateType,
            method: 'pin',
            pin: value,
            staffName: 'Owner',
          }),
        })
        const data = await res.json()
        if (data.locked) {
          setPin('')
          handleFailure(data.message || 'Module locked down.')
          return
        }
        if (data.verified) {
          toast.success('PIN accepted — access granted')
          handleSuccess()
        } else {
          setPin('')
          handleFailure(
            `Wrong PIN. Attempt ${failedAttempts + 1} of 2.`
          )
        }
      } catch (e) {
        setPin('')
        handleFailure('Network error. Try again.')
      }
    },
    [visibleGate, failedAttempts, handleFailure, handleSuccess]
  )

  if (!visibleGate) return null

  const meta = GATE_META[visibleGate.gateType] ?? GATE_META.owner_switch
  const { Icon } = meta

  return (
    <Dialog
      open={!!visibleGate}
      onOpenChange={(o) => {
        // Block closing during lockdown; allow cancel otherwise.
        if (!o && !isLocked && !verifying) resolveCancel()
      }}
    >
      <DialogContent
        showCloseButton={!isLocked && !verifying}
        className="max-w-md gap-0 overflow-hidden border border-border bg-card/80 p-0 backdrop-blur-xl dark:bg-card/80"
        onInteractOutside={(e) => {
          // prevent dismiss while locked / verifying
          if (isLocked || verifying) e.preventDefault()
        }}
        onEscapeKeyDown={(e) => {
          if (isLocked || verifying) e.preventDefault()
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 26 }}
          className="flex flex-col"
        >
          {/* Header — gate icon + title */}
          <DialogHeader className="gap-3 border-b border-border/60 p-5 text-left sm:text-left">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ring-1',
                  meta.iconBox
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <DialogTitle className="text-base font-semibold text-foreground">
                  {meta.title}
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Biometric verification required
                </DialogDescription>
              </div>
            </div>
            {visibleGate.description && (
              <p className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-foreground/80">
                {visibleGate.description}
              </p>
            )}
          </DialogHeader>

          {/* Body */}
          <div className="p-5">
            {/* Lockdown banner (priority over success/error UI) */}
            <AnimatePresence mode="wait">
              {isLocked ? (
                <motion.div
                  key="lockdown"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="space-y-3"
                >
                  <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-center">
                    <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/15">
                      <Lock className="h-6 w-6 text-red-400" />
                    </div>
                    <p className="text-sm font-semibold text-red-400">
                      Module locked
                    </p>
                    <p className="mt-1 text-xs text-red-400/80">
                      Too many failed attempts. Try again in{' '}
                      <span className="font-mono font-bold tabular-nums">
                        {formatCountdown(secondsLeft)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
                    <MessageCircle className="h-3.5 w-3.5" />
                    <span>Telegram alert sent to the owner</span>
                  </div>
                  <p className="text-center text-xs text-muted-foreground">
                    All verification inputs are disabled until the cooldown
                    ends.
                  </p>
                </motion.div>
              ) : success ? (
                <motion.div
                  key="success"
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.6, opacity: 0 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 18 }}
                  className="flex flex-col items-center justify-center py-6"
                >
                  <CheckCircle2 className="h-20 w-20 text-emerald-400" />
                  <p className="mt-3 text-sm font-medium text-emerald-400">
                    Access granted
                  </p>
                </motion.div>
              ) : (
                <motion.div
                  key="verify"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="space-y-4"
                >
                  {/* Mode toggle */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors',
                          mode === 'biometric'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'text-muted-foreground/70'
                        )}
                      >
                        <Fingerprint className="h-3 w-3" /> Fingerprint
                      </span>
                      <span className="text-muted-foreground/40">·</span>
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 transition-colors',
                          mode === 'pin'
                            ? 'bg-emerald-500/15 text-emerald-400'
                            : 'text-muted-foreground/70'
                        )}
                      >
                        <KeyRound className="h-3 w-3" /> PIN
                      </span>
                    </div>
                    {/* Attempt dots */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Attempts
                      </span>
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          failedAttempts >= 1
                            ? 'bg-red-500'
                            : 'bg-muted-foreground/25'
                        )}
                      />
                      <span
                        className={cn(
                          'h-2 w-2 rounded-full transition-colors',
                          failedAttempts >= 2
                            ? 'bg-red-500'
                            : 'bg-muted-foreground/25'
                        )}
                      />
                    </div>
                  </div>

                  <AnimatePresence mode="wait">
                    {mode === 'biometric' ? (
                      <motion.div
                        key="biometric"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{
                          opacity: 1,
                          y: 0,
                          x: shake ? 0 : 0,
                        }}
                        exit={{ opacity: 0, y: -6 }}
                        className="space-y-4"
                      >
                        <motion.div
                          animate={
                            shake
                              ? { x: [-10, 10, -10, 10, 0] }
                              : { x: 0 }
                          }
                          transition={{ duration: 0.45 }}
                          className="flex flex-col items-center"
                        >
                          <div className="group relative">
                            <span className="absolute inset-0 -m-2 animate-ping rounded-full bg-emerald-500/10 opacity-0 group-hover:opacity-100" />
                            <div
                              className={cn(
                                'flex h-24 w-24 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20 transition-transform',
                                verifying && 'animate-pulse'
                              )}
                            >
                              {verifying ? (
                                <Loader2 className="h-10 w-10 animate-spin" />
                              ) : (
                                <Fingerprint className="h-12 w-12" />
                              )}
                            </div>
                          </div>
                          <p className="mt-4 text-sm font-medium text-foreground/90">
                            {verifying ? 'Scanning...' : 'Touch the fingerprint sensor'}
                          </p>
                          <p className="mt-1 text-center text-xs text-muted-foreground">
                            Place your finger on the device sensor, or simulate
                            a scan below.
                          </p>
                        </motion.div>

                        {errorMsg && (
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center text-xs font-medium text-red-400"
                          >
                            {errorMsg}
                          </motion.p>
                        )}

                        <Button
                          type="button"
                          onClick={handleBiometric}
                          disabled={verifying}
                          className="h-11 w-full gap-2 bg-emerald-500 text-white hover:bg-emerald-600"
                        >
                          {verifying ? (
                            <>
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Scanning…
                            </>
                          ) : (
                            <>
                              <ScanLine className="h-4 w-4" />
                              Simulate Fingerprint Scan
                            </>
                          )}
                        </Button>

                        <button
                          type="button"
                          onClick={() => {
                            setMode('pin')
                            setErrorMsg(null)
                          }}
                          className="w-full text-center text-xs text-emerald-400 underline-offset-4 hover:underline"
                        >
                          Use PIN instead
                        </button>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="pin"
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -6 }}
                        className="space-y-4"
                      >
                        <motion.div
                          animate={shake ? { x: [-10, 10, -10, 10, 0] } : { x: 0 }}
                          transition={{ duration: 0.45 }}
                          className="flex flex-col items-center"
                        >
                          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20">
                            <KeyRound className="h-7 w-7" />
                          </div>
                          <p className="mt-3 text-sm font-medium text-foreground/90">
                            Enter your 6-digit PIN
                          </p>
                          <p className="mt-1 text-center text-xs text-muted-foreground">
                            Set in Settings → Security if you haven&apos;t yet.
                          </p>
                        </motion.div>

                        <div className="flex justify-center">
                          <InputOTP
                            maxLength={6}
                            pattern={REGEXP_ONLY_DIGITS}
                            value={pin}
                            onChange={(v) => setPin(v)}
                            onComplete={handlePinComplete}
                            disabled={verifying}
                          >
                            <InputOTPGroup>
                              <InputOTPSlot index={0} className="h-11 w-11" />
                              <InputOTPSlot index={1} className="h-11 w-11" />
                              <InputOTPSlot index={2} className="h-11 w-11" />
                              <InputOTPSlot index={3} className="h-11 w-11" />
                              <InputOTPSlot index={4} className="h-11 w-11" />
                              <InputOTPSlot index={5} className="h-11 w-11" />
                            </InputOTPGroup>
                          </InputOTP>
                        </div>

                        {verifying && (
                          <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Verifying PIN…
                          </p>
                        )}
                        {errorMsg && !verifying && (
                          <motion.p
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-center text-xs font-medium text-red-400"
                          >
                            {errorMsg}
                          </motion.p>
                        )}

                        <button
                          type="button"
                          onClick={() => {
                            setMode('biometric')
                            setErrorMsg(null)
                            setPin('')
                          }}
                          className="w-full text-center text-xs text-emerald-400 underline-offset-4 hover:underline"
                        >
                          Use fingerprint instead
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>

                  {/* Cancel */}
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={resolveCancel}
                    disabled={verifying}
                    className="h-10 w-full text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                  >
                    Cancel
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  )
}
