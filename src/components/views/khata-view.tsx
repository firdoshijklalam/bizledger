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
import { highlightWeighted } from '@/lib/highlight'
import { toast } from 'sonner'
import { useEffect, useMemo, useState } from 'react'
import { PartyForm } from './khata/party-form'
import { PartyDetail } from './khata/party-detail'
import { Input } from '@/components/ui/input'
import { useScrollStore } from '@/store/scroll-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { usePhoneticSearch } from '@/hooks/use-phonetic-search'

export function KhataView() {
  const {
    selectedPartyId, setSelectedPartyId,
    khataFilter, setKhataFilter,
    khataGradeFilter, setKhataGradeFilter,
    showPartyForm, setShowPartyForm,
    editingPartyId, setEditingPartyId,
    pendingQuickAction, clearQuickAction,
    business,
  } = useAppStore()
  const { t } = useI18n()
  const [search, setSearch] = useState('')
  const voiceProps = useVoiceInput<HTMLInputElement>((text) => setSearch(text))
  const [gradeFilter, setGradeFilter] = useState<string>('all')

  // §GRADE-ROUTING: Auto-apply grade filter passed from dashboard's grade
  // distribution bottom sheet ("Go to Khata →" button). Applies on mount,
  // then clears the param so it doesn't re-apply on later visits.
  useEffect(() => {
    if (!khataGradeFilter) return
    const t = setTimeout(() => {
      setGradeFilter(khataGradeFilter)
      setKhataGradeFilter(null)
    }, 0)
    return () => clearTimeout(t)
  }, [khataGradeFilter, setKhataGradeFilter])

  const { data: parties, loading } = useFetch<Party[]>('/api/parties?limit=200', [])

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

  // §1: Use SHARED usePhoneticSearch hook — same logic as Global Search
  // Checks: name + searchTags (aliases) + phone + phoneticMatch (cross-lingual)
  const phoneticFiltered = usePhoneticSearch(parties, search, {
    searchFields: ['phone'],
  })

  // §DYNAMIC-GRADES: Extract unique grades from CUSTOMERS only (not suppliers).
  // Suppliers don't have quality grades, so they're excluded from grade
  // generation AND from the grade filter. Only grades that actually exist
  // in the customer list are shown as filter chips.
  const availableGrades = useMemo(() => {
    if (!parties) return []
    const grades = new Set<string>()
    for (const p of parties) {
      // §SUPPLIER-EXCLUSION: Only customers (and 'both') have quality grades
      if ((p.type === 'customer' || p.type === 'both') && p.qualityGrade) {
        grades.add(p.qualityGrade)
      }
    }
    // Sort grades in natural order: A, B, C, D, E
    return Array.from(grades).sort()
  }, [parties])

  // §DYNAMIC-GRADES: Effective grade filter — if the selected grade no longer
  // exists in the customer list, fall back to 'all'. This avoids an empty
  // filtered list without calling setState in an effect (which lint disallows).
  const effectiveGradeFilter = (gradeFilter !== 'all' && availableGrades.includes(gradeFilter))
    ? gradeFilter
    : 'all'

  const filtered = useMemo(() => {
    let list = phoneticFiltered
    if (khataFilter === 'receivable') list = list.filter((p) => p.balance > 0)
    if (khataFilter === 'payable') list = list.filter((p) => p.balance < 0)
    // PRD Part 38 §3.2: Grade filter bar — §SUPPLIER-EXCLUSION:
    // Grade filter applies ONLY to customers. When a grade filter is active:
    //   - Customers are filtered to that grade.
    //   - Suppliers are ALWAYS shown (they don't have grades, so the filter
    //     is irrelevant for them).
    // §DYNAMIC-GRADES: Uses effectiveGradeFilter which falls back to 'all'
    // if the selected grade no longer exists in the customer list.
    if (effectiveGradeFilter !== 'all') list = list.filter((p) => {
      // Suppliers are grade-agnostic — always show them
      if (p.type === 'supplier') return true
      // Customers must match the selected grade
      return p.qualityGrade === effectiveGradeFilter
    })
    return list.sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance))
  }, [phoneticFiltered, khataFilter, effectiveGradeFilter])

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
          {...voiceProps}
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

      {/* PRD Part 38 §3.2: Horizontal Grade Filter Bar
          §DYNAMIC-GRADES: Only render chips for grades that ACTUALLY EXIST
          in the current customer list. Hides empty grades to save UI space.
          §SUPPLIER-EXCLUSION: Grades are extracted from customers only. */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
        {['all', ...availableGrades].map((g) => (
          <button
            key={g}
            onClick={() => setGradeFilter(g)}
            className={`shrink-0 px-2.5 py-1 rounded-lg text-[10px] font-bold transition-all min-h-[30px] ${
              effectiveGradeFilter === g
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
      ) : (!parties || parties.length === 0) ? (
        // §2 Condition A: Database is completely empty → "No parties yet"
        <EmptyState
          icon={Users}
          title={t('khata.empty')}
          action={
            <Button onClick={() => setShowPartyForm(true)} className="h-11">
              <Plus className="w-4 h-4 mr-1.5" /> {t('khata.addPartyShort')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        // §2 Condition B: Parties exist but search returned nothing → "No results found"
        <div className="text-center py-12">
          <Users className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">No parties found for &ldquo;{search}&rdquo;</p>
          <button onClick={() => setSearch('')} className="text-xs text-primary mt-2 hover:underline">
            Clear search
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <AnimatePresence>
            {filtered.map((p, i) => {
              const meta = GRADE_META[p.qualityGrade] ?? GRADE_META['B']
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
                          <p className="text-sm font-semibold truncate">{highlightWeighted(p.name, search)}</p>
                          {/* §SUPPLIER-EXCLUSION: Grade badges are ONLY for customers
                              (and 'both'). Suppliers never show a grade badge. */}
                          {(p.type === 'customer' || p.type === 'both') && (
                            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>
                              {p.qualityGrade}
                            </span>
                          )}
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
