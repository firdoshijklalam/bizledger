'use client'

import { useState } from 'react'
import { apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import {
  Plus, Loader2, AlertTriangle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'

// §COMPLAINT-FORM: Modal for creating a new complaint.
//
// §MOBILE-FIRST: uses the existing BizLedger visual language (rounded-2xl
// bg-card border-border p-4 shadow-sm). Create form uses a bottom-sheet
// Drawer on mobile, Dialog on sm+ — same responsive pattern as
// customer-behaviour-section.tsx's EditBehaviourDialog.
//
// §SYNC-ON-OPEN: form fields reset to defaults when the dialog opens
// (tracked via lastOpen state) — prevents stale values from a previous
// session leaking into a new complaint.
//
// §PARTY-LINK: partyId is OPTIONAL. When provided (e.g. from a party
// detail page), the new complaint is pre-linked to that party. When not
// provided, the API treats partyId as optional and creates a standalone
// complaint.

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type SourceType = 'MANUAL' | 'MESSAGE' | 'CALL' | 'FEEDBACK' | 'OTHER'

// §PRIORITY-META: visual config per priority. Uses amber/red shades so the
// urgency ramp is immediately scannable. Each priority has a short label
// and tailwind badge classes for the pill button states.
const PRIORITY_META: Record<Priority, { label: string; pill: string; pillActive: string }> = {
  LOW:    { label: 'Low',    pill: 'bg-muted text-muted-foreground hover:bg-muted/70',                                pillActive: 'bg-emerald-600 text-white' },
  MEDIUM: { label: 'Medium', pill: 'bg-muted text-muted-foreground hover:bg-muted/70',                                pillActive: 'bg-amber-600 text-white' },
  HIGH:   { label: 'High',   pill: 'bg-muted text-muted-foreground hover:bg-muted/70',                                pillActive: 'bg-orange-600 text-white' },
  URGENT: { label: 'Urgent', pill: 'bg-muted text-muted-foreground hover:bg-muted/70',                                pillActive: 'bg-red-600 text-white' },
}

const PRIORITY_ORDER: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

// §SOURCE-TYPES: only MANUAL is meaningful today (MESSAGE/CALL/FEEDBACK
// entities don't exist yet). We still expose the others for forward-compat
// so the schema field doesn't silently default to MANUAL when staff
// explicitly choose OTHER.
const SOURCE_TYPES: SourceType[] = ['MANUAL', 'MESSAGE', 'CALL', 'FEEDBACK', 'OTHER']

export function ComplaintForm({
  open, onOpenChange, partyId, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId?: string
  onSaved?: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<Priority>('MEDIUM')
  const [sourceType, setSourceType] = useState<SourceType>('MANUAL')
  const [assignedTo, setAssignedTo] = useState('')
  const [relatedInvoiceId, setRelatedInvoiceId] = useState('')
  const [relatedProductId, setRelatedProductId] = useState('')
  const [internalNotes, setInternalNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // §SYNC-ON-OPEN: reset form fields when the dialog opens (not on every render).
  // Mirrors the pattern in customer-behaviour-section.tsx's EditBehaviourDialog.
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setTitle('')
    setDescription('')
    setPriority('MEDIUM')
    setSourceType('MANUAL')
    setAssignedTo('')
    setRelatedInvoiceId('')
    setRelatedProductId('')
    setInternalNotes('')
    setSaving(false)
    setLastOpen(true)
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const handleSave = async () => {
    // §CLIENT-VALIDATION: title is required. The API also validates this
    // server-side, but we short-circuit here for snappy mobile UX.
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error('Title is required')
      return
    }

    setSaving(true)
    try {
      // §BUILD-PAYLOAD: only include partyId when provided — the API treats
      // it as optional and a standalone complaint is valid (e.g. a walk-in
      // grievance with no party record).
      const payload: Record<string, unknown> = {
        title: trimmedTitle,
        description: description.trim() || null,
        priority,
        sourceType,
        assignedTo: assignedTo.trim() || null,
        relatedInvoiceId: relatedInvoiceId.trim() || null,
        relatedProductId: relatedProductId.trim() || null,
        internalNotes: internalNotes.trim() || null,
      }
      if (partyId) {
        payload.partyId = partyId
      }

      await apiPost('/api/complaints', payload)
      toast.success('Complaint created')
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message || 'Failed to create complaint')
    } finally {
      setSaving(false)
    }
  }

  // §SHARED-FORM-CONTENT: rendered inside both the Drawer (mobile) and
  // Dialog (sm+). Keeping it in one variable ensures both surfaces stay
  // visually identical.
  const formContent = (
    <div className="space-y-4 py-2">
      {/* Title (required) */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9 text-xs"
          placeholder="Short summary of the complaint…"
          maxLength={500}
          autoFocus
        />
      </div>

      {/* Description (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Description (optional)</Label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[80px] resize-y text-xs"
          placeholder="What happened? What is the customer asking for?"
          maxLength={10000}
        />
      </div>

      {/* Priority — pill buttons */}
      <div className="space-y-1.5">
        <Label className="text-xs">Priority</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {PRIORITY_ORDER.map((p) => {
            const m = PRIORITY_META[p]
            const isSelected = priority === p
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(p)}
                className={`text-[11px] font-semibold px-2 py-2 rounded-lg transition-colors ${
                  isSelected ? m.pillActive : m.pill
                }`}
                aria-pressed={isSelected}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Source Type — pill buttons (only MANUAL is meaningful today) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Source Type</Label>
        <div className="flex flex-wrap gap-1.5">
          {SOURCE_TYPES.map((s) => {
            const isSelected = sourceType === s
            return (
              <button
                key={s}
                type="button"
                onClick={() => setSourceType(s)}
                className={`text-[10px] font-medium px-2.5 py-1 rounded-full transition-colors ${
                  isSelected
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
                aria-pressed={isSelected}
              >
                {s}
              </button>
            )
          })}
        </div>
      </div>

      {/* Assigned To (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Assigned To (optional)</Label>
        <Input
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className="h-9 text-xs"
          placeholder="Staff name"
          maxLength={200}
        />
      </div>

      {/* Related Invoice ID (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Related Invoice ID (optional)</Label>
        <Input
          value={relatedInvoiceId}
          onChange={(e) => setRelatedInvoiceId(e.target.value)}
          className="h-9 text-xs font-mono"
          placeholder="Paste invoice ID…"
          maxLength={200}
        />
        <p className="text-[10px] text-muted-foreground/70">
          Validated server-side — must belong to your business.
        </p>
      </div>

      {/* Related Product ID (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Related Product ID (optional)</Label>
        <Input
          value={relatedProductId}
          onChange={(e) => setRelatedProductId(e.target.value)}
          className="h-9 text-xs font-mono"
          placeholder="Paste product ID…"
          maxLength={200}
        />
        <p className="text-[10px] text-muted-foreground/70">
          Validated server-side — must belong to your business.
        </p>
      </div>

      {/* Internal Notes (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Internal Notes (optional)</Label>
        <Textarea
          value={internalNotes}
          onChange={(e) => setInternalNotes(e.target.value)}
          className="min-h-[70px] resize-y text-xs"
          placeholder="Staff-only notes — not visible to the customer."
          maxLength={5000}
        />
      </div>
    </div>
  )

  // §SHARED-FOOTER: Cancel + Save buttons. Save shows a spinner while
  // saving and is disabled during the request to prevent double-submits.
  const footer = (
    <div className="flex gap-2 w-full">
      <Button
        variant="outline"
        onClick={() => onOpenChange(false)}
        className="h-11 flex-1"
        disabled={saving}
      >
        Cancel
      </Button>
      <Button
        className="h-11 flex-[2]"
        onClick={handleSave}
        disabled={saving}
      >
        {saving ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <>
            <Plus className="w-4 h-4" /> Create Complaint
          </>
        )}
      </Button>
    </div>
  )

  return (
    <>
      {/* Mobile: bottom-sheet Drawer */}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[88vh]">
          <DrawerHeader>
            <DrawerTitle className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              New Complaint
            </DrawerTitle>
            {/* §A11Y: DrawerDescription satisfies Radix's aria-describedby
                requirement, eliminating the "Missing Description or
                aria-describedby" warning. */}
            <DrawerDescription>
              Log a customer complaint. Fields marked * are required.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            {formContent}
            <div className="mt-4">{footer}</div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* sm+: centered Dialog (hidden on mobile via 'hidden sm:block') */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <FormDialogContent className="max-w-md hidden sm:block">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              New Complaint
            </DialogTitle>
            {/* §A11Y: DialogDescription satisfies Radix's aria-describedby
                requirement. */}
            <DialogDescription>
              Log a customer complaint. Fields marked * are required.
            </DialogDescription>
          </DialogHeader>
          {formContent}
          <DialogFooter>{footer}</DialogFooter>
        </FormDialogContent>
      </Dialog>
    </>
  )
}
