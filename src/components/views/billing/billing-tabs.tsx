'use client'

import { useBillingStore } from '@/store/billing-store'
import { useCartStore, type HeldCart } from '@/store/cart-store'
import { useAppStore } from '@/store/app-store'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'
import { formatCurrency } from '@/lib/utils'

export function BillingTabs() {
  // §2: Read from cart-store (same as Quick Sale) — real-time sync
  const carts = useCartStore(s => s.carts)
  const setActiveCartId = useCartStore(s => s.setActiveCartId)
  const setCarts = useCartStore(s => s.setCarts)
  const business = useAppStore(s => s.business)
  const navigateTo = useAppStore(s => s.navigateTo)

  const [closeConfirmCartId, setCloseConfirmCartId] = useState<number | null>(null)
  const currency = business?.currency || 'INR'

  // §2: Render draft chips from cart-store carts (same source as Quick Sale)
  const draftCarts = carts.filter(c => c.items.length > 0 || c.customer)

  const handleDraftClick = (cart: HeldCart) => {
    // §2: Load this cart into Quick Sale and navigate there
    setActiveCartId(cart.id)
    navigateTo('sale-pad')
    toast.success(`${cart.customer?.name || 'কার্ট'} লোড হয়েছে`)
  }

  const handleRemoveDraft = (cartId: number) => {
    if (carts.length <= 1) {
      // Reset to empty
      setCarts([{ id: 1, label: 'পার্সন ১', items: [], customer: null, paymentMode: 'cash' }])
      setActiveCartId(1)
    } else {
      const newCarts = carts.filter(c => c.id !== cartId)
      setCarts(newCarts)
      setActiveCartId(newCarts[0].id)
    }
    setCloseConfirmCartId(null)
  }

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {/* §2: Render from cart-store — real-time sync with Quick Sale */}
        {draftCarts.map((cart, idx) => {
          const label = cart.customer?.name
            ? (cart.customer.name.length > 10 ? cart.customer.name.substring(0, 10) + '…' : cart.customer.name)
            : `পার্সন ${carts.indexOf(cart) + 1}`
          const itemCount = cart.items.length
          const cartTotal = cart.items.reduce((s, i) => s + i.total, 0)

          return (
            <div
              key={cart.id}
              onClick={() => handleDraftClick(cart)}
              className="group relative shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-t-lg cursor-pointer transition-colors min-w-[88px] bg-muted text-muted-foreground hover:bg-accent"
            >
              {/* §2: Pulse animation on incomplete drafts */}
              {itemCount > 0 && (
                <motion.span
                  className="w-2 h-2 rounded-full shrink-0 bg-yellow-500"
                  animate={{ scale: [1, 1.4, 1], opacity: [1, 0.6, 1] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                />
              )}
              <span className="text-xs font-medium truncate flex-1">{label}</span>
              {itemCount > 0 && (
                <span className="text-[10px] tabular text-muted-foreground">{formatCurrency(cartTotal, currency)}</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); setCloseConfirmCartId(cart.id) }}
                className="shrink-0 rounded-full p-0.5 hover:bg-background"
                aria-label="Close tab"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )
        })}

        {/* Show empty state if no drafts */}
        {draftCarts.length === 0 && (
          <p className="text-[11px] text-muted-foreground px-1 py-2">কোনো হোল্ড করা বিল নেই</p>
        )}

        {/* Add new draft button — opens Quick Sale */}
        <button
          onClick={() => navigateTo('sale-pad')}
          className="shrink-0 w-9 h-9 rounded-lg bg-muted hover:bg-accent flex items-center justify-center"
          aria-label="Add new draft"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      <AlertDialog open={!!closeConfirmCartId} onOpenChange={(o) => !o && setCloseConfirmCartId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>এই বিল বাতিল করবেন?</AlertDialogTitle>
            <AlertDialogDescription>
              এই হোল্ড করা বিলে {carts.find(c => c.id === closeConfirmCartId)?.items.length || 0}টি পণ্য আছে। এটি মুছে ফেললে আর ফিরে পাবেন না।
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (closeConfirmCartId) handleRemoveDraft(closeConfirmCartId) }}
            >
              Discard Bill
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
