'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'

/**
 * Android back button navigation with history back-stack.
 *
 * §FIX: Completely rewritten to properly handle overlays and dialogs.
 * The previous version only pushed state when `activeView` changed —
 * opening overlays (party/invoice) didn't push state, so pressing back
 * skipped steps and landed on Dashboard.
 *
 * §NEW-APPROACH:
 * 1. Push an initial state on mount.
 * 2. Push state whenever ANY overlay/dialog opens (not just view changes).
 * 3. On popstate, close the topmost overlay/dialog in priority order.
 * 4. After closing via popstate, re-push state so the user can press
 *    back again to go further (doesn't exit the app prematurely).
 * 5. Use a ref-based handler that reads latest state via getState()
 *    so the effect doesn't re-run on every state change.
 */

export function useBackButton() {
  const prevView = useRef<string>('')

  // Push initial state on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.history.pushState({ view: 'dashboard', initial: true }, '')
    prevView.current = useAppStore.getState().activeView
  }, [])

  // Watch for overlay/dialog state changes and push history entries
  useEffect(() => {
    if (typeof window === 'undefined') return

    const unsub = useAppStore.subscribe((state, prev) => {
      // Push state when any overlay/dialog opens (null → non-null)
      const openedOverlays: string[] = []
      if (!prev.overlayPartyId && state.overlayPartyId) openedOverlays.push('party-overlay')
      if (!prev.overlayInvoiceId && state.overlayInvoiceId) openedOverlays.push('invoice-overlay')
      if (!prev.showSearch && state.showSearch) openedOverlays.push('search')
      if (!prev.showPartyForm && state.showPartyForm) openedOverlays.push('party-form')
      if (!prev.showProductForm && state.showProductForm) openedOverlays.push('product-form')
      if (!prev.showInvoiceForm && state.showInvoiceForm) openedOverlays.push('invoice-form')
      if (!prev.fabOpen && state.fabOpen) openedOverlays.push('fab')
      if (!prev.globalFamilyModal && state.globalFamilyModal) openedOverlays.push('family-modal')
      if (!prev.globalPartnerModal && state.globalPartnerModal) openedOverlays.push('partner-modal')
      if (!prev.globalFingerprintModal && state.globalFingerprintModal) openedOverlays.push('fingerprint-modal')

      // Push state when view changes
      if (state.activeView !== prevView.current) {
        window.history.pushState({ view: state.activeView }, '')
        prevView.current = state.activeView
      }

      // Push state for each overlay that opened
      for (const overlay of openedOverlays) {
        window.history.pushState({ overlay }, '')
      }
    })

    return () => unsub()
  }, [])

  // Popstate handler — uses getState() so it always reads latest state
  useEffect(() => {
    if (typeof window === 'undefined') return

    let isExiting = false

    const handlePopState = () => {
      // §SKIP: If we just confirmed exit, let the browser handle it
      if (isExiting) return

      const state = useAppStore.getState()

      // Priority 1: Close global modals first
      if (state.globalFingerprintModal) { state.closeFingerprintModal(); rePush(); return }
      if (state.globalFamilyModal) { state.closeFamilyModal(); rePush(); return }
      if (state.globalPartnerModal) { state.closePartnerModal(); rePush(); return }

      // Priority 2: Close dialogs
      if (state.fabOpen) { state.setFabOpen(false); rePush(); return }
      if (state.showSearch) { state.setShowSearch(false); rePush(); return }
      if (state.showInvoiceForm) { state.setShowInvoiceForm(false); rePush(); return }
      if (state.showPartyForm) { state.setShowPartyForm(false); rePush(); return }
      if (state.showProductForm) { state.setShowProductForm(false); rePush(); return }

      // Priority 3: Close global overlays (party z-80, then invoice z-70)
      if (state.overlayPartyId) { state.setOverlayPartyId(null); rePush(); return }
      if (state.overlayInvoiceId) { state.setOverlayInvoiceId(null); rePush(); return }

      // Priority 4: Close sub-views
      if (state.selectedInvoiceId) { state.setSelectedInvoiceId(null); rePush(); return }
      if (state.selectedProductId) { state.setSelectedProductId(null); rePush(); return }
      if (state.selectedPartyId) { state.setSelectedPartyId(null); rePush(); return }

      // Priority 5: On dashboard, ask to exit
      if (state.activeView === 'dashboard') {
        if (confirm('Exit BizLedger?')) {
          isExiting = true
          // Let the browser go back naturally — don't re-push
          return
        } else {
          rePush()
          return
        }
      }

      // Priority 6: Go back to dashboard
      state.setActiveView('dashboard')
      rePush()
    }

    // §RE-PUSH: After closing an overlay via popstate, re-push state so
    // the user can press back again without exiting the app.
    const rePush = () => {
      window.history.pushState({ view: useAppStore.getState().activeView }, '')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
}
