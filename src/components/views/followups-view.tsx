'use client'

import { useState, useCallback, useMemo } from 'react'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ListTodo, Plus, Loader2, AlertTriangle, Filter, X,
  Clock, BellOff, Check, Play, Pause, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { FollowUpForm } from './followup-form'
import { FollowUpDetailSheet } from './followup-detail-sheet'

// §FOLLOWUPS-VIEW: Global follow-up work queue / board.
//
// §PATTERN: mirrors ComplaintsView — useFetch with query params, filter chips,
// list rendering with motion.div, Form + DetailSheet at the bottom.
//
// §FILTERS: status, priority, overdue — all use existing API query parameters.
// No client-side filtering of a large dataset.
//
// §SUMMARY: lightweight metrics derived from the fetched list. For exact
// counts across all statuses, the API's `total` field is used.
//
// §ACTIONS: transition buttons per status, using the existing /transition API.
// Duplicate submission prevented via `transitioning` state.

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
  party?: { id: string; name: string; phone?: string | null } | null
  assignedTo?: { id: string; name: string | null } | null
}

interface FollowUpsResponse { items: FollowUp[]; total: number; hasMore: boolean }

type StatusFilter = 'ALL' | 'PENDING' | 'IN_PROGRESS' | 'SNOOZED' | 'COMPLETED' | 'CANCELLED'
type PriorityFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type SortMode = 'due_soonest' | 'oldest_overdue' | 'priority' | 'recently_created'

