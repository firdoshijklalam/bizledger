'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { apiPost } from '@/hooks/use-fetch'
import type { Party, TransactionType } from '@/lib/types'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  party: Party | null
}

export function TransactionForm({ open, onOpenChange, party }: Props) {
  const { triggerRefresh } = useAppStore()
  const { t } = useI18n()
  const [type, setType] = useState<TransactionType>('credit')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [isOperatingExpense, setIsOperatingExpense] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    const amt = Number(amount)
    if (!amt || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (!party) return
    setSaving(true)
    try {
      await apiPost('/api/transactions', {
        partyId: party.id,
        type,
        amount: amt,
        description: description.trim() || (type === 'credit' ? 'Payment received' : 'Payment given'),
        category: type === 'credit' ? 'Payment In' : 'Payment Out',
        // §P16-STEP3.1-FIX-A: Only send isOperatingExpense for debit transactions.
        // Credits/sales can never be operating expenses.
        ...(type === 'debit' ? { isOperatingExpense } : {}),
      })
      toast.success(type === 'credit' ? 'Payment recorded' : 'Payment recorded')
      setAmount(''); setDescription(''); setIsOperatingExpense(false)
      triggerRefresh()
      onOpenChange(false)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent aria-describedby={undefined} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('khata.addTransaction')}</DialogTitle>
          {party && <p className="text-xs text-muted-foreground">{party.name}</p>}
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1.5 block">{t('txn.type')}</Label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setType('credit')}
                aria-pressed={type === 'credit'}
                className={`group relative flex flex-col items-center gap-1 py-3.5 px-2 rounded-2xl border-2 transition-all min-h-[72px] overflow-hidden active:scale-[0.97] ${
                  type === 'credit'
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 shadow-md shadow-emerald-500/10'
                    : 'border-border bg-muted hover:border-emerald-300 dark:hover:border-emerald-800'
                }`}
              >
                <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full transition-opacity ${type === 'credit' ? 'bg-emerald-500 opacity-100' : 'opacity-0'}`} />
                <span className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  type === 'credit' ? 'bg-emerald-500/15' : 'bg-muted-foreground/10'
                }`}>
                  <ArrowDownLeft className={`w-5 h-5 ${type === 'credit' ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                </span>
                <span className={`text-xs font-semibold ${type === 'credit' ? 'text-emerald-700 dark:text-emerald-300' : 'text-muted-foreground'}`}>{t('txn.got')}</span>
              </button>
              <button
                onClick={() => setType('debit')}
                aria-pressed={type === 'debit'}
                className={`group relative flex flex-col items-center gap-1 py-3.5 px-2 rounded-2xl border-2 transition-all min-h-[72px] overflow-hidden active:scale-[0.97] ${
                  type === 'debit'
                    ? 'border-red-500 bg-red-50 dark:bg-red-950/40 shadow-md shadow-red-500/10'
                    : 'border-border bg-muted hover:border-red-300 dark:hover:border-red-800'
                }`}
              >
                <span className={`absolute top-2 right-2 w-1.5 h-1.5 rounded-full transition-opacity ${type === 'debit' ? 'bg-red-500 opacity-100' : 'opacity-0'}`} />
                <span className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  type === 'debit' ? 'bg-red-500/15' : 'bg-muted-foreground/10'
                }`}>
                  <ArrowUpRight className={`w-5 h-5 ${type === 'debit' ? 'text-red-600' : 'text-muted-foreground'}`} />
                </span>
                <span className={`text-xs font-semibold ${type === 'debit' ? 'text-red-700 dark:text-red-300' : 'text-muted-foreground'}`}>{t('txn.gave')}</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount" className="text-xs">{t('common.amount')} (₹) *</Label>
            <Input
              id="amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="h-12 text-lg font-semibold tabular"
              placeholder="0"
              inputMode="numeric"
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="desc" className="text-xs">{t('txn.desc')}</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px]"
              placeholder={type === 'credit' ? t('txn.receivedFor') : t('txn.paidFor')}
            />
          </div>

          {/* §P16-STEP3.1-FIX-A: Operating expense checkbox — only visible for debit.
              When checked, the server classifies this as transactionSubtype='operating_expense'
              (rent, salary, electricity, marketing, etc.) — NOT as supplier payment or owner drawing.
              This is an explicit user intent, NOT free-text category inference. */}
          {type === 'debit' && (
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isOperatingExpense}
                onChange={(e) => setIsOperatingExpense(e.target.checked)}
                className="w-4 h-4 rounded border-border"
              />
              <span className="text-xs text-muted-foreground">
                Operating expense (rent, salary, utilities)
              </span>
            </label>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('common.save')}
          </Button>
        </DialogFooter>
      </FormDialogContent>
    </Dialog>
  )
}
