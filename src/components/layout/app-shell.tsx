'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { TopAppBar } from './top-app-bar'
import { BottomTabNav } from './bottom-tab-nav'
import { SideDrawerFab } from './side-drawer-fab'
import { FloatingKeyboardMic } from './floating-keyboard-mic'
import { SearchOverlay } from './search-overlay'
import { DashboardView } from '@/components/views/dashboard-view'
import { KhataView } from '@/components/views/khata-view'
import { InventoryView } from '@/components/views/inventory-view'
import { BillingView } from '@/components/views/billing-view'
import { ReportsView } from '@/components/views/reports-view'
import { TransactionHistoryView } from '@/components/views/transaction-history-view'
import { SettingsView } from '@/components/views/settings-view'
import { NotificationsView } from '@/components/views/notifications-view'
import { AiToolsView } from '@/components/views/ai-tools-view'
import { PaymentLandingPage } from '@/components/views/payment-landing-page'
import { SalePadView } from '@/components/views/sale-pad-view'
import { SourcingView } from '@/components/views/sourcing-view'
import { StaffManagementView } from '@/components/views/staff-management-view'
import { OnlineOrdersView } from '@/components/views/online-orders-view'
import { FulfillmentView } from '@/components/views/fulfillment-view'
import { StoreCatalogView } from '@/components/views/store-catalog-view'
import { CentralCatalogView } from '@/components/views/central-catalog-view'  // Part 36
import { MoreShopsView } from '@/components/views/more-shops-view'
import { VisitedShopsDeck } from '@/components/views/visited-shops-deck'
import { useBackButton } from '@/hooks/use-back-button'
import { useAntiTamper } from '@/hooks/use-anti-tamper'
import { useKeyboardVisibility } from '@/hooks/use-keyboard-visibility'
import { useAutoScrollToFocus } from '@/hooks/use-auto-scroll-to-focus'
import { FloatingInvoiceModal } from '@/components/shared/floating-invoice-modal'
import { BiometricGateModal } from '@/components/shared/biometric-gate-modal'
import { FloatingCustomerWidget } from '@/components/shared/floating-customer-widget'
import { ExternalScannerSimulator } from '@/components/shared/external-scanner-simulator'
import { GlobalModalProvider } from '@/components/shared/global-modal-provider'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { PartyDetail } from '@/components/views/khata/party-detail'
import { InvoicePreview } from '@/components/views/billing/invoice-preview'

