'use client'

// §COMPLAINT-DETAIL-SHEET: mobile-first bottom-sheet for viewing + editing a
// single complaint. Follows the existing BizLedger visual language (rounded-2xl
// bg-card border-border p-4 shadow-sm) and the Drawer-on-mobile pattern used
// by CustomerBehaviourSection.
//
// §EXPLICIT-ACTIONS: state changes are triggered by explicit buttons (not
// drag-and-drop) so accidental transitions are impossible. Each mutation
// hits the PUT /api/complaints/{id} endpoint, toasts success, refetches both
// the complaint + its event timeline, and notifies the parent via onUpdated().
//
// §STATUS-TRANSITIONS: the available "next status" buttons are computed from
// STATUS_TRANSITIONS in src/lib/complaints.ts. Only valid transitions are
// offered (e.g. CLOSED → IN_PROGRESS only, never CLOSED → RESOLVED).

import { useState, useCallback, useEffect } from 'react'
import { useFetch, apiPut, apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Loader2, AlertTriangle, Clock, User, FileText, MessageSquare,
  ArrowRight, Check, Package, Receipt,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { STATUS_TRANSITIONS } from '@/lib/complaints'

interface Complaint {
  id: string
  complaintNumber: string
  partyId: string | null
  sourceType: string
  sourceId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assignedTo: string | null
  relatedInvoiceId: string | null
  relatedProductId: string | null
  resolution: string | null
  internalNotes: string | null
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  party?: { id: string; name: string; phone: string | null } | null
  relatedInvoice?: { id: string; invoiceNumber: string } | null
  relatedProduct?: { id: string; name: string } | null
}

interface ComplaintEvent {
  id: string
  eventType: string
  fromValue: string | null
  toValue: string | null
  note: string | null
  actor: string | null
  createdAt: string
}

interface ComplaintResponse { complaint: Complaint }
interface EventsResponse { events: ComplaintEvent[] }

// §STATUS-BADGE-COLORS: must match complaints-view.tsx exactly so the same
// status reads the same color in list + detail.
const STATUS_BADGE: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  IN_PROGRESS: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  WAITING: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  RESOLVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CLOSED: 'bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<string, string> = {
  NEW: 'New',
  IN_PROGRESS: 'In Progress',
  WAITING: 'Waiting',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
}

