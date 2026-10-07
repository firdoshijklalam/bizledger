/**
 * §EOD-SUMMARY: "Day Summary" dashboard card — a merchant-shareable snapshot
 * of today's business activity (IST-aligned, mirrors /api/dashboard's
 * "today" boundary logic).
 *
 * Data: GET /api/dashboard/eod-summary (see route for the aggregation contract).
 *
 * Design notes:
 *  - Always-compact card: 2×2 metric grid (Sales / Collected / Credit Given /
 *    Expenses) + context rows (Top Customer, Follow-ups, Low Stock) + Share /
 *    Copy actions that build a localized plain-text summary for WhatsApp.
 *  - Semantic palette (de-indigo sweep): Sales=emerald, Collected=teal,
 *    Credit=amber, Expenses=rose, Top Customer=violet, Follow-ups=cyan,
 *    Low Stock=orange.
 *  - Loading skeleton mirrors the card layout; error state is silent-empty
 *    (the card must never break the dashboard).
 */
'use client'

import { useState } from 'react'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  Wallet, ArrowDownLeft, HandCoins, ReceiptText,
  Star, Clock, PackageMinus, Share2, Copy, Moon,
} from 'lucide-react'

interface EodSummary {
  date: string
  salesTotal: number
  salesCount: number
  collections: number
  expenses: number
  newCreditGiven: number
  topCustomer: { name: string; amount: number } | null
  pendingFollowUps: number
  lowStockCount: number
}