export function AppShell() {
  const {
    activeView,
    business,
    setBusiness,
    businessLoaded,
    setBusinessLoaded,
    overlayPartyId,
    setOverlayPartyId,
    overlayInvoiceId,
    setOverlayInvoiceId,
  } = useAppStore()
  const { setLanguage } = useI18n()
  const [paymentToken, setPaymentToken] = useState<string | null>(() => { if (typeof window === 'undefined') return null; return new URLSearchParams(window.location.search).get('payment') })
  // PRD Part 33: public store / more-shops / visited-shops URL routing
  // Use lazy initializers to read URL params on first render (before businessLoaded check)
  const [storeSlug, setStoreSlug] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('store')
  })
  const [storeInvoiceToken, setStoreInvoiceToken] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return new URLSearchParams(window.location.search).get('invoice')
  })
  const [showMoreShops, setShowMoreShops] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!new URLSearchParams(window.location.search).get('more-shops')
  })
  const [showVisitedDeck, setShowVisitedDeck] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!new URLSearchParams(window.location.search).get('visited')
  })
  // PRD Part 36: public central marketplace catalog (?marketplace=1)
  const [showMarketplace, setShowMarketplace] = useState(() => {
    if (typeof window === 'undefined') return false
    return !!new URLSearchParams(window.location.search).get('marketplace')
  })

  // Android back button navigation with history back-stack (PRD Part 3 §4)
  useBackButton()

  // §GLOBAL-KEYBOARD-SYNC: Track focusin/focusout globally to sync mic
  // visibility with the virtual keyboard. The mic appears for ANY text
  // input/textarea that receives focus, not just those with useVoiceInput.
  useKeyboardVisibility()

  // §AUTO-SCROLL-TO-FOCUS: When any input/textarea receives focus, scroll
  // it to the center of the visible viewport so it's not hidden by the
  // keyboard. Works for both dialogs (FormDialogContent) and full-screen
  // views. Finds the nearest scrollable ancestor and scrolls THAT.
  useAutoScrollToFocus()

  // PRD Part 38 §4.2: Manual scroll restoration — prevent browser from jumping to top
  useEffect(() => {
    if (typeof window === 'undefined') return
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }
    return () => {
      if ('scrollRestoration' in window.history) {
        window.history.scrollRestoration = 'auto'
      }
    }
  }, [])

  // PRD Part 34 Threat 1: Anti-tamper & root detection (runs on mount + every 5min)
  useAntiTamper()

  // PRD Part 36: Re-check URL params after hydration (lazy init handles client-side first render,
  // but this ensures the state is set even after SSR hydration)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    if (params.get('marketplace')) setShowMarketplace(true)
    if (params.get('store')) setStoreSlug(params.get('store'))
    if (params.get('more-shops')) setShowMoreShops(true)
    if (params.get('visited')) setShowVisitedDeck(true)
    if (params.get('payment')) setPaymentToken(params.get('payment'))
  }, [])

  // Bootstrap: ensure seeded + load business + load language setting
  // Includes retry logic for sandbox environment where server may be temporarily unavailable
  useEffect(() => {
    let mounted = true
    let retryCount = 0

    const bootstrap = async () => {
      try {
        let biz = await fetch('/api/business').then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.json()
        })
        if (!biz) {
          await fetch('/api/seed', { method: 'POST' })
          biz = await fetch('/api/business').then((r) => r.json())
        }
        if (!mounted) return
        setBusiness(biz)
        const settings = await fetch('/api/app-settings').then((r) => r.json())
        if (settings?.language) setLanguage(settings.language)
        if (mounted) setBusinessLoaded(true)
      } catch (e) {
        console.error('Bootstrap error (attempt ' + (retryCount + 1) + ')', e)
        if (retryCount < 5 && mounted) {
          retryCount++
          setTimeout(bootstrap, 1000 * Math.pow(2, retryCount - 1))
          return
        }
        if (mounted) setBusinessLoaded(true)
      }
    }

    bootstrap()
    return () => {
      mounted = false
    }
  }, [])

  // PRD Part 33: Public pages render immediately — no business loading required
  // Payment Landing Page — public, no app chrome (PRD v2 §10.5)
  if (paymentToken) {
    return <PaymentLandingPage token={paymentToken} />
  }

  // PRD Part 33 §1-2: Public store catalog — customer-facing, no app chrome
  if (storeSlug) {
    return <StoreCatalogView slug={storeSlug as string} invoiceToken={storeInvoiceToken ?? undefined} />
  }

  // PRD Part 36 §1: Public hyperlocal marketplace — customer-facing, no app chrome
  if (showMarketplace) {
    return <CentralCatalogView />
  }

  // PRD Part 33 §3: More Shops discovery — public, no app chrome
  if (showMoreShops) {
    return <MoreShopsView />
  }

  // PRD Part 33 §2.2: Visited Shops deck — public, no app chrome
  if (showVisitedDeck) {
    return <VisitedShopsDeck />
  }

  if (!businessLoaded) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 bg-background" style={{ minHeight: '100dvh' }}>
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-primary-foreground animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Loading BizLedger…</p>
        <p className="text-[10px] text-muted-foreground/50">v7.2 · Part 1-7 Complete</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col bg-background" style={{ minHeight: '100dvh' }}>
      <TopAppBar />
      <main
        className="flex-1 w-full max-w-2xl mx-auto px-3 sm:px-4 pb-28 pt-3"
        style={{ overflowAnchor: 'none' }}
      >
        {/* §1: SalePad is ALWAYS mounted (display:none when inactive) to preserve cart state.
            All other views use AnimatePresence for transitions. */}
        <div style={{ display: activeView === 'sale-pad' ? 'block' : 'none' }}>
          <SalePadView />
        </div>
        {activeView !== 'sale-pad' && (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              {renderView(activeView)}
            </motion.div>
          </AnimatePresence>
        )}
      </main>
      <SideDrawerFab />
      <BottomTabNav />
      <SearchOverlay />
      <FloatingKeyboardMic />
      <FloatingInvoiceModal />

      {/* §2: Global overlay stack — Invoice overlay (z-70) below Party overlay (z-80).
          This creates a proper push stack: Dashboard → Invoice → Party Profile.
          Back from Party → returns to Invoice. Back from Invoice → returns to Dashboard. */}
      <AnimatePresence>
        {overlayInvoiceId && (
          <motion.div
            key="overlay-invoice"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-0 z-[70] bg-background overflow-y-auto pb-[50vh]"
          >
            <InvoicePreview invoiceId={overlayInvoiceId} />
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {overlayPartyId && (
          <motion.div
            key="overlay-party"
            initial={{ opacity: 0, x: 30 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 30 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed inset-0 z-[80] bg-background overflow-y-auto pb-[50vh]"
          >
            <PartyDetail partyId={overlayPartyId} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* PRD Part 32: Biometric ecosystem — global overlays */}
      <BiometricGateModal />
      <FloatingCustomerWidget />
      <ExternalScannerSimulator />

      {/* §GLOBAL-MODALS: Family / Partner / Fingerprint modals rendered at
          app root. These modals are triggered via global state (Zustand)
          and render via Radix Dialog portals to document.body with z-[200].
          This ensures they ALWAYS appear on top of ALL overlays (party z-80,
          invoice z-70) regardless of how deep the user navigated. */}
      <GlobalModalProvider />
    </div>
  )
}

function renderView(view: string) {
  switch (view) {
    case 'dashboard':
      return <DashboardView />
    case 'khata':
      return <KhataView />
    case 'inventory':
      return <InventoryView />
    case 'billing':
      return <BillingView />
    case 'reports':
      return <ReportsView />
    case 'history':
      return <TransactionHistoryView />
    case 'ai-tools':
      return <AiToolsView />
    case 'settings':
      return <SettingsView />
    case 'notifications':
      return <NotificationsView />
    // §1: sale-pad is rendered separately (always mounted) — not here
    case 'sourcing':
      return <SourcingView />
    case 'online-orders':
      return <OnlineOrdersView />
    case 'fulfillment':
      return <FulfillmentView />
    case 'staff':
      return <StaffManagementView />
    default:
      return <DashboardView />
  }
}
