'use client'

import { useState } from 'react'
import { apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import {
  Loader2,
} from 'lucide-react'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

// §FOLLOWUP-FORM: Modal for creating a new follow-up from the party detail.
//
// §MOBILE-FIRST: Drawer on mobile, Dialog on sm+ — same responsive pattern
// as ComplaintForm.
//
// §REQUIRED-FIELDS: title, type, dueAt. The API also requires partyId (passed
// from the parent section — the user never types it).
//
// §SERVER-DERIVED: businessId, createdById, followUpNumber, status are
// NEVER exposed in the form — the server derives them from the session.
//
// §DUPLICATE-PREVENTION: the saving state disables the submit button until
// the API responds.

type Priority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT'
type FollowUpType =
  | 'payment_reminder' | 'product_feedback' | 'complaint_followup'
  | 'reorder_reminder' | 'warranty_expiry' | 'callback'
  | 'offer' | 'birthday' | 'manual' | 'generic_custom'

const PRIORITY_META: Record<Priority, { label: string; pill: string; pillActive: string }> = {
  LOW:    { label: 'Low',    pill: 'bg-muted text-muted-foreground hover:bg-muted/70', pillActive: 'bg-emerald-600 text-white' },
  MEDIUM: { label: 'Medium', pill: 'bg-muted text-muted-foreground hover:bg-muted/70', pillActive: 'bg-amber-600 text-white' },
  HIGH:   { label: 'High',   pill: 'bg-muted text-muted-foreground hover:bg-muted/70', pillActive: 'bg-orange-600 text-white' },
  URGENT: { label: 'Urgent', pill: 'bg-muted text-muted-foreground hover:bg-muted/70', pillActive: 'bg-red-600 text-white' },
}
const PRIORITY_ORDER: Priority[] = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

const TYPE_LABELS: Record<FollowUpType, string> = {
  payment_reminder: 'Payment Reminder',
  product_feedback: 'Product Feedback',
  complaint_followup: 'Complaint Follow-up',
  reorder_reminder: 'Reorder Reminder',
  warranty_expiry: 'Warranty Expiry',
  callback: 'Callback',
  offer: 'Offer',
  birthday: 'Birthday',
  manual: 'Manual',
  generic_custom: 'Custom',
}
const TYPE_ORDER: FollowUpType[] = [
  'manual', 'payment_reminder', 'callback', 'reorder_reminder',
  'product_feedback', 'complaint_followup', 'warranty_expiry',
  'offer', 'birthday', 'generic_custom',
]

export function FollowUpForm({
  open, onOpenChange, partyId, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId: string
  onSaved?: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [type, setType] = useState<FollowUpType>('manual')
  const [priority, setPriority] = useState<Priority>('MEDIUM')
  const [dueAt, setDueAt] = useState('')
  const [saving, setSaving] = useState(false)

  // §SYNC-ON-OPEN: reset form fields when the dialog opens.
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setTitle('')
    setDescription('')
    setType('manual')
    setPriority('MEDIUM')
    setDueAt('')
    setSaving(false)
    setLastOpen(true)
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const handleSave = async () => {
    const trimmedTitle = title.trim()
    if (!trimmedTitle) {
      toast.error('Title is required')
      return
    }
    if (!dueAt) {
      toast.error('Due date is required')
      return
    }
    // §CLIENT-VALIDATION: validate dueAt is a valid date (server is authoritative)
    const dueDate = new Date(dueAt)
    if (isNaN(dueDate.getTime())) {
      toast.error('Invalid due date')
      return
    }

    setSaving(true)
    try {
      const payload = {
        partyId,
        title: trimmedTitle,
        description: description.trim() || null,
        type,
        priority,
        dueAt: dueDate.toISOString(),
      }
      const result = await apiPost('/api/followups', payload)
      // §SHOW-RETURNED-NUMBER: the API returns the created follow-up with followUpNumber
      toast.success(`Follow-up created: ${result.followUpNumber}`)
      onOpenChange(false)
      onSaved?.()
    } catch (e: any) {
      toast.error(e.message || 'Failed to create follow-up')
    } finally {
      setSaving(false)
    }
  }

  const formContent = (
    <div className="space-y-4 py-2">
      {/* Title (required) */}
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="fu-title">
          Title <span className="text-red-500">*</span>
        </Label>
        <Input
          id="fu-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-9 text-xs"
          placeholder="What needs to be done?"
          maxLength={500}
          autoFocus
        />
      </div>

      {/* Type (required) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Type</Label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as FollowUpType)}
          className="w-full h-9 rounded-md border border-input bg-background px-3 text-xs"
          aria-label="Follow-up type"
        >
          {TYPE_ORDER.map((t) => (
            <option key={t} value={t}>{TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Due At (required) */}
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="fu-due">
          Due Date <span className="text-red-500">*</span>
        </Label>
        <Input
          id="fu-due"
          type="datetime-local"
          value={dueAt}
          onChange={(e) => setDueAt(e.target.value)}
          className="h-9 text-xs"
          aria-label="Due date and time"
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
                aria-label={`Priority ${m.label}`}
              >
                {m.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Description (optional) */}
      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="fu-desc">Description (optional)</Label>
        <Textarea
          id="fu-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="min-h-[60px] resize-y text-xs"
          placeholder="Additional context, instructions, or notes…"
          maxLength={5000}
        />
      </div>
    </div>
  )

  const footer = (
    <div className="flex items-center justify-end gap-2 pt-2">
      <Button
        variant="outline"
        size="sm"
        onClick={() => onOpenChange(false)}
        disabled={saving}
        className="text-xs"
      >
        Cancel
      </Button>
      <Button
        size="sm"
        onClick={handleSave}
        disabled={saving || !title.trim() || !dueAt}
        className="text-xs"
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : null}
        Create Follow-up
      </Button>
    </div>
  )

  return (
    <>
      {/* Mobile: Drawer */}
      <Drawer open={open && typeof window !== 'undefined' && window.innerWidth < 640} onOpenChange={onOpenChange}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm">New Follow-up</DrawerTitle>
            <DrawerDescription className="text-xs">Create a follow-up task for this customer.</DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4">
            {formContent}
            {footer}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Desktop: Dialog */}
      <Dialog open={open && (typeof window === 'undefined' || window.innerWidth >= 640)} onOpenChange={onOpenChange}>
        <FormDialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="text-sm">New Follow-up</DialogTitle>
            <DialogDescription className="text-xs">Create a follow-up task for this customer.</DialogDescription>
          </DialogHeader>
          {formContent}
          <DialogFooter>{footer}</DialogFooter>
        </FormDialogContent>
      </Dialog>
    </>
  )
}
