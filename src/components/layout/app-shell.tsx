'use client'

import { useEffect, useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { TopAppBar } from './top-app-bar'
import { BottomTabNav } from './bottom-tab-nav'
import { SideDrawerFab } from './side-drawer-fab'
import { SearchOverlay } from './search-overlay'
import { DashboardView } from '@/components/views/dashboard-view'
import { KhataView } from '@/components/views/khata-view'
import { InventoryView } from '@/components/views/inventory-view'
import { BillingView } from '@/components/views/billing-view'
import { ReportsView } from '@/components/views/reports-view'
import { SettingsView } from '@/components/views/settings-view'
import { NotificationsView } from '@/components/views/notifications-view'
import { AiToolsView } from '@/components/views/ai-tools-view'
import { PaymentLandingPage } from '@/components/views/payment-landing-page'
import { SalePadView } from '@/components/views/sale-pad-view'
import { useBackButton } from '@/hooks/use-back-button'
import { FloatingInvoiceModal } from '@/components/shared/floating-invoice-modal'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'

export function AppShell() {
  const {
    activeView,
    business,
    setBusiness,
    businessLoaded,
    setBusinessLoaded,
  } = useAppStore()
  const { setLanguage } = useI18n()
  const [paymentToken, setPaymentToken] = useState<string | null>(null)

  // Android back button navigation with history back-stack (PRD Part 3 §4)
  useBackButton()

  // Check for payment landing page token in URL (?payment=TOKEN)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('payment')
    if (token) setPaymentToken(token)
  }, [])

  // Bootstrap: ensure seeded + load business + load language setting
  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        // Ensure DB has a business; seed if missing
        let biz = await fetch('/api/business').then((r) => r.json())
        if (!biz) {
          await fetch('/api/seed', { method: 'POST' })
          biz = await fetch('/api/business').then((r) => r.json())
        }
        if (!mounted) return
        setBusiness(biz)
        // load language pref
        const settings = await fetch('/api/app-settings').then((r) => r.json())
        if (settings?.language) setLanguage(settings.language)
      } catch (e) {
        console.error('Bootstrap error', e)
      } finally {
        if (mounted) setBusinessLoaded(true)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  if (!businessLoaded) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-background">
        <div className="w-14 h-14 rounded-2xl bg-primary flex items-center justify-center">
          <Loader2 className="w-7 h-7 text-primary-foreground animate-spin" />
        </div>
        <p className="text-sm text-muted-foreground">Loading BizLedger…</p>
      </div>
    )
  }

  // Payment Landing Page — public, no app chrome (PRD v2 §10.5)
  if (paymentToken) {
    return <PaymentLandingPage token={paymentToken} />
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <TopAppBar />
      <main className="flex-1 w-full max-w-2xl mx-auto px-3 sm:px-4 pb-28 pt-3">
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
      </main>
      <SideDrawerFab />
      <BottomTabNav />
      <SearchOverlay />
      <FloatingInvoiceModal />
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
    case 'ai-tools':
      return <AiToolsView />
    case 'settings':
      return <SettingsView />
    case 'notifications':
      return <NotificationsView />
    case 'sale-pad':
      return <SalePadView />
    default:
      return <DashboardView />
  }
}
