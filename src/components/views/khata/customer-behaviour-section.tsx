'use client'

import { useState } from 'react'
import { useFetch, apiPut } from '@/hooks/use-fetch'
import { timeAgo, formatDateTime } from '@/lib/utils'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Heart, Pencil, Loader2, AlertTriangle, X, Check, History,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
} from '@/components/ui/drawer'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { BEHAVIOUR_TAG_PRESETS } from '@/app/api/parties/[id]/behaviour/route'

// §CUSTOMER-BEHAVIOUR-SECTION: Manually-rated interaction/service behaviour.
//
// §VISUAL-DISTINCTION-FROM-TRUST-SCORE:
//   - TrustScoreCard uses Star icon + emerald/amber/red colors + "AI Credit
//     Trust Score" label (financial, auto-computed).
//   - This section uses Heart icon + violet/purple colors + "Customer
//     Behaviour" label (interaction, staff-rated).
// The two are intentionally visually distinct so users never confuse them.
//
// §MOBILE-FIRST: uses the existing BizLedger visual language (rounded-2xl
// bg-card border-border p-4 shadow-sm). Edit dialog uses a bottom-sheet
// Drawer on mobile, Dialog on sm+.

type Rating = 'VERY_BAD' | 'BAD' | 'GOOD' | 'BETTER' | 'BEST'

interface CustomerBehaviour {
  id: string
  businessId: string
  partyId: string
  rating: Rating
  tags: string | null
  notes: string | null
  ratedBy: string | null
  createdAt: string
  updatedAt: string
}

interface BehaviourResponse {
  behaviour: CustomerBehaviour | null
}

interface HistoryEntry {
  id: string
  rating: Rating
  tags: string | null
  notes: string | null
  ratedBy: string | null
  createdAt: string
}

interface HistoryResponse {
  history: HistoryEntry[]
}

