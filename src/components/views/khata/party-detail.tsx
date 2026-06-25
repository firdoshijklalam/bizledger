'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Party, Transaction, Invoice } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Phone, Plus, Receipt, FileEdit, ArrowDownLeft, ArrowUpRight,
  CheckCircle2, MessageSquare, X, Zap, Share2, FileText,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useState, useCallback, useRef } from 'react'
import { TransactionForm } from './transaction-form'
import { PartyForm } from './party-form'
import { ShareSheet } from '@/components/shared/share-sheet'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

interface PartyDetailData extends Party {
  transactions: Transaction[]
  invoices: Invoice[]
  partyNotes: any[]
}

export function PartyDetail({ partyId }: { partyId: string }) {
  const { setSelectedPartyId, setActiveView, setShowInvoiceForm, business, setSelectedInvoiceId, setEditingPartyId, editingPartyId, returnToView, setReturnToView } = useAppStore()
  const { t } = useI18n()
  const { data, refetch } = useFetch<PartyDetailData>(`/api/parties/${partyId}`, [partyId])
  const [showTxn, setShowTxn] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [showNote, setShowNote] = useState(false)
  // Multi-select state (PRD Part 7 §4)
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set())
  // Share sheet state (PRD Part 10 §2)
  const [showShareSheet, setShowShareSheet] = useState(false)
  const [shareSheetText, setShareSheetText] = useState('')
  const [shareSheetTitle, setShareSheetTitle] = useState('')

  // Multi-select handlers (PRD Part 7 §4) — must be before early return
  const toggleTxSelection = useCallback((txId: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev)
      if (next.has(txId)) next.delete(txId)
      else next.add(txId)
      return next
    })
  }, [])

  const selectAllTx = () => {
    setSelectedTxIds(new Set(data.transactions.map((t) => t.id)))
  }

  const deselectAllTx = () => {
    setSelectedTxIds(new Set())
    setMultiSelectMode(false)
  }

  const handleShareSelected = () => {
    const selected = data.transactions.filter((t) => selectedTxIds.has(t.id))
    if (selected.length === 0) return
    // PRD Part 10: Open dynamic share sheet instead of direct WhatsApp
    const lines = [
      `${business?.name || 'BizLedger'} — Selected Transactions`,
      `Customer: ${data.name}`,
      ``,
    ]
    selected.forEach((tx) => {
      const isCredit = tx.type === 'credit'
      lines.push(`${formatDate(tx.createdAt)} | ${isCredit ? 'পেলাম' : 'দিলাম'} | ${formatCurrency(tx.amount, currency)} | ${tx.description || ''}`)
    })
    lines.push(``, `Total: ${selected.length} transactions`)
    setShareSheetText(lines.join('\n'))
    setShareSheetTitle(`${selected.length} Transactions Statement`)
    setShowShareSheet(true)
  }

  const handleShareStatement = () => {
    // PRD Part 10: Share full statement via dynamic share sheet
    const lines = [
      `${business?.name || 'BizLedger'} — Ledger Statement`,
      `Customer: ${data.name}`,
      ``,
      `Date | Type | Amount | Description`,
    ]
    data.transactions.forEach((tx) => {
      const isCredit = tx.type === 'credit'
      lines.push(`${formatDate(tx.createdAt)} | ${isCredit ? 'পেলাম' : 'দিলাম'} | ${formatCurrency(tx.amount, currency)} | ${tx.description || ''}`)
    })
    lines.push(``, `Current Balance: ${formatCurrency(data.balance, currency)}`)
    setShareSheetText(lines.join('\n'))
    setShareSheetTitle('Full Ledger Statement')
    setShowShareSheet(true)
  }

  if (!data) return null
  const currency = business?.currency || 'INR'
  const meta = GRADE_META[data.qualityGrade]
  const isReceivable = data.balance > 0
  const isPayable = data.balance < 0

  const handleSettle = async (amount: number) => {
    await apiPost('/api/transactions', {
      partyId: data.id,
      type: isReceivable ? 'credit' : 'debit',
      amount,
      description: 'Settlement (বুঝিয়ে নেওয়া)',
      category: 'Settlement',
    })
    toast.success('Settled successfully')
    setShowSettle(false)
    refetch()
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            if (returnToView) {
              setActiveView(returnToView)
              setReturnToView(null)
            }
            setSelectedPartyId(null)
          }}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1 truncate">{data.name}</h2>
        <button
          onClick={() => setEditingPartyId(partyId)}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Edit"
        >
          <FileEdit className="w-4 h-4" />
        </button>
      </div>

      {/* Profile card */}
      <div className="rounded-2xl bg-card border border-border p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center text-white text-xl font-bold shrink-0">
            {data.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold truncate">{data.name}</h3>
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                {data.qualityGrade} · {meta.desc}
              </span>
            </div>
            <p className="text-xs text-muted-foreground capitalize">{t(`common.${data.type}`)}</p>
            {data.phone && (
              <a href={`tel:${data.phone}`} className="text-xs text-primary flex items-center gap-1 mt-1">
                <Phone className="w-3 h-3" /> {data.phone}
              </a>
            )}
          </div>
        </div>

        {/* Balance */}
        <div className="mt-4 p-4 rounded-xl bg-muted/50">
          <p className="text-xs text-muted-foreground mb-0.5">
            {isReceivable ? t('khata.outstanding') : isPayable ? 'আপনি দেবেন' : 'ব্যালেন্স'}
          </p>
          <p className={`text-2xl font-bold tabular ${isReceivable ? 'text-emerald-600' : isPayable ? 'text-red-600' : 'text-foreground'}`}>
            {formatCurrency(Math.abs(data.balance), currency)}
          </p>
          {data.creditLimit && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Credit Limit: {formatCurrency(data.creditLimit, currency)}
            </p>
          )}
        </div>

        {/* Action buttons */}
        <div className="grid grid-cols-4 gap-2 mt-4">
          {data.phone && (
            <Button
              variant="outline"
              className="flex flex-col items-center gap-1 h-auto py-2.5"
              onClick={() => window.location.href = `tel:${data.phone}`}
            >
              <Phone className="w-4 h-4" />
              <span className="text-[10px]">{t('khata.call')}</span>
            </Button>
          )}
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-2.5"
            onClick={() => setShowTxn(true)}
          >
            <Plus className="w-4 h-4" />
            <span className="text-[10px]">Entry</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-2.5"
            onClick={() => {
              useAppStore.getState().setPendingNewCustomer(data.id, data.name)
              setReturnToView('khata')
              setActiveView('sale-pad')
            }}
          >
            <Zap className="w-4 h-4" />
            <span className="text-[10px]">Quick Sale</span>
          </Button>
          <Button
            variant="outline"
            className="flex flex-col items-center gap-1 h-auto py-2.5"
            onClick={() => setShowSettle(true)}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span className="text-[10px]">{t('khata.settleUp')}</span>
          </Button>
        </div>
      </div>

      {/* Transactions — multi-select + share (PRD Part 6 §2 + Part 7 §4) */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('khata.transactions')}</h3>
          <div className="flex items-center gap-2">
            {data.transactions.length > 0 && !multiSelectMode && (
              <button
                onClick={handleShareStatement}
                className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg flex items-center gap-1"
              >
                <FileText className="w-3 h-3" /> Share Statement
              </button>
            )}
            <span className="text-xs text-muted-foreground">{data.transactions.length}</span>
          </div>
        </div>

        {/* Multi-select control bar (PRD Part 7 §4.3) */}
        {multiSelectMode && (
          <div className="flex items-center justify-between gap-2 mb-3 p-2 rounded-xl bg-primary/5 border border-primary/20">
            <div className="flex items-center gap-2">
              <button onClick={selectAllTx} className="text-[10px] font-medium text-primary px-2 py-1 rounded-lg bg-primary/10">Select All</button>
              <button onClick={deselectAllTx} className="text-[10px] font-medium text-muted-foreground px-2 py-1 rounded-lg bg-muted">Deselect All</button>
            </div>
            <span className="text-[10px] text-muted-foreground">{selectedTxIds.size} selected</span>
          </div>
        )}

        {data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No transactions yet</p>
        ) : (
          <>
            <div className="space-y-1 max-h-96 overflow-y-auto scroll-area">
              {data.transactions.map((tx) => {
                const isCredit = tx.type === 'credit'
                const isSelected = selectedTxIds.has(tx.id)
                return (
                  <TxRow
                    key={tx.id}
                    tx={tx}
                    isCredit={isCredit}
                    isSelected={isSelected}
                    multiSelectMode={multiSelectMode}
                    currency={currency}
                    onLongPress={() => { setMultiSelectMode(true); setSelectedTxIds(new Set([tx.id])) }}
                    onToggle={() => toggleTxSelection(tx.id)}
                  />
                )
              })}
            </div>
            {/* Share Selected button (PRD Part 7 §4.4) */}
            {multiSelectMode && selectedTxIds.size > 0 && (
              <button
                onClick={handleShareSelected}
                className="w-full mt-3 h-11 rounded-xl bg-primary text-primary-foreground font-medium text-sm flex items-center justify-center gap-2"
              >
                <Share2 className="w-4 h-4" /> Share Selected ({selectedTxIds.size})
              </button>
            )}
          </>
        )}
      </div>

      {/* Invoices */}
      {data.invoices.length > 0 && (
        <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
          <h3 className="text-sm font-semibold mb-3">Invoices ({data.invoices.length})</h3>
          <div className="space-y-1 max-h-64 overflow-y-auto scroll-area">
            {data.invoices.map((inv) => (
              <button
                key={inv.id}
                onClick={() => { setSelectedInvoiceId(inv.id); setActiveView('billing') }}
                className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50 text-left"
              >
                <Receipt className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{inv.invoiceNumber}</p>
                  <p className="text-[11px] text-muted-foreground">{formatDate(inv.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold tabular">{formatCurrency(inv.grandTotal, currency)}</p>
                  <span className={`text-[10px] ${inv.status === 'paid' ? 'text-emerald-600' : inv.status === 'partial' ? 'text-amber-600' : 'text-red-600'}`}>
                    {inv.status}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <TransactionForm open={showTxn} onOpenChange={setShowTxn} party={data} />
      <SettleUpDialog open={showSettle} onOpenChange={setShowSettle} party={data} onConfirm={handleSettle} />
      <PartyForm
        open={!!editingPartyId}
        onOpenChange={(o) => { if (!o) setEditingPartyId(null) }}
        partyId={editingPartyId}
      />
      <ShareSheet
        open={showShareSheet}
        onClose={() => setShowShareSheet(false)}
        customerName={data.name}
        customerPhone={data.phone}
        shareText={shareSheetText}
        shareTitle={shareSheetTitle}
      />
    </motion.div>
  )
}

function SettleUpDialog({
  open, onOpenChange, party, onConfirm,
}: { open: boolean; onOpenChange: (o: boolean) => void; party: Party; onConfirm: (amt: number) => void }) {
  const { business } = useAppStore()
  const currency = business?.currency || 'INR'
  const [amount, setAmount] = useState(String(Math.abs(party.balance)))
  const isReceivable = party.balance > 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Settle Up</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="p-3 rounded-xl bg-muted/50 text-sm">
            <p className="text-muted-foreground text-xs">
              {isReceivable ? 'Customer will pay you' : 'You will pay supplier'}
            </p>
            <p className={`text-lg font-bold tabular ${isReceivable ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatCurrency(Math.abs(party.balance), currency)}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Settlement Amount</Label>
            <Input value={amount} onChange={(e) => setAmount(e.target.value)} className="h-11" inputMode="numeric" />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">Cancel</Button>
          <Button className="h-11 flex-1" onClick={() => onConfirm(Number(amount) || 0)}>
            Confirm Settlement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Transaction row with long-press multi-select (PRD Part 7 §4)
function TxRow({ tx, isCredit, isSelected, multiSelectMode, currency, onLongPress, onToggle }: {
  tx: any
  isCredit: boolean
  isSelected: boolean
  multiSelectMode: boolean
  currency: string
  onLongPress: () => void
  onToggle: () => void
}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressedRef = useRef(false)

  const handleStart = () => {
    longPressedRef.current = false
    timerRef.current = setTimeout(() => {
      longPressedRef.current = true
      onLongPress()
    }, 500)
  }
  const handleEnd = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    if (!longPressedRef.current && multiSelectMode) {
      onToggle()
    }
  }

  return (
    <div
      onTouchStart={handleStart}
      onTouchEnd={handleEnd}
      onMouseDown={handleStart}
      onMouseUp={handleEnd}
      onMouseLeave={() => { if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null } }}
      className={`flex items-center gap-3 p-2 rounded-lg transition-colors cursor-pointer select-none ${
        isSelected ? 'bg-primary/10 border border-primary/30' : 'hover:bg-muted/50'
      }`}
    >
      {multiSelectMode && (
        <span className={`w-5 h-5 rounded-md border-2 shrink-0 flex items-center justify-center ${
          isSelected ? 'bg-primary border-primary text-primary-foreground' : 'border-muted-foreground'
        }`}>
          {isSelected && <CheckCircle2 className="w-3 h-3" />}
        </span>
      )}
      <span className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isCredit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
        {isCredit ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-600" />}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{tx.description || tx.type}</p>
        <p className="text-[11px] text-muted-foreground">{formatDate(tx.createdAt)}</p>
      </div>
      <span className={`text-sm font-semibold tabular shrink-0 ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
        {isCredit ? '+' : '-'}{formatCurrency(tx.amount, currency)}
      </span>
    </div>
  )
}
