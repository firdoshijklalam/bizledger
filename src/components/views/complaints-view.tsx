'use client'

import { useState, useCallback, useMemo } from 'react'
import { useFetch, apiPost, apiPut, apiDelete } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { Plus, MessageSquare, Loader2, AlertTriangle, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { ComplaintForm } from './complaint-form'
import { ComplaintDetailSheet } from './complaint-detail-sheet'

// §COMPLAINT-TYPE: Mirrors the Prisma Complaint model + the relation includes
// returned by GET /api/complaints (party / relatedInvoice / relatedProduct).
interface Complaint {
  id: string
  businessId: string
  complaintNumber: string
  partyId: string | null
  sourceType: string
  title: string
  description: string | null
  status: string
  priority: string
  assignedTo: string | null
  relatedInvoiceId: string | null
  relatedProductId: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  party?: { id: string; name: string; phone: string | null } | null
  relatedInvoice?: { id: string; invoiceNumber: string } | null
  relatedProduct?: { id: string; name: string } | null
}

type StatusFilter = 'ALL' | 'NEW' | 'IN_PROGRESS' | 'WAITING' | 'RESOLVED' | 'CLOSED'
type PriorityFilter = 'ALL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'

// §STATUS-PALETTE: Deliberately distinct from the trust-score palette used in
// khata (emerald/amber/red). NEW→blue signals "fresh", IN_PROGRESS→violet
// signals "active work", WAITING→amber signals "blocked on someone",
// RESOLVED→emerald signals "done good", CLOSED→muted signals "archived".
const STATUS_META: Record<StatusFilter, { label: string; className: string }> = {
  ALL: { label: 'All', className: 'bg-muted text-muted-foreground' },
  NEW: { label: 'New', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  IN_PROGRESS: { label: 'In Progress', className: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300' },
  WAITING: { label: 'Waiting', className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  RESOLVED: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' },
  CLOSED: { label: 'Closed', className: 'bg-muted text-muted-foreground' },
}

// §PRIORITY-PALETTE: Severity ramp from muted→blue→orange→red. URGENT uses red
// to grab attention; LOW uses muted so low-priority items visually recede.
const PRIORITY_META: Record<PriorityFilter, { label: string; className: string }> = {
  ALL: { label: 'All', className: 'bg-muted text-muted-foreground' },
  LOW: { label: 'Low', className: 'bg-muted text-muted-foreground' },
  MEDIUM: { label: 'Medium', className: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  HIGH: { label: 'High', className: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
  URGENT: { label: 'Urgent', className: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
}

const STATUS_OPTIONS: StatusFilter[] = ['ALL', 'NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED']
const PRIORITY_OPTIONS: PriorityFilter[] = ['ALL', 'LOW', 'MEDIUM', 'HIGH', 'URGENT']

// §STATUS-RESOLUTION: Tolerant lookup — server may store status in kebab-case
// or sentence case. Normalize to the canonical uppercase key for badge styling.
function resolveStatus(raw: string | null | undefined): StatusFilter {
  if (!raw) return 'NEW'
  const key = String(raw).toUpperCase().replace(/[-\s]+/g, '_')
  return (STATUS_OPTIONS as string[]).includes(key) ? (key as StatusFilter) : 'NEW'
}

function resolvePriority(raw: string | null | undefined): PriorityFilter {
  if (!raw) return 'MEDIUM'
  const key = String(raw).toUpperCase()
  return (PRIORITY_OPTIONS as string[]).includes(key) ? (key as PriorityFilter) : 'MEDIUM'
}

export function ComplaintsView() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL')
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('ALL')
  const [formOpen, setFormOpen] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  // §FETCH: Build query string with active (non-ALL) filters so the server
  // does the heavy lifting. useFetch will re-fetch automatically when the
  // query key (deps array) changes — switching a chip instantly re-queries.
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (statusFilter !== 'ALL') params.set('status', statusFilter)
    if (priorityFilter !== 'ALL') params.set('priority', priorityFilter)
    const qs = params.toString()
    return qs ? `/api/complaints?${qs}` : '/api/complaints'
  }, [statusFilter, priorityFilter])

  const { data, loading, error, refetch } = useFetch<{ items: Complaint[] } | Complaint[]>(query, [query])

  // §EXTRACT: useFetch auto-extracts `items` only when `total`/`hasMore` is
  // also present. The complaints API returns just `{ items: [...] }`, so
  // handle both shapes (array OR { items: [] }) defensively.
  const items = useMemo<Complaint[]>(() => {
    if (!data) return []
    if (Array.isArray(data)) return data as Complaint[]
    if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as any).items)) {
      return (data as any).items as Complaint[]
    }
    return []
  }, [data])

  // §SORT: Newest first (createdAt desc). Stable for ties on same timestamp.
  const sorted = useMemo(() => {
    return [...items].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime() || 0
      const tb = new Date(b.createdAt).getTime() || 0
      return tb - ta
    })
  }, [items])

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [])

  const closeDetail = useCallback((open: boolean) => {
    setDetailOpen(open)
    if (!open) setDetailId(null)
  }, [])

  // §AFTER-SAVE: After creating a complaint in the form, refetch the list and
  // close the form. The ComplaintForm already shows its own success toast.
  const handleSaved = useCallback(() => {
    refetch()
    setFormOpen(false)
  }, [refetch])

  // §AFTER-UPDATE: After editing a complaint in the detail sheet, refetch the
  // list so the card reflects the new status/priority/assignment immediately.
  const handleUpdated = useCallback(() => {
    refetch()
  }, [refetch])

  const hasActiveFilters = statusFilter !== 'ALL' || priorityFilter !== 'ALL'

  return (
    <div className="space-y-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
      {/* §HEADER: Title + count + New Complaint button */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4 text-primary shrink-0" />
            Complaints
          </h2>
          <p className="text-[11px] text-muted-foreground truncate">
            {sorted.length} {sorted.length === 1 ? 'complaint' : 'complaints'}
            {statusFilter !== 'ALL' && ` · ${STATUS_META[statusFilter].label}`}
            {priorityFilter !== 'ALL' && ` · ${priorityFilter.toLowerCase()} priority`}
          </p>
        </div>
        <Button onClick={() => setFormOpen(true)} className="h-10 shrink-0">
          <Plus className="w-4 h-4 mr-1" /> New Complaint
        </Button>
      </div>

      {/* §STATUS-CHIPS: Horizontal scrollable. Active chip uses bg-primary
          (filled); inactive chips use their semantic status color so the user
          gets a visual preview of what each status looks like. */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        <Filter className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-hidden />
        {STATUS_OPTIONS.map((s) => {
          const meta = STATUS_META[s]
          const active = statusFilter === s
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              aria-pressed={active}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[32px] ${
                active ? 'bg-primary text-primary-foreground shadow-sm' : meta.className
              }`}
            >
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* §PRIORITY-CHIPS: Smaller pill row, uppercase for severity emphasis. */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {PRIORITY_OPTIONS.map((p) => {
          const meta = PRIORITY_META[p]
          const active = priorityFilter === p
          return (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              aria-pressed={active}
              className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-all min-h-[28px] ${
                active ? 'bg-primary text-primary-foreground shadow-sm' : meta.className
              }`}
            >
              {meta.label}
            </button>
          )
        })}
      </div>

      {/* §LOADING-STATE: Show spinner while fetching from API.
          We only show this on the initial load (placeholderData in useFetch
          prevents re-showing it on background refetch). */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-6 h-6 text-primary animate-spin" />
          <span className="ml-2 text-sm text-muted-foreground">Loading complaints…</span>
        </div>
      )}

      {/* §ERROR-STATE: Network/timeout/server errors. Retry button refetches. */}
      {error && !loading && (
        <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6 text-destructive" />
          </div>
          <p className="text-sm font-medium mb-1">Failed to load complaints</p>
          <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{error}</p>
          <button
            onClick={() => refetch()}
            className="text-sm text-primary font-medium inline-flex items-center gap-1"
          >
            <Loader2 className="w-3.5 h-3.5" /> Try again
          </button>
        </div>
      )}

      {/* §LIST-AND-EMPTY: Only render when loaded successfully */}
      {!loading && !error && (
        <>
          {sorted.length === 0 ? (
            // §EMPTY-STATE: Two variants —
            // (A) No filters active: "No complaints yet" + CTA to log first one.
            // (B) Filters active but no matches: hint to clear filters.
            <div className="flex flex-col items-center justify-center py-16 text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mb-4">
                <MessageSquare className="w-8 h-8 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium">
                {hasActiveFilters ? 'No matching complaints' : 'No complaints yet'}
              </p>
              <p className="text-xs text-muted-foreground mt-1 mb-4 max-w-xs">
                {hasActiveFilters
                  ? 'Try a different status or priority filter.'
                  : 'When a customer or supplier raises an issue, it will appear here.'}
              </p>
              {hasActiveFilters ? (
                <button
                  onClick={() => { setStatusFilter('ALL'); setPriorityFilter('ALL') }}
                  className="text-xs text-primary font-medium inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-primary/10"
                >
                  <X className="w-3 h-3" /> Clear filters
                </button>
              ) : (
                <Button onClick={() => setFormOpen(true)} className="h-11">
                  <Plus className="w-4 h-4 mr-1.5" /> Log First Complaint
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {sorted.map((c, i) => {
                  const status = resolveStatus(c.status)
                  const priority = resolvePriority(c.priority)
                  const sMeta = STATUS_META[status]
                  const pMeta = PRIORITY_META[priority]
                  // §CUSTOMER-NAME: "Anonymous" when no party is linked at all;
                  // "Unknown" when a partyId exists but the relation didn't
                  // resolve (rare — usually a deleted party).
                  const customerName = c.party?.name
                    || (c.partyId ? 'Unknown' : 'Anonymous')
                  // §REFERENCE: Show the invoice number or product name when
                  // linked. Both cannot be set simultaneously per the API spec,
                  // so we render whichever exists.
                  const referenceLabel = c.relatedInvoice
                    ? `Inv #${c.relatedInvoice.invoiceNumber}`
                    : c.relatedProduct
                      ? c.relatedProduct.name
                      : null

                  return (
                    <motion.div
                      key={c.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ delay: Math.min(i * 0.025, 0.25) }}
                      layout
                    >
                      <button
                        type="button"
                        onClick={() => openDetail(c.id)}
                        aria-label={`Open complaint ${c.complaintNumber}: ${c.title}`}
                        className="w-full text-left max-w-2xl mx-auto p-4 rounded-2xl bg-card border border-border shadow-sm hover:shadow-md hover:border-primary/30 active:scale-[0.99] transition-all"
                      >
                        {/* Row 1: complaint number + status + priority badges */}
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className="text-[11px] font-mono font-semibold text-muted-foreground">
                            {c.complaintNumber}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${sMeta.className}`}
                          >
                            {sMeta.label}
                          </span>
                          <span
                            className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ${pMeta.className}`}
                          >
                            {pMeta.label}
                          </span>
                        </div>

                        {/* Row 2: customer name (Anonymous fallback) */}
                        <p className="text-[11px] text-muted-foreground truncate">
                          {customerName}
                        </p>

                        {/* Row 3: title */}
                        <p className="text-sm font-semibold leading-snug line-clamp-2 mt-0.5">
                          {c.title}
                        </p>

                        {/* Row 4: meta line — assigned person + reference + time */}
                        <div className="flex items-center gap-2 mt-2 text-[11px] text-muted-foreground flex-wrap">
                          {c.assignedTo && (
                            <span className="inline-flex items-center gap-1">
                              <span className="w-1.5 h-1.5 rounded-full bg-violet-500 shrink-0" />
                              <span className="truncate max-w-[120px]">{c.assignedTo}</span>
                            </span>
                          )}
                          {referenceLabel && (
                            <span className="inline-flex items-center gap-1 min-w-0">
                              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />
                              <span className="truncate max-w-[160px]">{referenceLabel}</span>
                            </span>
                          )}
                          <span className="ml-auto shrink-0">{timeAgo(c.createdAt)}</span>
                        </div>
                      </button>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </>
      )}

      {/* §COMPLAINT-FORM: Modal for creating a new complaint. Opened via the
          "New Complaint" button. onSaved triggers refetch + closes the form. */}
      <ComplaintForm
        open={formOpen}
        onOpenChange={setFormOpen}
        onSaved={handleSaved}
      />

      {/* §COMPLAINT-DETAIL-SHEET: Bottom sheet for viewing/editing a single
          complaint. complaintId is null when closed so the sheet doesn't
          render stale data during the close transition. */}
      <ComplaintDetailSheet
        open={detailOpen}
        onOpenChange={closeDetail}
        complaintId={detailId}
        onUpdated={handleUpdated}
      />
    </div>
  )
}
