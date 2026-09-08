'use client'

import { useState, useCallback } from 'react'
import { useFetch, apiPost, apiPut, apiDelete } from '@/hooks/use-fetch'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Plus, Pencil, Trash2, Loader2, AlertTriangle, X,
  Phone, Users, Wallet, FileText, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

// §PARTY-NOTES-SECTION: Activates the dormant PartyNote feature.
//
// This component renders a card on the Party Detail page showing:
//   - A header with note count + "Add Note" button
//   - A list of notes (newest first), each showing type badge, content, author, time
//   - Edit + Delete actions per note (Delete uses AlertDialog confirmation)
//   - Empty state when there are no notes
//   - Loading state, error state, add/edit dialog
//
// §MOBILE-FIRST: uses the existing BizLedger visual language —
// rounded-2xl bg-card border-border p-4 shadow-sm cards, scroll-area for
// long lists, h-11 touch targets, bottom-sheet-style dialogs.
//
// §OPTIMISTIC-CACHE: uses TanStack Query via useFetch for the list.
// Add/edit/delete call apiPost/apiPut/apiDelete then refetch the list.
// (No optimistic local mutation — the list is short and refetch is cheap.)

export interface PartyNote {
  id: string
  partyId: string
  type: string          // 'call' | 'meeting' | 'payment_promise' | 'general'
  content: string
  author: string | null
  createdAt: string
}

interface NotesResponse {
  notes: PartyNote[]
}

const NOTE_TYPE_META: Record<string, { label: string; icon: typeof Phone; color: string }> = {
  call: { label: 'Call', icon: Phone, color: 'text-emerald-600' },
  meeting: { label: 'Meeting', icon: Users, color: 'text-cyan-600' },
  payment_promise: { label: 'Promise', icon: Wallet, color: 'text-amber-600' },
  general: { label: 'Note', icon: FileText, color: 'text-muted-foreground' },
}

const NOTE_TYPES = Object.keys(NOTE_TYPE_META)

