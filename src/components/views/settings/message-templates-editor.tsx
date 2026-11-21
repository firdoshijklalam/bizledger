'use client'

/**
 * §MESSAGE-TEMPLATES-EDITOR — Settings → Templates tab.
 *
 * Lets a business customize the 4 customer-facing message slots (payment
 * reminder in/out, overdue reminder, feedback request) per language with
 * {party} {amount} {business} {bill} placeholders. Overrides persist in
 * AppSettings.messageTemplates (JSON) and are consumed by
 * src/lib/message-templates.ts at generation time — every share surface
 * (ShareSheet, AI Reminders, follow-up WhatsApp nudges) picks them up with
 * zero call-site changes.
 *
 * Design notes:
 *  - The textarea prefills with the placeholder-ized BUILT-IN default
 *    (editing a known-good draft beats writing from scratch).
 *  - Placeholder chips insert at the cursor position.
 *  - Live SMS segment estimate (feature-phone merchants pay per segment).
 *  - "Reset to default" clears the slot's override for the CURRENT language.
 *  - Saving updates the TanStack Query app-settings cache — app-shell's
 *    subscription re-hydrates the overrides store app-wide.
 */

import { useAppStore } from '@/store/app-store'
import { useI18n, type Language } from '@/store/i18n-store'
import { useMessageTemplateStore, type TemplateSlotId, type TemplateOverrides } from '@/store/message-template-store'
import { DEFAULT_TEMPLATES, renderTemplatePreview, smsSegmentEstimate } from '@/lib/message-templates'
import { apiPut } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import { useQueryClient } from '@tanstack/react-query'
import {
  MessageSquare, ArrowDownLeft, ArrowUpRight, AlarmClock, Star,
  Pencil, RotateCcw, Loader2, CheckCircle2, ChevronDown,
} from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { useState, useRef, useEffect } from 'react'

const MAX_LEN = 640

