'use client'

import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Send, FileText, Smartphone, X, CheckCircle2 } from 'lucide-react'
import { toast } from 'sonner'

interface ShareSheetProps {
  open: boolean
  onClose: () => void
  customerName: string
  customerPhone: string | null
  shareText: string
  shareTitle: string
}

/**
 * Dynamic Share Sheet (PRD Part 10 §2-3).
 * Detects customer device type and shows appropriate share options:
 * - Smartphone: WhatsApp, Telegram, Premium Template (all enabled)
 * - Feature phone: Only SMS/Plain Text (WhatsApp/Telegram disabled)
 */
export function ShareSheet({ open, onClose, customerName, customerPhone, shareText, shareTitle }: ShareSheetProps) {
  // PRD Part 33 §1.1: Append dynamic store link to shared text.
  // Uses the slugify fallback the /api/store/[slug] endpoint provides if no storeSlug is set.
  const [storeSlug, setStoreSlug] = useState<string>('')

  useEffect(() => {
    if (!open) return
    fetch('/api/business')
      .then((r) => r.json())
      .then((biz) => {
        if (biz?.storeSlug) {
          setStoreSlug(biz.storeSlug)
        } else if (biz?.name) {
          // Fallback: slugify business name (matches /api/store/[slug] fallback logic)
          setStoreSlug(biz.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''))
        }
      })
      .catch(() => {})
  }, [open])

  if (!open) return null

  const storeLink = typeof window !== 'undefined' && storeSlug
    ? `${window.location.origin}/?store=${storeSlug}`
    : ''
  const fullShareText = shareText + (storeLink ? `\n\n🛒 Browse more products from our shop:\n${storeLink}` : '')

  // PRD Part 10 §2.1: Device capability detection
  // Simple heuristic: if phone number exists and looks like a standard mobile number, assume smartphone
  // In production, this would use OTP/app status from DB
  const isSmartphone = (() => {
    if (!customerPhone) return true // Default to smartphone if unknown
    const digits = customerPhone.replace(/[^0-9]/g, '')
    // Indian mobile numbers start with 6,7,8,9 after country code
    const localNum = digits.length > 10 ? digits.slice(-10) : digits
    return localNum.length === 10 && /^[6-9]/.test(localNum)
  })()

  const handleWhatsApp = () => {
    if (!isSmartphone) {
      toast.warning('এই কাস্টমারের ফোনে WhatsApp সাপোর্ট নাও থাকতে পারে। SMS ব্যবহার করুন।')
      return
    }
    const phone = customerPhone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(fullShareText)
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
    toast.success('WhatsApp এ পাঠানো হচ্ছে…')
    onClose()
  }

  const handleTelegram = () => {
    if (!isSmartphone) {
      toast.warning('এই কাস্টমারের ফোনে Telegram সাপোর্ট নাও থাকতে পারে।')
      return
    }
    const text = encodeURIComponent(fullShareText)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${text}`, '_blank')
    toast.success('Telegram এ পাঠানো হচ্ছে…')
    onClose()
  }

  const handleSMS = () => {
    const phone = customerPhone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(fullShareText)
    // Use SMS deep link
    const a = document.createElement('a')
    a.href = phone ? `sms:${phone}?body=${text}` : `sms:?body=${text}`
    a.click()
    toast.success('SMS এ পাঠানো হচ্ছে…')
    onClose()
  }

  const handlePremiumTemplate = () => {
    if (!isSmartphone) {
      toast.warning('Premium Template শুধু স্মার্টফোনে সাপোর্ট করে।')
      return
    }
    // Generate premium formatted text (header + customer block + transactions table)
    const lines = fullShareText.split('\n')
    const premiumText = [
      `╔══════════════════════════╗`,
      `   ${shareTitle}`,
      `╚══════════════════════════╝`,
      ``,
      ...lines,
      ``,
      `━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `Sent via BizLedger 📱`,
    ].join('\n')
    
    const phone = customerPhone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(premiumText)
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
    toast.success('Premium Template পাঠানো হচ্ছে…')
    onClose()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(fullShareText)
    toast.success('কপি হয়েছে')
    onClose()
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[90] bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="fixed bottom-0 inset-x-0 z-[90] bg-card rounded-t-3xl border-t border-border p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]"
          >
            {/* Handle */}
            <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4" />
            
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold">শেয়ার করুন</h3>
                <p className="text-[11px] text-muted-foreground">{customerName}</p>
              </div>
              <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Device indicator (PRD Part 10 §2.3) */}
            <div className={`flex items-center gap-2 p-2.5 rounded-xl mb-4 text-xs ${
              isSmartphone 
                ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
            }`}>
              <Smartphone className="w-4 h-4 shrink-0" />
              <span className="flex-1">
                {isSmartphone 
                  ? 'স্মার্টফোন ডিটেক্ট হয়েছে — সব অপশন এনাবেল'
                  : 'সাধারণ ফোন ডিটেক্ট হয়েছে — শুধু SMS এনাবেল'}
              </span>
            </div>

            {/* Share options */}
            <div className="grid grid-cols-2 gap-3">
              {/* WhatsApp */}
              <button
                onClick={handleWhatsApp}
                disabled={!isSmartphone}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-h-[80px] justify-center ${
                  isSmartphone
                    ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                    : 'border-border bg-muted/30 opacity-50'
                }`}
              >
                <MessageCircle className={`w-7 h-7 ${isSmartphone ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium">WhatsApp</span>
                {!isSmartphone && <span className="text-[9px] text-muted-foreground">ডিজেবল</span>}
              </button>

              {/* Telegram */}
              <button
                onClick={handleTelegram}
                disabled={!isSmartphone}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-h-[80px] justify-center ${
                  isSmartphone
                    ? 'border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 hover:bg-blue-100 dark:hover:bg-blue-900/30'
                    : 'border-border bg-muted/30 opacity-50'
                }`}
              >
                <Send className={`w-7 h-7 ${isSmartphone ? 'text-blue-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium">Telegram</span>
                {!isSmartphone && <span className="text-[9px] text-muted-foreground">ডিজেবল</span>}
              </button>

              {/* Premium Template */}
              <button
                onClick={handlePremiumTemplate}
                disabled={!isSmartphone}
                className={`flex flex-col items-center gap-2 p-4 rounded-2xl border transition-all min-h-[80px] justify-center ${
                  isSmartphone
                    ? 'border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 hover:bg-purple-100 dark:hover:bg-purple-900/30'
                    : 'border-border bg-muted/30 opacity-50'
                }`}
              >
                <FileText className={`w-7 h-7 ${isSmartphone ? 'text-purple-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium">Premium Template</span>
                {!isSmartphone && <span className="text-[9px] text-muted-foreground">ডিজেবল</span>}
              </button>

              {/* SMS / Plain Text — always enabled */}
              <button
                onClick={handleSMS}
                className="flex flex-col items-center gap-2 p-4 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-all min-h-[80px] justify-center"
              >
                <FileText className="w-7 h-7 text-amber-600" />
                <span className="text-xs font-medium">SMS / Text</span>
                <span className="text-[9px] text-emerald-600">সবসময় এনাবেল</span>
              </button>
            </div>

            {/* Copy option */}
            <button
              onClick={handleCopy}
              className="w-full mt-3 h-10 rounded-xl bg-muted hover:bg-muted/70 text-sm font-medium flex items-center justify-center gap-2"
            >
              <CheckCircle2 className="w-4 h-4" /> টেক্সট কপি করুন
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