// §PRIORITY-BADGE-COLORS: distinct from status colors so priority + status can
// be read independently at a glance. Urgent = red, High = orange,
// Medium = amber, Low = muted (low severity = low visual weight).
const PRIORITY_BADGE: Record<string, string> = {
  LOW: 'bg-muted text-muted-foreground',
  MEDIUM: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  HIGH: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  URGENT: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

// §EVENT-TYPE-BADGE-COLORS: each event type carries a distinct color so the
// timeline can be scanned quickly. Same scheme as complaints-view.
const EVENT_BADGE: Record<string, string> = {
  CREATED: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  STATUS_CHANGE: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  PRIORITY_CHANGE: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300',
  ASSIGN: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300',
  COMMENT: 'bg-muted text-muted-foreground',
  RESOLVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CLOSE: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Created',
  STATUS_CHANGE: 'Status',
  PRIORITY_CHANGE: 'Priority',
  ASSIGN: 'Assign',
  COMMENT: 'Comment',
  RESOLVE: 'Resolved',
  CLOSE: 'Closed',
}

// §TRANSITION-VERB: short verb describing the user's action (not the resulting
// state). E.g. NEW → IN_PROGRESS reads "Start", not "In Progress".
const TRANSITION_VERB: Record<string, string> = {
  IN_PROGRESS: 'Start',
  WAITING: 'Wait',
  RESOLVED: 'Resolve',
  CLOSED: 'Close',
}

export function ComplaintDetailSheet({
  open,
  onOpenChange,
  complaintId,
  onUpdated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  complaintId: string | null
  onUpdated?: () => void
}) {
  // §FETCH-GATING: only fetch when the drawer is open AND we have an id.
  // When closed, url is null → TanStack Query's `enabled: false` skips the
  // fetch entirely (no wasted requests, no stale data flashing).
  const url = open && complaintId ? `/api/complaints/${complaintId}` : null
  const eventsUrl = open && complaintId ? `/api/complaints/${complaintId}/events` : null

  const { data, loading, error, refetch } = useFetch<ComplaintResponse>(url, [complaintId, open])
  const { data: eventsData, refetch: refetchEvents } = useFetch<EventsResponse>(eventsUrl, [complaintId, open])

  const complaint = data?.complaint ?? null
  const events = eventsData?.events ?? []

  const [busyAction, setBusyAction] = useState<string | null>(null)
  const [assignInput, setAssignInput] = useState('')
  const [commentInput, setCommentInput] = useState('')
  const [commentActor, setCommentActor] = useState('')

  // §RESET-ON-CLOSE: clear all input state when the sheet closes so stale
  // text from a previous complaint doesn't leak into the next one.
  useEffect(() => {
    if (!open) {
      setAssignInput('')
      setCommentInput('')
      setCommentActor('')
      setBusyAction(null)
    }
  }, [open])

  const refreshAll = useCallback(async () => {
    await Promise.all([refetch(), refetchEvents()])
    onUpdated?.()
  }, [refetch, refetchEvents, onUpdated])

  const handleStatusChange = async (newStatus: string) => {
    if (!complaintId || !complaint) return
    setBusyAction(`status-${newStatus}`)
    try {
      await apiPut(`/api/complaints/${complaintId}`, { status: newStatus })
      toast.success(`Status → ${STATUS_LABEL[newStatus] ?? newStatus}`)
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update status')
    } finally {
      setBusyAction(null)
    }
  }

  const handlePriorityChange = async (newPriority: string) => {
    if (!complaintId || !complaint) return
    if (complaint.priority === newPriority) return
    setBusyAction(`priority-${newPriority}`)
    try {
      await apiPut(`/api/complaints/${complaintId}`, { priority: newPriority })
      toast.success(`Priority → ${newPriority}`)
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update priority')
    } finally {
      setBusyAction(null)
    }
  }

  const handleAssign = async () => {
    if (!complaintId || !complaint) return
    const name = assignInput.trim()
    if (!name) {
      toast.error('Enter a name to assign')
      return
    }
    setBusyAction('assign')
    try {
      await apiPut(`/api/complaints/${complaintId}`, { assignedTo: name })
      toast.success(`Assigned to ${name}`)
      setAssignInput('')
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to assign')
    } finally {
      setBusyAction(null)
    }
  }

  const handleAddComment = async () => {
    if (!complaintId || !complaint) return
    const note = commentInput.trim()
    if (!note) {
      toast.error('Comment cannot be empty')
      return
    }
    setBusyAction('comment')
    try {
      await apiPost(`/api/complaints/${complaintId}/events`, {
        eventType: 'COMMENT',
        note,
        actor: commentActor.trim() || 'Staff',
      })
      toast.success('Comment added')
      setCommentInput('')
      setCommentActor('')
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to add comment')
    } finally {
      setBusyAction(null)
    }
  }

  const allowedTransitions = complaint
    ? STATUS_TRANSITIONS[complaint.status] ?? []
    : []

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="data-[vaul-drawer-direction=bottom]:max-h-[90vh] sm:max-w-lg sm:mx-auto"
      >
        {/* §ACCESSIBILITY: DrawerTitle/Description are required by vaul for
            aria, but we visually hide them since the visible header below
            already conveys the same information. */}
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle className="sr-only">Complaint Details</DrawerTitle>
          <DrawerDescription className="sr-only">
            View and update complaint status, priority, assignment, and comments.
          </DrawerDescription>
        </DrawerHeader>

        {/* §SCROLL-BODY: the body scrolls while the header (close button)
            stays anchored. flex-1 + overflow-y-auto on a flex-col parent. */}
        <div className="flex-1 overflow-y-auto px-4 pb-8 space-y-4">
          {loading && !complaint ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="w-6 h-6 animate-spin mb-2" />
              <p className="text-sm">Loading complaint…</p>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-16 text-red-600 dark:text-red-400">
              <AlertTriangle className="w-6 h-6 mb-2" />
              <p className="text-sm">{error}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : complaint ? (
            <ComplaintBody
              complaint={complaint}
              events={events}
              allowedTransitions={allowedTransitions}
              busyAction={busyAction}
              assignInput={assignInput}
              setAssignInput={setAssignInput}
              commentInput={commentInput}
              setCommentInput={setCommentInput}
              commentActor={commentActor}
              setCommentActor={setCommentActor}
              onClose={() => onOpenChange(false)}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onAssign={handleAssign}
              onAddComment={handleAddComment}
            />
          ) : null}
        </div>
      </DrawerContent>
    </Drawer>
  )
}

