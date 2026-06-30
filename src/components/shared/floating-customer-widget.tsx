'use client'

/**
 * PRD Part 32 §2.2 — Floating Customer Widget
 *
 * Round, draggable floating widget that appears when the
 * external biometric scanner (or any other source) recognizes
 * a customer. Sits above the bottom navigation and provides
 * one-tap access to the recognized party's khata.
 *
 * Behaviour:
 *  - Renders only when `floatingWidget.open === true`.
 *  - Circular Avatar (image if available, else first-letter fallback).
 *  - Name below avatar (truncated to ~14 chars).
 *  - "Khata" badge showing current balance via formatCurrency.
 *  - If `floatingWidget.defaulterAlert` is set → red pulsing ring around
 *    the avatar + a small red AlertTriangle warning badge.
 *  - Single tap  → navigates to party detail (khata) via
 *    `setSelectedPartyId(partyId)` + `setActiveView('khata')`,
 *    then `hideFloatingWidget()`.
 *  - Long-press OR X button → dismisses via `hideFloatingWidget()`.
 *  - Position: `fixed bottom-24 right-4 z-50` (above bottom nav).
 *  - Draggable horizontally/vertically via Framer Motion `drag`.
 *  - Entry: scale 0 → 1 + spring.
 *  - Auto-hides after 8 seconds if not tapped.
 */

import { useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence, type PanInfo } from 'framer-motion'
import { X, AlertTriangle, Wallet } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { useBiometricGateStore } from '@/store/biometric-gate-store'
import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, cn } from '@/lib/utils'

interface PartyDetail {
  id: string
  name: string
  balance: number
}

const AUTO_HIDE_MS = 8000
const LONG_PRESS_MS = 500
const MAX_NAME_LEN = 14

function truncateName(name: string | null): string {
  if (!name) return 'Unknown'
  return name.length > MAX_NAME_LEN ? name.slice(0, MAX_NAME_LEN - 1) + '…' : name
}

