'use client'

/**
 * PRD Part 32 §4.2 — Business Partners & Collection Agents Fingerprint Manager
 *
 * Lets the owner link a partner's / cashier's / collection agent's
 * fingerprint to a supplier (mahajan) profile so they can scan-to-view the
 * supplier's ledger and confirm digital receipts.
 *
 * Modal layout (mirrors FamilyMemberManager):
 *  - Header: "Business Partners & Collection Agents" with Briefcase icon.
 *  - Inline add form: name + role-type select (Business Partner / Cashier /
 *    Collection Agent / Other) + hand + finger + "Scan Fingerprint".
 *  - List filtered to role === 'partner' | 'agent' with color-coded role
 *    badges (Partner=emerald, Cashier=amber, Collection Agent=sky) and
 *    delete (Trash2) buttons.
 *
 * Role mapping:
 *  - "Business Partner" / "Other"  → role: 'partner'
 *  - "Cashier" / "Collection Agent" → role: 'agent'
 *  The human-readable type is persisted in the `relation` field so the list
 *  can render the correct badge without an extra column.
 */

import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Briefcase,
  Fingerprint,
  Trash2,
  Loader2,
  Plus,
  ShieldCheck,
  Hand as HandIcon,
  Store,
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

export interface PartnerAgentManagerProps {
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

const ROLE_TYPES = [
  { value: 'Business Partner', apiRole: 'partner' },
  { value: 'Cashier', apiRole: 'agent' },
  { value: 'Collection Agent', apiRole: 'agent' },
  { value: 'Other', apiRole: 'partner' },
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

function roleBadgeClass(relation: string | null, role: string): string {
  if (role === 'partner') {
    return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
  }
  // agent variants
  if (relation === 'Cashier') {
    return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
  }
  if (relation === 'Collection Agent') {
    return 'border-sky-500/30 bg-sky-500/10 text-sky-300'
  }
  return 'border-amber-500/30 bg-amber-500/10 text-amber-300'
}

function roleIcon(role: string, relation: string | null) {
  if (role === 'partner') return <Briefcase className="h-4 w-4" />
  if (relation === 'Collection Agent') return <ShieldCheck className="h-4 w-4" />
  return <Store className="h-4 w-4" />
}

export function PartnerAgentManager({
  partyId,
  partyName,
  open,
  onOpenChange,
}: PartnerAgentManagerProps) {
  const { data, loading, refetch } = useFetch<any>(
    open ? `/api/fingerprints?partyId=${partyId}` : null,
    [partyId, open]
  )

  const [name, setName] = useState('')
  const [roleType, setRoleType] = useState<string>('Business Partner')
  const [hand, setHand] = useState<string>('right')
  const [finger, setFinger] = useState<string>('thumb')
  const [scanning, setScanning] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const all: FingerprintRecord[] = data?.fingerprints ?? data ?? []
  const partnersAndAgents = all.filter(
    (r) => r.role === 'partner' || r.role === 'agent'
  )

  const resetForm = useCallback(() => {
    setName('')
    setRoleType('Business Partner')
    setHand('right')
    setFinger('thumb')
  }, [])

  const handleScan = useCallback(async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Name is required', {
        description: 'Enter the partner, cashier, or agent name to link their fingerprint.',
      })
      return
    }

    const match = ROLE_TYPES.find((r) => r.value === roleType) ?? ROLE_TYPES[0]
    const apiRole = match.apiRole

    setScanning(true)
    await new Promise((r) => setTimeout(r, SCAN_DURATION_MS))

