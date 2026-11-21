'use client'

import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { MessageCircle, Send, FileText, Smartphone, MessageSquare, X, CheckCircle2, Pencil, RotateCcw, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { createPortal } from 'react-dom'
import { useI18n } from '@/store/i18n-store'
import { useMessageTemplateStore, type TemplateSlotId } from '@/store/message-template-store'
import { smsSegmentEstimate } from '@/lib/message-templates'

interface ShareSheetProps {
  open: boolean
  onClose: () => void
  customerName: string
  customerPhone: string | null
  shareText: string
  shareTitle: string
  /** Which message-template slot generated shareText (if any). When the
   * business has a custom override for that slot, a small "Custom" chip is
   * shown on the message preview so merchants recognize their own wording. */
  templateSlot?: TemplateSlotId
}

/**
 * Dynamic Share Sheet (PRD Part 10 §2-3).
 * Detects customer device type and shows appropriate share options:
 * - Smartphone: WhatsApp, Telegram, Premium Template (all enabled)
 * - Feature phone: Only SMS/Plain Text (WhatsApp/Telegram disabled)
 *
 * §EDITABLE-MESSAGE (this round): the outgoing message is now VISIBLE and
 * EDITABLE before send — merchants preview the prefilled text, tweak it
 * (add a name correction, change the tone), and watch the SMS segment
 * counter so feature-phone SMS costs stay predictable. Previously the text
 * was invisible until the app opened WhatsApp/SMS.
 *
 * §I18N: every label, toast and hint is localized (en/bn/hi). This sheet is
 * used from party profiles, AI reminders, notifications and invoices — it
 * used to be hardcoded Bengali regardless of the app language.
 */
export function ShareSheet({ open, onClose, customerName, customerPhone, shareText, shareTitle, templateSlot }: ShareSheetProps) {
  const { t, language } = useI18n()
  // §CUSTOM-TEMPLATE-BADGE: reactive read of the business's override for the
  // slot that generated this message. Empty/missing → built-in default → no badge.
  const slotOverride = useMessageTemplateStore(
    (s) => (templateSlot ? s.overrides?.[templateSlot]?.[language] : undefined),
  )
  const isCustomTemplate = typeof slotOverride === 'string' && slotOverride.trim().length > 0
  // PRD Part 33 §1.1: Append dynamic store link to shared text.
  // Uses the slugify fallback the /api/store/[slug] endpoint provides if no storeSlug is set.
  const [storeSlug, setStoreSlug] = useState<string>('')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  // §SESSION-RESET (render-time adjust pattern, per React docs — avoids the
  // setState-in-effect cascading-render lint): when the sheet re-opens, drop
  // any stale edit so the caller's fresh message is what the user previews.
  const [prevOpen, setPrevOpen] = useState(false)
  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setEditing(false)
      setDraft('')
    }
  }

  // §KEYBOARD-DISMISS: Escape closes the sheet (WAI-ARIA dialog pattern).
  // First press exits edit mode (message draft preserved in state), second
  // press closes the sheet — standard two-step semantics for editable dialogs.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (editing) {
        setEditing(false)
      } else {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, onClose])

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

  const storeLink = typeof window !== 'undefined' && storeSlug
    ? `${window.location.origin}/?store=${storeSlug}`
    : ''
  const originalFullText = shareText + (storeLink ? `\n\n🛒 Browse more products from our shop:\n${storeLink}` : '')

  // The message that is actually sent: the draft while editing persists,
  // otherwise the caller's original (store-link appended) text.
  const effectiveText = useMemo(() => {
    if (editing) return draft
    if (draft && draft !== originalFullText) return draft
    return originalFullText
  }, [editing, draft, originalFullText])

  const segmentInfo = smsSegmentEstimate(effectiveText)

  const startEditing = () => {
    setDraft(effectiveText)
    setEditing(true)
  }

  const resetDraft = () => {
    setDraft(originalFullText)
    toast.info(t('share.msg.reset'))
  }

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
      toast.warning(t('share.warn.smartphone'))
      return
    }
    const phone = customerPhone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(effectiveText)
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
    toast.success(t('share.opening.whatsapp'))
    onClose()
  }

  const handleTelegram = () => {
    if (!isSmartphone) {
      toast.warning(t('share.warn.telegram'))
      return
    }
    const text = encodeURIComponent(effectiveText)
    window.open(`https://t.me/share/url?url=${encodeURIComponent(window.location.origin)}&text=${text}`, '_blank')
    toast.success(t('share.opening.telegram'))
    onClose()
  }

  const handleSMS = () => {
    const phone = customerPhone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(effectiveText)
    // Use SMS deep link
    const a = document.createElement('a')
    a.href = phone ? `sms:${phone}?body=${text}` : `sms:?body=${text}`
    a.click()
    toast.success(t('share.opening.sms'))
    onClose()
  }

  const handlePremiumTemplate = () => {
    if (!isSmartphone) {
      toast.warning(t('share.warn.premium'))
      return
    }
    // Generate premium formatted text (header + customer block + transactions table)
    const lines = effectiveText.split('\n')
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
    toast.success(t('share.premium.sent'))
    onClose()
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(effectiveText)
    toast.success(t('share.copied'))
    onClose()
  }

  if (!open) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-[2px]"
          />
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            role="dialog"
            aria-modal="true"
            aria-label={shareTitle}
            className="fixed bottom-0 inset-x-0 z-[200] bg-card rounded-t-3xl border-t border-border shadow-[0_-8px_30px_rgba(0,0,0,0.08)] dark:shadow-[0_-8px_30px_rgba(0,0,0,0.5)]"
          >
            <div className="max-h-[88vh] overflow-y-auto p-5 pb-[calc(env(safe-area-inset-bottom)+20px)]">
              {/* Handle */}
              <div className="w-10 h-1 rounded-full bg-muted mx-auto mb-4" />

              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold">{t('share.title')}</h3>
                  <p className="text-[11px] text-muted-foreground">{customerName}</p>
                </div>
                <button onClick={onClose} aria-label={t('common.close')} className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center transition-colors">
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* §EDITABLE-MESSAGE: preview + edit the outgoing message before send */}
              <section aria-label={t('share.msg.title')} className="mb-4">
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <MessageCircle className="w-3 h-3" />
                    {editing ? t('share.msg.editing') : t('share.msg.title')}
                    {isCustomTemplate && (
                      <span
                        title={t('share.msg.customHint')}
                        className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 px-1.5 py-px text-[9px] font-bold normal-case tracking-normal text-primary ring-1 ring-primary/25"
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                        {t('share.msg.custom')}
                      </span>
                    )}
                  </p>
                  <div className="flex items-center gap-1">
                    {editing && (
                      <button
                        onClick={resetDraft}
                        className="text-[10px] text-muted-foreground hover:text-foreground px-1.5 py-1 rounded-md hover:bg-muted flex items-center gap-1 transition-colors"
                        title={t('share.msg.reset')}
                      >
                        <RotateCcw className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      onClick={() => (editing ? setEditing(false) : startEditing())}
                      className={`text-[11px] font-medium px-2.5 py-1 rounded-lg flex items-center gap-1 transition-colors ${
                        editing
                          ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                          : 'bg-primary/10 text-primary hover:bg-primary/20'
                      }`}
                    >
                      {editing ? <CheckCircle2 className="w-3 h-3" /> : <Pencil className="w-3 h-3" />}
                      {editing ? t('share.msg.done') : t('share.msg.edit')}
                    </button>
                  </div>
                </div>

                {editing ? (
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    rows={7}
                    autoFocus
                    aria-label={t('share.msg.editing')}
                    className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y min-h-[120px]"
                  />
                ) : (
                  <div className="rounded-xl bg-muted/60 dark:bg-muted/40 border border-border/60 px-3 py-2.5">
                    <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-[110px] overflow-y-auto">
                      {effectiveText}
                    </p>
                  </div>
                )}

                {/* SMS segment awareness — feature-phone merchants pay per segment */}
                {segmentInfo && (
                  <p
                    className={`mt-1.5 text-[10px] tabular-nums ${
                      segmentInfo.segments > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'
                    }`}
                    aria-label={`${segmentInfo.chars} characters, ${segmentInfo.segments} SMS segments`}
                  >
                    {t('share.msg.segments')
                      .replace('{n}', String(segmentInfo.chars))
                      .replace('{segments}', String(segmentInfo.segments))}
                    {segmentInfo.encoding === 'UCS-2' && segmentInfo.segments > 2 ? ' ⚠' : ''}
                  </p>
                )}
              </section>

              {/* Device indicator (PRD Part 10 §2.3) */}
              <div className={`flex items-center gap-2 p-2.5 rounded-xl mb-4 text-xs ${
                isSmartphone
                  ? 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300'
              }`}>
                <Smartphone className="w-4 h-4 shrink-0" />
                <span className="flex-1">
                  {isSmartphone ? t('share.device.smart') : t('share.device.basic')}
                </span>
              </div>

              {/* Share options */}
              <div className="grid grid-cols-2 gap-3">
                {/* WhatsApp */}
                <button
                  onClick={handleWhatsApp}
                  disabled={!isSmartphone}
                  aria-label="Share on WhatsApp"
                  className={`group flex flex-col items-center gap-1.5 p-4 rounded-2xl border transition-all min-h-[84px] justify-center active:scale-[0.97] ${
                    isSmartphone
                      ? 'border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30 hover:shadow-md hover:shadow-emerald-500/10'
                      : 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <MessageCircle className={`w-7 h-7 transition-transform group-hover:scale-110 ${isSmartphone ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium">WhatsApp</span>
                  {!isSmartphone && <span className="text-[9px] text-muted-foreground">{t('share.disabled')}</span>}
                </button>

                {/* Telegram */}
                <button
                  onClick={handleTelegram}
                  disabled={!isSmartphone}
                  aria-label="Share on Telegram"
                  className={`group flex flex-col items-center gap-1.5 p-4 rounded-2xl border transition-all min-h-[84px] justify-center active:scale-[0.97] ${
                    isSmartphone
                      ? 'border-cyan-300 dark:border-cyan-800 bg-cyan-50 dark:bg-cyan-950/20 hover:bg-cyan-100 dark:hover:bg-cyan-900/30 hover:shadow-md hover:shadow-cyan-500/10'
                      : 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <Send className={`w-7 h-7 transition-transform group-hover:scale-110 ${isSmartphone ? 'text-cyan-600' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium">Telegram</span>
                  {!isSmartphone && <span className="text-[9px] text-muted-foreground">{t('share.disabled')}</span>}
                </button>

                {/* Premium Template */}
                <button
                  onClick={handlePremiumTemplate}
                  disabled={!isSmartphone}
                  aria-label={t('share.premium')}
                  className={`group flex flex-col items-center gap-1.5 p-4 rounded-2xl border transition-all min-h-[84px] justify-center active:scale-[0.97] ${
                    isSmartphone
                      ? 'border-purple-300 dark:border-purple-800 bg-purple-50 dark:bg-purple-950/20 hover:bg-purple-100 dark:hover:bg-purple-900/30 hover:shadow-md hover:shadow-purple-500/10'
                      : 'border-border bg-muted/30 opacity-50 cursor-not-allowed'
                  }`}
                >
                  <FileText className={`w-7 h-7 transition-transform group-hover:scale-110 ${isSmartphone ? 'text-purple-600' : 'text-muted-foreground'}`} />
                  <span className="text-xs font-medium">{t('share.premium')}</span>
                  {!isSmartphone && <span className="text-[9px] text-muted-foreground">{t('share.disabled')}</span>}
                </button>

                {/* SMS / Plain Text — always enabled */}
                <button
                  onClick={handleSMS}
                  aria-label={t('share.sms')}
                  className="group flex flex-col items-center gap-1.5 p-4 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/20 hover:bg-amber-100 dark:hover:bg-amber-900/30 hover:shadow-md hover:shadow-amber-500/10 transition-all min-h-[84px] justify-center active:scale-[0.97]"
                >
                  <MessageSquare className="w-7 h-7 text-amber-600 transition-transform group-hover:scale-110" />
                  <span className="text-xs font-medium">{t('share.sms')}</span>
                  <span className="text-[9px] text-emerald-600">{t('share.always')}</span>
                </button>
              </div>

              {/* Copy option */}
              <button
                onClick={handleCopy}
                className="w-full mt-3 h-11 rounded-xl bg-muted hover:bg-muted/70 text-sm font-medium flex items-center justify-center gap-2 transition-colors active:scale-[0.98]"
              >
                <CheckCircle2 className="w-4 h-4" /> {t('share.copy')}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body
  )
}
