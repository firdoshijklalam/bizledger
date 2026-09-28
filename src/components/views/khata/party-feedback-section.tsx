'use client'

import { useFetch, apiPost } from '@/hooks/use-fetch'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Star, MessageSquare, Loader2, AlertTriangle, Clock, Send,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { useState } from 'react'

// §PARTY-FEEDBACK-SECTION: Compact Product Feedback list on the party detail
// page. Shows feedback records requested for this customer, with their rating,
// comment, status, and date. Includes a "Request Feedback" action that
// schedules a feedback request for this party (no product/invoice required —
// they're optional). The calculated timing is read from AppSettings.
//
// §SCOPE-BOUNDARY: this section is for PRODUCT FEEDBACK (post-purchase review
// requests) — it is distinct from the Party's Customer Behaviour rating
// (interaction/service quality) and the AI Credit Trust Score (financial
// credit-worthiness). The header is clearly labeled "Product Feedback" so
// merchants do not confuse these three separate signals.
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

interface FeedbackResponse { items: ProductFeedback[]; total: number; hasMore: boolean }

interface AppSettingsResponse {
  feedbackDelayHours?: number | null
}

const STATUS_BADGE: Record<string, string> = {
  pending: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  scheduled: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  submitted: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  skipped: 'bg-muted text-muted-foreground',
  expired: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) {
    return <span className="text-[10px] text-muted-foreground/60 italic">no rating</span>
  }
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rating: ${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
      <span className="text-[10px] text-muted-foreground/70 ml-1">{rating}/5</span>
    </span>
  )
}

export function PartyFeedbackSection({ partyId, partyName }: { partyId: string; partyName?: string }) {
  const queryParams = new URLSearchParams({ partyId, limit: '20' })
  const { data, loading, error, refetch } = useFetch<FeedbackResponse>(
    `/api/feedback?${queryParams.toString()}`,
    [partyId],
  )
  // §SETTINGS-FETCH: read AppSettings.feedbackDelayHours to display the
  // suggested timing for a new feedback request. Default 48 if unset.
  const { data: settings } = useFetch<AppSettingsResponse>(`/api/app-settings`)
  const feedbackDelayHours = (settings as any)?.feedbackDelayHours ?? 48
  const [requesting, setRequesting] = useState(false)
  const items = data?.items ?? []
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
          Product Feedback
          {pendingCount > 0 && (
            <span className="text-[10px] font-bold text-violet-700 dark:text-violet-300 bg-violet-100 dark:bg-violet-950/40 px-1.5 py-0.5 rounded-full">
              {pendingCount} pending
            </span>
          )}
          {submittedCount > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              {submittedCount} submitted
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
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <Star className="w-6 h-6 text-muted-foreground/30" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">No product feedback requests yet</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1">
          <AnimatePresence initial={false}>
            {items.map((fb) => (
              <motion.article
                key={fb.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex items-start gap-2 p-2 rounded-lg hover:bg-muted/50 transition-colors"
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
      )}
    </section>
  )
}
