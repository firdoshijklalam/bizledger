'use client'

import { useFetch, apiPost } from '@/hooks/use-fetch'
import { useI18n } from '@/store/i18n-store'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Star, MessageSquare, Loader2, AlertTriangle, Clock, Send, ThumbsUp,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useState } from 'react'

// §PARTY-FEEDBACK-SECTION: Product Feedback list + insights on the party
// detail page. Shows feedback records requested for this customer, with their
// rating, comment, status, and date, plus an INSIGHTS STRIP (average rating,
// response rate, rating distribution). Includes a "Request Feedback" action
// that schedules a feedback request for this party (no product/invoice
// required — they're optional). The calculated timing is read from AppSettings.
//
// §SCOPE-BOUNDARY: this section is for PRODUCT FEEDBACK (post-purchase review
// requests) — it is distinct from the Party's Customer Behaviour rating
// (interaction/service quality) and the AI Credit Trust Score (financial
// credit-worthiness). The header is clearly labeled "Product Feedback" so
// merchants do not confuse these three separate signals.
//
// §DATA-CONTRACT (envelope-mismatch fix): useFetch EXTRACTS paginated
// envelopes — `/api/feedback` returns {items, total, hasMore}, so `data` IS
// the items ARRAY. Previously typed as the envelope (`data?.items`), which
// made the list always render empty.
//
// §CREATE-FLOW: the "Request Feedback" button calls POST /api/feedback with
// just { partyId }. The server resolves the effective delay (Product
// override > AppSettings default), schedules the request at now + delayHours,
// and creates a linked FollowUp reminder. On 409 (duplicate), toast.error
// informs the merchant. On success, toast.success + refetch the list.

interface ProductFeedback {
  id: string
  status: string // pending | scheduled | submitted | skipped | expired
  rating: number | null // 1-5, null until submitted
  comment: string | null
  requestedAt: string | null
  submittedAt: string | null
  createdAt: string
  product?: { id: string; name: string; sku?: string | null } | null
  invoice?: { id: string; invoiceNumber: string; grandTotal: number } | null
  followUp?: { id: string; followUpNumber: string; status: string; dueAt: string | null } | null
}

interface AppSettingsResponse {
  feedbackDelayHours?: number | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  scheduled: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300',
  submitted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  skipped: 'bg-muted text-muted-foreground',
  expired: 'bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300',
}