const STATUS_META: Record<string, { label: string; color: string }> = {
  PENDING: { label: 'Pending', color: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300' },
  IN_PROGRESS: { label: 'In Progress', color: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300' },
  SNOOZED: { label: 'Snoozed', color: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' },
  COMPLETED: { label: 'Completed', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' },
  CANCELLED: { label: 'Cancelled', color: 'bg-muted text-muted-foreground' },
}

const PRIORITY_DOT: Record<string, string> = {
  LOW: 'bg-muted-foreground/40',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

const TYPE_LABELS: Record<string, string> = {
  payment_reminder: 'Payment', product_feedback: 'Feedback',
  complaint_followup: 'Complaint', reorder_reminder: 'Reorder',
  warranty_expiry: 'Warranty', callback: 'Callback',
  offer: 'Offer', birthday: 'Birthday',
  manual: 'Manual', generic_custom: 'Custom',
}

const STATUS_FILTERS: StatusFilter[] = ['ALL', 'PENDING', 'IN_PROGRESS', 'SNOOZED', 'COMPLETED', 'CANCELLED']
const PRIORITY_FILTERS: PriorityFilter[] = ['ALL', 'URGENT', 'HIGH', 'MEDIUM', 'LOW']

const SORT_OPTIONS: Array<{ value: SortMode; label: string }> = [
  { value: 'due_soonest', label: 'Due Soonest' },
  { value: 'oldest_overdue', label: 'Oldest Overdue' },
  { value: 'priority', label: 'Priority' },
  { value: 'recently_created', label: 'Recently Created' },
]

const PRIORITY_ORDER: Record<string, number> = { URGENT: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

// §CLIENT-SORT: sorts the fetched dataset client-side. Does NOT change the
// API's server-side ordering. Applied AFTER useFetch returns data.
function sortItems(items: FollowUp[], mode: SortMode): FollowUp[] {
  const sorted = [...items]
  switch (mode) {
    case 'due_soonest':
      // earliest non-null dueAt first; null dueAt last
      sorted.sort((a, b) => {
        if (!a.dueAt && !b.dueAt) return b.id.localeCompare(a.id)
        if (!a.dueAt) return 1
        if (!b.dueAt) return -1
        const diff = new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      break
    case 'oldest_overdue':
      // overdue items first (oldest dueAt), then non-overdue (newest createdAt)
      sorted.sort((a, b) => {
        const now = Date.now()
        const aOverdue = a.status === 'PENDING' && a.dueAt && new Date(a.dueAt).getTime() < now && !a.snoozedUntil
        const bOverdue = b.status === 'PENDING' && b.dueAt && new Date(b.dueAt).getTime() < now && !b.snoozedUntil
        if (aOverdue && !bOverdue) return -1
        if (!aOverdue && bOverdue) return 1
        if (aOverdue && bOverdue) {
          const diff = new Date(a.dueAt!).getTime() - new Date(b.dueAt!).getTime()
          return diff !== 0 ? diff : b.id.localeCompare(a.id)
        }
        // both non-overdue: newest createdAt first
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      break
    case 'priority':
      // URGENT → HIGH → MEDIUM → LOW, tie-break by createdAt DESC
      sorted.sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority] ?? 99
        const pb = PRIORITY_ORDER[b.priority] ?? 99
        if (pa !== pb) return pa - pb
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      break
    case 'recently_created':
      // newest createdAt first, id DESC tie-breaker
      sorted.sort((a, b) => {
        const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        return diff !== 0 ? diff : b.id.localeCompare(a.id)
      })
      break
  }
  return sorted
}

// §TRANSITION-ACTIONS: available actions per status (same as detail sheet)
function getActions(status: string): Array<{ toStatus: string; label: string; icon: any; variant?: string }> {
  switch (status) {
    case 'PENDING':
      return [
        { toStatus: 'IN_PROGRESS', label: 'Start', icon: Play },
        { toStatus: 'COMPLETED', label: 'Complete', icon: Check },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'IN_PROGRESS':
      return [
        { toStatus: 'PENDING', label: 'Pending', icon: Pause },
        { toStatus: 'COMPLETED', label: 'Complete', icon: Check },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'SNOOZED':
      return [
        { toStatus: 'PENDING', label: 'Wake', icon: BellOff },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'COMPLETED':
      return [{ toStatus: 'IN_PROGRESS', label: 'Reopen', icon: RotateCcw }]
    case 'CANCELLED':
      return [{ toStatus: 'IN_PROGRESS', label: 'Reopen', icon: RotateCcw }]
    default:
      return []
  }
}

export function FollowupsView() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState<string>('')
  const [sortMode, setSortMode] = useState<SortMode>('due_soonest')
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [transitioning, setTransitioning] = useState<string | null>(null)

  // §ASSIGNEE-LIST: fetch business users for the assignee filter dropdown
  const { data: usersData } = useFetch<any>('/api/staff', [])
  const assignees = useMemo(() => {
    if (!usersData) return []
    if (Array.isArray(usersData)) return usersData
    if (usersData && typeof usersData === 'object' && 'items' in usersData) return (usersData as any).items
    return []
  }, [usersData])

  // §BUILD-QUERY: filters map to API query params
  const query = useMemo(() => {
    const params = new URLSearchParams({ limit: '50' })
    if (statusFilter !== 'ALL') params.set('status', statusFilter)
    if (priorityFilter !== 'ALL') params.set('priority', priorityFilter)
    if (overdueOnly) params.set('overdue', 'true')
    if (assigneeFilter) params.set('assignedToId', assigneeFilter)
    return `/api/followups?${params.toString()}`
  }, [statusFilter, priorityFilter, overdueOnly, assigneeFilter])

  const { data, loading, error, refetch } = useFetch<FollowUpsResponse>(query, [query])

  const items = useMemo<FollowUp[]>(() => {
    if (!data) return []
    if (Array.isArray(data)) return data as FollowUp[]
    if (data && typeof data === 'object' && 'items' in data) return (data as any).items as FollowUp[]
    return []
  }, [data])

  // §CLIENT-SORT: apply the selected sort mode to the fetched items.
  // Does NOT change the API's server-side ordering.
  const sortedItems = useMemo(() => sortItems(items, sortMode), [items, sortMode])

  // §SUMMARY-METRICS: derived from the fetched items
  const now = new Date()
  const openCount = items.filter(f => ['PENDING', 'IN_PROGRESS', 'SNOOZED'].includes(f.status)).length
  const overdueCount = items.filter(f =>
    f.status === 'PENDING' && f.dueAt && new Date(f.dueAt) < now && !f.snoozedUntil
  ).length
  const dueSoonCount = items.filter(f =>
    f.status === 'PENDING' && f.dueAt && new Date(f.dueAt) >= now && new Date(f.dueAt) <= new Date(now.getTime() + 3600000) && !f.snoozedUntil
  ).length
  const highUrgentCount = items.filter(f => ['HIGH', 'URGENT'].includes(f.priority) && ['PENDING', 'IN_PROGRESS'].includes(f.status)).length
  // §COMPLETED-TODAY: completedAt falls within the user's local calendar day.
  // Uses the existing application date convention (JS Date, local timezone).
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const completedTodayCount = items.filter(f =>
    f.status === 'COMPLETED' && f.completedAt && new Date(f.completedAt) >= todayStart
  ).length

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const closeDetail = useCallback((open: boolean) => {
    setDetailOpen(open)
    if (!open) setDetailId(null)
  }, [])

  const handleSaved = useCallback(() => {
    refetch()
    setFormOpen(false)
  }, [refetch])

  const handleUpdated = useCallback(() => {
    refetch()
  }, [refetch])

  const handleTransition = async (fu: FollowUp, toStatus: string) => {
    if (transitioning) return // §DUPLICATE-PREVENTION
    setTransitioning(fu.id)
    try {
      await apiPost(`/api/followups/${fu.id}/transition`, { toStatus })
      toast.success(`Status changed to ${STATUS_META[toStatus]?.label || toStatus}`)
      await refetch()
    } catch (e: any) {
      toast.error(e.message || 'Failed to change status')
    } finally {
      setTransitioning(null)
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-indigo-500" />
          Follow-ups
        </h2>
        <Button onClick={() => setFormOpen(true)} className="h-9 text-xs shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New Follow-up
        </Button>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <div className="rounded-xl bg-card border border-border p-3 text-center">
          <p className="text-xl font-bold text-blue-600 dark:text-blue-400">{openCount}</p>
          <p className="text-[10px] text-muted-foreground">Open</p>
        </div>
        <div className="rounded-xl bg-card border border-border p-3 text-center">
          <p className="text-xl font-bold text-red-600 dark:text-red-400">{overdueCount}</p>
          <p className="text-[10px] text-muted-foreground">Overdue</p>
        </div>
        <div className="rounded-xl bg-card border border-border p-3 text-center">
          <p className="text-xl font-bold text-indigo-600 dark:text-indigo-400">{dueSoonCount}</p>
          <p className="text-[10px] text-muted-foreground">Due Soon</p>
        </div>
        <div className="rounded-xl bg-card border border-border p-3 text-center">
          <p className="text-xl font-bold text-orange-600 dark:text-orange-400">{highUrgentCount}</p>
          <p className="text-[10px] text-muted-foreground">High/Urgent</p>
        </div>
        <div className="rounded-xl bg-card border border-border p-3 text-center">
          <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{completedTodayCount}</p>
          <p className="text-[10px] text-muted-foreground">Done Today</p>
        </div>
      </div>

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
          {STATUS_FILTERS.map(s => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0 transition-colors ${
                statusFilter === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
              aria-pressed={statusFilter === s}
              aria-label={`Filter by status ${s}`}
            >
              {s === 'ALL' ? 'All' : STATUS_META[s]?.label || s}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          {PRIORITY_FILTERS.map(p => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0 transition-colors ${
                priorityFilter === p
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70'
              }`}
              aria-pressed={priorityFilter === p}
              aria-label={`Filter by priority ${p}`}
            >
              {p === 'ALL' ? 'All Priority' : p}
            </button>
          ))}
          <button
            onClick={() => setOverdueOnly(!overdueOnly)}
            className={`text-[10px] font-medium px-2.5 py-1 rounded-full shrink-0 transition-colors ${
              overdueOnly
                ? 'bg-red-600 text-white'
                : 'bg-muted text-muted-foreground hover:bg-muted/70'
            }`}
            aria-pressed={overdueOnly}
            aria-label="Filter overdue only"
          >
            Overdue
          </button>
          {/* §ASSIGNEE-FILTER: dropdown populated from /api/staff (business-scoped) */}
          <select
            value={assigneeFilter}
            onChange={(e) => setAssigneeFilter(e.target.value)}
            className="text-[10px] h-6 rounded-full border border-input bg-background px-2 shrink-0"
            aria-label="Filter by assigned user"
          >
            <option value="">All Assignees</option>
            {assignees.map((u: any) => (
              <option key={u.id} value={u.id}>{u.name || u.email || 'Unknown'}</option>
            ))}
          </select>
        </div>
        {/* §SORT-SELECTION: client-side sort over fetched dataset */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground shrink-0">Sort:</span>
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="text-[10px] h-6 rounded-full border border-input bg-background px-2"
            aria-label="Sort mode"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Content */}
      {loading && items.length === 0 ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">{typeof error === 'string' ? error : (error as any)?.message || 'Failed to load follow-ups'}</p>
          <Button variant="outline" size="sm" className="mt-2 text-xs" onClick={() => refetch()}>Retry</Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center">
          <ListTodo className="w-8 h-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">
            {statusFilter !== 'ALL' || priorityFilter !== 'ALL' || overdueOnly || assigneeFilter
              ? 'No follow-ups match the current filters'
              : 'No follow-ups yet. Create one to get started.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence initial={false}>
            {sortedItems.map((fu) => {
              const isOverdue = fu.status === 'PENDING' && fu.dueAt && new Date(fu.dueAt) < now && !fu.snoozedUntil
              const actions = getActions(fu.status)
              const partyName = fu.party?.name || 'Unknown'
              return (
                <motion.div
                  key={fu.id}
                  layout
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="rounded-xl bg-card border border-border p-3 shadow-sm"
                >
                  {/* Row header: click to open detail */}
                  <button
                    onClick={() => openDetail(fu.id)}
                    className="w-full text-left"
                    aria-label={`Open follow-up ${fu.followUpNumber}: ${fu.title}`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[fu.priority] || PRIORITY_DOT.MEDIUM}`} />
                      <span className="text-[10px] font-mono font-medium text-muted-foreground">{fu.followUpNumber}</span>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_META[fu.status]?.color || ''}`}>
                        {STATUS_META[fu.status]?.label || fu.status}
                      </span>
                      {isOverdue && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                          Overdue
                        </span>
                      )}
                      {fu.status === 'SNOOZED' && fu.snoozedUntil && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                          <BellOff className="w-2.5 h-2.5 inline mr-0.5" />{formatDateTime(fu.snoozedUntil)}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium truncate">{fu.title}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <span className="text-[10px] text-muted-foreground/70">{partyName}</span>
                      <span className="text-[10px] text-muted-foreground/70">•</span>
                      <span className="text-[10px] text-muted-foreground/70">{TYPE_LABELS[fu.type] || fu.type}</span>
                      {fu.dueAt && (
                        <>
                          <span className="text-[10px] text-muted-foreground/70">•</span>
                          <span className={`text-[10px] ${isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : 'text-muted-foreground/70'}`}>
                            <Clock className="w-2.5 h-2.5 inline mr-0.5" />{formatDateTime(fu.dueAt)}
                          </span>
                        </>
                      )}
                      {fu.assignedTo?.name && (
                        <>
                          <span className="text-[10px] text-muted-foreground/70">•</span>
                          <span className="text-[10px] text-muted-foreground/70">{fu.assignedTo.name}</span>
                        </>
                      )}
                    </div>
                  </button>

                  {/* Quick actions */}
                  {actions.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border">
                      {actions.map(a => {
                        const Icon = a.icon
                        return (
                          <button
                            key={a.toStatus}
                            onClick={() => handleTransition(fu, a.toStatus)}
                            disabled={transitioning === fu.id}
                            className={`text-[10px] font-medium px-2 py-1 rounded-md flex items-center gap-1 transition-colors disabled:opacity-50 ${
                              a.variant === 'destructive'
                                ? 'bg-red-100 text-red-700 hover:bg-red-200 dark:bg-red-950/40 dark:text-red-300'
                                : 'bg-muted hover:bg-muted/70 text-muted-foreground'
                            }`}
                            aria-label={`${a.label} follow-up ${fu.followUpNumber}`}
                          >
                            {transitioning === fu.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Icon className="w-3 h-3" />}
                            {a.label}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <FollowUpForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
      />

      <FollowUpDetailSheet
        open={detailOpen}
        onOpenChange={closeDetail}
        followUpId={detailId}
        onUpdated={handleUpdated}
      />
    </div>
  )
}