// ─── Body (presentational) ───────────────────────────────────────────────
//
// §SPLIT: separated from the action handlers above so the markup is readable.
// All state lives in the parent; this component is mostly presentational
// apart from input onChange bindings.

interface ComplaintBodyProps {
  complaint: Complaint
  events: ComplaintEvent[]
  allowedTransitions: string[]
  busyAction: string | null
  assignInput: string
  setAssignInput: (v: string) => void
  commentInput: string
  setCommentInput: (v: string) => void
  commentActor: string
  setCommentActor: (v: string) => void
  onClose: () => void
  onStatusChange: (s: string) => void
  onPriorityChange: (p: string) => void
  onAssign: () => void
  onAddComment: () => void
}

function ComplaintBody({
  complaint,
  events,
  allowedTransitions,
  busyAction,
  assignInput,
  setAssignInput,
  commentInput,
  setCommentInput,
  commentActor,
  setCommentActor,
  onClose,
  onStatusChange,
  onPriorityChange,
  onAssign,
  onAddComment,
}: ComplaintBodyProps) {
  const customerName = complaint.party?.name?.trim() || 'Anonymous'
  const disabled = busyAction !== null

  return (
    <>
      {/* ─── Header: number + badges + close ─── */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <span className="text-xs font-mono font-medium text-muted-foreground truncate">
            {complaint.complaintNumber}
          </span>
          <Badge
            variant="secondary"
            className={`border-transparent ${STATUS_BADGE[complaint.status] ?? STATUS_BADGE.NEW}`}
          >
            {STATUS_LABEL[complaint.status] ?? complaint.status}
          </Badge>
          <Badge
            variant="secondary"
            className={`border-transparent ${PRIORITY_BADGE[complaint.priority] ?? ''}`}
          >
            {complaint.priority}
          </Badge>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 -mr-1 -mt-1 p-1.5 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ─── Customer + Title ─── */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <User className="w-3.5 h-3.5" />
          <span className="truncate">{customerName}</span>
        </div>
        <h2 className="text-lg font-semibold leading-tight text-foreground">
          {complaint.title}
        </h2>
      </div>

      {/* ─── Description ─── */}
      {complaint.description && (
        <div className="rounded-xl bg-muted/40 border border-border/60 p-3">
          <p className="text-xs text-foreground/80 whitespace-pre-wrap break-words">
            {complaint.description}
          </p>
        </div>
      )}

      {/* ─── Metadata grid ─── */}
      <div className="grid grid-cols-2 gap-2">
        <MetaTile
          icon={<User className="w-3.5 h-3.5" />}
          label="Assigned To"
          value={complaint.assignedTo || 'Unassigned'}
        />
        <MetaTile
          icon={<Receipt className="w-3.5 h-3.5" />}
          label="Related Invoice"
          value={complaint.relatedInvoice?.invoiceNumber || '—'}
        />
        <MetaTile
          icon={<Package className="w-3.5 h-3.5" />}
          label="Related Product"
          value={complaint.relatedProduct?.name || '—'}
        />
        <MetaTile
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Created"
          value={formatDateTime(complaint.createdAt)}
          sub={timeAgo(complaint.createdAt)}
        />
        <MetaTile
          icon={<Clock className="w-3.5 h-3.5" />}
          label="Updated"
          value={formatDateTime(complaint.updatedAt)}
          sub={timeAgo(complaint.updatedAt)}
        />
        {complaint.resolvedAt && (
          <MetaTile
            icon={<Check className="w-3.5 h-3.5" />}
            label="Resolved"
            value={formatDateTime(complaint.resolvedAt)}
            sub={timeAgo(complaint.resolvedAt)}
          />
        )}
      </div>

      {/* ─── Action: Status transitions ─── */}
      <SectionCard
        icon={<ArrowRight className="w-4 h-4" />}
        title="Status"
      >
        {allowedTransitions.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            No further status transitions available.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {allowedTransitions.map((next) => {
              const verb = TRANSITION_VERB[next] ?? next
              const isBusy = busyAction === `status-${next}`
              return (
                <Button
                  key={next}
                  size="sm"
                  variant="outline"
                  onClick={() => onStatusChange(next)}
                  disabled={disabled}
                  className="h-8 gap-1.5 px-2.5 text-xs"
                >
                  {isBusy ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <span className="font-medium">{verb}</span>
                  )}
                  <ArrowRight className="w-3 h-3 opacity-50" />
                  <span className="text-[10px] text-muted-foreground">
                    {STATUS_LABEL[next] ?? next}
                  </span>
                </Button>
              )
            })}
          </div>
        )}
      </SectionCard>

      {/* ─── Action: Priority ─── */}
      <SectionCard
        icon={<AlertTriangle className="w-4 h-4" />}
        title="Priority"
      >
        <div className="flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => {
            const isCurrent = complaint.priority === p
            return (
              <button
                key={p}
                onClick={() => onPriorityChange(p)}
                disabled={disabled}
                className={`text-[11px] font-medium px-2.5 py-1 rounded-full transition-all flex items-center gap-1 ${
                  isCurrent
                    ? `${PRIORITY_BADGE[p]} ring-1 ring-inset ring-current/20`
                    : 'bg-muted/40 text-muted-foreground hover:bg-muted/70'
                }`}
                aria-pressed={isCurrent}
              >
                {isCurrent && <Check className="w-2.5 h-2.5" />}
                {p}
              </button>
            )
          })}
        </div>
      </SectionCard>

      {/* ─── Action: Assign ─── */}
      <SectionCard
        icon={<User className="w-4 h-4" />}
        title="Assign"
      >
        <div className="flex gap-1.5">
          <Input
            value={assignInput}
            onChange={(e) => setAssignInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAssign() } }}
            placeholder={complaint.assignedTo ? `Reassign (currently ${complaint.assignedTo})` : 'Staff name'}
            disabled={disabled}
            className="h-9 text-xs flex-1"
            maxLength={80}
          />
          <Button
            type="button"
            size="sm"
            onClick={onAssign}
            disabled={disabled || !assignInput.trim()}
            className="h-9 px-3 text-xs shrink-0"
          >
            {busyAction === 'assign' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              'Assign'
            )}
          </Button>
        </div>
      </SectionCard>

      {/* ─── Action: Add Comment ─── */}
      <SectionCard
        icon={<MessageSquare className="w-4 h-4" />}
        title="Add Comment"
      >
        <div className="space-y-1.5">
          <Input
            value={commentActor}
            onChange={(e) => setCommentActor(e.target.value)}
            placeholder="Your name (optional, defaults to Staff)"
            disabled={disabled}
            className="h-9 text-xs"
            maxLength={80}
          />
          <Textarea
            value={commentInput}
            onChange={(e) => setCommentInput(e.target.value)}
            placeholder="Type a comment or update note…"
            disabled={disabled}
            className="text-xs min-h-[72px] resize-y"
            maxLength={1000}
          />
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={onAddComment}
              disabled={disabled || !commentInput.trim()}
              className="h-9 px-3 text-xs"
            >
              {busyAction === 'comment' ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" />
              ) : (
                <MessageSquare className="w-3.5 h-3.5 mr-1" />
              )}
              Add Comment
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* ─── Event Timeline ─── */}
      <SectionCard
        icon={<FileText className="w-4 h-4" />}
        title="History"
      >
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">No events yet.</p>
        ) : (
          <ol className="relative space-y-3 max-h-72 overflow-y-auto pr-1
                         [scrollbar-width:thin] [scrollbar-color:var(--muted-foreground)_transparent]">
            {events.map((ev, idx) => (
              <TimelineItem
                key={ev.id}
                event={ev}
                isLast={idx === events.length - 1}
              />
            ))}
          </ol>
        )}
      </SectionCard>
    </>
  )
}

