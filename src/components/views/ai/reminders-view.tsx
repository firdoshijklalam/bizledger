'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Bell, MessageCircle, Phone, Clock, CheckCircle2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LoadingState, EmptyState } from '@/components/shared/states'
import { toast } from 'sonner'
import { useState } from 'react'

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

export function RemindersView() {
  const { business } = useAppStore()
  const { data, loading } = useFetch<Reminder[]>('/api/reminders', [])
  const [sentIds, setSentIds] = useState<Set<string>>(new Set())
  const currency = business?.currency || 'INR'

  if (loading) return <LoadingState />
  if (!data || data.length === 0) return <EmptyState icon={CheckCircle2} title="No overdue payments 🎉" description="All your customers are up to date!" />

  const sendWhatsApp = (r: Reminder) => {
    const phone = r.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(
      `প্রিয় ${r.name},\n\nআপনার ${business?.name || 'আমাদের দোকান'}-এ বকেয়া টাকা রয়েছে: ${formatCurrency(r.balance, currency)}\n${r.oldestInvoiceNumber ? `বিল: ${r.oldestInvoiceNumber}\n` : ''}অনুগ্রহ করে পেমেন্ট করুন। ধন্যবাদ 🙏`
    )
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
                <div className="grid grid-cols-2 gap-2">
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
                    size="sm"
                    onClick={() => sendWhatsApp(r)}
                    className={`h-9 ${sent ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                  >
                    {sent ? <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> : <MessageCircle className="w-3.5 h-3.5 mr-1" />}
                    {sent ? 'Sent' : 'WhatsApp'}
                  </Button>
                </div>
              </Card>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}
