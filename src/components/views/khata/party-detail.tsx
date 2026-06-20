'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Party, Transaction, Invoice } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import {
  ArrowLeft, Phone, Plus, Receipt, FileEdit, ArrowDownLeft, ArrowUpRight,
  CheckCircle2, MessageSquare, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useState } from 'react'
import { TransactionForm } from './transaction-form'
import { PartyForm } from './party-form'
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
  const { setSelectedPartyId, setActiveView, setShowInvoiceForm, business, setSelectedInvoiceId, setEditingPartyId, editingPartyId } = useAppStore()
  const { t } = useI18n()
  const { data, refetch } = useFetch<PartyDetailData>(`/api/parties/${partyId}`, [partyId])
  const [showTxn, setShowTxn] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [showNote, setShowNote] = useState(false)

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
          onClick={() => setSelectedPartyId(null)}
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
            onClick={() => { setActiveView('billing'); setShowInvoiceForm(true) }}
          >
            <Receipt className="w-4 h-4" />
            <span className="text-[10px]">{t('bill.newInvoiceShort')}</span>
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

      {/* Transactions */}
      <div className="rounded-2xl bg-card border border-border p-4 shadow-sm">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t('khata.transactions')}</h3>
          <span className="text-xs text-muted-foreground">{data.transactions.length}</span>
        </div>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No transactions yet</p>
        ) : (
          <div className="space-y-1 max-h-96 overflow-y-auto scroll-area">
            {data.transactions.map((tx) => {
              const isCredit = tx.type === 'credit'
              return (
                <div key={tx.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted/50">
                  <span className={`w-8 h-8 rounded-full flex items-center justify-center ${isCredit ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'}`}>
                    {isCredit ? <ArrowDownLeft className="w-4 h-4 text-emerald-600" /> : <ArrowUpRight className="w-4 h-4 text-red-600" />}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tx.description || tx.type}</p>
                    <p className="text-[11px] text-muted-foreground">{formatDate(tx.createdAt)}</p>
                  </div>
                  <span className={`text-sm font-semibold tabular ${isCredit ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isCredit ? '+' : '-'}{formatCurrency(tx.amount, currency)}
                  </span>
                </div>
              )
            })}
          </div>
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
