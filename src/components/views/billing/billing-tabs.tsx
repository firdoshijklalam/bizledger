'use client'

import { useBillingStore } from '@/store/billing-store'
import { useCartStore } from '@/store/cart-store'
import { useAppStore } from '@/store/app-store'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

export function BillingTabs() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab, updateTab } = useBillingStore()
  const { setShowInvoiceForm, navigateTo } = useAppStore()
  const { setCarts, setActiveCartId, clearBillingState } = useCartStore()
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null)

  const tabToClose = tabs.find((t) => t.id === closeConfirmId)

  // §1: Clicking a draft chip loads that cart into Quick Sale
  const handleTabClick = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId)
    if (!tab) return
    setActiveTab(tabId)

    // §1: If this tab has a draft, load it into Quick Sale cart store and navigate
    if (tab.hasDraft && tab.items.length > 0) {
      // Load the draft items into the global cart store
      const cartItems = tab.items.map((item, i) => ({
        cartKey: `${tab.id}-${i}`,
        productId: item.productId || '',
        name: item.name,
        unit: 'pcs',
        price: item.unitPrice,
        quantity: item.quantity,
        qtyStr: String(item.quantity),
        total: item.total,
        manualOverride: false,
        gstRate: item.gstRate || 0,
        mrp: 0,
        retailMrp: 0,
        itemGstEnabled: item.gstRate > 0,
        itemGstRate: item.gstRate || 0,
        itemGstManuallyDisabled: false,
        itemMode: 'retail' as const,
      }))

      // Set the cart in the global store
      setCarts([{
        id: 1,
        label: tab.customerName || tab.label,
        items: cartItems,
        customer: tab.customerId ? { id: tab.customerId, name: tab.customerName || '' } as any : null,
        paymentMode: (tab.paymentMode as any) || 'cash',
      }])
      setActiveCartId(1)

      // Navigate to Quick Sale
      navigateTo('sale-pad')
      toast.success(`${tab.customerName || tab.label}-এর বিল লোড হয়েছে`)
    } else if (tab?.hasDraft) {
      setShowInvoiceForm(true)
    }
  }

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id
          // §1: Dynamic naming — show customer name if selected, otherwise label
          const label = tab.customerName
            ? tab.customerName.length > 10
              ? tab.customerName.substring(0, 10) + '…'
              : tab.customerName
            : tab.label
          return (
            <div
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`group relative shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-t-lg cursor-pointer transition-colors min-w-[88px] ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {/* §2: Pulse animation on incomplete drafts */}
              {tab.hasDraft && (
                <motion.span
                  className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-yellow-300' : 'bg-yellow-500'}`}
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <span className="text-xs font-medium truncate flex-1">{label}</span>
              {tabs.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    if (tab.hasDraft) {
                      setCloseConfirmId(tab.id)
                    } else {
                      closeTab(tab.id)
                    }
                  }}
                  className={`shrink-0 rounded-full p-0.5 ${isActive ? 'hover:bg-white/20' : 'hover:bg-background'}`}
                  aria-label="Close tab"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
              {isActive && (
                <motion.div
                  layoutId="billing-active-tab"
                  className="absolute -bottom-1 inset-x-0 h-0.5 bg-primary"
                />
              )}
            </div>
          )
        })}
        {tabs.length < 5 && (
          <button
            onClick={() => addTab()}
            className="shrink-0 w-9 h-9 rounded-lg bg-muted hover:bg-accent flex items-center justify-center"
            aria-label="Add tab"
          >
            <Plus className="w-4 h-4" />
          </button>
        )}
      </div>

      <AlertDialog open={!!closeConfirmId} onOpenChange={(o) => !o && setCloseConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>এই বিল বাতিল করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              {tabToClose?.customerName || tabToClose?.label}-এর হোল্ড করা বিলে {tabToClose?.items.length || 0}টি পণ্য আছে। এটি মুছে ফেললে আর ফিরে পাবেন না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (closeConfirmId) closeTab(closeConfirmId); setCloseConfirmId(null) }}
            >
              Discard Bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
