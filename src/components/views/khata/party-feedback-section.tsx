'use client'

import { useFetch } from '@/hooks/use-fetch'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Star, MessageSquare, Loader2, AlertTriangle, Clock,
} from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

// §PARTY-FEEDBACK-SECTION: Compact Product Feedback list on the party detail
// page. Shows feedback records requested for this customer, with their rating,
// comment, status, and date.
//
// §SCOPE-BOUNDARY: this section is for PRODUCT FEEDBACK (post-purchase review
// requests) — it is distinct from the Party's Customer Behaviour rating
// (interaction/service quality) and the AI Credit Trust Score (financial
// credit-worthiness). The header is clearly labeled "Product Feedback" so
// merchants do not confuse these three separate signals.
//
// §NO-CREATION-FORM: this section is read-only. Feedback requests are created
// via POST /api/feedback (e.g. from the invoice flow or a future dedicated
// action). The component surfaces existing records for review only.

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

export function PartyFeedbackSection({ partyId }: { partyId: string }) {
  const queryParams = new URLSearchParams({ partyId, limit: '20' })
  const { data, loading, error } = useFetch<FeedbackResponse>(
    `/api/feedback?${queryParams.toString()}`,
    [partyId],
  )
  const items = data?.items ?? []
  const submittedCount = items.filter((f) => f.status === 'submitted').length
  const pendingCount = items.filter((f) => f.status === 'pending' || f.status === 'scheduled').length

  return (
    <section
      className="rounded-2xl bg-card border border-border p-4 shadow-sm"
      aria-label="Product Feedback section"
    >
      <header className="flex items-center justify-between mb-3">
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
      </header>

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