    try {
      await apiPost('/api/fingerprints', {
        partyId,
        role: apiRole,
        linkedName: trimmed,
        relation: roleType,
        hand,
        finger,
        scannerType: 'native',
      })
      toast.success(`Fingerprint linked for ${trimmed}`, {
        description: `${roleType} • ${cap(hand)} ${cap(finger)} finger`,
      })
      resetForm()
      await refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error('Could not link fingerprint', { description: msg })
    } finally {
      setScanning(false)
    }
  }, [name, roleType, hand, finger, partyId, refetch, resetForm])

  const handleDelete = useCallback(
    async (fp: FingerprintRecord) => {
      setDeletingId(fp.id)
      try {
        await apiDelete(`/api/fingerprints?id=${fp.id}`)
        toast.success('Fingerprint removed', {
          description: fp.linkedName
            ? `${fp.linkedName}'s access revoked from ${partyName}'s ledger.`
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
            <Briefcase className="h-7 w-7" />
          </div>
          <DialogTitle className="text-center text-lg font-semibold text-foreground">
            Business Partners &amp; Collection Agents
          </DialogTitle>
          <DialogDescription className="text-center text-sm text-muted-foreground">
            Link a partner&apos;s, cashier&apos;s, or collection agent&apos;s
            fingerprint to <span className="font-medium text-foreground">{partyName}</span>&apos;s
            ledger. They can scan to view this mahajan&apos;s ledger and confirm
            digital receipts.
          </DialogDescription>
        </DialogHeader>

        {/* ─── Add Partner / Agent form (inline) ─── */}
        <div className="rounded-lg border border-border bg-background/50 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium text-foreground">
            <Plus className="h-4 w-4 text-emerald-300" />
            Add Partner or Agent
          </div>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="pa-name">Name</Label>
              <Input
                id="pa-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Amit (Cashier) or Rahim (Agent)"
                disabled={scanning}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !scanning) handleScan()
                }}
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Role</Label>
                <Select value={roleType} onValueChange={setRoleType} disabled={scanning}>
                  <SelectTrigger className="w-full" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_TYPES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.value}
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

        {/* ─── Existing partners / agents list ─── */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Linked Partners &amp; Agents ({partnersAndAgents.length})
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
          ) : partnersAndAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/30 px-4 py-8 text-center">
              <Briefcase className="h-8 w-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No partners or agents linked yet.
              </p>
            </div>
          ) : (
            <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1
                [&::-webkit-scrollbar]:w-1.5
                [&::-webkit-scrollbar-thumb]:rounded-full
                [&::-webkit-scrollbar-thumb]:bg-border
                [&::-webkit-scrollbar-track]:bg-transparent">
              <AnimatePresence initial={false}>
                {partnersAndAgents.map((fp) => (
                  <li key={fp.id}>
                    <PartnerAgentRow
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
          <ShieldCheck className="h-3 w-3 text-emerald-400" />
          <span>
            Partners can confirm digital receipts; agents can collect &amp;
            reconcile payments on this ledger.
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface RowProps {
  fp: FingerprintRecord
  deleting: boolean
  onDelete: (fp: FingerprintRecord) => void
}

function PartnerAgentRow({ fp, deleting, onDelete }: RowProps) {
  const label = fp.linkedName || 'Unnamed contact'
  const handFinger = [cap(fp.hand), cap(fp.finger)].filter(Boolean).join(' ')
  const badgeLabel =
    fp.relation || (fp.role === 'partner' ? 'Partner' : 'Agent')
  const iconBg =
    fp.role === 'partner'
      ? 'bg-emerald-500/10 text-emerald-300'
      : fp.relation === 'Collection Agent'
        ? 'bg-sky-500/10 text-sky-300'
        : 'bg-amber-500/10 text-amber-300'

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -16 }}
      transition={{ type: 'spring', stiffness: 320, damping: 26 }}
      className="group flex items-center gap-3 rounded-md border border-border bg-background/50 px-3 py-2.5 transition hover:border-emerald-500/30 hover:bg-emerald-500/5"
    >
      <div
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
          iconBg
        )}
      >
        {roleIcon(fp.role, fp.relation)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{label}</p>
          <Badge className={cn('shrink-0', roleBadgeClass(fp.relation, fp.role))}>
            {badgeLabel}
          </Badge>
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
    </motion.div>
  )
}

export default PartnerAgentManager
