'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost, apiPut } from '@/hooks/use-fetch'
import type { Party, PartyType, QualityGrade } from '@/lib/types'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { User, Phone, FileText, MapPin, CreditCard } from 'lucide-react'
import { useVoiceInput } from '@/hooks/use-voice-input'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  partyId?: string | null
  // §ON-SUCCESS: Called when a party is created or updated. Passes the full
  // party object so callers (e.g. SalePadView) can auto-select the customer.
  onSuccess?: (party: Party) => void
}

export function PartyForm({ open, onOpenChange, partyId, onSuccess }: Props) {
  const { triggerRefresh, setSelectedPartyId } = useAppStore()
  const { t } = useI18n()
  const { data: existing } = useFetch<Party>(partyId ? `/api/parties/${partyId}` : null, [partyId, open])

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [type, setType] = useState<PartyType>('customer')
  const [grade, setGrade] = useState<QualityGrade>('B')
  const [openingBalance, setOpeningBalance] = useState('0')
  const [balanceType, setBalanceType] = useState<'receivable' | 'payable'>('receivable')
  const [creditLimit, setCreditLimit] = useState('')
  const [address, setAddress] = useState('')
  const [gstin, setGstin] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  // §3: Voice input support — register ALL text inputs with global mic
  const nameVoice = useVoiceInput<HTMLInputElement>((text) => setName(text))
  const phoneVoice = useVoiceInput<HTMLInputElement>((text) => setPhone(text))
  const gstinVoice = useVoiceInput<HTMLInputElement>((text) => setGstin(text))
  const addressVoice = useVoiceInput<HTMLTextAreaElement>((text) => setAddress(text))
  const notesVoice = useVoiceInput<HTMLTextAreaElement>((text) => setNotes(text))

  useEffect(() => {
    if (existing) {
      setName(existing.name)
      setPhone(existing.phone || '')
      setType(existing.type as PartyType)
      setGrade(existing.qualityGrade as QualityGrade)
      setOpeningBalance(String(Math.abs(existing.openingBalance)))
      setBalanceType(existing.openingBalance >= 0 ? 'receivable' : 'payable')
      setCreditLimit(existing.creditLimit ? String(existing.creditLimit) : '')
      setAddress(existing.address || '')
      setGstin(existing.gstin || '')
      setNotes(existing.notes || '')
    } else if (!partyId) {
      setName(''); setPhone(''); setType('customer'); setGrade('B')
      setOpeningBalance('0'); setBalanceType('receivable')
      setCreditLimit(''); setAddress(''); setGstin(''); setNotes('')
    }
  }, [existing, partyId, open])

  const isCustomer = type === 'customer' || type === 'both'
  const isSupplier = type === 'supplier' || type === 'both'

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error('Please enter a name')
      return
    }
    setSaving(true)
    try {
      const balance = Number(openingBalance) || 0
      const signedBalance = balanceType === 'payable' ? -balance : balance
      const payload = {
        name: name.trim(),
        phone: phone.trim(),
        type,
        qualityGrade: grade,
        openingBalance: signedBalance,
        balance: signedBalance,
        creditLimit: creditLimit ? Number(creditLimit) : null,
        address: address.trim(),
        gstin: gstin.trim(),
        notes: notes.trim(),
      }
      if (partyId) {
        const updated = await apiPut(`/api/parties/${partyId}`, payload)
        toast.success('Party updated')
        setSelectedPartyId(updated.id)
        if (onSuccess) onSuccess(updated)
      } else {
        const created = await apiPost('/api/parties', payload)
        toast.success('Party added')
        setSelectedPartyId(created.id)
        if (onSuccess) onSuccess(created)
      }
      triggerRefresh()
      onOpenChange(false)
    } catch (e) {
      toast.error('Failed to save: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <FormDialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{partyId ? 'Edit Party' : t('khata.addParty')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            <Label className="text-xs mb-1.5 block">{t('common.type')}</Label>
            <div className="grid grid-cols-3 gap-2">
              {(['customer', 'supplier', 'both'] as PartyType[]).map((tp) => (
                <button
                  key={tp}
                  onClick={() => setType(tp)}
                  className={`px-3 py-2.5 rounded-xl text-xs font-medium transition-all min-h-[44px] ${
                    type === tp
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground hover:bg-accent'
                  }`}
                >
                  {t(`common.${tp}`)}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name" className="text-xs">{t('common.name')} *</Label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="name" {...nameVoice} value={name} onChange={(e) => setName(e.target.value)} className="pl-9 h-11" placeholder="Amit Trading" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone" className="text-xs">{t('set.phone')}</Label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input id="phone" {...phoneVoice} value={phone} onChange={(e) => setPhone(e.target.value)} className="pl-9 h-11" placeholder="+91 98300 12345" inputMode="tel" />
            </div>
          </div>

          <AnimatePresence mode="wait">
            {isCustomer && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-4 overflow-hidden"
              >
                <div className="space-y-1.5">
                  <Label className="text-xs">Quality Grade</Label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {(['A', 'B', 'C', 'D', 'E'] as QualityGrade[]).map((g) => (
                      <button
                        key={g}
                        onClick={() => setGrade(g)}
                        className={`py-2.5 rounded-lg text-sm font-bold transition-all min-h-[44px] ${
                          grade === g
                            ? 'bg-primary text-primary-foreground shadow-sm'
                            : 'bg-muted hover:bg-accent'
                        }`}
                      >
                        {g}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="credit" className="text-xs flex items-center gap-1">
                    <CreditCard className="w-3 h-3" /> Credit Limit (₹)
                  </Label>
                  <Input id="credit" value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)} className="h-11" placeholder="50000" inputMode="numeric" />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait">
            {isSupplier && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="space-y-1.5 overflow-hidden"
              >
                <Label htmlFor="gstin" className="text-xs">{t('set.gstin')}</Label>
                <Input id="gstin" {...gstinVoice} value={gstin} onChange={(e) => setGstin(e.target.value)} className="h-11" placeholder="19ABCDE1234F1Z5" />
              </motion.div>
            )}
          </AnimatePresence>

          {!partyId && (
            <div className="space-y-1.5">
              <Label className="text-xs">Opening Balance</Label>
              <div className="flex gap-2">
                <Input value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} className="h-11 flex-1" inputMode="numeric" />
                <div className="grid grid-cols-2 gap-1.5 w-40">
                  <button
                    onClick={() => setBalanceType('receivable')}
                    className={`px-2 py-2 rounded-xl text-xs font-medium min-h-[44px] ${
                      balanceType === 'receivable' ? 'bg-emerald-500 text-white' : 'bg-muted'
                    }`}
                  >
                    পাবো
                  </button>
                  <button
                    onClick={() => setBalanceType('payable')}
                    className={`px-2 py-2 rounded-xl text-xs font-medium min-h-[44px] ${
                      balanceType === 'payable' ? 'bg-red-500 text-white' : 'bg-muted'
                    }`}
                  >
                    দেবো
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="address" className="text-xs">{t('set.address')}</Label>
            <div className="relative">
              <MapPin className="absolute left-3 top-3 w-4 h-4 text-muted-foreground" />
              <Textarea id="address" {...addressVoice} value={address} onChange={(e) => setAddress(e.target.value)} className="pl-9 min-h-[60px]" placeholder="Address" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes" className="text-xs flex items-center gap-1">
              <FileText className="w-3 h-3" /> Internal Notes
            </Label>
            <Textarea id="notes" {...notesVoice} value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-[50px]" placeholder="Notes about this party…" />
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
      </FormDialogContent>
    </Dialog>
  )
}