// ─── MetaTile: icon + label + value (+ optional sub-text) ───────────────

function MetaTile({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode
  label: string
  value: string
  sub?: string
}) {
  return (
    <div className="rounded-xl bg-card border border-border p-2.5">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <p className="text-xs font-medium text-foreground truncate" title={value}>
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-muted-foreground/70 truncate" title={sub}>
          {sub}
        </p>
      )}
    </div>
  )
}

// ─── SectionCard: titled action block ───────────────────────────────────

function SectionCard({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl bg-card border border-border p-3.5 shadow-sm space-y-2.5">
      <h3 className="text-xs font-semibold flex items-center gap-1.5 text-foreground/90">
        {icon}
        {title}
      </h3>
      {children}
    </div>
  )
}

// ─── TimelineItem: single event row ──────────────────────────────────────

function TimelineItem({ event, isLast }: { event: ComplaintEvent; isLast: boolean }) {
  const badgeClass = EVENT_BADGE[event.eventType] ?? EVENT_BADGE.COMMENT
  const label = EVENT_LABEL[event.eventType] ?? event.eventType
  const hasTransition =
    event.eventType === 'STATUS_CHANGE' ||
    event.eventType === 'PRIORITY_CHANGE' ||
    event.eventType === 'ASSIGN'

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.18 }}
      className="relative pl-4"
    >
      {/* timeline rail */}
      {!isLast && (
        <span
          aria-hidden
          className="absolute left-[3px] top-3 bottom-[-12px] w-px bg-border"
        />
      )}
      <span
        aria-hidden
        className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${badgeClass.split(' ')[0] ?? 'bg-muted'}`}
      />

      <div className="flex items-center gap-1.5 flex-wrap">
        <Badge variant="secondary" className={`border-transparent ${badgeClass}`}>
          {label}
        </Badge>
        {hasTransition && event.fromValue && event.toValue && (
          <span className="text-[11px] text-muted-foreground flex items-center gap-1">
            <span className="font-mono">{event.fromValue}</span>
            <ArrowRight className="w-3 h-3" />
            <span className="font-mono font-medium text-foreground/80">{event.toValue}</span>
          </span>
        )}
        <span className="text-[10px] text-muted-foreground/70 ml-auto" title={formatDateTime(event.createdAt)}>
          {timeAgo(event.createdAt)}
        </span>
      </div>

      {event.note && (
        <p className="mt-1 text-xs text-foreground/80 whitespace-pre-wrap break-words">
          {event.note}
        </p>
      )}

      {event.actor && (
        <p className="mt-0.5 text-[10px] text-muted-foreground/70 flex items-center gap-1">
          <User className="w-2.5 h-2.5" />
          {event.actor}
        </p>
      )}
    </motion.li>
  )
}
