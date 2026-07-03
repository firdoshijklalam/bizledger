'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Party } from '@/lib/types'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { BookOpen, Plus, Users, Filter, Phone, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState, LoadingState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useEffect, useMemo, useState } from 'react'
import { PartyForm } from './khata/party-form'
import { PartyDetail } from './khata/party-detail'
import { Input } from '@/components/ui/input'
import { useScrollStore } from '@/store/scroll-store'

export function KhataView() {
  const {
    selectedPartyId, setSelectedPartyId,
    khataFilter, setKhataFilter,
    showPartyForm, setShowPartyForm,
    editingPartyId, setEditingPartyId,
    pendingQuickAction, clearQuickAction,
    business,
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const [gradeFilter, setGradeFilter] = useState<string>('all')

  const { data: parties, loading } = useFetch<Party[]>('/api/parties', [])

  // PRD Part 7 §3: scroll retention
  const { save: saveScrollPos, restore: restoreScrollPos } = useScrollStore()
  useEffect(() => {
    if (!selectedPartyId) {
      restoreScrollPos('khata')
    }
    // Save on unmount
    return () => {
      if (!selectedPartyId) saveScrollPos('khata')
    }
  }, [selectedPartyId, saveScrollPos, restoreScrollPos])

  // Handle quick action trigger
  useEffect(() => {
    if (pendingQuickAction?.type === 'add-party') {
      setShowPartyForm(true)
      clearQuickAction()
    } else if (pendingQuickAction?.type === 'add-transaction') {
      // Transaction needs a party — prompt user to select one
      toast.info('Select a party to add a transaction')
      clearQuickAction()
    }
  }, [pendingQuickAction, setShowPartyForm, clearQuickAction])

  const currency = business?.currency || 'INR'

  const filtered = useMemo(() => {
    if (!parties) return []
    let list = parties
    if (khataFilter === 'receivable') list = list.filter((p) => p.balance > 0)
    if (khataFilter === 'payable') list = list.filter((p) => p.balance < 0)
    // PRD Part 38 §3.2: Grade filter bar
    if (gradeFilter !== 'all') list = list.filter((p) => p.qualityGrade === gradeFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((p) => p.name.toLowerCase().includes(q) || (p.phone || '').includes(search))
    }
    return list.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [parties, khataFilter, search, gradeFilter])

  const totals = useMemo(() => {
    if (!parties) return { receivable: 0, payable: 0 }
    return {
      receivable: parties.filter((p) => p.balance > 0).reduce((s, p) => s + p.balance, 0),
      payable: parties.filter((p) => p.balance < 0).reduce((s, p) => s + Math.abs(p.balance), 0),
    }
  }, [parties])

  if (selectedPartyId) {
    return <PartyDetail partyId={selectedPartyId} />
  }

  return (
    <div className="space-y-4">
      {/* Add Party button — at top (PRD Part 2 §3) */}
      <Button onClick={() => setShowPartyForm(true)} className="w-full h-11">
        <Plus className="w-4 h-4 mr-1.5" /> {t('khata.addParty')}
      </Button>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setKhataFilter(khataFilter === 'receivable' ? 'all' : 'receivable')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            khataFilter === 'receivable' ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-emerald-50 dark:bg-emerald-950/30 border-transparent'
          }`}
        >
          <p className="text-xs opacity-80 mb-1">{t('khata.receivables')}</p>
          <p className="text-lg font-bold tabular">{formatCurrency(totals.receivable, currency)}</p>
        </button>
        <button
          onClick={() => setKhataFilter(khataFilter === 'payable' ? 'all' : 'payable')}
          className={`text-left p-4 rounded-2xl border transition-all ${
            khataFilter === 'payable' ? 'bg-red-500 text-white border-red-500' : 'bg-red-50 dark:bg-red-950/30 border-transparent'
          }`}
        >
          <p className="text-xs opacity-80 mb-1">{t('khata.payables')}</p>
          <p className="text-lg font-bold tabular">{formatCurrency(totals.payable, currency)}</p>
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t('common.search') + ' parties…'}
          className="h-11 pl-4"
        />
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1">
        {(['all', 'receivable', 'payable'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setKhataFilter(f)}
            className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all min-h-[36px] ${
              khataFilter === f ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'
            }`}
          >
            {f === 'all' ? t('khata.all') : f === 'receivable' ? t('khata.receivables') : t('khata.payables')}
          </button>
        ))}
        <div className="ml-auto text-xs text-muted-foreground shrink-0 pr-1">
          {filtered.length} {filtered.length === 1 ? 'party' : 'parties'}
        </div>
      </div>

      {/* PRD Part 38 §3.2: Horizontal Grade Filter Bar */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {['all', 'A', 'B', 'C', 'D', 'E'].map((g) => (
          <button
            key={g}
            onClick={() => setGradeFilter(g)}
            className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all min-h-[30px] ${
              gradeFilter === g
                ? g === 'A' ? 'bg-emerald-500 text-white'
                  : g === 'B' ? 'bg-teal-500 text-white'
                  : g === 'C' ? 'bg-amber-500 text-white'
                  : g === 'D' ? 'bg-orange-500 text-white'
                  : g === 'E' ? 'bg-red-500 text-white'
                  : 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {g === 'all' ? 'All Grades' : `${g} Quality`}
          </button>
        ))}
      </div>

      {/* Party list */}
      {loading ? (
        <LoadingState />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Users}
          title={t('khata.empty')}
          action={
            <Button onClick={() => setShowPartyForm(true)} className="h-11">
              <Plus className="w-4 h-4 mr-1.5" /> {t('khata.addPartyShort')}
            </Button>
          }
        />
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((p, i) => {
              const meta = GRADE_META[p.qualityGrade]
              const isReceivable = p.balance > 0
              const isPayable = p.balance < 0
              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.02 }}
                  layout
                >
                  <Card className="p-3.5 hover:shadow-md transition-shadow">
                    <button
                      onClick={() => setSelectedPartyId(p.id)}
                      className="w-full flex items-center gap-3 text-left"
                    >
                      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white font-bold shrink-0">
                        {p.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-sm font-semibold truncate">{p.name}</p>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>
                            {p.qualityGrade}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate">
                          {p.phone || 'No phone'} · {t(`common.${p.type}`)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className={`text-sm font-bold tabular ${isReceivable ? 'text-emerald-600' : isPayable ? 'text-red-600' : 'text-muted-foreground'}`}>
                          {p.balance === 0 ? 'Settled' : formatCurrency(Math.abs(p.balance), currency)}
                        </p>
                        <p className="text-[10px] text-muted-foreground">
                          {isReceivable ? t('khata.outstanding') : isPayable ? 'দেবো' : ''}
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  </Card>
                </motion.div>
              )
            })}
          </AnimatePresence>
        </div>
      )}

      <PartyForm
        open={showPartyForm || !!editingPartyId}
        onOpenChange={(o) => { setShowPartyForm(o); if (!o) setEditingPartyId(null) }}
        partyId={editingPartyId}
      />
    </div>
  )
}
