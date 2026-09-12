'use client'

// §FOLLOWUP-DETAIL-SHEET: mobile-first bottom-sheet for viewing + editing a
// single follow-up. Mirrors ComplaintDetailSheet's responsive pattern
// (Drawer on mobile, Dialog on desktop — but here we use a full Sheet for
// both to keep it simple).
//
// §STATUS-TRANSITIONS: the available actions are computed from the current
// status. Only valid transitions are offered (e.g. COMPLETED → IN_PROGRESS
// only, never COMPLETED → PENDING). Uses the /transition endpoint.
//
// §COMPLETED-BY: the server derives completedById from the authenticated
// session. The UI NEVER asks for or displays a completedById input field.
//
// §COMMENTS: users can add COMMENT events via POST /events. Event history
// is displayed newest-first.

import { useState, useCallback, useEffect } from 'react'
import { useFetch, apiPatch, apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, Loader2, AlertTriangle, Clock, User, MessageSquare,
  Check, Play, Pause, Bell, BellOff, RotateCcw,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { timeAgo, formatDateTime } from '@/lib/utils'

interface FollowUp {
  id: string
  followUpNumber: string
  partyId: string | null
  type: string
  sourceType: string
  sourceId: string | null
  title: string
  description: string | null
  status: string
  priority: string
  assignedToId: string | null
  createdById: string | null
  dueAt: string | null
  snoozedUntil: string | null
  completedAt: string | null
  completedById: string | null
  outcome: string | null
  relatedInvoiceId: string | null
  relatedComplaintId: string | null
  createdAt: string
  updatedAt: string
  party?: { id: string; name: string; phone: string | null } | null
  assignedTo?: { id: string; name: string | null } | null
  createdBy?: { id: string; name: string | null } | null
  completedBy?: { id: string; name: string | null } | null
  relatedInvoice?: { id: string; invoiceNumber: string } | null
  relatedComplaint?: { id: string; complaintNumber: string; title: string } | null
}

interface FollowUpEvent {
  id: string
  eventType: string
  fromValue: string | null
  toValue: string | null
  note: string | null
  actor: string | null
  createdAt: string
}

interface FollowUpResponse { followUp: FollowUp }
interface EventsResponse { items: FollowUpEvent[] }

const STATUS_BADGE: Record<string, string> = {
  PENDING: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  IN_PROGRESS: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  SNOOZED: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  COMPLETED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CANCELLED: 'bg-muted text-muted-foreground',
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  SNOOZED: 'Snoozed',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
}

const PRIORITY_DOT: Record<string, string> = {
  LOW: 'bg-muted-foreground/40',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

const EVENT_LABEL: Record<string, string> = {
  CREATED: 'Created',
  STATUS_CHANGE: 'Status Change',
  PRIORITY_CHANGE: 'Priority Change',
  ASSIGN: 'Assignment',
  SNOOZE: 'Snoozed',
  COMMENT: 'Comment',
  COMPLETE: 'Completed',
  CANCEL: 'Cancelled',
}

// §TRANSITION-ACTIONS: the available actions per current status.
// Only valid transitions from the domain state machine are offered.
function getAvailableActions(status: string): Array<{ toStatus: string; label: string; icon: any; variant?: 'default' | 'outline' | 'destructive' }> {
  switch (status) {
    case 'PENDING':
      return [
        { toStatus: 'IN_PROGRESS', label: 'Start', icon: Play },
        { toStatus: 'SNOOZED', label: 'Snooze', icon: BellOff },
        { toStatus: 'COMPLETED', label: 'Complete', icon: Check },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'IN_PROGRESS':
      return [
        { toStatus: 'PENDING', label: 'Move to Pending', icon: Pause },
        { toStatus: 'SNOOZED', label: 'Snooze', icon: BellOff },
        { toStatus: 'COMPLETED', label: 'Complete', icon: Check },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'SNOOZED':
      return [
        { toStatus: 'PENDING', label: 'Wake', icon: Bell },
        { toStatus: 'CANCELLED', label: 'Cancel', icon: X, variant: 'destructive' },
      ]
    case 'COMPLETED':
      return [
        { toStatus: 'IN_PROGRESS', label: 'Reopen', icon: RotateCcw },
      ]
    case 'CANCELLED':
      return [
        { toStatus: 'IN_PROGRESS', label: 'Reopen', icon: RotateCcw },
      ]
    default:
      return []
  }
}

export function FollowUpDetailSheet({
  open, onOpenChange, followUpId, onUpdated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  followUpId: string | null
  onUpdated?: () => void
}) {
  const { data, loading, error, refetch } = useFetch<FollowUpResponse>(
    followUpId ? `/api/followups/${followUpId}` : null,
    [followUpId, open]
  )
  const { data: eventsData, refetch: refetchEvents } = useFetch<EventsResponse>(
    followUpId ? `/api/followups/${followUpId}/events` : null,
    [followUpId, open]
  )

  const followUp = data?.followUp
  const events = eventsData?.items ?? []

  const [transitioning, setTransitioning] = useState(false)
  const [showSnooze, setShowSnooze] = useState(false)
  const [snoozeUntil, setSnoozeUntil] = useState('')
  const [comment, setComment] = useState('')
  const [commenting, setCommenting] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editDueAt, setEditDueAt] = useState('')
  const [saving, setSaving] = useState(false)

  // §SYNC-EDIT-FIELDS: when entering edit mode, populate from server data
  useEffect(() => {
    if (editing && followUp) {
      setEditTitle(followUp.title)
      setEditDescription(followUp.description || '')
      setEditDueAt(followUp.dueAt ? new Date(followUp.dueAt).toISOString().slice(0, 16) : '')
    }
  }, [editing, followUp])

  const refreshAll = useCallback(async () => {
    await Promise.all([refetch(), refetchEvents()])
    onUpdated?.()
  }, [refetch, refetchEvents, onUpdated])

  const handleTransition = async (toStatus: string, extra?: Record<string, any>) => {
    if (!followUp) return
    // §DUPLICATE-PREVENTION: disable all transition buttons while one is in-flight
    setTransitioning(true)
    try {
      await apiPost(`/api/followups/${followUp.id}/transition`, { toStatus, ...extra })
      toast.success(`Status changed to ${STATUS_LABEL[toStatus] || toStatus}`)
      setShowSnooze(false)
      setSnoozeUntil('')
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to change status')
    } finally {
      setTransitioning(false)
    }
  }

  const handleSnooze = () => {
    if (!snoozeUntil) {
      toast.error('Snooze date is required')
      return
    }
    const snoozeDate = new Date(snoozeUntil)
    if (isNaN(snoozeDate.getTime())) {
      toast.error('Invalid snooze date')
      return
    }
    // §CLIENT-VALIDATION: reject past dates (server is authoritative)
    if (snoozeDate <= new Date()) {
      toast.error('Snooze date must be in the future')
      return
    }
    handleTransition('SNOOZED', { snoozedUntil: snoozeDate.toISOString() })
  }

  const handleComment = async () => {
    if (!followUp) return
    const trimmed = comment.trim()
    if (!trimmed) {
      toast.error('Comment cannot be empty')
      return
    }
    setCommenting(true)
    try {
      await apiPost(`/api/followups/${followUp.id}/events`, { note: trimmed })
      toast.success('Comment added')
      setComment('')
      await refetchEvents()
    } catch (e: any) {
      toast.error(e.message || 'Failed to add comment')
    } finally {
      setCommenting(false)
    }
  }

  const handleSaveEdit = async () => {
    if (!followUp) return
    setSaving(true)
    try {
      const payload: Record<string, any> = {}
      if (editTitle.trim() !== followUp.title) payload.title = editTitle.trim()
      if (editDescription.trim() !== (followUp.description || '')) payload.description = editDescription.trim() || null
      if (editDueAt) {
        const newDue = new Date(editDueAt).toISOString()
        const oldDue = followUp.dueAt ? new Date(followUp.dueAt).toISOString() : null
        if (newDue !== oldDue) payload.dueAt = newDue
      }
      if (Object.keys(payload).length === 0) {
        toast.info('No changes to save')
        setEditing(false)
        return
      }
      await apiPatch(`/api/followups/${followUp.id}`, payload)
      toast.success('Follow-up updated')
      setEditing(false)
      await refreshAll()
    } catch (e: any) {
      toast.error(e.message || 'Failed to update')
    } finally {
      setSaving(false)
    }
  }

  const actions = followUp ? getAvailableActions(followUp.status) : []
  const isOverdue = followUp?.status === 'PENDING' && followUp?.dueAt && new Date(followUp.dueAt) < new Date() && !followUp.snoozedUntil

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-sm flex items-center gap-2">
            {followUp && (
              <>
                <span className="text-[10px] font-mono text-muted-foreground">{followUp.followUpNumber}</span>
                {followUp.status && (
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[followUp.status] || ''}`}>
                    {STATUS_LABEL[followUp.status] || followUp.status}
                  </span>
                )}
                {isOverdue && (
                  <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300">
                    Overdue
                  </span>
                )}
              </>
            )}
          </SheetTitle>
          <SheetDescription className="text-xs">
            {followUp?.title || 'Loading…'}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
            <p className="text-xs text-muted-foreground">{typeof error === 'string' ? error : (error as any)?.message || 'Failed to load'}</p>
            <Button variant="outline" size="sm" className="mt-3 text-xs" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : followUp ? (
          <div className="px-4 pb-6 space-y-4 mt-2">
            {/* §DETAIL-FIELDS: core fields */}
            {!editing ? (
              <>
                <div className="space-y-2 text-xs">
                  {/* Type + Priority */}
                  <div className="flex items-center gap-3">
                    <span className="text-muted-foreground">Type:</span>
                    <span className="font-medium capitalize">{followUp.type.replace(/_/g, ' ')}</span>
                    <span className="flex items-center gap-1">
                      <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[followUp.priority] || PRIORITY_DOT.MEDIUM}`} />
                      <span className="text-muted-foreground">{followUp.priority}</span>
                    </span>
                  </div>

                  {/* Due At */}
                  {followUp.dueAt && (
                    <div className="flex items-center gap-2">
                      <Clock className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className={isOverdue ? 'text-red-600 dark:text-red-400 font-medium' : ''}>
                        Due: {formatDateTime(followUp.dueAt)}
                        {isOverdue && ' (overdue)'}
                      </span>
                    </div>
                  )}

                  {/* Snoozed Until */}
                  {followUp.status === 'SNOOZED' && followUp.snoozedUntil && (
                    <div className="flex items-center gap-2">
                      <BellOff className="w-3.5 h-3.5 text-amber-500" />
                      <span className="text-amber-600 dark:text-amber-400">
                        Snoozed until: {formatDateTime(followUp.snoozedUntil)}
                      </span>
                    </div>
                  )}

                  {/* Assigned To */}
                  <div className="flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-muted-foreground">Assigned:</span>
                    <span>{followUp.assignedTo?.name || 'Unassigned'}</span>
                  </div>

                  {/* Created By */}
                  <div className="flex items-center gap-2">
                    <span className="text-muted-foreground">Created by:</span>
                    <span>{followUp.createdBy?.name || '—'} • {timeAgo(followUp.createdAt)}</span>
                  </div>

                  {/* Completed */}
                  {followUp.completedAt && (
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                      <span className="text-muted-foreground">Completed:</span>
                      <span>{formatDateTime(followUp.completedAt)} by {followUp.completedBy?.name || '—'}</span>
                    </div>
                  )}

                  {/* Description */}
                  {followUp.description && (
                    <div className="pt-2">
                      <p className="text-muted-foreground text-[10px] mb-1">Description</p>
                      <p className="text-xs whitespace-pre-wrap">{followUp.description}</p>
                    </div>
                  )}

                  {/* Outcome */}
                  {followUp.outcome && (
                    <div className="pt-1">
                      <p className="text-muted-foreground text-[10px] mb-1">Outcome</p>
                      <p className="text-xs whitespace-pre-wrap">{followUp.outcome}</p>
                    </div>
                  )}
                </div>

                <Button variant="outline" size="sm" className="text-xs w-full" onClick={() => setEditing(true)}>
                  Edit Details
                </Button>
              </>
            ) : (
              /* §EDIT-MODE: editable fields (no status) */
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Title</Label>
                  <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Description</Label>
                  <Textarea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} className="min-h-[60px] resize-y text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Due Date</Label>
                  <Input type="datetime-local" value={editDueAt} onChange={(e) => setEditDueAt(e.target.value)} className="h-9 text-xs" />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="text-xs" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
                  <Button size="sm" className="text-xs" onClick={handleSaveEdit} disabled={saving || !editTitle.trim()}>
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                    Save
                  </Button>
                </div>
              </div>
            )}

            {/* §TRANSITION-ACTIONS: only valid transitions shown */}
            {!editing && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {actions.map((a) => {
                    const Icon = a.icon
                    if (a.toStatus === 'SNOOZED') {
                      return (
                        <Button
                          key={a.toStatus}
                          variant={a.variant || 'outline'}
                          size="sm"
                          className="text-xs"
                          disabled={transitioning}
                          onClick={() => setShowSnooze(!showSnooze)}
                        >
                          <Icon className="w-3.5 h-3.5 mr-1" />
                          {a.label}
                        </Button>
                      )
                    }
                    return (
                      <Button
                        key={a.toStatus}
                        variant={a.variant || 'outline'}
                        size="sm"
                        className="text-xs"
                        disabled={transitioning}
                        onClick={() => handleTransition(a.toStatus)}
                      >
                        {transitioning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Icon className="w-3.5 h-3.5 mr-1" />}
                        {a.label}
                      </Button>
                    )
                  })}
                </div>

                {/* §SNOOZE-UI: date picker for snooze */}
                {showSnooze && (
                  <div className="flex flex-col gap-2 p-3 rounded-lg bg-muted/40">
                    <Label className="text-xs">Snooze until (future date)</Label>
                    <Input
                      type="datetime-local"
                      value={snoozeUntil}
                      onChange={(e) => setSnoozeUntil(e.target.value)}
                      className="h-9 text-xs"
                      aria-label="Snooze until date and time"
                    />
                    <Button size="sm" className="text-xs" onClick={handleSnooze} disabled={transitioning || !snoozeUntil}>
                      {transitioning ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
                      Confirm Snooze
                    </Button>
                  </div>
                )}
              </div>
            )}

            {/* §COMMENTS: add comment + event history */}
            {!editing && (
              <div className="space-y-2 pt-2 border-t border-border">
                <Label className="text-xs flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" />
                  Activity
                </Label>

                {/* Add comment */}
                <div className="flex gap-2">
                  <Input
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    className="h-9 text-xs flex-1"
                    placeholder="Add a comment…"
                    maxLength={2000}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleComment() } }}
                  />
                  <Button size="sm" className="text-xs" onClick={handleComment} disabled={commenting || !comment.trim()}>
                    {commenting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Post'}
                  </Button>
                </div>

                {/* Event history newest-first */}
                <div className="space-y-1 max-h-48 overflow-y-auto scroll-area">
                  <AnimatePresence initial={false}>
                    {events.map((evt) => (
                      <motion.div
                        key={evt.id}
                        layout
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className="text-[11px] p-2 rounded-lg bg-muted/40"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-muted-foreground">{EVENT_LABEL[evt.eventType] || evt.eventType}</span>
                          <span className="text-[10px] text-muted-foreground/70">{timeAgo(evt.createdAt)}</span>
                        </div>
                        {evt.note && <p className="mt-0.5 whitespace-pre-wrap">{evt.note}</p>}
                        {evt.fromValue && evt.toValue && (
                          <p className="mt-0.5 text-muted-foreground">
                            <span className="text-[10px]">{evt.fromValue}</span> → <span className="text-[10px] font-medium">{evt.toValue}</span>
                          </p>
                        )}
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {events.length === 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-2">No activity yet</p>
                  )}
                </div>
              </div>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
