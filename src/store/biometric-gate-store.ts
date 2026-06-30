'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * PRD Part 32 §1: Biometric Action Gate Store
 *
 * Manages the central biometric gate modal that pops up at 5 critical action gates:
 * 1. owner_switch     — Owner Mode Re-switching
 * 2. high_value_discount — Discount above ₹ limit (default 5000)
 * 3. data_export      — JSON/CSV export or Telegram backup
 * 4. inventory_price  — Purchase price / bulk stock edit
 * 5. danger_zone      — Demo reset or khata delete
 *
 * PIN fallback: 2 wrong attempts → 2-minute lockdown + Telegram alert.
 */

export type GateType =
  | 'owner_switch'
  | 'high_value_discount'
  | 'data_export'
  | 'inventory_price'
  | 'danger_zone'

export interface GateConfig {
  gateOwnerSwitch: boolean
  gateHighValueDiscount: boolean
  gateDiscountLimit: number
  gateDataExport: boolean
  gateInventoryPrice: boolean
  gateDangerZone: boolean
  externalScannerEnabled: boolean
  defaulterRegistryEnabled: boolean
}

interface PendingGate {
  gateType: GateType
  description: string
  // called when biometric / PIN verified successfully
  onSuccess: () => void
  // called when user cancels
  onCancel?: () => void
}

interface BiometricGateState {
  // currently open gate (null if closed)
  openGate: PendingGate | null
  // number of failed attempts in this session
  failedAttempts: number
  // ISO timestamp until which the gate is locked down
  lockdownUntil: number | null
  // last verification result for audit
  lastResult: 'success' | 'failed' | 'locked' | null
  // floating customer widget state (PRD Part 32 §2.2)
  floatingWidget: {
    open: boolean
    partyId: string | null
    partyName: string | null
    partyAvatar?: string | null
    defaulterAlert?: { amount: number; merchantName: string } | null
  }
  // trigger a verification flow
  requestGate: (gate: {
    gateType: GateType
    description: string
    onSuccess: () => void
    onCancel?: () => void
  }) => void
  // called by the modal when verification succeeds
  resolveSuccess: () => void
  // called by the modal when user cancels
  resolveCancel: () => void
  // called by the modal when an attempt fails
  registerFailure: () => void
  // clear lockdown (after timeout)
  clearLockdown: () => void
  // floating widget actions
  showFloatingWidget: (data: {
    partyId: string
    partyName: string
    partyAvatar?: string | null
    defaulterAlert?: { amount: number; merchantName: string } | null
  }) => void
  hideFloatingWidget: () => void
}

export const useBiometricGateStore = create<BiometricGateState>()(
  persist(
    (set, get) => ({
      openGate: null,
      failedAttempts: 0,
      lockdownUntil: null,
      lastResult: null,
      floatingWidget: {
        open: false,
        partyId: null,
        partyName: null,
        partyAvatar: null,
        defaulterAlert: null,
      },

      requestGate: ({ gateType, description, onSuccess, onCancel }) => {
        // if under lockdown, block immediately
        const lockdownUntil = get().lockdownUntil
        if (lockdownUntil && Date.now() < lockdownUntil) {
          // still locked — don't open modal, but call cancel
          onCancel?.()
          return
        }
        set({
          openGate: { gateType, description, onSuccess, onCancel },
          lastResult: null,
        })
      },

      resolveSuccess: () => {
        const gate = get().openGate
        set({
          openGate: null,
          failedAttempts: 0,
          lockdownUntil: null,
          lastResult: 'success',
        })
        gate?.onSuccess()
      },

      resolveCancel: () => {
        const gate = get().openGate
        set({
          openGate: null,
          failedAttempts: 0,
          lastResult: null,
        })
        gate?.onCancel?.()
      },

      registerFailure: () => {
        const newFails = get().failedAttempts + 1
        if (newFails >= 2) {
          // 2-min lockdown
          const until = Date.now() + 2 * 60 * 1000
          set({
            failedAttempts: 0,
            lockdownUntil: until,
            openGate: null,
            lastResult: 'locked',
          })
          // also call onCancel so caller knows it was aborted
          get().openGate?.onCancel?.()
        } else {
          set({ failedAttempts: newFails, lastResult: 'failed' })
        }
      },

      clearLockdown: () => set({ lockdownUntil: null, failedAttempts: 0 }),

      showFloatingWidget: (data) =>
        set({
          floatingWidget: {
            open: true,
            partyId: data.partyId,
            partyName: data.partyName,
            partyAvatar: data.partyAvatar ?? null,
            defaulterAlert: data.defaulterAlert ?? null,
          },
        }),

      hideFloatingWidget: () =>
        set({
          floatingWidget: {
            open: false,
            partyId: null,
            partyName: null,
            partyAvatar: null,
            defaulterAlert: null,
          },
        }),
    }),
    {
      name: 'bizledger-biometric-gate',
      // don't persist functions / openGate (callback closures can't serialize)
      partialize: (state) => ({
        lockdownUntil: state.lockdownUntil,
      }),
    }
  )
)

/**
 * Helper hook: returns a function to trigger a gate.
 * Usage:
 *   const triggerGate = useGateTrigger()
 *   triggerGate('data_export', 'Export 245 invoices to JSON', () => doExport())
 */
export function useGateTrigger() {
  const requestGate = useBiometricGateStore((s) => s.requestGate)
  return (
    gateType: GateType,
    description: string,
    onSuccess: () => void,
    onCancel?: () => void
  ) => requestGate({ gateType, description, onSuccess, onCancel })
}
