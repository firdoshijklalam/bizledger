'use client'

import { useBillingStore } from '@/store/billing-store'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Plus } from 'lucide-react'
import { useState } from 'react'
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export function BillingTabs() {
  const { tabs, activeTabId, setActiveTab, addTab, closeTab } = useBillingStore()
  const [closeConfirmId, setCloseConfirmId] = useState<string | null>(null)

  const tabToClose = tabs.find((t) => t.id === closeConfirmId)

  return (
    <>
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1 pb-1">
        {tabs.map((tab) => {
          const isActive = activeTabId === tab.id
          const label = tab.customerName
            ? tab.customerName.substring(0, 8)
            : tab.label
          return (
            <div
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`group relative shrink-0 flex items-center gap-1.5 px-3 h-9 rounded-t-lg cursor-pointer transition-colors min-w-[88px] ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {tab.hasDraft && (
                <span className={`w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-yellow-300' : 'bg-yellow-500'}`} />
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
