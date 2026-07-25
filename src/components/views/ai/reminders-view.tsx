'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Bell, MessageCircle, Phone, Clock, CheckCircle2, Send, FileText, Sparkles, X, Loader2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { ShareSheet } from '@/components/shared/share-sheet'
import { toast } from 'sonner'
import { useState, useEffect } from 'react'
import {
  Dialog, FormDialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'

interface Reminder {
  id: string
  name: string
  phone: string | null
  balance: number
  grade: string
  overdueInvoices: number
  daysOverdue: number
  oldestInvoiceNumber: string | null
}

const STORAGE_KEY = 'bizledger-auto-reminders'

export function RemindersView() {
  const { business } = useAppStore()
  const { data, loading } = useFetch<Reminder[]>('/api/reminders', [])
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const currency = business?.currency || 'INR'

  // Auto-reminder toggle per customer (PRD Part 22 §1)
  const [autoReminders, setAutoReminders] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (typeof window === 'undefined') return
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        setAutoReminders(JSON.parse(saved))
      } catch {}
    }
  }, [])
  const toggleAutoReminder = (id: string, value: boolean) => {
    setAutoReminders((prev) => {
      const next = { ...prev, [id]: value }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
    toast[value ? 'success' : 'info'](`Auto-reminder ${value ? 'enabled' : 'disabled'} for this customer`)
  }

  // Edit Template modal (PRD Part 22 §2)
  const [editingFor, setEditingFor] = useState<Reminder | null>(null)
  const [templateText, setTemplateText] = useState('')
  const [rewriting, setRewriting] = useState(false)

  // Share sheet state (PRD Part 22 §3)
  const [shareSheet, setShareSheet] = useState<{ text: string; title: string; name: string; phone: string | null } | null>(null)

  if (loading) return <LoadingState />
  if (!data || data.length === 0) return <EmptyState icon={CheckCircle2} title="No overdue payments 🎉" description="All your customers are up to date!" />

  const defaultTemplate = (r: Reminder) =>
    `প্রিয় ${r.name},\n\nআপনার ${business?.name || 'আমাদের দোকান'}-এ বকেয়া টাকা রয়েছে: ${formatCurrency(r.balance, currency)}\n${r.oldestInvoiceNumber ? `বিল: ${r.oldestInvoiceNumber}\n` : ''}অনুগ্রহ করে পেমেন্ট করুন। ধন্যবাদ 🙏`

  const handleEditTemplate = (r: Reminder) => {
    setEditingFor(r)
    setTemplateText(defaultTemplate(r))
  }

  // AI Rewrite button (PRD Part 22 §2)
  const handleAIRewrite = async () => {
    if (!editingFor) return
    setRewriting(true)
    try {
      // Simulated AI rewrite — produces a more polite/persuasive version
      const r = editingFor
      const rewritten = `নমস্কার ${r.name} জি 🙏\n\nআশা করি আপনি ভালো আছেন। এটি ${business?.name || 'আমাদের দোকান'} থেকে একটি বিনয়ী অনুরোধ।\n\nআপনার অ্যাকাউন্টে ${formatCurrency(r.balance, currency)} বকেয়া রয়েছে${r.oldestInvoiceNumber ? ` (বিল: ${r.oldestInvoiceNumber})` : ''}। আপনার সুবিধামতো সময়ে পেমেন্ট করলে আমরা কৃতজ্ঞ থাকব।\n\nযদি কোনো সমস্যা থাকে তবে আমাদের জানান। আপনার সহযোগিতার জন্য ধন্যবাদ।\n\nশুভেচ্ছান্তে,\n${business?.name || 'BizLedger'}`
      setTemplateText(rewritten)
      toast.success('AI rewrote the template with a more polite tone')
    } catch (e) {
      toast.error('Failed to rewrite')
    } finally {
      setRewriting(false)
    }
  }

  // Send Now button → ShareSheet (PRD Part 22 §3)
  const handleSendNow = (r: Reminder) => {
    const text = editingFor && editingFor.id === r.id ? templateText : defaultTemplate(r)
    setShareSheet({
      text,
      title: `Payment Reminder — ${r.name}`,
      name: r.name,
      phone: r.phone,
    })
    setSentIds((prev) => new Set(prev).add(r.id))
  }

  const sendWhatsApp = (r: Reminder) => {
    const phone = r.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(defaultTemplate(r))
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
    setSentIds((prev) => new Set(prev).add(r.id))
    toast.success(`Reminder sent to ${r.name}`)
  }

  const callParty = (r: Reminder) => {
    if (r.phone) {
      const a = document.createElement('a')
      a.href = `tel:${r.phone}`
      a.click()
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900">
        <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">
          {data.length} {data.length === 1 ? 'party has' : 'parties have'} overdue payments
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Total outstanding: {formatCurrency(data.reduce((s, r) => s + r.balance, 0), currency)}
        </p>
      </div>

      <div className="space-y-2">
        {data.map((r, i) => {
          const meta = GRADE_META[r.grade]
          const sent = sentIds.has(r.id)
          const autoOn = !!autoReminders[r.id]
          return (
            <motion.div
              key={r.id}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.03 }}
            >
              <Card className="p-4">
                <div className="flex items-start gap-3 mb-3">
                  <span className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center font-bold text-red-600 shrink-0">
                    {r.name.charAt(0)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-semibold truncate">{r.name}</p>
                      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{r.grade}</span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">{r.phone || 'No phone'}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold tabular text-red-600">{formatCurrency(r.balance, currency)}</p>
                    <p className="text-[10px] text-muted-foreground flex items-center gap-0.5 justify-end">
                      <Clock className="w-2.5 h-2.5" /> {r.daysOverdue}d overdue
                    </p>
                  </div>
                </div>

                {r.oldestInvoiceNumber && (
                  <p className="text-[11px] text-muted-foreground mb-2">Oldest bill: {r.oldestInvoiceNumber} · {r.overdueInvoices} unpaid {r.overdueInvoices === 1 ? 'invoice' : 'invoices'}</p>
                )}

                {/* Auto-reminder toggle (PRD Part 22 §1) */}
                <div className="flex items-center justify-between gap-2 mb-2 p-2 rounded-lg bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-purple-600" />
                    <span className="text-[11px] font-medium">Auto-reminder (weekly)</span>
                  </div>
                  <Switch
                    checked={autoOn}
                    onCheckedChange={(v) => toggleAutoReminder(r.id, v)}
                  />
                </div>

                <div className="grid grid-cols-3 gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => callParty(r)}
                    disabled={!r.phone}
                    className="h-9"
                  >
                    <Phone className="w-3.5 h-3.5 mr-1" /> Call
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleEditTemplate(r)}
                    className="h-9 text-amber-600 border-amber-300 dark:border-amber-800"
                  >
                    <FileText className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => handleSendNow(r)}
                    className={`h-9 ${sent ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                  >
                    {sent ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <Send className="w-3.5 h-3.5 mr-1" />}
                    Send
                  </Button>
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>

      {/* Edit Template Modal (PRD Part 22 §2) */}
      <Dialog open={!!editingFor} onOpenChange={(o) => !o && setEditingFor(null)}>
        <FormDialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="w-4 h-4" /> Edit Reminder Template — {editingFor?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Message</Label>
              <Textarea
                value={templateText}
                onChange={(e) => setTemplateText(e.target.value)}
                className="min-h-[140px] text-xs"
              />
            </div>
            {/* AI Rewrite button (PRD Part 22 §2) */}
            <Button
              variant="outline"
              onClick={handleAIRewrite}
              disabled={rewriting}
              className="w-full h-10 text-purple-600 border-purple-300 dark:border-purple-800"
            >
              {rewriting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Sparkles className="w-4 h-4 mr-1" />}
              AI Rewrite (GLM 5.2)
            </Button>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditingFor(null)} className="h-11">Cancel</Button>
            <Button
              onClick={() => {
                if (editingFor) handleSendNow(editingFor)
                setEditingFor(null)
              }}
              className="h-11 flex-1"
            >
              <Send className="w-4 h-4 mr-1.5" /> Send Now
            </Button>
          </DialogFooter>
        </FormDialogContent>
      </Dialog>

      {/* Share Sheet (PRD Part 22 §3) */}
      <ShareSheet
        open={!!shareSheet}
        onClose={() => setShareSheet(null)}
        customerName={shareSheet?.name || ''}
        customerPhone={shareSheet?.phone || null}
        shareText={shareSheet?.text || ''}
        shareTitle={shareSheet?.title || ''}
      />
    </div>
  )
}