export function PartyNotesSection({ partyId }: { partyId: string }) {
  const { data, loading, error, refetch } = useFetch<NotesResponse>(
    `/api/parties/${partyId}/notes`,
    [partyId]
  )
  const notes = (data?.notes ?? []) as PartyNote[]

  const [showAddDialog, setShowAddDialog] = useState(false)
  const [editingNote, setEditingNote] = useState<PartyNote | null>(null)
  const [deletingNote, setDeletingNote] = useState<PartyNote | null>(null)

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-muted-foreground" />
          Notes
          {notes.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{notes.length}</span>
          )}
        </h3>
        <button
          onClick={() => setShowAddDialog(true)}
          className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-primary/20 transition-colors"
        >
          <Plus className="w-3 h-3" /> Add
        </button>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <AlertTriangle className="w-8 h-8 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load notes</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : notes.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
          <MessageSquare className="w-8 h-8 text-muted-foreground/40" />
          <p className="text-xs text-muted-foreground">No notes yet</p>
          <p className="text-[11px] text-muted-foreground/70">
            Add a call log, meeting note, or payment promise.
          </p>
        </div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-y-auto scroll-area pr-1">
          <AnimatePresence initial={false}>
            {notes.map((note) => (
              <NoteRow
                key={note.id}
                note={note}
                onEdit={() => setEditingNote(note)}
                onDelete={() => setDeletingNote(note)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Add Note Dialog */}
      <NoteFormDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        partyId={partyId}
        mode="create"
        onSaved={() => refetch()}
      />

      {/* Edit Note Dialog */}
      <NoteFormDialog
        open={!!editingNote}
        onOpenChange={(o) => { if (!o) setEditingNote(null) }}
        partyId={partyId}
        mode="edit"
        existingNote={editingNote}
        onSaved={() => refetch()}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingNote} onOpenChange={(o) => { if (!o) setDeletingNote(null) }}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete note?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the note. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 hover:bg-red-700 text-white"
              onClick={async () => {
                if (!deletingNote) return
                try {
                  await apiDelete(`/api/parties/${partyId}/notes/${deletingNote.id}`)
                  toast.success('Note deleted')
                  setDeletingNote(null)
                  refetch()
                } catch (e: any) {
                  toast.error(e.message || 'Failed to delete note')
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── Note Row ──────────────────────────────────────────────────────────
function NoteRow({ note, onEdit, onDelete }: {
  note: PartyNote
  onEdit: () => void
  onDelete: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const meta = NOTE_TYPE_META[note.type] || NOTE_TYPE_META.general
  const Icon = meta.icon
  const isLong = note.content.length > 120
  const displayContent = expanded || !isLong
    ? note.content
    : note.content.slice(0, 120) + '…'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0 }}
      className="p-3 rounded-xl bg-muted/40 hover:bg-muted/60 transition-colors"
    >
      <div className="flex items-start gap-2.5">
        <span className={`w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0 ${meta.color}`}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
              {meta.label}
            </span>
            <span className="text-[10px] text-muted-foreground/70">·</span>
            <span className="text-[10px] text-muted-foreground/80" title={formatDateTime(note.createdAt)}>
              {timeAgo(note.createdAt)}
            </span>
            {note.author && (
              <>
                <span className="text-[10px] text-muted-foreground/70">·</span>
                <span className="text-[10px] text-muted-foreground/80 truncate max-w-[120px]">
                  {note.author}
                </span>
              </>
            )}
          </div>
          <p className="text-xs text-foreground whitespace-pre-wrap break-words">
            {displayContent}
          </p>
          {isLong && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[10px] font-medium text-primary mt-1 flex items-center gap-0.5"
            >
              {expanded ? (
                <>Show less <ChevronUp className="w-3 h-3" /></>
              ) : (
                <>Show more <ChevronDown className="w-3 h-3" /></>
              )}
            </button>
          )}
        </div>
        {/* Actions */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="w-7 h-7 rounded-lg hover:bg-background flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Edit note"
          >
            <Pencil className="w-3 h-3" />
          </button>
          <button
            onClick={onDelete}
            className="w-7 h-7 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center text-muted-foreground hover:text-red-600 transition-colors"
            aria-label="Delete note"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

// ─── Add / Edit Note Dialog ────────────────────────────────────────────
function NoteFormDialog({
  open, onOpenChange, partyId, mode, existingNote, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId: string
  mode: 'create' | 'edit'
  existingNote?: PartyNote | null
  onSaved: () => void
}) {
  const [content, setContent] = useState('')
  const [type, setType] = useState('general')
  const [author, setAuthor] = useState('')
  const [saving, setSaving] = useState(false)

  // §SYNC-ON-OPEN: reset/sync form fields when the dialog opens.
  // We can't use useEffect with `open` alone because the dialog component
  // stays mounted. Using onOpenChange to reset would fire on every change.
  // Instead, we re-init state when `existingNote` or `open` transitions.
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    // Dialog just opened — sync form fields
    setContent(existingNote?.content ?? '')
    setType(existingNote?.type ?? 'general')
    setAuthor(existingNote?.author ?? '')
    setSaving(false)
    setLastOpen(true)
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const handleSave = async () => {
    const trimmed = content.trim()
    if (!trimmed) {
      toast.error('Note content is required')
      return
    }
    setSaving(true)
    try {
      if (mode === 'create') {
        await apiPost(`/api/parties/${partyId}/notes`, {
          content: trimmed,
          type,
          author: author.trim() || null,
        })
        toast.success('Note added')
      } else {
        await apiPut(`/api/parties/${partyId}/notes/${existingNote?.id}`, {
          content: trimmed,
          type,
          author: author.trim() || null,
        })
        toast.success('Note updated')
      }
      onOpenChange(false)
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save note')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Add Note' : 'Edit Note'}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {/* Type selector — pill buttons (mobile-friendly) */}
          <div className="space-y-1.5">
            <Label className="text-xs">Type</Label>
            <div className="flex flex-wrap gap-1.5">
              {NOTE_TYPES.map((t) => {
                const m = NOTE_TYPE_META[t]
                const TI = m.icon
                return (
                  <button
                    key={t}
                    onClick={() => setType(t)}
                    className={`text-[11px] font-medium px-2.5 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${
                      type === t
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-muted/70'
                    }`}
                  >
                    <TI className="w-3 h-3" /> {m.label}
                  </button>
                )
              })}
            </div>
          </div>
          {/* Content */}
          <div className="space-y-1.5">
            <Label className="text-xs">Content</Label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="min-h-[100px] resize-y"
              placeholder="What happened? What was agreed?"
              maxLength={5000}
            />
            <p className="text-[10px] text-muted-foreground text-right">{content.length}/5000</p>
          </div>
          {/* Author (optional) */}
          <div className="space-y-1.5">
            <Label className="text-xs">Author (optional)</Label>
            <Input
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="h-10"
              placeholder="Who wrote this?"
              maxLength={200}
            />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11" disabled={saving}>
            Cancel
          </Button>
          <Button className="h-11 flex-1" onClick={handleSave} disabled={saving || !content.trim()}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'create' ? 'Add Note' : 'Save'}
          </Button>
        </DialogFooter>
      </FormDialogContent>
    </Dialog>
  )
}
