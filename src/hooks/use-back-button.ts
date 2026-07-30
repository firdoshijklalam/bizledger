'use client'

import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store/app-store'

/**
 * Android back button navigation with history back-stack (PRD Part 3 §4).
 * Maintains a stack of previous views. When the browser back button is pressed:
 * - If a sub-view (party detail, product profile, invoice preview) is open, go back to the parent view
 * - If a dialog/form is open, close it
 * - On dashboard, push a hash so back button shows "Exit App" confirmation
 */
export function useBackButton() {
  const {
    activeView, setActiveView,
    selectedPartyId, setSelectedPartyId,
    selectedProductId, setSelectedProductId,
    selectedInvoiceId, setSelectedInvoiceId,
    showPartyForm, setShowPartyForm,
    showProductForm, setShowProductForm,
    showInvoiceForm, setShowInvoiceForm,
    showSearch, setShowSearch,
    fabOpen, setFabOpen,
    // §OVERLAYS: Global overlay state — must be closed BEFORE sub-views.
    overlayPartyId, setOverlayPartyId,
    overlayInvoiceId, setOverlayInvoiceId,
    // §GLOBAL-MODALS: Global modal state — must be closed BEFORE view navigation.
    globalFamilyModal, closeFamilyModal,
    globalPartnerModal, closePartnerModal,
    globalFingerprintModal, closeFingerprintModal,
  } = useAppStore()

  const prevView = useRef(activeView)

  // Push hash state on navigation (enables back button interception)
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Push a state entry whenever the view changes
    if (activeView !== prevView.current) {
      window.history.pushState({ view: activeView }, '')
      prevView.current = activeView
    }
  }, [activeView])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = (e: PopStateEvent) => {
      // Priority 1: Close global modals first (they're on top of everything)
      if (globalFingerprintModal) { closeFingerprintModal(); return }
      if (globalFamilyModal) { closeFamilyModal(); return }
      if (globalPartnerModal) { closePartnerModal(); return }

      // Priority 2: Close open dialogs/overlays
      if (fabOpen) { setFabOpen(false); return }
      if (showSearch) { setShowSearch(false); return }
      if (showInvoiceForm) { setShowInvoiceForm(false); return }
      if (showPartyForm) { setShowPartyForm(false); return }
      if (showProductForm) { setShowProductForm(false); return }

      // Priority 3: Close global overlays (z-80 party, z-70 invoice)
      if (overlayPartyId) { setOverlayPartyId(null); return }
      if (overlayInvoiceId) { setOverlayInvoiceId(null); return }

      // Priority 4: Close sub-views
      if (selectedInvoiceId) { setSelectedInvoiceId(null); return }
      if (selectedProductId) { setSelectedProductId(null); return }
      if (selectedPartyId) { setSelectedPartyId(null); return }

      // If on dashboard, ask to exit
      if (activeView === 'dashboard') {
        if (confirm('Exit BizLedger?')) {
          window.history.back()
        } else {
          // Re-push state so back button works next time
          window.history.pushState({ view: 'dashboard' }, '')
        }
        return
      }

      // Otherwise go back to dashboard
      setActiveView('dashboard')
      // Re-push state to prevent immediate exit
      window.history.pushState({ view: 'dashboard' }, '')
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [
    activeView, setActiveView,
    selectedPartyId, setSelectedPartyId,
    selectedProductId, setSelectedProductId,
    selectedInvoiceId, setSelectedInvoiceId,
    showPartyForm, setShowPartyForm,
    showProductForm, setShowProductForm,
    showInvoiceForm, setShowInvoiceForm,
    showSearch, setShowSearch,
    fabOpen, setFabOpen,
    overlayPartyId, setOverlayPartyId,
    overlayInvoiceId, setOverlayInvoiceId,
    globalFamilyModal, closeFamilyModal,
    globalPartnerModal, closePartnerModal,
    globalFingerprintModal, closeFingerprintModal,
  ])
}
