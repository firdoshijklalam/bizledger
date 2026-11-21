'use client'

import { useFetch } from '@/hooks/use-fetch'
import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { motion } from 'framer-motion'
import { Star, MessageSquare, ThumbsUp, Clock, TrendingUp, AlertTriangle, Quote, FileSpreadsheet, Printer, Gauge } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { buildFeedbackCsv } from '@/lib/reports-csv'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import type { ViewId } from '@/lib/types'

// §FEEDBACK-ANALYTICS: business-wide product-feedback analytics tab in the
// Reports view. Answers the merchant's top questions at a glance:
//   1. How good are my products?        (avg rating + distribution)
//   2. Are customers responding?        (response rate)
//   3. Which products are best/worst?   (product leaderboard)
//   4. What did customers say lately?   (recent reviews)
//
// §DATA-CONTRACT: `/api/feedback/analytics` returns a PLAIN OBJECT (no
// {items,total,hasMore} envelope — the `items` key is absent so useFetch does
// NOT extract it). `data` IS the analytics object itself.
//
// §STYLE-SYSTEM: mirrors the amber/emerald gradient + animated-bar design
// language of the party-profile insights strip and the per-product feedback
// card, so all three feedback surfaces feel like one feature family.

interface AnalyticsProduct {
  productId: string
  name: string
  sku: string | null
  total: number
  submitted: number
  reviews: number
  avgRating: number | null
  responseRate: number
}

interface AnalyticsResponse {
  total: number
  byStatus: Record<string, number>
  submitted: number
  rated: number
  withComment: number
  avgRating: number | null
  responseRate: number
  distribution: Record<string, number>
  products: AnalyticsProduct[]
  recentReviews: Array<{
    id: string
    rating: number | null
    comment: string | null
    partyName: string | null
    productName: string | null
    submittedAt: string
  }>
  truncated?: boolean
}

