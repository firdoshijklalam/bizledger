'use client'

import { useState, useCallback } from 'react'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import { toast } from 'sonner'
import { motion, AnimatePresence } from 'framer-motion'
import {
  MessageSquare, Plus, Loader2, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { timeAgo } from '@/lib/utils'
import { useAppStore } from '@/store/app-store'
import { ComplaintForm } from '../complaint-form'
import { ComplaintDetailSheet } from '../complaint-detail-sheet'

// §PARTY-COMPLAINTS-SECTION: Compact complaints summary on the party detail
// page. Shows active complaint count + recent complaints + a "Create Complaint"
// button. Clicking a complaint opens the detail sheet.

interface Complaint {
  id: string
  complaintNumber: string
  title: string
  status: string
  priority: string
  createdAt: string
  party?: { id: string; name: string } | null
}

interface ComplaintsResponse { items: Complaint[] }

const STATUS_BADGE: Record<string, string> = {
  NEW: 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300',
  IN_PROGRESS: 'bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300',
  WAITING: 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
  RESOLVED: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
  CLOSED: 'bg-muted text-muted-foreground',
}

const PRIORITY_DOT: Record<string, string> = {
  LOW: 'bg-muted-foreground/40',
  MEDIUM: 'bg-blue-500',
  HIGH: 'bg-orange-500',
  URGENT: 'bg-red-500',
}

// Active = not RESOLVED/CLOSED
const ACTIVE_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING']

export function PartyComplaintsSection({ partyId, partyName }: { partyId: string; partyName?: string }) {
  const { data, loading, error, refetch } = useFetch<ComplaintsResponse>(
    `/api/complaints?partyId=${partyId}&limit=10`,
    [partyId]
  )
  const complaints = data?.items ?? []

  const [showForm, setShowForm] = useState(false)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const { setActiveView } = useAppStore()

  const activeCount = complaints.filter(c => ACTIVE_STATUSES.includes(c.status)).length

  const openDetail = useCallback((id: string) => {
    setDetailId(id)
    setDetailOpen(true)
  }, [setDetailId, setDetailOpen])

  const handleViewAll = () => {
    // Navigate to the complaints board (the board has its own filters)
    setActiveView('complaints' as any)
  }

  return (
    <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          <MessageSquare className="w-4 h-4 text-amber-500" />
          Complaints
          {activeCount > 0 && (
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded-full">
              {activeCount} active
            </span>
          )}
          {complaints.length > 0 && (
            <span className="text-xs text-muted-foreground font-normal">{complaints.length}</span>
          )}
        </h3>
        <div className="flex items-center gap-1">
          {complaints.length > 0 && (
            <button
              onClick={handleViewAll}
              className="text-[10px] font-medium text-muted-foreground hover:text-foreground bg-muted hover:bg-muted/70 px-2 py-1 rounded-lg flex items-center gap-0.5 transition-colors"
            >
              View All <ChevronRight className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={() => setShowForm(true)}
            className="text-[10px] font-medium text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/40 px-2 py-1 rounded-lg flex items-center gap-1 hover:bg-amber-200 dark:hover:bg-amber-900/40 transition-colors"
          >
            <Plus className="w-3 h-3" /> New
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-4 gap-2">
          <AlertTriangle className="w-6 h-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">Couldn&apos;t load complaints</p>
          <button
            onClick={() => refetch()}
            className="text-[11px] font-medium text-primary px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : complaints.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-5 gap-1.5 text-center">
          <MessageSquare className="w-6 h-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">No complaints yet</p>
        </div>
      ) : (
        <div className="space-y-1.5 max-h-72 overflow-y-auto scroll-area pr-1">
          <AnimatePresence initial={false}>
            {complaints.slice(0, 5).map((c) => (
              <motion.button
                key={c.id}
                layout
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                onClick={() => openDetail(c.id)}
                className="w-full flex items-center gap-2 p-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
              >
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIORITY_DOT[c.priority] || PRIORITY_DOT.MEDIUM}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono font-medium text-muted-foreground">{c.complaintNumber}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${STATUS_BADGE[c.status] || STATUS_BADGE.NEW}`}>
                      {c.status}
                    </span>
                  </div>
                  <p className="text-xs font-medium truncate mt-0.5">{c.title}</p>
                </div>
                <span className="text-[10px] text-muted-foreground/70 shrink-0">{timeAgo(c.createdAt)}</span>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      )}

      <ComplaintForm
        open={showForm}
        onOpenChange={setShowForm}
        partyId={partyId}
        onSaved={() => refetch()}
      />

      <ComplaintDetailSheet
        open={detailOpen}
        onOpenChange={(o) => { setDetailOpen(o); if (!o) setDetailId(null) }}
        complaintId={detailId}
        onUpdated={() => refetch()}
      />
    </div>
  )
}