// §SCROLL-AFFORDANCE (VLM round 9): preview boxes are max-h scrollable, but a
// clipped bottom edge gave no hint that more content was below — reviewers
// read it as broken truncation. This wrapper shows a small "↓" chip pinned to
// the bottom-right ONLY while unscrolled content remains below the fold
// (re-checks on scroll + on content change).
function ScrollFadeText({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [hasMore, setHasMore] = useState(false)
  const check = () => {
    const el = ref.current
    if (!el) return
    setHasMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8)
  }
  useEffect(check)
  return (
    <div className="relative">
      <p ref={ref} onScroll={check} className={className}>
        {children}
      </p>
      {hasMore && (
        <span className="pointer-events-none absolute bottom-1 right-2 flex items-center gap-0.5 rounded-full bg-muted/90 dark:bg-muted/70 px-1.5 py-0.5 text-[8px] font-semibold text-muted-foreground ring-1 ring-border/60">
          <ChevronDown className="w-2.5 h-2.5" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}

const SLOTS: Array<{
  id: TemplateSlotId
  icon: typeof MessageSquare
  tint: string
  placeholders: string[]
}> = [
  {
    id: 'paymentReceivable',
    icon: ArrowDownLeft,
    tint: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600',
    placeholders: ['{party}', '{amount}', '{business}'],
  },
  {
    id: 'paymentPayable',
    icon: ArrowUpRight,
    tint: 'bg-rose-100 dark:bg-rose-900/40 text-rose-600',
    placeholders: ['{party}', '{amount}', '{business}'],
  },
  {
    id: 'overdue',
    icon: AlarmClock,
    tint: 'bg-amber-100 dark:bg-amber-900/40 text-amber-600',
    placeholders: ['{party}', '{amount}', '{business}', '{bill}'],
  },
  {
    id: 'feedback',
    icon: Star,
    tint: 'bg-cyan-100 dark:bg-cyan-900/40 text-cyan-600',
    placeholders: ['{party}'],
  },
]

const LANG_NATIVE: Record<Language, string> = {
  en: 'English',
  bn: 'বাংলা',
  hi: 'हिन्दी',
}

export function MessageTemplatesEditor() {
  const { business } = useAppStore()
  const { t, language } = useI18n()
  const overrides = useMessageTemplateStore((s) => s.overrides)
  const setOverrides = useMessageTemplateStore((s) => s.setOverrides)
  const queryClient = useQueryClient()
  const [editingSlot, setEditingSlot] = useState<TemplateSlotId | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currency = business?.currency || 'INR'
  const sample = {
    partyName: 'Amit Trading',
    amount: formatCurrency(1250, currency),
    businessName: business?.name || 'Sharma Trading Co.',
    invoiceNumber: 'INV-001',
  }

  const segmentInfo = smsSegmentEstimate(draft)

  const openEditor = (slot: TemplateSlotId) => {
    const existing = overrides?.[slot]?.[language]
    setDraft(existing ?? DEFAULT_TEMPLATES[slot][language])
    setEditingSlot(slot)
  }

  const insertPlaceholder = (token: string) => {
    const el = textareaRef.current
    if (!el) {
      setDraft((d) => d + token)
      return
    }
    const start = el.selectionStart ?? draft.length
    const end = el.selectionEnd ?? draft.length
    const next = draft.slice(0, start) + token + draft.slice(end)
    setDraft(next)
    // Restore caret after the inserted token (next tick, once React re-renders)
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(start + token.length, start + token.length)
    })
  }

  // Persist the whole overrides map (not just the edited slot) — the server
  // replaces the column wholesale, so we must send the merged state.
  const persist = async (next: TemplateOverrides) => {
    setSaving(true)
    try {
      await apiPut('/api/app-settings', { messageTemplates: JSON.stringify(next) })
      setOverrides(next)
      // Update the shared app-settings cache so app-shell's subscription
      // re-hydrates the store for every mounted surface.
      queryClient.setQueryData(['/api/app-settings'], (old: any) =>
        old ? { ...old, messageTemplates: JSON.stringify(next) } : old
      )
      setEditingSlot(null)
      toast.success(t('set.tpl.saved'))
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const save = () => {
    if (!editingSlot) return
    const trimmed = draft.trim()
    if (trimmed.length > MAX_LEN) {
      toast.error(t('set.tpl.tooLong').replace('{max}', String(MAX_LEN)))
      return
    }
    const next: TemplateOverrides = JSON.parse(JSON.stringify(overrides ?? {}))
    if (!trimmed) {
      // Empty draft = clear the override → built-in default
      delete next[editingSlot]?.[language]
      if (next[editingSlot] && Object.keys(next[editingSlot]).length === 0) delete next[editingSlot]
    } else {
      next[editingSlot] = { ...(next[editingSlot] ?? {}), [language]: trimmed }
    }
    void persist(next)
  }

  const resetToDefault = () => {
    if (!editingSlot) return
    const next: TemplateOverrides = JSON.parse(JSON.stringify(overrides ?? {}))
    delete next[editingSlot]?.[language]
    if (next[editingSlot] && Object.keys(next[editingSlot]).length === 0) delete next[editingSlot]
    setDraft(DEFAULT_TEMPLATES[editingSlot][language])
    void persist(next)
  }

  const editingMeta = SLOTS.find((s) => s.id === editingSlot)

  return (
    <Card className="p-5 space-y-4">
      {/* Section header */}
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <MessageSquare className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold flex flex-wrap items-center gap-2">
            {t('set.tpl.title')}
            <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              {LANG_NATIVE[language]}
            </span>
          </h3>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{t('set.tpl.sub')}</p>
        </div>
      </div>

      {/* Slot cards */}
      <div className="space-y-3">
        {SLOTS.map((slot) => {
          const Icon = slot.icon
          const hasOverride = Boolean(overrides?.[slot.id]?.[language])
          const preview = renderTemplatePreview(slot.id, language, sample)
          return (
            <div
              key={slot.id}
              className="rounded-xl border border-border/80 bg-muted/20 hover:bg-muted/30 transition-colors p-3.5 space-y-2.5"
            >
              <div className="flex items-start gap-2.5">
                <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${slot.tint}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <p className="text-xs font-semibold">{t(`set.tpl.slot.${slot.id}.name`)}</p>
                    {hasOverride ? (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 uppercase tracking-wide">
                        {t('set.tpl.custom')}
                      </span>
                    ) : (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground uppercase tracking-wide">
                        {t('set.tpl.default')}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug mt-0.5">{t(`set.tpl.slot.${slot.id}.desc`)}</p>
                </div>
                <button
                  onClick={() => openEditor(slot.id)}
                  className="shrink-0 text-[11px] font-medium px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center gap-1 transition-colors min-h-[36px]"
                >
                  <Pencil className="w-3 h-3" /> {t('set.tpl.edit')}
                </button>
              </div>

              {/* Live preview with sample data — px-3.5 py-3 + max-h-28
                  (VLM: preview text was edge-crammed and clipped abruptly) */}
              <div className="rounded-lg bg-background/60 dark:bg-background/40 ring-1 ring-border/60 px-3.5 py-3">
                <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">{t('set.tpl.preview')}</p>
                <ScrollFadeText className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-28 overflow-y-auto">
                  {preview}
                </ScrollFadeText>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-[10px] text-muted-foreground text-center">
        {t('set.tpl.langNote').replace('{lang}', LANG_NATIVE[language])}
      </p>

      {/* Editor dialog */}
      <Dialog open={!!editingSlot} onOpenChange={(o) => !o && setEditingSlot(null)}>
        <FormDialogContent aria-describedby={undefined} className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editingMeta && (
                <span className={`w-7 h-7 rounded-lg flex items-center justify-center ${editingMeta.tint}`}>
                  <editingMeta.icon className="w-3.5 h-3.5" />
                </span>
              )}
              {editingSlot && t(`set.tpl.slot.${editingSlot}.name`)}
              <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {LANG_NATIVE[language]}
              </span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={7}
              autoFocus
              aria-label={editingSlot ? t(`set.tpl.slot.${editingSlot}.name`) : 'template'}
              className="w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs leading-relaxed outline-none focus:ring-2 focus:ring-ring resize-y min-h-[130px]"
            />

            {/* Placeholder chips — tap to insert at cursor */}
            {editingMeta && (
              <div className="flex items-center flex-wrap gap-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">{t('set.tpl.placeholders')}</span>
                {editingMeta.placeholders.map((token) => (
                  <button
                    key={token}
                    onClick={() => insertPlaceholder(token)}
                    className="text-[10px] font-mono px-2 py-1 rounded-md bg-muted hover:bg-primary/10 hover:text-primary text-muted-foreground transition-colors"
                  >
                    {token}
                  </button>
                ))}
              </div>
            )}

            {/* SMS segment + char counter */}
            {segmentInfo && (
              <div className="flex items-center justify-between text-[10px] tabular-nums">
                <p className={draft.length > MAX_LEN ? 'text-red-600' : 'text-muted-foreground'}>
                  {draft.length} / {MAX_LEN}
                </p>
                <p className={segmentInfo.segments > 1 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}>
                  {segmentInfo.segments} SMS {segmentInfo.encoding === 'UCS-2' ? '· UCS-2' : '· GSM-7'}
                  {segmentInfo.encoding === 'UCS-2' && segmentInfo.segments > 2 ? ' ⚠' : ''}
                </p>
              </div>
            )}

            {/* Live preview of the draft with sample data */}
            <div className="rounded-lg bg-muted/40 ring-1 ring-border/60 px-3.5 py-3">
              <p className="text-[9px] uppercase tracking-wide text-muted-foreground mb-1">{t('set.tpl.preview')}</p>
              <ScrollFadeText className="text-[11px] leading-relaxed whitespace-pre-wrap text-foreground/90 max-h-28 overflow-y-auto">
                {draft
                  .split('{party}').join(sample.partyName)
                  .split('{amount}').join(sample.amount)
                  .split('{business}').join(sample.businessName)
                  .split('{bill}').join('INV-001\n')}
              </ScrollFadeText>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={resetToDefault}
              disabled={saving}
              className="h-11 text-muted-foreground"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" /> {t('set.tpl.reset')}
            </Button>
            <Button onClick={save} disabled={saving} className="h-11 flex-1">
              {saving ? <Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-1.5" />}
              {t('set.tpl.save')}
            </Button>
          </DialogFooter>
        </FormDialogContent>
      </Dialog>
    </Card>
  )
}
