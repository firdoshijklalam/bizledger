'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { apiPost } from '@/hooks/use-fetch'
import type { Party, TransactionType } from '@/lib/types'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
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
      })
      toast.success(type === 'credit' ? 'Payment recorded' : 'Payment recorded')
      setAmount(''); setDescription('')
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
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('khata.addTransaction')}</DialogTitle>
          {party && <p className="text-xs text-muted-foreground">{party.name}</p>}
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1.5 block">Transaction Type</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setType('credit')}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all min-h-[64px] ${
                  type === 'credit' ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/30' : 'border-border bg-muted'
                }`}
              >
                <ArrowDownLeft className={`w-5 h-5 ${type === 'credit' ? 'text-emerald-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium">টাকা পেলাম</span>
              </button>
              <button
                onClick={() => setType('debit')}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all min-h-[64px] ${
                  type === 'debit' ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-border bg-muted'
                }`}
              >
                <ArrowUpRight className={`w-5 h-5 ${type === 'debit' ? 'text-red-600' : 'text-muted-foreground'}`} />
                <span className="text-xs font-medium">টাকা দিলাম</span>
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
            <Label htmlFor="desc" className="text-xs">Description</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[60px]"
              placeholder={type === 'credit' ? 'Payment received for…' : 'Paid for…'}
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('common.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
