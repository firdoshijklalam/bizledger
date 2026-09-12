'use client'

import { useState, useCallback } from 'react'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { timeAgo, formatDateTime, formatCurrency } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Loader2, AlertTriangle, Clock, Receipt, ArrowDownLeft, ArrowUpRight,
  MessageSquare, FileWarning, GitBranch, Heart, FileText, ChevronDown, ListTodo,
} from 'lucide-react'
import { Button } from '@/components/ui/button'

// §PARTY-TIMELINE-SECTION: Compact composed timeline on the customer profile.
// Fetches from GET /api/parties/[id]/timeline (read-only, no new table).
// Shows newest events first with type-specific icons + colors.

interface TimelineEvent {
  id: string
  type: string
  occurredAt: string
  title: string
  description: string | null
  partyId: string
  entityId: string
  entityType: string
  metadata: Record<string, unknown> | null
}

interface TimelineResponse {
  items: TimelineEvent[]
  total: number
  hasMore: boolean
  offset: number
  limit: number
}

const TYPE_META: Record<string, { icon: typeof Clock; color: string; label: string }> = {
  invoice: { icon: Receipt, color: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-950/40', label: 'Sale' },
  transaction: { icon: ArrowDownLeft, color: 'text-blue-600 bg-blue-100 dark:bg-blue-950/40', label: 'Payment' },
  message: { icon: MessageSquare, color: 'text-violet-600 bg-violet-100 dark:bg-violet-950/40', label: 'Message' },
  complaint: { icon: FileWarning, color: 'text-amber-600 bg-amber-100 dark:bg-amber-950/40', label: 'Complaint' },
  complaint_event: { icon: GitBranch, color: 'text-orange-600 bg-orange-100 dark:bg-orange-950/40', label: 'Complaint Update' },
  behaviour_change: { icon: Heart, color: 'text-purple-600 bg-purple-100 dark:bg-purple-950/40', label: 'Behaviour' },
  note: { icon: FileText, color: 'text-muted-foreground bg-muted', label: 'Note' },
  follow_up: { icon: ListTodo, color: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-950/40', label: 'Follow-up' },
}

export function PartyTimelineSection({ partyId }: { partyId: string }) {
  const [offset, setOffset] = useState(0)
  const limit = 15

  const url = `/api/parties/${partyId}/timeline?limit=${limit}&offset=${offset}`
  const { data, loading, error, refetch } = useFetch<TimelineResponse>(url, [partyId, offset])

  const events = data?.items ?? []
  const hasMore = data?.hasMore ?? false
  const total = data?.total ?? 0

  const loadMore = useCallback(() => {
    setOffset(prev => prev + limit)
  }, [])

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Clock className="w-4 h-4 text-muted-foreground" />
          Timeline
          {total > 0 && <span className="text-xs text-muted-foreground font-normal">{total}</span>}
        </h3>
      </div>

      {loading && offset === 0 ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load timeline</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : events.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <Clock className="w-6 h-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No activity yet</p>
        </div>
      ) : (
        <div className="space-y-1">
          <AnimatePresence initial={false}>
            {events.map((event) => {
              const meta = TYPE_META[event.type] || TYPE_META.note
              const Icon = meta.icon
              return (
                <motion.div
                  key={event.id}
                  layout
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  className="flex gap-2.5 p-2 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${meta.color}`}>
                    <Icon className="w-3.5 h-3.5" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-xs font-medium truncate">{event.title}</span>
                      <span className="text-[10px] text-muted-foreground/70">·</span>
                      <span className="text-[10px] text-muted-foreground" title={formatDateTime(event.occurredAt)}>
                        {timeAgo(event.occurredAt)}
                      </span>
                    </div>
                    {event.description && (
                      <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                        {event.description}
                      </p>
                    )}
                    {/* Metadata badges */}
                    {event.metadata && (
                      <div className="flex items-center gap-1 mt-0.5">
                        {event.type === 'invoice' && event.metadata.grandTotal != null && (
                          <span className="text-[9px] font-medium text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40 px-1.5 py-0.5 rounded">
                            {formatCurrency(event.metadata.grandTotal as number)}
                          </span>
                        )}
                        {event.type === 'transaction' && event.metadata.amount != null && (
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${
                            event.metadata.type === 'credit'
                              ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-100 dark:bg-emerald-950/40'
                              : 'text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/40'
                          }`}>
                            {event.metadata.type === 'credit' ? '+' : '-'}{formatCurrency(event.metadata.amount as number)}
                          </span>
                        )}
                        {event.type === 'complaint' && event.metadata.status != null && (
                          <span className="text-[9px] font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">
                            {String(event.metadata.status)}
                          </span>
                        )}
                        {event.type === 'behaviour_change' && event.metadata.rating != null && (
                          <span className="text-[9px] font-medium text-purple-700 dark:text-purple-300 bg-purple-100 dark:bg-purple-950/40 px-1.5 py-0.5 rounded">
                            {String(event.metadata.rating)}
                          </span>
                        )}
                        {event.type === 'follow_up' && event.metadata.followUpNumber != null && (
                          <span className="text-[9px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded">
                            {String(event.metadata.followUpNumber)}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </AnimatePresence>

          {loading && offset > 0 && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {hasMore && !loading && (
            <button
              onClick={loadMore}
              className="w-full mt-2 py-2 text-xs font-medium text-primary bg-primary/5 hover:bg-primary/10 rounded-lg flex items-center justify-center gap-1 transition-colors"
            >
              Load more <ChevronDown className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
    </div>
  )
}
