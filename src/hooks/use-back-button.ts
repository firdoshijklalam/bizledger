'use client'

import { useEffect } from 'react'
import { useAppStore } from '@/store/app-store'

/**
 * Android back button navigation — single canonical implementation.
 *
 * §DESIGN (v2 — fixes the "Back always jumps to Dashboard" bug):
 *
 * We maintain our OWN navigation stack in the Zustand store (`viewStack`
 * + overlay stack) as the source of truth for what view/overlay is active.
 * The browser history is used ONLY as a trigger for popstate — we do NOT
 * rely on `history.state.view` because Next.js App Router overwrites
 * `history.state` with its own internal fields (`__NA`, `__PRIVATE_NEXTJS_...`).
 *
 * §PUSH: Every view change + overlay open pushes a marker entry onto the
 * browser history (just `{}` — content doesn't matter) AND records the
 * logical state in our store's `navStack`.
 *
 * §POP: When popstate fires, we pop our `navStack` and restore the previous
 * logical state. We do NOT re-push (the browser already moved back).
 *
 * §OVERLAY-PRIORITY: When closing overlays on popstate, close in reverse
 * z-index order: global modals (z-200) → dialogs (z-50) → party overlay
 * (z-80) → invoice overlay (z-70) → sub-view selections.
 *
 * §EXIT: On dashboard with no overlays and empty navStack, allow the
 * browser to exit the app naturally (do NOT re-push).
 *
 * §CANONICAL: All view navigation goes through `setActiveView` (tab
 * switches — pushes history so Back returns). `navigateTo` is an alias
 * that also records to `viewStack` for the legacy goBack() API.
 */

// §NAV-STACK: Parallel to browser history. Each entry describes what was
// pushed: { type: 'view', view } or { type: 'overlay', overlay }.
// This survives Next.js overwriting history.state.
type NavEntry =
  | { type: 'view'; view: string }
  | { type: 'overlay'; overlay: string }

const navStack: NavEntry[] = []
// §NAV-GUARD: When the popstate handler restores state, it sets this flag
// so the subscribe handler doesn't push a duplicate entry.
let isRestoringFromHistory = false

