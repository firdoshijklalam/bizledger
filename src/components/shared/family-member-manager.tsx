'use client'

/**
 * PRD Part 32 §4.1 — Family Members & Relatives Fingerprint Manager
 *
 * Lets the owner link a family member's fingerprint to a customer's khata
 * so that family member can scan-to-open the customer's account (useful for
 * shared family businesses where a son/daughter collects on the parent's
 * behalf).
 *
 * Modal layout:
 *  - Header: "Family Members & Relatives" with Users icon.
 *  - Inline add form: name + relation + hand + finger + "Scan Fingerprint"
 *    (1.2s simulated scan, then POST /api/fingerprints with role: 'family').
 *  - List of existing family-member fingerprints with relation badge,
 *    hand+finger text, and a delete (Trash2) button.
 *  - Empty state when no family members are linked yet.
 *
 * The primary fingerprint (role === 'primary') is also surfaced at the top
 * of the list so the owner has full context of every biometric credential
 * attached to this khata.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Users,
  Fingerprint,
  Trash2,
  Loader2,
  Plus,
  ScanLine,
  UserCircle2,
  Hand as HandIcon,
} from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import { toast } from 'sonner'
import { useFetch, apiPost, apiDelete } from '@/hooks/use-fetch'
import { cn } from '@/lib/utils'

export interface FamilyMemberManagerProps {
  partyId: string
  partyName: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface FingerprintRecord {
  id: string
  fingerprintHash: string
  partyId: string
  role: string
  linkedName: string | null
  relation: string | null
  scannerType: string | null
  hand: string | null
  finger: string | null
  createdAt: string
}

interface FingerprintsResponse {
  count: number
  fingerprints: FingerprintRecord[]
}

const RELATIONS = [
  'Son',
  'Daughter',
  'Wife',
  'Husband',
  'Brother',
  'Sister',
  'Father',
  'Mother',
  'Other',
] as const

const HANDS = [
  { value: 'right', label: 'Right' },
  { value: 'left', label: 'Left' },
] as const

const FINGERS = [
  { value: 'thumb', label: 'Thumb' },
  { value: 'index', label: 'Index' },
  { value: 'middle', label: 'Middle' },
  { value: 'ring', label: 'Ring' },
  { value: 'pinky', label: 'Pinky' },
] as const

const SCAN_DURATION_MS = 1200

function cap(s: string | null): string {
  if (!s) return ''
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function relationBadgeClass(relation: string): string {
  switch (relation) {
    case 'Son':
    case 'Daughter':
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    case 'Wife':
    case 'Husband':
      return 'border-rose-500/30 bg-rose-500/10 text-rose-300'
    case 'Brother':
    case 'Sister':
      return 'border-cyan-500/30 bg-cyan-500/10 text-cyan-300'
    case 'Father':
    case 'Mother':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    default:
      return 'border-border bg-muted text-muted-foreground'
  }
}

export function FamilyMemberManager({
  partyId,
  partyName,
  open,
  onOpenChange,
}: FamilyMemberManagerProps) {
  const { data, loading, refetch } = useFetch<FingerprintsResponse>(
    open ? `/api/fingerprints?partyId=${partyId}` : null,
    [partyId, open]
  )

  const [name, setName] = useState('')
  const [relation, setRelation] = useState<string>('Son')
  const [hand, setHand] = useState<string>('right')
  const [finger, setFinger] = useState<string>('thumb')
  const [scanning, setScanning] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const all: FingerprintRecord[] = data?.fingerprints ?? data ?? []
  const primary = all.find((r) => r.role === 'primary')
  const familyMembers = all.filter((r) => r.role === 'family')

  const resetForm = useCallback(() => {
    setName('')
    setRelation('Son')
    setHand('right')
    setFinger('thumb')
  }, [])

  const handleScan = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Family member name is required', {
        description: 'Enter a name like "Rahim\'s Son" to link their fingerprint.',
      })
      return
    }

    setScanning(true)
    // Simulated fingerprint scan (web cannot reach native scanner SDK).
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS))

    try {
      await apiPost('/api/fingerprints', {
        partyId,
        role: 'family',
        linkedName: trimmed,
        relation,
        hand,
        finger,
        scannerType: 'native',
      })
      toast.success(`Fingerprint linked for ${trimmed}`, {
        description: `${cap(hand)} ${cap(finger)} finger • Relation: ${relation}`,
      })
      resetForm()
      await refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Could not link fingerprint', { description: msg })
    } finally {
      setScanning(false)
    }
  }, [name, relation, hand, finger, partyId, refetch, resetForm])

  const handleDelete = useCallback(
    async (fp: FingerprintRecord) => {
      setDeletingId(fp.id)
      try {
        await apiDelete(`/api/fingerprints?id=${fp.id}`)
        toast.success('Fingerprint removed', {
          description: fp.linkedName
            ? `${fp.linkedName}'s access revoked from ${partyName}'s khata.`
            : 'Access revoked.',
        })
        await refetch()
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error('Could not remove fingerprint', { description: msg })
      } finally {
        setDeletingId(null)
      }
    },
    [refetch, partyName]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card/80 backdrop-blur-xl">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300 ring-2 ring-emerald-500/20">
            <Users className="h-7 w-7" />
          </div>
          <DialogTitle className="text-center text-lg font-semibold text-foreground">
            Family Members &amp; Relatives
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Link a family member&apos;s fingerprint to this khata. They can scan
            to open <span className="font-medium text-foreground">{partyName}</span>&apos;s
            account.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Add Family Member form (inline) ─── */}
        <div className="rounded-lg border border-border bg-background/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-emerald-300" />
            Add Family Member
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="fm-name">Family Member Name</Label>
              <Input
                id="fm-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Rahim's Son"
                disabled={scanning}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !scanning) handleScan()
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Relation</Label>
                <Select value={relation} onValueChange={setRelation} disabled={scanning}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RELATIONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Hand</Label>
                <Select value={hand} onValueChange={setHand} disabled={scanning}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HANDS.map((h) => (
                      <SelectItem key={h.value} value={h.value}>
                        {h.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Finger</Label>
                <Select value={finger} onValueChange={setFinger} disabled={scanning}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FINGERS.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <Button
              type="button"
              className="w-full bg-emerald-600 text-white hover:bg-emerald-500"
              disabled={scanning}
              onClick={handleScan}
            >
              {scanning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Scanning fingerprint…
                </>
              ) : (
                <>
                  <Fingerprint className="h-4 w-4" />
                  Scan Fingerprint
                </>
              )}
            </Button>
          </div>
        </div>

        {/* ─── Existing family members list ─── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Linked Family Members ({familyMembers.length})
            </p>
            {loading && (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
            )}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[0, 1].map((i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-md border border-border bg-background/40"
                />
              ))}
            </div>
          ) : familyMembers.length === 0 && !primary ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/30 px-4 py-8 text-center">
              <UserCircle2 className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No family members linked yet. Add one to enable one-touch khata
                access.
              </p>
            </div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1
                [&::-webkit-scrollbar]:w-1.5
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:bg-border
                [&::-webkit-scrollbar-track]:bg-transparent">
              <AnimatePresence initial={false}>
                {primary && (
                  <li key={primary.id}>
                    <FamilyMemberRow
                      fp={primary}
                      isPrimary
                      deleting={deletingId === primary.id}
                      onDelete={handleDelete}
                    />
                  </li>
                )}
                {familyMembers.map((fp) => (
                  <li key={fp.id}>
                    <FamilyMemberRow
                      fp={fp}
                      deleting={deletingId === fp.id}
                      onDelete={handleDelete}
                    />
                  </li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>

        <div className="flex items-center justify-center gap-1.5 pt-1 text-[11px] text-muted-foreground">
          <ScanLine className="h-3 w-3 text-emerald-400" />
          <span>
            Family members can scan their finger at the biometric scanner to
            instantly open this khata.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface RowProps {
  fp: FingerprintRecord
  isPrimary?: boolean
  deleting: boolean
  onDelete: (fp: FingerprintRecord) => void
}

function FamilyMemberRow({ fp, isPrimary, deleting, onDelete }: RowProps) {
  const label =
    fp.linkedName || (isPrimary ? 'Primary (owner)' : 'Family member')
  const handFinger = [cap(fp.hand), cap(fp.finger)].filter(Boolean).join(' ')

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="group flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2.5 transition hover:border-emerald-500/30 hover:bg-emerald-500/5"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-300">
        {isPrimary ? (
          <UserCircle2 className="h-5 w-5" />
        ) : (
          <Fingerprint className="h-4 w-4" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          {isPrimary ? (
            <Badge className="shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-300">
              Primary
            </Badge>
          ) : (
            fp.relation && (
              <Badge className={cn('shrink-0', relationBadgeClass(fp.relation))}>
                {fp.relation}
              </Badge>
            )
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {handFinger && (
            <>
              <HandIcon className="h-3 w-3" />
              <span>{handFinger}</span>
              <span aria-hidden>•</span>
            </>
          )}
          <span className="capitalize">{fp.scannerType || 'native'} scan</span>
        </div>
      </div>

      {!isPrimary && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground hover:bg-red-500/10 hover:text-red-400"
          disabled={deleting}
          onClick={() => onDelete(fp)}
          aria-label={`Remove ${label}'s fingerprint`}
        >
          {deleting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
        </Button>
      )}
    </motion.div>
  )
}

export default FamilyMemberManager