// §RATING-META: visual config per rating. Colors are violet/purple shades
// (distinct from TrustScore's emerald/amber/red). Each rating has a short
// label + emoji for quick mobile scanning.
const RATING_META: Record<Rating, { label: string; emoji: string; badge: string; ring: string; dot: string }> = {
  VERY_BAD: { label: 'Very Bad', emoji: '😠', badge: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300', ring: 'ring-red-500/30', dot: 'bg-red-500' },
  BAD:      { label: 'Bad',       emoji: '😕', badge: 'bg-orange-100 text-orange-700 dark:bg-orange-950/40 dark:text-orange-300', ring: 'ring-orange-500/30', dot: 'bg-orange-500' },
  GOOD:     { label: 'Good',     emoji: '🙂', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300', ring: 'ring-violet-500/30', dot: 'bg-violet-500' },
  BETTER:   { label: 'Better',   emoji: '😊', badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300', ring: 'ring-indigo-500/30', dot: 'bg-indigo-500' },
  BEST:     { label: 'Best',     emoji: '🤩', badge: 'bg-purple-100 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300', ring: 'ring-purple-500/30', dot: 'bg-purple-500' },
}

const RATING_ORDER: Rating[] = ['VERY_BAD', 'BAD', 'GOOD', 'BETTER', 'BEST']

function parseTags(tags: string | null): string[] {
  if (!tags) return []
  try {
    const parsed = JSON.parse(tags)
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : []
  } catch {
    return []
  }
}

export function CustomerBehaviourSection({ partyId }: { partyId: string }) {
  const { data, loading, error, refetch } = useFetch<BehaviourResponse>(
    `/api/parties/${partyId}/behaviour`,
    [partyId]
  )
  const behaviour = data?.behaviour ?? null

  const [showEdit, setShowEdit] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      {/* Header — intentionally distinct from TrustScoreCard */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <Heart className="w-4 h-4 text-violet-500" />
          Customer Behaviour
          {/* §DISTINCT-LABEL: explicit "interaction/service" subtitle to
              distinguish from the financial AI Credit Trust Score. */}
          <span className="text-[10px] font-normal text-muted-foreground/70 hidden sm:inline">
            · interaction
          </span>
        </h3>
        <div className="flex items-center gap-1">
          {behaviour && (
            <button
              onClick={() => setShowHistory(true)}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 px-2 py-1 rounded-lg flex items-center gap-1 transition-colors"
              aria-label="View history"
            >
              <History className="w-3 h-3" /> History
            </button>
          )}
          <button
            onClick={() => setShowEdit(true)}
            className="text-[10px] font-medium text-violet-600 bg-violet-100 dark:bg-violet-950/40 dark:text-violet-300 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-violet-200 dark:hover:bg-violet-900/40 transition-colors"
          >
            <Pencil className="w-3 h-3" /> {behaviour ? 'Edit' : 'Rate'}
          </button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <AlertTriangle className="w-8 h-8 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load behaviour</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : !behaviour ? (
        // §EMPTY-STATE: no behaviour set yet — prompt staff to rate.
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <Heart className="w-7 h-7 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No behaviour rating yet</p>
          <p className="text-[11px] text-muted-foreground/70 max-w-[220px]">
            Rate this customer&apos;s interaction style — separate from their payment trust score.
          </p>
        </div>
      ) : (
        <BehaviourDisplay behaviour={behaviour} />
      )}

      {/* Edit / Rate Dialog */}
      <EditBehaviourDialog
        open={showEdit}
        onOpenChange={setShowEdit}
        partyId={partyId}
        existing={behaviour}
        onSaved={() => refetch()}
      />

      {/* History Drawer (mobile bottom-sheet) */}
      <HistoryDrawer
        open={showHistory}
        onOpenChange={setShowHistory}
        partyId={partyId}
      />
    </div>
  )
}

// ─── Behaviour Display ─────────────────────────────────────────────────
function BehaviourDisplay({ behaviour }: { behaviour: CustomerBehaviour }) {
  const meta = RATING_META[behaviour.rating] || RATING_META.GOOD
  const tags = parseTags(behaviour.tags)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-3"
    >
      {/* Rating badge */}
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-xl ring-1 ${meta.badge} ${meta.ring}`}>
        <span className="text-base leading-none">{meta.emoji}</span>
        <span className="text-sm font-semibold">{meta.label}</span>
      </div>

      {/* Tags */}
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Notes */}
      {behaviour.notes && (
        <p className="text-xs text-foreground/80 whitespace-pre-wrap break-words bg-muted/40 rounded-lg p-2.5">
          {behaviour.notes}
        </p>
      )}

      {/* Footer: last rated info */}
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/80">
        <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
        {behaviour.ratedBy && <span>{behaviour.ratedBy}</span>}
        {behaviour.ratedBy && <span>·</span>}
        <span title={formatDateTime(behaviour.updatedAt)}>
          {timeAgo(behaviour.updatedAt)}
        </span>
      </div>
    </motion.div>
  )
}

// ─── Edit / Rate Dialog ────────────────────────────────────────────────
function EditBehaviourDialog({
  open, onOpenChange, partyId, existing, onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId: string
  existing: CustomerBehaviour | null
  onSaved: () => void
}) {
  const initialRating: Rating = existing?.rating ?? 'GOOD'
  const initialTags = parseTags(existing?.tags ?? null)
  const initialNotes = existing?.notes ?? ''
  const initialRatedBy = existing?.ratedBy ?? ''

  const [rating, setRating] = useState<Rating>(initialRating)
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set(initialTags))
  const [customTag, setCustomTag] = useState('')
  const [notes, setNotes] = useState(initialNotes)
  const [ratedBy, setRatedBy] = useState(initialRatedBy)
  const [saving, setSaving] = useState(false)

  // §SYNC-ON-OPEN: reset form fields when the dialog opens (not on every render).
  const [lastOpen, setLastOpen] = useState(false)
  if (open && !lastOpen) {
    setRating(initialRating)
    setSelectedTags(new Set(initialTags))
    setCustomTag('')
    setNotes(initialNotes)
    setRatedBy(initialRatedBy)
    setSaving(false)
    setLastOpen(true)
  } else if (!open && lastOpen) {
    setLastOpen(false)
  }

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  const addCustomTag = () => {
    const trimmed = customTag.trim()
    if (!trimmed) return
    if (trimmed.length > 50) {
      toast.error('Tag too long (max 50 chars)')
      return
    }
    if (selectedTags.size >= 20) {
      toast.error('Too many tags (max 20)')
      return
    }
    setSelectedTags((prev) => new Set(prev).add(trimmed))
    setCustomTag('')
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const tagsArray = Array.from(selectedTags)
      await apiPut(`/api/parties/${partyId}/behaviour`, {
        rating,
        tags: tagsArray,
        notes: notes.trim() || null,
        ratedBy: ratedBy.trim() || null,
      })
      toast.success(existing ? 'Behaviour updated' : 'Behaviour rated')
      onOpenChange(false)
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to save behaviour')
    } finally {
      setSaving(false)
    }
  }

  // §RESPONSIVE: Dialog on sm+ (centered modal), Drawer on mobile (bottom-sheet).
  // The form content is shared.
  const formContent = (
    <div className="space-y-4 py-2">
      {/* Rating selector — 5 buttons in a row (mobile-friendly) */}
      <div className="space-y-1.5">
        <Label className="text-xs">Rating</Label>
        <div className="grid grid-cols-5 gap-1.5">
          {RATING_ORDER.map((r) => {
            const m = RATING_META[r]
            const isSelected = rating === r
            return (
              <button
                key={r}
                onClick={() => setRating(r)}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border transition-all ${
                  isSelected
                    ? `${m.badge} border-current ring-1 ${m.ring}`
                    : 'border-border bg-muted/30 hover:bg-muted/60'
                }`}
                aria-pressed={isSelected}
              >
                <span className="text-base leading-none">{m.emoji}</span>
                <span className="text-[9px] font-medium leading-tight text-center">{m.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Tags — preset chips + custom input */}
      <div className="space-y-1.5">
        <Label className="text-xs">Tags (optional)</Label>
        <div className="flex flex-wrap gap-1.5">
          {BEHAVIOUR_TAG_PRESETS.map((tag) => {
            const isSelected = selectedTags.has(tag)
            return (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className={`text-[10px] font-medium px-2 py-1 rounded-full flex items-center gap-0.5 transition-colors ${
                  isSelected
                    ? 'bg-violet-600 text-white'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70'
                }`}
              >
                {isSelected && <Check className="w-2.5 h-2.5" />}
                {tag}
              </button>
            )
          })}
        </div>
        {/* Selected custom tags (removable) */}
        {Array.from(selectedTags).filter((t) => !BEHAVIOUR_TAG_PRESETS.includes(t as any)).length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {Array.from(selectedTags).filter((t) => !BEHAVIOUR_TAG_PRESETS.includes(t as any)).map((tag) => (
              <button
                key={tag}
                onClick={() => toggleTag(tag)}
                className="text-[10px] font-medium px-2 py-1 rounded-full bg-violet-100 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300 flex items-center gap-0.5"
              >
                {tag} <X className="w-2.5 h-2.5" />
              </button>
            ))}
          </div>
        )}
        {/* Custom tag input */}
        <div className="flex gap-1.5">
          <Input
            value={customTag}
            onChange={(e) => setCustomTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCustomTag() } }}
            className="h-9 text-xs"
            placeholder="Add custom tag…"
            maxLength={50}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addCustomTag}
            className="h-9 px-3 text-xs shrink-0"
            disabled={!customTag.trim()}
          >
            Add
          </Button>
        </div>
      </div>

      {/* Notes */}
      <div className="space-y-1.5">
        <Label className="text-xs">Notes (optional)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-[70px] resize-y text-xs"
          placeholder="Behaviour-specific note (interaction style, preferences…)"
          maxLength={5000}
        />
      </div>

      {/* Rated by */}
      <div className="space-y-1.5">
        <Label className="text-xs">Rated by (optional)</Label>
        <Input
          value={ratedBy}
          onChange={(e) => setRatedBy(e.target.value)}
          className="h-9 text-xs"
          placeholder="Staff name"
          maxLength={200}
        />
      </div>
    </div>
  )

  const footer = (
    <div className="flex gap-2 w-full">
      <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11 flex-1" disabled={saving}>
        Cancel
      </Button>
      <Button className="h-11 flex-[2] bg-violet-600 hover:bg-violet-700" onClick={handleSave} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : existing ? 'Save Changes' : 'Rate Behaviour'}
      </Button>
    </div>
  )

  return (
    <>
      {/* Mobile: bottom-sheet Drawer */}
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>{existing ? 'Edit Behaviour' : 'Rate Customer Behaviour'}</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4 overflow-y-auto">
            {formContent}
            <div className="mt-4">{footer}</div>
          </div>
        </DrawerContent>
      </Drawer>

      {/* sm+: centered Dialog */}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <FormDialogContent className="max-w-md hidden sm:block">
          <DialogHeader>
            <DialogTitle>{existing ? 'Edit Behaviour' : 'Rate Customer Behaviour'}</DialogTitle>
          </DialogHeader>
          {formContent}
          <DialogFooter>{footer}</DialogFooter>
        </FormDialogContent>
      </Dialog>
    </>
  )
}

