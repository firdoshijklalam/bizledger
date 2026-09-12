'use client'

import { useState, useCallback } from 'react'
import { useFetch } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ListTodo, Plus, Loader2, AlertTriangle,
  Clock, BellOff,
} from 'lucide-react'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { FollowUpForm } from '../followup-form'
import { FollowUpDetailSheet } from '../followup-detail-sheet'

// §PARTY-FOLLOWUPS-SECTION: Compact follow-up summary on the party detail page.
// Shows active count + recent follow-ups + a "New" button. Clicking a
// follow-up opens the detail sheet.
//
// §ORDERING: follows the API result (dueAt ASC NULLS LAST, createdAt DESC,
// id DESC). The UI does NOT re-sort — it renders items in the order the API
// returns them.
//
// §FILTERS: lightweight UI filters that map to API query params.

interface FollowUp {
  id: string
  followUpNumber: string
  type: string
  title: string
  status: string
  priority: string
  dueAt: string | null
  snoozedUntil: string | null
  completedAt: string | null
  createdAt: string
  assignedToId: string | null
  assignedTo?: { id: string; name: string | null } | null
  party?: { id: string; name: string } | null
}

interface FollowUpsResponse { items: FollowUp[]; total: number; hasMore: boolean }

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  IN_PROGRESS: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  SNOOZED: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CANCELLED: 'bg-muted text-muted-foreground',
}

const PRIORITY_DOT: Record<string, string> = {
  LOW: 'bg-muted-foreground/40',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

// Active = PENDING, IN_PROGRESS, SNOOZED (not COMPLETED/CANCELLED)
const ACTIVE_STATUSES = ['PENDING', 'IN_PROGRESS', 'SNOOZED']

const FILTER_STATUSES = ['', 'PENDING', 'IN_PROGRESS', 'SNOOZED', 'COMPLETED', 'CANCELLED']
const FILTER_PRIORITIES = ['', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']

const TYPE_LABELS: Record<string, string> = {
  payment_reminder: 'Payment',
  product_feedback: 'Feedback',
  complaint_followup: 'Complaint',
  reorder_reminder: 'Reorder',
  warranty_expiry: 'Warranty',
  callback: 'Callback',
  offer: 'Offer',
  birthday: 'Birthday',
  manual: 'Manual',
  generic_custom: 'Custom',
}

export function PartyFollowupsSection({ partyId }: { partyId: string }) {
  const [statusFilter, setStatusFilter] = useState('')
  const [priorityFilter, setPriorityFilter] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  // §BUILD-URL: filters map to API query params. The API handles validation.
  const queryParams = new URLSearchParams({ partyId, limit: '20' })
  if (statusFilter) queryParams.set('status', statusFilter)
  if (priorityFilter) queryParams.set('priority', priorityFilter)
  if (overdueOnly) queryParams.set('overdue', 'true')

  const { data, loading, error, refetch } = useFetch<FollowUpsResponse>(
    `/api/followups?${queryParams.toString()}`,
    [partyId, statusFilter, priorityFilter, overdueOnly]
  )
  const followUps = data?.items ?? []

  const [showForm, setShowForm] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const activeCount = followUps.filter(f => ACTIVE_STATUSES.includes(f.status)).length
  const overdueCount = followUps.filter(f =>
    f.status === 'PENDING' && f.dueAt && new Date(f.dueAt) < new Date() && !f.snoozedUntil
  ).length

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [setDetailId, setDetailOpen])

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <ListTodo className="w-4 h-4 text-indigo-500" />
          Follow-ups
          {activeCount > 0 && (
            <span className="text-[10px] font-bold text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/40 px-1.5 py-0.5 rounded-full">
              {activeCount} active
            </span>
          )}
          {overdueCount > 0 && (
            <span className="text-[10px] font-bold text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/40 px-1.5 py-0.5 rounded-full">
              {overdueCount} overdue
            </span>
          )}
        </h3>
        <button
          onClick={() => setShowForm(true)}
          className="text-[10px] font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-100 dark:bg-indigo-950/40 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-indigo-200 dark:hover:bg-indigo-900/40 transition-colors"
          aria-label="Create new follow-up"
        >
          <Plus className="w-3 h-3" /> New
        </button>
      </div>

      {/* §FILTERS: lightweight dropdowns */}
      {followUps.length > 0 && (
        <div className="flex items-center gap-2 mb-3">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="text-[10px] h-7 rounded-md border border-input bg-background px-2"
            aria-label="Filter by status"
          >
            {FILTER_STATUSES.map(s => (
              <option key={s} value={s}>{s || 'All Status'}</option>
            ))}
          </select>
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="text-[10px] h-7 rounded-md border border-input bg-background px-2"
            aria-label="Filter by priority"
          >
            {FILTER_PRIORITIES.map(p => (
              <option key={p} value={p}>{p || 'All Priority'}</option>
            ))}
          </select>
          <button
            onClick={() => setOverdueOnly(!overdueOnly)}
            className={`text-[10px] font-medium px-2 h-7 rounded-md border transition-colors ${
              overdueOnly
                ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900/50'
                : 'bg-background text-muted-foreground border-input hover:bg-muted/50'
            }`}
            aria-pressed={overdueOnly}
          >
            Overdue
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{typeof error === 'string' ? error : (error as any)?.message || 'Couldn&apos;t load follow-ups'}</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : followUps.length === 0 ? (
        /* §EMPTY-STATE */
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <ListTodo className="w-6 h-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {statusFilter || priorityFilter || overdueOnly ? 'No follow-ups match the filter' : 'No follow-ups yet'}
          </p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1">
          <AnimatePresence initial={false}>
            {followUps.map((fu) => {
              const isOverdue = fu.status === 'PENDING' && fu.dueAt && new Date(fu.dueAt) < new Date() && !fu.snoozedUntil
              return (
                <motion.button
                  key={fu.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  onClick={() => openDetail(fu.id)}
                  className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
                >
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[fu.priority] || PRIORITY_DOT.MEDIUM}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-medium text-muted-foreground">{fu.followUpNumber}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[fu.status] || STATUS_BADGE.PENDING}`}>
                        {fu.status}
                      </span>
                      {isOverdue && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                          Overdue
                        </span>
                      )}
                      {fu.status === 'SNOOZED' && fu.snoozedUntil && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          <BellOff className="w-2.5 h-2.5 inline mr-0.5" />
                          {formatDateTime(fu.snoozedUntil)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs font-medium truncate mt-0.5">{fu.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-muted-foreground/70">{TYPE_LABELS[fu.type] || fu.type}</span>
                      {fu.dueAt && (
                        <span className={`text-[10px] ${isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground/70'}`}>
                          <Clock className="w-2.5 h-2.5 inline mr-0.5" />
                          {formatDateTime(fu.dueAt)}
                        </span>
                      )}
                      {fu.assignedTo?.name && (
                        <span className="text-[10px] text-muted-foreground/70">• {fu.assignedTo.name}</span>
                      )}
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <FollowUpForm
        open={showForm}
        onOpenChange={setShowForm}
        partyId={partyId}
        onSaved={() => refetch()}
      />

      <FollowUpDetailSheet
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
        followUpId={detailId}
        onUpdated={() => refetch()}
      />
    </div>
  )
}
