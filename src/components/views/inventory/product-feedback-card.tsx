'use client'

import { useFetch } from '@/hooks/use-fetch'
import { motion, AnimatePresence } from 'framer-motion'
import { Star, MessageSquare, Clock, ThumbsUp } from 'lucide-react'
import { formatDateTime } from '@/lib/utils'

// §PRODUCT-FEEDBACK-CARD: per-product feedback summary on the Inventory
// product profile. Mirrors the party-profile insights strip (avg rating +
// response rate + recent reviews) but scoped to ONE product — so merchants
// can see how a specific item is performing without opening each customer.
//
// §DATA-CONTRACT: useFetch EXTRACTS paginated envelopes — `/api/feedback`
// returns {items, total, hasMore}, so `data` IS the items ARRAY.
//
// §RENDER-GATE: the card renders NOTHING when the product has no feedback
// records (keeps profiles of un-reviewed products uncluttered).

interface ProductFeedbackItem {
  id: string
  status: string
  rating: number | null
  comment: string | null
  requestedAt: string | null
  submittedAt: string | null
  createdAt: string
  party?: { id: string; name: string } | null
}

export function ProductFeedbackCard({
  productId,
  feedbackDelayHours,
}: {
  productId: string
  feedbackDelayHours?: number | null
}) {
  const queryParams = new URLSearchParams({ productId, limit: '50' })
  const { data } = useFetch<ProductFeedbackItem[]>(
    `/api/feedback?${queryParams.toString()}`,
    [productId],
  )
  const items = data ?? []

  // §RENDER-GATE: nothing to show yet — don't clutter the profile.
  if (items.length === 0) return null

  const submitted = items.filter((f) => f.status === 'submitted')
  const rated = submitted.filter((f) => f.rating != null)
  const avg =
    rated.length > 0 ? rated.reduce((s, f) => s + (f.rating ?? 0), 0) / rated.length : null
  const responseRate = Math.round((submitted.length / items.length) * 100)
  // §RECENT: newest submitted reviews first (max 3 to stay compact).
  const recent = [...submitted]
    .sort((a, b) => new Date(b.submittedAt ?? b.createdAt).getTime() - new Date(a.submittedAt ?? a.createdAt).getTime())
    .slice(0, 3)

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl bg-card border border-border p-4 shadow-sm"
      aria-label="Customer feedback section"
    >
      <header className="flex items-center justify-between mb-3 gap-2">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-emerald-500" aria-hidden="true" />
          Customer Feedback
          {submitted.length > 0 && (
            <span className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded-full">
              {submitted.length} review{submitted.length === 1 ? '' : 's'}
            </span>
          )}
        </h3>
        {/* §DELAY-CHIP: surfaces this product's per-product feedback delay
            override (empty = business default, not shown). */}
        {feedbackDelayHours != null && (
          <span className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-full flex items-center gap-1">
            <Clock className="w-2.5 h-2.5" aria-hidden="true" />
            {feedbackDelayHours}h delay
          </span>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 mb-3">
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
              <Stars rating={Math.round(avg)} />
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
            aria-label="Feedback response rate for this product"
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
            {submitted.length} of {items.length} responded
          </p>
        </div>
      </div>

      {/* §RECENT-REVIEWS: newest first, max 3, compact rows. */}
      {recent.length > 0 && (
        <div className="space-y-1.5 max-h-44 overflow-y-auto scroll-area pr-1" role="list" aria-label="Recent reviews">
          <AnimatePresence initial={false}>
            {recent.map((fb) => (
              <motion.article
                key={fb.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="p-2 rounded-lg hover:bg-muted/50 transition-colors"
                role="listitem"
              >
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Stars rating={fb.rating} />
                  <span className="text-[10px] font-medium text-muted-foreground">
                    {fb.party?.name ?? 'Customer'}
                  </span>
                </div>
                {fb.comment && (
                  <p className="text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                    &ldquo;{fb.comment}&rdquo;
                  </p>
                )}
                {fb.submittedAt && (
                  <span className="text-[10px] text-muted-foreground/70">
                    submitted {formatDateTime(fb.submittedAt)}
                  </span>
                )}
              </motion.article>
            ))}
          </AnimatePresence>
        </div>
      )}
    </motion.section>
  )
}

function Stars({ rating }: { rating: number | null }) {
  if (rating == null) return null
  return (
    <span className="flex items-center gap-0.5" aria-label={`Rating: ${rating} of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={`w-3 h-3 ${n <= rating ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/30'}`}
        />
      ))}
    </span>
  )
}