function Stars({ rating, size = 'sm' }: { rating: number | null; size?: 'sm' | 'md' }) {
  if (rating == null) {
    return <span className="text-[10px] text-muted-foreground/60 italic">no rating</span>
  }
  const dim = size === 'md' ? 'w-4 h-4' : 'w-3 h-3'
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rating: ${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`${dim} ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
      {size === 'sm' && <span className="text-[10px] text-muted-foreground/70 ml-1">{rating}/5</span>}
    </span>
  )
}

// §INSIGHTS: aggregate feedback analytics for this customer. Only rendered
// when at least one record exists. Average + distribution derive from
// SUBMITTED records with a rating; response rate = submitted / all requests.
function FeedbackInsights({ items }: { items: ProductFeedback[] }) {
  const total = items.length
  const submitted = items.filter((f) => f.status === 'submitted')
  const rated = submitted.filter((f) => f.rating != null)
  const avg = rated.length > 0 ? rated.reduce((s, f) => s + (f.rating ?? 0), 0) / rated.length : null
  const responseRate = total > 0 ? Math.round((submitted.length / total) * 100) : 0
  const distribution = [5, 4, 3, 2, 1].map((n) => ({
    stars: n,
    count: rated.filter((f) => f.rating === n).length,
  }))
  const maxCount = Math.max(1, ...distribution.map((d) => d.count))

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="mb-3"
      aria-label="Feedback insights"
    >
      <div className="grid grid-cols-2 gap-2">
        {/* §AVG-RATING */}
        <div className="rounded-xl p-2.5 border border-amber-200/60 dark:border-amber-900/30 bg-gradient-to-br from-amber-50 to-orange-50/70 dark:from-amber-950/25 dark:to-orange-950/15">
          <p className="text-[10px] font-medium text-amber-800/80 dark:text-amber-300/80 uppercase tracking-wide">
            Avg rating
          </p>
          {avg != null ? (
            <>
              <p className="text-xl font-bold text-amber-900 dark:text-amber-200 leading-tight tabular-nums">
                {avg.toFixed(1)}
                <span className="text-xs font-normal text-amber-700/60 dark:text-amber-300/60">/5</span>
              </p>
              <Stars rating={Math.round(avg)} size="md" />
              <p className="text-[10px] text-amber-800/70 dark:text-amber-300/70 mt-0.5">
                {rated.length} review{rated.length === 1 ? '' : 's'}
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-800/50 dark:text-amber-300/50 mt-1.5">No ratings yet</p>
          )}
        </div>

        {/* §RESPONSE-RATE */}
        <div className="rounded-xl p-2.5 border border-emerald-200/60 dark:border-emerald-900/30 bg-gradient-to-br from-emerald-50 to-teal-50/70 dark:from-emerald-950/25 dark:to-teal-950/15">
          <p className="text-[10px] font-medium text-emerald-800/80 dark:text-emerald-300/80 uppercase tracking-wide">
            Response rate
          </p>
          <p className="text-xl font-bold text-emerald-900 dark:text-emerald-200 leading-tight tabular-nums">
            {responseRate}
            <span className="text-xs font-normal text-emerald-700/60 dark:text-emerald-300/60">%</span>
          </p>
          <div
            className="h-1.5 rounded-full bg-emerald-900/10 dark:bg-emerald-100/10 overflow-hidden mt-1"
            role="progressbar"
            aria-valuenow={responseRate}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Feedback response rate"
          >
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${responseRate}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
              className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500"
            />
          </div>
          <p className="text-[10px] text-emerald-800/70 dark:text-emerald-300/70 mt-1 flex items-center gap-0.5">
            <ThumbsUp className="w-2.5 h-2.5" aria-hidden="true" />
            {submitted.length} of {total} responded
          </p>
        </div>
      </div>

      {/* §RATING-DISTRIBUTION: proportional bars per star level (5→1). */}
      {rated.length > 0 && (
        <div className="mt-2 rounded-xl p-2.5 bg-muted/40 border border-border/60 space-y-1">
          {distribution.map((d) => (
            <div key={d.stars} className="flex items-center gap-1.5">
              <span className="text-[10px] font-medium text-muted-foreground w-4 text-right tabular-nums">
                {d.stars}
              </span>
              <Star className="w-2.5 h-2.5 fill-amber-400 text-amber-400 shrink-0" aria-hidden="true" />
              <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
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
      )}
    </motion.div>
  )
}

export function PartyFeedbackSection({ partyId, partyName }: { partyId: string; partyName?: string }) {
  const { t } = useI18n()
  const queryParams = new URLSearchParams({ partyId, limit: '20' })
  // §ARRAY-CONTRACT: `data` IS the feedback list (see §DATA-CONTRACT above).
  const { data, loading, error, refetch } = useFetch<ProductFeedback[]>(
    `/api/feedback?${queryParams.toString()}`,
    [partyId],
  )
  // §SETTINGS-FETCH: read AppSettings.feedbackDelayHours to display the
  // suggested timing for a new feedback request. Default 48 if unset.
  const { data: settings } = useFetch<AppSettingsResponse>(`/api/app-settings`)
  const feedbackDelayHours = (settings as any)?.feedbackDelayHours ?? 48
  const [requesting, setRequesting] = useState(false)
  const items = data ?? []
  const submittedCount = items.filter((f) => f.status === 'submitted').length
  const pendingCount = items.filter((f) => f.status === 'pending' || f.status === 'scheduled').length

  async function handleRequestFeedback() {
    setRequesting(true)
    try {
      await apiPost('/api/feedback', { partyId })
      toast.success('Feedback request scheduled')
      await refetch()
    } catch (e: any) {
      // §DEDUP: an active feedback request already exists for this party.
      // The server returns 409; apiPost throws Error with the server message.
      const msg = e?.message ?? ''
      if (msg.includes('already exists') || msg.includes('HTTP 409')) {
        toast.error('An active feedback request already exists')
      } else {
        toast.error(msg || 'Failed to schedule feedback request')
      }
    } finally {
      setRequesting(false)
    }
  }

  return (
    <section
      className="rounded-2xl bg-card border border-border p-4 shadow-sm"
      aria-label="Product Feedback section"
    >
      <header className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          {t('pp.productFeedback')}
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/40 px-1.5 py-0.5 rounded-full">
              {t('pp.nPending').replace('{n}', String(pendingCount))}
            </span>
          )}
          {submittedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              {t('pp.nSubmitted').replace('{n}', String(submittedCount))}
            </span>
          )}
        </h3>
        {/* §REQUEST-FEEDBACK: schedules a feedback request for this party.
            No product/invoice required — they're optional. The server
            resolves the effective delay (Product override > AppSettings
            default) and creates a linked FollowUp reminder. */}
        <button
          type="button"
          onClick={handleRequestFeedback}
          disabled={requesting}
          aria-label="Request product feedback"
          className="text-[10px] font-medium text-primary bg-primary/10 hover:bg-primary/20 disabled:opacity-50 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
        >
          {requesting ? (
            <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="w-3 h-3" aria-hidden="true" />
          )}
          Request Feedback
        </button>
      </header>

      {/* §TIMING-NOTE: shows the suggested delay before the request fires.
          Reads from AppSettings.feedbackDelayHours (default 48). */}
      <p className="text-[10px] text-muted-foreground/70 mb-2 flex items-center gap-1">
        <Clock className="w-2.5 h-2.5 inline" aria-hidden="true" />
        Feedback will be requested in ~{feedbackDelayHours} hour{feedbackDelayHours === 1 ? '' : 's'}
      </p>

      <p className="sr-only">
        Product Feedback records for this customer. This is separate from the
        Customer Behaviour rating and the AI Credit Trust Score.
      </p>

      {loading ? (
        <div className="flex items-center justify-center py-6" role="status" aria-live="polite">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
          <span className="sr-only">Loading product feedback…</span>
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2" role="alert">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">
            {typeof error === 'string' ? error : (error as any)?.message || 'Couldn&apos;t load product feedback'}
          </p>
          <button
            type="button"
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <Star className="w-6 h-6 text-muted-foreground/30" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">No product feedback requests yet</p>
          <p className="text-[10px] text-muted-foreground/60">
            Tap &ldquo;Request Feedback&rdquo; to schedule one for {partyName || 'this customer'}
          </p>
        </div>
      ) : (
        <>
          {/* §INSIGHTS-STRIP: avg rating + response rate + distribution. */}
          <FeedbackInsights items={items} />

          <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1" role="list" aria-label="Feedback records">
            <AnimatePresence initial={false}>
              {items.map((fb) => (
                <motion.article
                  key={fb.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                  role="listitem"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[fb.status] || STATUS_BADGE.pending}`}
                      >
                        {fb.status}
                      </span>
                      <Stars rating={fb.rating} />
                    </div>
                    <p className="text-xs font-medium truncate mt-0.5">
                      {fb.product?.name ?? 'General purchase'}
                    </p>
                    {fb.comment && (
                      <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        &ldquo;{fb.comment}&rdquo;
                      </p>
                    )}
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {fb.requestedAt && (
                        <span className="text-[10px] text-muted-foreground/70 flex items-center">
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" aria-hidden="true" />
                          requested {formatDateTime(fb.requestedAt)}
                        </span>
                      )}
                      {fb.submittedAt && (
                        <span className="text-[10px] text-muted-foreground/70">
                          submitted {formatDateTime(fb.submittedAt)}
                        </span>
                      )}
                      {fb.invoice?.invoiceNumber && (
                        <span className="text-[10px] text-muted-foreground/70">
                          • {fb.invoice.invoiceNumber}
                        </span>
                      )}
                    </div>
                  </div>
                </motion.article>
              ))}
            </AnimatePresence>
          </div>
        </>
      )}
    </section>
  )
}