// ─── History Drawer ────────────────────────────────────────────────────
function HistoryDrawer({ open, onOpenChange, partyId }: {
  open: boolean
  onOpenChange: (o: boolean) => void
  partyId: string
}) {
  const { data, loading, error } = useFetch<HistoryResponse>(
    open ? `/api/parties/${partyId}/behaviour/history?limit=50` : null,
    [partyId, open]
  )
  const history = data?.history ?? []

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[80vh]">
        <DrawerHeader>
          <DrawerTitle className="flex items-center gap-1.5">
            <History className="w-4 h-4 text-violet-500" />
            Behaviour History
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-4 overflow-y-auto max-h-[60vh]">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
              <AlertTriangle className="w-8 h-8 text-muted-foreground/50" />
              <p className="text-xs text-muted-foreground">Couldn&apos;t load history</p>
            </div>
          ) : history.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-6">No history yet</p>
          ) : (
            <div className="space-y-2">
              <AnimatePresence initial={false}>
                {history.map((entry) => {
                  const meta = RATING_META[entry.rating] || RATING_META.GOOD
                  const tags = parseTags(entry.tags)
                  return (
                    <motion.div
                      key={entry.id}
                      layout
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex gap-2.5 p-2.5 rounded-xl bg-muted/40"
                    >
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-base ${meta.badge}`}>
                        {meta.emoji}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-xs font-semibold">{meta.label}</span>
                          <span className="text-[10px] text-muted-foreground/70">·</span>
                          <span className="text-[10px] text-muted-foreground" title={formatDateTime(entry.createdAt)}>
                            {timeAgo(entry.createdAt)}
                          </span>
                          {entry.ratedBy && (
                            <>
                              <span className="text-[10px] text-muted-foreground/70">·</span>
                              <span className="text-[10px] text-muted-foreground truncate max-w-[100px]">{entry.ratedBy}</span>
                            </>
                          )}
                        </div>
                        {tags.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {tags.map((t) => (
                              <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">{t}</span>
                            ))}
                          </div>
                        )}
                        {entry.notes && (
                          <p className="text-[11px] text-foreground/70 mt-1 whitespace-pre-wrap break-words">{entry.notes}</p>
                        )}
                      </div>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