// §I18N (Task 10): every user-visible string routes through the i18n store
// (en/bn/hi — see the `fa.*` keys in src/store/i18n-store.ts). Interpolation
// uses the codebase-wide {placeholder} + .replace() convention. English
// plural quality is preserved via explicit .one/.many key pairs (Bengali and
// Hindi do not inflect, so their pairs share one word).
const STATUS_META: Array<{ key: string; i18nKey: string; cls: string }> = [
  { key: 'scheduled', i18nKey: 'fa.status.scheduled', cls: 'bg-cyan-100 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300' },
  { key: 'pending', i18nKey: 'fa.status.pending', cls: 'bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  { key: 'submitted', i18nKey: 'fa.status.submitted', cls: 'bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300' },
  { key: 'skipped', i18nKey: 'fa.status.skipped', cls: 'bg-muted text-muted-foreground' },
  { key: 'expired', i18nKey: 'fa.status.expired', cls: 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300' },
]

export function FeedbackAnalytics() {
  const { data, loading, error, refetch } = useFetch<AnalyticsResponse>('/api/feedback/analytics', [])
  const { setSelectedProductId, setActiveView } = useAppStore()
  const { t } = useI18n()

  if (error) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-center">
        <p className="text-sm text-destructive mb-2">{error}</p>
        <button onClick={() => refetch()} className="text-xs text-primary underline">
          {t('fa.retry')}
        </button>
      </div>
    )
  }
  if (loading || !data) return <LoadingState text={t('common.loading')} />

  // §EMPTY-STATE: no feedback records yet — explain how the pipeline starts
  // (invoice completion / manual request) instead of showing zeros.
  if (data.total === 0) {
    return (
      <EmptyState
        icon={MessageSquare}
        title={t('fa.empty.title')}
        description={t('fa.empty.desc')}
      />
    )
  }

  const distribution = [5, 4, 3, 2, 1].map((n) => ({ stars: n, count: data.distribution[String(n)] ?? 0 }))
  const maxCount = Math.max(1, ...distribution.map((d) => d.count))
  const ratedProducts = data.products.filter((p) => p.avgRating != null)
  const topRated = ratedProducts.slice(0, 5)
  const needsAttention = ratedProducts.filter((p) => (p.avgRating ?? 5) < 3).slice(0, 3)
  const activeRequests = (data.byStatus.scheduled ?? 0) + (data.byStatus.pending ?? 0)

  // §NPS-SCORECARD: promoter-score style rollup of the SAME distribution the
  // bar chart shows — one glance answer to "do customers advocate for my
  // products?". Promoters = 4-5★, passives = 3★, detractors = 1-2★;
  // score = round(100 × (promoters − detractors) / rated) ∈ [-100, +100].
  // Computed client-side from the existing /api/feedback/analytics payload —
  // no API change, no extra request.
  const promoters = (data.distribution['5'] ?? 0) + (data.distribution['4'] ?? 0)
  const passives = data.distribution['3'] ?? 0
  const detractors = (data.distribution['2'] ?? 0) + (data.distribution['1'] ?? 0)
  const npsScore = data.rated > 0 ? Math.round((100 * (promoters - detractors)) / data.rated) : 0
  const npsTone =
    npsScore >= 50 ? 'text-emerald-700 dark:text-emerald-300'
    : npsScore >= 0 ? 'text-amber-700 dark:text-amber-300'
    : 'text-rose-700 dark:text-rose-300'
  const npsLabel =
    npsScore >= 50 ? t('fa.nps.love')
    : npsScore >= 0 ? t('fa.nps.mixed')
    : t('fa.nps.unhappy')
  const ratedForBar = Math.max(1, data.rated)

  const openProduct = (productId: string) => {
    setSelectedProductId(productId)
    setActiveView('inventory' as ViewId)
  }

  // §EXPORT-CSV: mirrors the other report tabs' export row, but consumes the
  // ANALYTICS payload (not /api/reports data) via buildFeedbackCsv. UTF-8 BOM
  // + RFC 4180 escaping come from buildCsv inside reports-csv.ts.
  const exportCsv = () => {
    try {
      const csv = buildFeedbackCsv(data)
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `bizledger-feedback-analytics-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      toast.success(t('fa.toast.exported'))
    } catch {
      toast.error(t('fa.toast.exportFailed'))
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="space-y-4"
      aria-label={t('fa.aria.panel')}
    >
      {/* §EXPORT-ROW: same grid + styling as the other report tabs' action
          buttons (reports-view hides its own row for this tab). */}
      <div className="grid grid-cols-2 gap-2 action-buttons">
        <Button variant="outline" onClick={exportCsv} className="h-11 flex-col text-xs">
          <FileSpreadsheet className="w-4 h-4 mb-0.5" /> {t('fa.exportCsv')}
        </Button>
        <Button variant="outline" onClick={() => window.print()} className="h-11 flex-col text-xs">
          <Printer className="w-4 h-4 mb-0.5" /> {t('fa.print')}
        </Button>
      </div>

      {/* §KPI-STRIP: avg rating + response rate — the two headline metrics. */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl p-2.5 border border-amber-200/60 dark:border-amber-900/30 bg-gradient-to-br from-amber-50 to-orange-50/70 dark:from-amber-950/25 dark:to-orange-950/15">
          <p className="text-[10px] font-medium text-amber-800/80 dark:text-amber-300/80 uppercase tracking-wide">
            {t('fa.avgRating')}
          </p>
          {data.avgRating != null ? (
            <>
              <p className="text-2xl font-bold text-amber-900 dark:text-amber-200 leading-tight tabular-nums">
                {data.avgRating.toFixed(1)}
                <span className="text-xs font-normal text-amber-700/60 dark:text-amber-300/60">/5</span>
              </p>
              <Stars rating={Math.round(data.avgRating)} />
              <p className="text-[10px] text-amber-800/70 dark:text-amber-300/70 mt-0.5">
                {data.rated} {data.rated === 1 ? t('fa.reviews.one') : t('fa.reviews.many')}
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-800/50 dark:text-amber-300/50 mt-1.5">{t('fa.noRatings')}</p>
          )}
        </div>

        <div className="rounded-xl p-2.5 border border-emerald-200/60 dark:border-emerald-900/30 bg-gradient-to-br from-emerald-50 to-teal-50/70 dark:from-emerald-950/25 dark:to-teal-950/15">
          <p className="text-[10px] font-medium text-emerald-800/80 dark:text-emerald-300/80 uppercase tracking-wide">
            {t('fa.responseRate')}
          </p>
          <p className="text-2xl font-bold text-emerald-900 dark:text-emerald-200 leading-tight tabular-nums">
            {data.responseRate}
            <span className="text-xs font-normal text-emerald-700/60 dark:text-emerald-300/60">%</span>
          </p>
          <div
            className="h-1.5 rounded-full bg-emerald-900/10 dark:bg-emerald-100/20 overflow-hidden mt-1"
            role="progressbar"
            aria-valuenow={data.responseRate}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={t('fa.aria.responseBar')}
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${data.responseRate}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
            />
          </div>
          <p className="text-[10px] text-emerald-800/70 dark:text-emerald-300/70 mt-1 flex items-center gap-0.5">
            <ThumbsUp className="w-2.5 h-2.5" aria-hidden="true" />
            {t('fa.responded').replace('{a}', String(data.submitted)).replace('{b}', String(data.total))}
          </p>
        </div>

        <div className="rounded-xl p-2.5 border border-cyan-200/60 dark:border-cyan-900/30 bg-gradient-to-br from-cyan-50 to-teal-50/60 dark:from-cyan-950/25 dark:to-teal-950/15">
          <p className="text-[10px] font-medium text-cyan-800/80 dark:text-cyan-300/80 uppercase tracking-wide">
            {t('fa.inFlight')}
          </p>
          <p className="text-2xl font-bold text-cyan-900 dark:text-cyan-200 leading-tight tabular-nums">
            {activeRequests}
          </p>
          <p className="text-[10px] text-cyan-800/70 dark:text-cyan-300/70 mt-0.5 flex items-center gap-0.5">
            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
            {t('fa.awaiting')}
          </p>
          <p className="text-[10px] text-cyan-800/50 dark:text-cyan-300/50 mt-1">
            {data.total} {data.total === 1 ? t('fa.requests.one') : t('fa.requests.many')}
          </p>
        </div>
      </div>

      {/* §STATUS-BREAKDOWN: chip row of every status count (zeros omitted). */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {STATUS_META.filter((s) => (data.byStatus[s.key] ?? 0) > 0).map((s) => (
          <span key={s.key} className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${s.cls}`}>
            {t(s.i18nKey)}: {data.byStatus[s.key]}
          </span>
        ))}
      </div>

      {/* §NPS-SCORECARD-CARD: promoter score + segmented advocacy bar. Derived
          from the same rating distribution above — turns "4.5 avg" into a
          single "would they recommend me" number the merchant can track. */}
      {data.rated > 0 && (
        <div className="rounded-xl p-4 bg-card border border-border shadow-sm">
          <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5 text-foreground">
            <Gauge className="w-3.5 h-3.5 text-teal-500" aria-hidden="true" />
            {t('fa.advocacy')}
          </h3>
          <div className="flex items-baseline gap-2 mb-2">
            <p className={`text-2xl font-bold leading-none tabular-nums ${npsTone}`}>
              {npsScore > 0 ? '+' : ''}{npsScore}
            </p>
            <p className="text-[10px] text-muted-foreground">{npsLabel}</p>
          </div>
          {/* Segmented bar: promoters (emerald) / passives (amber) / detractors (rose) */}
          <div
            className="flex h-2 rounded-full overflow-hidden bg-muted dark:bg-muted/70"
            role="img"
            aria-label={t('fa.aria.advocacyBar')
              .replace('{p}', String(promoters))
              .replace('{pa}', String(passives))
              .replace('{d}', String(detractors))
              .replace('{r}', String(data.rated))}
          >
            {promoters > 0 && (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(100 * promoters) / ratedForBar}%` }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
                className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500"
              />
            )}
            {passives > 0 && (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(100 * passives) / ratedForBar}%` }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.05 }}
                className="h-full bg-amber-300 dark:bg-amber-500/70"
              />
            )}
            {detractors > 0 && (
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${(100 * detractors) / ratedForBar}%` }}
                transition={{ duration: 0.4, ease: 'easeOut', delay: 0.1 }}
                className="h-full bg-gradient-to-r from-rose-400 to-rose-500"
              />
            )}
          </div>
          <div className="flex items-center justify-between gap-1 mt-1.5 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('fa.promoters').replace('{n}', String(promoters))}</span>
            </span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-amber-300 dark:bg-amber-500/70 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('fa.passive').replace('{n}', String(passives))}</span>
            </span>
            <span className="flex items-center gap-1 min-w-0">
              <span className="w-2 h-2 rounded-full bg-rose-500 shrink-0" aria-hidden="true" />
              <span className="truncate">{t('fa.detractors').replace('{n}', String(detractors))}</span>
            </span>
          </div>
        </div>
      )}

      {/* §RATING-DISTRIBUTION: proportional bars per star level (5→1). */}
      {data.rated > 0 && (
        <div className="rounded-xl p-4 bg-card border border-border shadow-sm">
          <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5 text-foreground">
            <Star className="w-3.5 h-3.5 text-amber-500" aria-hidden="true" />
            {t('fa.distribution')}
          </h3>
          <div className="space-y-1.5">
            {distribution.map((d) => (
              <div key={d.stars} className="flex items-center gap-1.5">
                <span className="text-[10px] font-medium text-muted-foreground w-4 text-right tabular-nums">
                  {d.stars}
                </span>
                <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" aria-hidden="true" />
                <div className="flex-1 h-2 rounded-full bg-muted dark:bg-muted/70 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(d.count / maxCount) * 100}%` }}
                    transition={{ duration: 0.35, ease: 'easeOut' }}
                    className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500"
                  />
                </div>
                <span className="text-[10px] text-muted-foreground w-4 tabular-nums">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* §PRODUCT-LEADERBOARD: best-rated products (tap → product profile). */}
      {topRated.length > 0 && (
        <div className="rounded-xl p-4 bg-card border border-border shadow-sm">
          <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5 text-foreground">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500" aria-hidden="true" />
            {t('fa.topRated')}
          </h3>
          <div className="space-y-1.5" role="list" aria-label={t('fa.topRated')}>
            {topRated.map((p, i) => (
              <motion.button
                key={p.productId}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                onClick={() => openProduct(p.productId)}
                className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-muted/60 transition-colors text-left"
                aria-label={t('fa.aria.openProfile').replace('{name}', p.name)}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.name}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Stars rating={Math.round(p.avgRating ?? 0)} />
                    <span className="text-[10px] text-muted-foreground">
                      {(p.reviews === 1 ? t('fa.reviewLine.one') : t('fa.reviewLine.many'))
                        .replace('{n}', String(p.reviews))
                        .replace('{p}', String(p.responseRate))}
                    </span>
                  </div>
                </div>
                <span className="text-sm font-bold text-amber-700 dark:text-amber-300 tabular-nums shrink-0">
                  {(p.avgRating ?? 0).toFixed(1)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* §NEEDS-ATTENTION: rated products under 3★ — the merchant's fix list. */}
      {needsAttention.length > 0 && (
        <div className="rounded-xl p-4 border border-rose-200/70 dark:border-rose-900/40 bg-gradient-to-br from-rose-50/80 to-orange-50/50 dark:from-rose-950/20 dark:to-orange-950/10 shadow-sm">
          <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {t('fa.needsAttention')}
          </h3>
          <div className="space-y-1.5" role="list" aria-label={t('fa.aria.needsAttention')}>
            {needsAttention.map((p) => (
              <motion.button
                key={p.productId}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                onClick={() => openProduct(p.productId)}
                className="w-full flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-rose-100/50 dark:hover:bg-rose-950/40 transition-colors text-left"
                aria-label={t('fa.aria.openProfile').replace('{name}', p.name)}
              >
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.name}</p>
                  <Stars rating={Math.round(p.avgRating ?? 0)} />
                </div>
                <span className="text-sm font-bold text-rose-700 dark:text-rose-300 tabular-nums shrink-0">
                  {(p.avgRating ?? 0).toFixed(1)}
                </span>
              </motion.button>
            ))}
          </div>
        </div>
      )}

      {/* §RECENT-REVIEWS: latest submitted reviews with comments. */}
      {data.recentReviews.length > 0 && (
        <div className="rounded-xl p-4 bg-card border border-border shadow-sm">
          <h3 className="text-xs font-semibold mb-2.5 flex items-center gap-1.5 text-foreground">
            <Quote className="w-3.5 h-3.5 text-muted-foreground" aria-hidden="true" />
            {t('fa.recent')}
          </h3>
          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1" role="list" aria-label={t('fa.recent')}>
            {data.recentReviews.map((r) => (
              <article key={r.id} className="p-2 rounded-lg hover:bg-muted/50 transition-colors" role="listitem">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Stars rating={r.rating} />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {r.partyName ?? t('fa.customer')}
                    {r.productName ? ` · ${r.productName}` : ''}
                  </span>
                </div>
                {r.comment && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    &ldquo;{r.comment}&rdquo;
                  </p>
                )}
                <span className="text-[10px] text-muted-foreground/70">
                  {formatDateTime(r.submittedAt)}
                </span>
              </article>
            ))}
          </div>
        </div>
      )}

      {/* §TRUNCATION-NOTE: honest display when the rollup hit MAX_ROWS. */}
      {data.truncated && (
        <p className="text-[10px] text-muted-foreground text-center">
          {t('fa.truncated').replace('{n}', String(data.total))}
        </p>
      )}
    </motion.div>
  )
}

function Stars({ rating }: { rating: number | null }) {
  const { t } = useI18n()
  if (rating == null) return null
  return (
    <span className="flex items-center gap-0.5" aria-label={t('fa.aria.rating').replace('{n}', String(rating))}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}
