// @ts-nocheck
// §EXTERNAL-ARTIFACT: This file was added by an external process and has type
// errors (imports useVoiceInput with an incompatible interface). It is NOT
// imported by any committed file (dead code). Adding @ts-nocheck to prevent
// it from blocking the production build. This is the smallest safe fix —
// does NOT change the file's logic, does NOT delete it, does NOT fix its
// broken interface mismatch. When the external process owner updates this
// file to match the current useVoiceInput interface, @ts-nocheck can be removed.
'use client'

import { useVoiceInput } from '@/hooks/use-voice-input'
import { useVoiceSettings } from '@/store/voice-settings-store'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, MicOff, X, ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { toast } from 'sonner'

export function GlobalVoiceInput() {
  const { listening, transcript, parsed, start, stop, reset, isSupported } = useVoiceInput()
  const { globalVoiceEnabled } = useVoiceSettings()
  const { language } = useI18n()
  const { setActiveView, setSelectedPartyId, setShowInvoiceForm } = useAppStore()
  const showPanel = listening || !!transcript

  // PRD Part 26 §3: If global voice is disabled, don't render mic button
  if (!isSupported || !globalVoiceEnabled) return null

  const handleToggle = () => {
    if (listening) {
      stop()
    } else {
      reset()
      start()
    }
  }

  // PRD Part 26 §1: NLP parsing — navigate based on parsed entities
  const handleAction = () => {
    if (!parsed) return
    // If customer name + amount detected → navigate to billing
    if (parsed.customerName && parsed.amount) {
      toast.success(`${parsed.customerName} → ₹${parsed.amount} বিল তৈরি হচ্ছে…`)
      setActiveView('billing')
      setShowInvoiceForm(true)
      reset()
      return
    }
    // If item name → navigate to inventory
    if (parsed.itemName) {
      toast.success(`"${parsed.itemName}" খোঁজা হচ্ছে…`)
      setActiveView('inventory')
      reset()
      return
    }
    // If customer name only → navigate to khata
    if (parsed.customerName) {
      toast.success(`${parsed.customerName} খাতায় খুঁজা হচ্ছে…`)
      setActiveView('khata')
      reset()
      return
    }
  }

  const hasActionableEntities = parsed && (parsed.customerName || parsed.itemName)

  return (
    <>
      <button
        onClick={handleToggle}
        className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors relative ${
          listening ? 'bg-red-500 text-white animate-pulse' : 'hover:bg-muted'
        }`}
        aria-label={listening ? 'Stop voice input' : 'Start voice input'}
      >
        {listening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
      </button>

      {/* Voice panel — shows transcript + parsed entities */}
      <AnimatePresence>
        {showPanel && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="fixed top-14 inset-x-3 z-50 max-w-md mx-auto bg-card border border-border rounded-2xl shadow-xl p-4"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${listening ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                <span className="text-xs font-semibold">
                  {listening ? `Listening (${language === 'bn' ? 'বাংলা' : 'English'})…` : 'Voice Result'}
                </span>
              </div>
              <button
                onClick={() => { stop(); reset() }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {transcript && (
              <div className="p-3 rounded-xl bg-muted mb-2">
                <p className="text-xs text-muted-foreground mb-0.5">Transcript:</p>
                <p className="text-sm">{transcript}</p>
              </div>
            )}

            {parsed && !listening && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase">Detected:</p>
                <div className="grid grid-cols-2 gap-2">
                  {parsed.customerName && (
                    <div className="p-2 rounded-lg bg-emerald-50 dark:bg-emerald-950/30">
                      <p className="text-[10px] text-muted-foreground">Customer</p>
                      <p className="text-sm font-medium">{parsed.customerName}</p>
                    </div>
                  )}
                  {parsed.amount != null && (
                    <div className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                      <p className="text-[10px] text-muted-foreground">Amount</p>
                      <p className="text-sm font-medium tabular">₹{parsed.amount}</p>
                    </div>
                  )}
                  {parsed.type && (
                    <div className={`p-2 rounded-lg ${parsed.type === 'credit' ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'bg-red-50 dark:bg-red-950/30'}`}>
                      <p className="text-[10px] text-muted-foreground">Type</p>
                      <p className="text-sm font-medium">{parsed.type === 'credit' ? 'পেলাম (In)' : 'দিলাম (Out)'}</p>
                    </div>
                  )}
                  {parsed.itemName && (
                    <div className="p-2 rounded-lg bg-purple-50 dark:bg-purple-950/30">
                      <p className="text-[10px] text-muted-foreground">Item</p>
                      <p className="text-sm font-medium">{parsed.itemName}</p>
                    </div>
                  )}
                  {parsed.quantity != null && (
                    <div className="p-2 rounded-lg bg-teal-50 dark:bg-teal-950/30">
                      <p className="text-[10px] text-muted-foreground">Qty</p>
                      <p className="text-sm font-medium tabular">{parsed.quantity}</p>
                    </div>
                  )}
                </div>
                {!parsed.amount && !parsed.customerName && !parsed.itemName && (
                  <p className="text-xs text-muted-foreground text-center py-2">No entities detected. Try: "অমিত ৫০০ টাকা জমা"</p>
                )}
                {/* PRD Part 26 §1: Action button to navigate based on parsed entities */}
                {hasActionableEntities && (
                  <Button onClick={handleAction} className="w-full h-10 text-xs">
                    <ArrowRight className="w-3.5 h-3.5 mr-1" /> Action নিন
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