export function useBackButton() {

  // Push initial marker on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    // Replace the current entry with our marker so Back has something to pop.
    // We use replaceState (not pushState) so we don't add a duplicate entry.
    // The state content is empty — we track logical state in navStack.
    window.history.replaceState({ app: 'bizledger', initial: true }, '')
    navStack.length = 0
    navStack.push({ type: 'view', view: 'dashboard' })
  }, [])

  // Watch for view + overlay state changes and push history entries.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const unsub = useAppStore.subscribe((state, prev) => {
      if (isRestoringFromHistory) return

      // Push state when activeView changes.
      if (state.activeView !== prev.activeView) {
        navStack.push({ type: 'view', view: state.activeView })
        window.history.pushState({ app: 'bizledger' }, '')
      }

      // §OVERLAY-OPEN: Push when an overlay/dialog opens (null → non-null).
      // Only push for OPENING — closing is handled lazily by popstate (the
      // stale entry is consumed on the next Back press, at which point the
      // overlay is already closed and the popstate close-check is a no-op).
      //
      // §DESIGN-NOTE: We intentionally do NOT call history.back() when an
      // overlay closes via UI. The previous 0f270f3 commit tried that, but
      // it broke the common "close overlay + navigate" pattern (e.g. party
      // detail → Quick Sale) where setOverlayPartyId(null) and
      // setActiveView('sale-pad') are batched in one state update. The
      // history.back() + early return caused the view change to be skipped
      // from the navStack, leaving the app in a broken state. Leaving the
      // stale entry is the safer trade-off: the next Back press consumes
      // it as a no-op close, which is correct browser behavior.
      if (!prev.overlayPartyId && state.overlayPartyId) {
        navStack.push({ type: 'overlay', overlay: 'party' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.overlayInvoiceId && state.overlayInvoiceId) {
        navStack.push({ type: 'overlay', overlay: 'invoice' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.showSearch && state.showSearch) {
        navStack.push({ type: 'overlay', overlay: 'search' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.showPartyForm && state.showPartyForm) {
        navStack.push({ type: 'overlay', overlay: 'party-form' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.showProductForm && state.showProductForm) {
        navStack.push({ type: 'overlay', overlay: 'product-form' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.showInvoiceForm && state.showInvoiceForm) {
        navStack.push({ type: 'overlay', overlay: 'invoice-form' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.fabOpen && state.fabOpen) {
        navStack.push({ type: 'overlay', overlay: 'fab' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.globalFamilyModal && state.globalFamilyModal) {
        navStack.push({ type: 'overlay', overlay: 'family-modal' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.globalPartnerModal && state.globalPartnerModal) {
        navStack.push({ type: 'overlay', overlay: 'partner-modal' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
      if (!prev.globalFingerprintModal && state.globalFingerprintModal) {
        navStack.push({ type: 'overlay', overlay: 'fingerprint-modal' })
        window.history.pushState({ app: 'bizledger' }, '')
      }
    })

    return () => unsub()
  }, [])

  // Popstate handler — pops our navStack and restores the previous state.
  useEffect(() => {
    if (typeof window === 'undefined') return

    const handlePopState = () => {
      const state = useAppStore.getState()

      // §SUB-VIEW-CLOSE: Sub-views (selectedPartyId, selectedInvoiceId,
      // selectedProductId) render WITHIN a view (e.g. party detail inside
      // Khata). They do NOT push their own history entries. When the user
      // presses Back from a sub-view, the browser goes back to the previous
      // view entry. We must close the sub-view and re-push a history entry
      // so the user stays on the same view (instead of going to the previous
      // view). This mirrors the original 1cf7c96 Priority 4 behavior.
      // §GUARD: Only handle if a sub-view is open AND the navStack top is a
      // view (not an overlay) — otherwise we'd interfere with overlay close.
      const navTop = navStack[navStack.length - 1]
      if (navTop?.type === 'view') {
        if (state.selectedPartyId) {
          state.setSelectedPartyId(null)
          // Re-push so the browser stays on the current view.
          navStack.push({ type: 'view', view: state.activeView })
          window.history.pushState({ app: 'bizledger' }, '')
          return
        }
        if (state.selectedInvoiceId) {
          state.setSelectedInvoiceId(null)
          navStack.push({ type: 'view', view: state.activeView })
          window.history.pushState({ app: 'bizledger' }, '')
          return
        }
        if (state.selectedProductId) {
          state.setSelectedProductId(null)
          navStack.push({ type: 'view', view: state.activeView })
          window.history.pushState({ app: 'bizledger' }, '')
          return
        }
      }

      // Pop the current entry (the one we're leaving).
      const leaving = navStack.pop()

      // §OVERLAY-CLOSE: If we're leaving an overlay, close it. The previous
      // entry (now top of stack) is what we restore to.
      if (leaving?.type === 'overlay') {
        switch (leaving.overlay) {
          case 'fingerprint-modal':
            if (state.globalFingerprintModal) state.closeFingerprintModal()
            break
          case 'family-modal':
            if (state.globalFamilyModal) state.closeFamilyModal()
            break
          case 'partner-modal':
            if (state.globalPartnerModal) state.closePartnerModal()
            break
          case 'fab':
            if (state.fabOpen) state.setFabOpen(false)
            break
          case 'search':
            if (state.showSearch) state.setShowSearch(false)
            break
          case 'invoice-form':
            if (state.showInvoiceForm) state.setShowInvoiceForm(false)
            break
          case 'party-form':
            if (state.showPartyForm) state.setShowPartyForm(false)
            break
          case 'product-form':
            if (state.showProductForm) state.setShowProductForm(false)
            break
          case 'party':
            if (state.overlayPartyId) state.setOverlayPartyId(null)
            break
          case 'invoice':
            if (state.overlayInvoiceId) state.setOverlayInvoiceId(null)
            break
        }
        // The previous entry is the underlying view — it's already active.
        // No view change needed.
        return
      }

      // §VIEW-RESTORE: We're leaving a view entry. Restore the previous
      // entry (now top of stack). If stack is empty, we're at the initial
      // dashboard — allow app exit.
      const target = navStack[navStack.length - 1]

      if (target?.type === 'view') {
        if (target.view !== state.activeView) {
          isRestoringFromHistory = true
          state.setActiveView(target.view as any)
          isRestoringFromHistory = false
        }
        return
      }

      if (target?.type === 'overlay') {
        // Restoring to an overlay — shouldn't normally happen because
        // overlay-close is handled above. But if it does, just stay.
        return
      }

      // §EXIT: navStack is empty. We're at the initial dashboard with no
      // overlays. Let the browser handle Back naturally — it will exit the
      // app or go to the previous site. We do NOT re-push (that would trap
      // the user in the app and make Back never exit).
      if (state.activeView === 'dashboard') {
        return
      }

      // §FALLBACK: On a non-dashboard view with empty stack — go to dashboard.
      isRestoringFromHistory = true
      state.setActiveView('dashboard')
      isRestoringFromHistory = false
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])
}