export function EodSummaryCard() {
  const { t } = useI18n()
  const business = useAppStore((s) => s.business)
  const currency = business?.currency || 'INR'
  const { data, loading } = useFetch<EodSummary>('/api/dashboard/eod-summary', [])
  const [copied, setCopied] = useState(false)

  // §REACT-COMPILER: plain computation (no useMemo) — trivially cheap and
  // avoids optional-chain dependency mismatch flagged by the compiler.
  // §IST-DISPLAY: formatted in Asia/Kolkata so every merchant sees the IST
  // business date (matching the API's IST-aligned aggregation window). Noon
  // anchor (T12:00:00Z) keeps the calendar date stable in any browser tz.
  const dateLabel = (() => {
    if (!data?.date) return ''
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short',
      }).format(new Date(data.date + 'T12:00:00Z'))
    } catch {
      return data.date
    }
  })()

  // §SHARE-TEXT: localized plain-text summary for WhatsApp / clipboard.
  // Labels come from i18n so the merchant's customers read them in-language.
  const buildShareText = (): string => {
    const d = data
    if (!d) return ''
    const lines = [
      `🌙 *${t('eod.shareText').replace('{date}', dateLabel).replace('{business}', business?.name || '')}*`,
      '',
      `💰 ${t('eod.sales')}: ${formatCurrency(d.salesTotal, currency)} (${t('eod.bills').replace('{n}', String(d.salesCount))})`,
      `📥 ${t('eod.collected')}: ${formatCurrency(d.collections, currency)}`,
      `📤 ${t('eod.creditGiven')}: ${formatCurrency(d.newCreditGiven, currency)}`,
      `🧾 ${t('eod.expenses')}: ${formatCurrency(d.expenses, currency)}`,
    ]
    if (d.topCustomer) {
      const name = d.topCustomer.name === '__WALK_IN__' ? t('eod.walkIn') : d.topCustomer.name
      lines.push(`⭐ ${t('eod.topCustomer')}: ${name} (${formatCurrency(d.topCustomer.amount, currency)})`)
    }
    lines.push(`⏰ ${t('eod.followUps')}: ${d.pendingFollowUps} ${t('eod.pending')}`)
    lines.push(`📦 ${t('eod.lowStock')}: ${d.lowStockCount} ${t('eod.items')}`)
    lines.push('', '— BizLedger')
    return lines.join('\n')
  }

  const handleShare = () => {
    const text = buildShareText()
    if (!text) return
    // §WA-SHARE: no-phone wa.me link → WhatsApp lets the merchant pick the
    // recipient (matches the ShareSheet convention used across the app).
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
  }

  const handleCopy = async () => {
    const text = buildShareText()
    if (!text) return
    // §CLIPBOARD-FALLBACK: navigator.clipboard requires user-activation +
    // secure context; older Android WebViews (this PWA's audience) lack it.
    // Fall back to the legacy execCommand path via a detached textarea.
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.focus()
        ta.select()
        const ok = document.execCommand('copy')
        document.body.removeChild(ta)
        if (!ok) throw new Error('execCommand failed')
        setCopied(true)
      } catch {
        toast.error('Copy failed')
        return
      }
    }
    toast.success(t('eod.copied'))
    setTimeout(() => setCopied(false), 2000)
  }

  if (loading || !data) {
    return (
      <section aria-label={t('eod.title')} className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-xl" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-xl" />
          ))}
        </div>
      </section>
    )
  }

  const hasActivity =
    data.salesTotal !== 0 || data.collections !== 0 || data.expenses !== 0 || data.newCreditGiven !== 0

  const metrics = [
    { label: t('eod.sales'), value: formatCurrency(data.salesTotal, currency), icon: Wallet, cls: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30', sub: t('eod.bills').replace('{n}', String(data.salesCount)) },
    { label: t('eod.collected'), value: formatCurrency(data.collections, currency), icon: ArrowDownLeft, cls: 'text-teal-600 bg-teal-50 dark:bg-teal-950/30', sub: '' },
    { label: t('eod.creditGiven'), value: formatCurrency(data.newCreditGiven, currency), icon: HandCoins, cls: 'text-amber-600 bg-amber-50 dark:bg-amber-950/30', sub: '' },
    { label: t('eod.expenses'), value: formatCurrency(data.expenses, currency), icon: ReceiptText, cls: 'text-rose-600 bg-rose-50 dark:bg-rose-950/30', sub: '' },
  ]

  const topName = data.topCustomer
    ? data.topCustomer.name === '__WALK_IN__' ? t('eod.walkIn') : data.topCustomer.name
    : null

  return (
    <section aria-label={t('eod.title')} className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 pt-3.5 pb-3 bg-gradient-to-r from-emerald-500/10 to-teal-500/5 border-b border-border">
        <div className="w-8 h-8 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0">
          <Moon className="w-4 h-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">{t('eod.title')}</h3>
          <p className="text-[11px] text-muted-foreground leading-tight">{dateLabel}</p>
        </div>
        <div className="flex gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            className="h-8 px-2.5 text-[11px] min-h-0"
            aria-label={copied ? t('eod.copied') : t('eod.copy')}
          >
            <Copy className={`w-3.5 h-3.5 ${copied ? 'text-emerald-600' : ''}`} aria-hidden />
          </Button>
          <Button
            size="sm"
            onClick={handleShare}
            className="h-8 px-3 text-[11px] min-h-0 bg-emerald-600 hover:bg-emerald-700 text-white"
            aria-label={t('eod.share')}
          >
            <Share2 className="w-3.5 h-3.5 mr-1" aria-hidden />
            {t('eod.share')}
          </Button>
        </div>
      </div>

      {/* Metric grid */}
      <div className="p-3 grid grid-cols-2 gap-2">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-xl border border-border/60 bg-background/50 p-2.5">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-5 h-5 rounded-md flex items-center justify-center ${m.cls}`} aria-hidden>
                <m.icon className="w-3 h-3" />
              </span>
              <p className="text-[10px] font-medium text-muted-foreground truncate">{m.label}</p>
            </div>
            <p className="text-sm font-bold tabular-nums leading-tight">{m.value}</p>
            {m.sub && <p className="text-[10px] text-muted-foreground mt-0.5">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* Context rows */}
      <div className="px-3 pb-3 space-y-1.5">
        {topName && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-950/20">
            <Star className="w-3.5 h-3.5 text-violet-600 shrink-0" aria-hidden />
            <p className="text-[11px] text-violet-700 dark:text-violet-300 truncate flex-1">
              {t('eod.topCustomer')}: <span className="font-semibold">{topName}</span>
            </p>
            <p className="text-[11px] font-bold tabular-nums text-violet-700 dark:text-violet-300">
              {formatCurrency(data.topCustomer!.amount, currency)}
            </p>
          </div>
        )}
        {data.pendingFollowUps > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-cyan-50 dark:bg-cyan-950/20">
            <Clock className="w-3.5 h-3.5 text-cyan-600 shrink-0" aria-hidden />
            <p className="text-[11px] text-cyan-700 dark:text-cyan-300 flex-1">
              {t('eod.followUps')}: <span className="font-semibold">{data.pendingFollowUps}</span> {t('eod.pending')}
            </p>
          </div>
        )}
        {data.lowStockCount > 0 && (
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-orange-50 dark:bg-orange-950/20">
            <PackageMinus className="w-3.5 h-3.5 text-orange-600 shrink-0" aria-hidden />
            <p className="text-[11px] text-orange-700 dark:text-orange-300 flex-1">
              {t('eod.lowStock')}: <span className="font-semibold">{data.lowStockCount}</span> {t('eod.items')}
            </p>
          </div>
        )}
        {!hasActivity && (
          <p className="text-[11px] text-muted-foreground text-center py-1.5">{t('eod.noActivity')}</p>
        )}
      </div>
    </section>
  )
}