export function FloatingCustomerWidget() {
  const { floatingWidget, hideFloatingWidget } = useBiometricGateStore()
  const { setSelectedPartyId, setActiveView } = useAppStore()

  // Long-press timer ref
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressFired = useRef(false)
  // Track pointer movement to cancel long-press on drag/scroll
  const pointerStart = useRef<{ x: number; y: number } | null>(null)

  // Fetch the party's current balance when the widget opens for a party.
  // useFetch returns null data when the URL is null (widget closed), and
  // refetches automatically when the URL changes.
  const partyUrl =
    floatingWidget.open && floatingWidget.partyId
      ? `/api/parties/${floatingWidget.partyId}`
      : null
  const { data: partyDetail } = useFetch<PartyDetail>(partyUrl, [
    floatingWidget.open,
    floatingWidget.partyId,
  ])
  const balance = partyDetail && typeof partyDetail.balance === 'number'
    ? partyDetail.balance
    : null

  // Auto-hide after AUTO_HIDE_MS if not tapped.
  useEffect(() => {
    if (!floatingWidget.open) return
    const timer = setTimeout(() => {
      hideFloatingWidget()
    }, AUTO_HIDE_MS)
    return () => clearTimeout(timer)
  }, [floatingWidget.open, floatingWidget.partyId, hideFloatingWidget])

  // Clean up any pending long-press timer on unmount.
  useEffect(() => {
    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
    }
  }, [])

  const handleTap = useCallback(() => {
    if (longPressFired.current) {
      longPressFired.current = false
      return
    }
    const partyId = floatingWidget.partyId
    if (!partyId) {
      hideFloatingWidget()
      return
    }
    setSelectedPartyId(partyId)
    setActiveView('khata')
    hideFloatingWidget()
  }, [floatingWidget.partyId, hideFloatingWidget, setSelectedPartyId, setActiveView])

  const startLongPress = useCallback(
    (clientX: number, clientY: number) => {
      pointerStart.current = { x: clientX, y: clientY }
      longPressFired.current = false
      if (longPressTimer.current) clearTimeout(longPressTimer.current)
      longPressTimer.current = setTimeout(() => {
        longPressFired.current = true
        hideFloatingWidget()
      }, LONG_PRESS_MS)
    },
    [hideFloatingWidget]
  )

  const cancelLongPress = useCallback(
    (clientX: number, clientY: number) => {
      // Cancel if pointer moved more than a few pixels (drag/scroll)
      if (pointerStart.current) {
        const dx = Math.abs(clientX - pointerStart.current.x)
        const dy = Math.abs(clientY - pointerStart.current.y)
        if (dx > 8 || dy > 8) {
          if (longPressTimer.current) {
            clearTimeout(longPressTimer.current)
            longPressTimer.current = null
          }
          longPressFired.current = false
          return
        }
      }
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current)
        longPressTimer.current = null
      }
    },
    []
  )

  const handleDragEnd = useCallback(
    (_e: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
      // Framer Motion already keeps the element where it was dropped
      // (because dragMomentum is false). We only cancel any pending
      // long-press here so a drag does not also dismiss the widget.
      if (info.offset && (Math.abs(info.offset.x) > 4 || Math.abs(info.offset.y) > 4)) {
        if (longPressTimer.current) {
          clearTimeout(longPressTimer.current)
          longPressTimer.current = null
        }
        longPressFired.current = true
        // Reset for the next interaction
        setTimeout(() => {
          longPressFired.current = false
        }, 300)
      }
    },
    []
  )

  const defaulterAlert = floatingWidget.defaulterAlert
  const partyName = floatingWidget.partyName
  const partyAvatar = floatingWidget.partyAvatar
  const firstLetter = partyName ? partyName.charAt(0).toUpperCase() : '?'

  return (
    <AnimatePresence>
      {floatingWidget.open && (
        <motion.div
          drag
          dragMomentum={false}
          dragElastic={0.12}
          dragConstraints={{ left: -200, right: 200, top: -400, bottom: 80 }}
          onDragEnd={handleDragEnd}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 320, damping: 22 }}
          className="fixed bottom-24 right-4 z-50 select-none touch-none"
          role="button"
          aria-label={`Recognized customer ${partyName ?? 'Unknown'}. Tap to open khata. Long-press to dismiss.`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              handleTap()
            } else if (e.key === 'Escape') {
              hideFloatingWidget()
            }
          }}
          onPointerDown={(e) => startLongPress(e.clientX, e.clientY)}
          onPointerUp={(e) => cancelLongPress(e.clientX, e.clientY)}
          onPointerLeave={(e) => cancelLongPress(e.clientX, e.clientY)}
          onPointerCancel={(e) => cancelLongPress(e.clientX, e.clientY)}
          onClick={(e) => {
            // Prevent the click from also firing after a drag.
            if (longPressFired.current) {
              e.preventDefault()
              return
            }
            handleTap()
          }}
        >
          <div className="relative flex w-20 flex-col items-center gap-1.5">
            {/* Dismiss (X) button — top-right of avatar */}
            <button
              type="button"
              aria-label="Dismiss widget"
              onClick={(e) => {
                e.stopPropagation()
                hideFloatingWidget()
              }}
              className="absolute -right-0.5 -top-0.5 z-20 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background/90 text-foreground/70 shadow-md backdrop-blur transition hover:bg-background hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>

            {/* Defaulter warning badge — top-left of avatar */}
            {defaulterAlert && (
              <div className="absolute -left-1 top-1 z-20">
                <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-red-500/50 bg-red-500 text-white shadow-md">
                  <AlertTriangle className="h-3 w-3" />
                  <span className="absolute -z-10 inline-flex h-full w-full animate-ping rounded-full bg-red-500/60" />
                </span>
              </div>
            )}

            {/* Avatar with optional red pulsing ring */}
            <motion.div
              className={cn(
                'relative rounded-full',
                defaulterAlert && 'ring-2 ring-red-500/70 ring-offset-2 ring-offset-background'
              )}
              animate={
                defaulterAlert
                  ? {
                      boxShadow: [
                        '0 0 0 0 rgba(239,68,68,0.55)',
                        '0 0 0 8px rgba(239,68,68,0)',
                      ],
                    }
                  : {}
              }
              transition={
                defaulterAlert
                  ? { duration: 1.4, repeat: Infinity, ease: 'easeOut' }
                  : {}
              }
            >
              <Avatar className="h-16 w-16 border-2 border-border bg-card shadow-lg">
                {partyAvatar ? (
                  <AvatarImage src={partyAvatar} alt={partyName ?? 'Customer'} />
                ) : null}
                <AvatarFallback className="bg-emerald-500/15 text-lg font-semibold text-emerald-300">
                  {firstLetter}
                </AvatarFallback>
              </Avatar>
            </motion.div>

            {/* Name */}
            <p
              className="max-w-[5.5rem] truncate text-center text-[11px] font-medium leading-tight text-foreground"
              title={partyName ?? undefined}
            >
              {truncateName(partyName)}
            </p>

            {/* Khata balance badge */}
            <Badge
              variant="secondary"
              className="gap-1 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-500/20"
              title="Current khata balance"
            >
              <Wallet className="h-2.5 w-2.5" />
              {balance === null ? 'Khata' : formatCurrency(balance)}
            </Badge>

            {defaulterAlert && (
              <Badge
                variant="destructive"
                className="bg-red-500/15 px-1.5 py-0.5 text-[9px] font-semibold text-red-300 ring-1 ring-red-500/30"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Default
              </Badge>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
