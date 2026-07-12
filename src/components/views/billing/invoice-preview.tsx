'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Invoice } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Share2, Printer, X, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useEffect, useRef } from 'react'

export function InvoicePreview({ invoiceId }: { invoiceId: string }) {
  const { setSelectedInvoiceId, business } = useAppStore()
  const { t } = useI18n()
  const { data: invoice } = useFetch<Invoice>(`/api/invoices/${invoiceId}`, [invoiceId])
  const printRef = useRef<HTMLDivElement>(null)

  if (!invoice) return null
  const currency = business?.currency || 'INR'
  const meta = invoice.party ? GRADE_META[invoice.party.qualityGrade] : null

  const handlePrint = () => {
    window.print()
  }

  const handleShare = async () => {
    const text = `Bill from ${business?.name}\nInvoice: ${invoice.invoiceNumber}\nTotal: ${formatCurrency(invoice.grandTotal, currency)}\nDue: ${formatCurrency(invoice.amountDue, currency)}`
    if (navigator.share) {
      try {
        await navigator.share({ title: `Invoice ${invoice.invoiceNumber}`, text })
      } catch {}
    } else {
      await navigator.clipboard.writeText(text)
      toast.success('Invoice details copied')
    }
  }

  const handleWhatsAppShare = () => {
    // PRD v2 §10.4 — clean text format with Pay Now link (no QR in share)
    const payUrl = `${window.location.origin}/payment/${invoice.paymentLandingToken || invoice.id}`
    const phone = invoice.party?.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const lines = [
      `প্রিয় কাস্টমার,`,
      ``,
      `${business?.name}-এর বিল জেনারেট হয়েছে।`,
      ``,
      `🧾 Invoice: ${invoice.invoiceNumber}`,
      `📅 Date: ${formatDate(invoice.createdAt)}`,
      `💰 Total: ${formatCurrency(invoice.grandTotal, currency)}`,
    ]
    if (invoice.amountDue > 0) {
      lines.push(`⚠️ Due: ${formatCurrency(invoice.amountDue, currency)}`)
    }
    lines.push(``, `💳 Pay Now: ${payUrl}`, ``, `Thank you! 🙏`)
    const text = encodeURIComponent(lines.join('\n'))
    const waUrl = phone
      ? `https://wa.me/${phone}?text=${text}`
      : `https://wa.me/?text=${text}`
    window.open(waUrl, '_blank')
    toast.success('Opening WhatsApp…')
  }

  const handleSMSShare = () => {
    const payUrl = `${window.location.origin}/payment/${invoice.paymentLandingToken || invoice.id}`
    const phone = invoice.party?.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(
      `${business?.name} বিল: #${invoice.invoiceNumber}, মোট: ${formatCurrency(invoice.grandTotal, currency)}। পেমেন্ট করতে ক্লিক করুন: ${payUrl}`
    )
    window.location.href = phone ? `sms:${phone}?body=${text}` : `sms:?body=${text}`
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      {/* Action bar (no-print) */}
      <div className="flex items-center gap-2 action-buttons">
        <button
          onClick={() => setSelectedInvoiceId(null)}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">{invoice.invoiceNumber}</h2>
        <button onClick={handleWhatsAppShare} className="w-10 h-10 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center justify-center text-emerald-600" aria-label="Share on WhatsApp">
          <MessageCircle className="w-4 h-4" />
        </button>
        <button onClick={handleShare} className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Share">
          <Share2 className="w-4 h-4" />
        </button>
        <button onClick={handlePrint} className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center" aria-label="Print">
          <Printer className="w-4 h-4" />
        </button>
      </div>

      {/* Premium Invoice — print area */}
      <div ref={printRef} className="invoice-content bg-card rounded-2xl overflow-hidden border border-border shadow-sm">
        {/* Brand color header band */}
        <div className="bg-gradient-to-r from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 p-5 text-primary-foreground">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold leading-tight">{business?.name}</h1>
              <p className="text-xs opacity-90 mt-1">{business?.address}</p>
              <p className="text-xs opacity-90">
                {business?.phone}{business?.gstin ? ` · GSTIN: ${business.gstin}` : ''}
              </p>
              {/* §1: CIN No + Terminal/Counter ID */}
              <p className="text-[10px] opacity-75 mt-1">
                {business?.pan ? `CIN: U74110WB2018PTC${business.pan}` : ''}{invoice.collectedByRole ? ` · Terminal: ${invoice.collectedByRole.toUpperCase()}` : ' · Terminal: T01'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase opacity-75 tracking-wider">Tax Invoice</p>
              <p className="text-sm font-bold">{invoice.invoiceNumber}</p>
              <p className="text-[11px] opacity-90 mt-1">{formatDate(invoice.createdAt)}</p>
              <p className="text-[10px] opacity-75 mt-0.5">Counter: {(invoice as any).counterId || 'T01'}</p>
            </div>
          </div>
        </div>

        {/* Bill To */}
        <div className="p-5 border-b border-border">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Billed To</p>
          {invoice.party ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700 dark:text-emerald-300">
                {invoice.party.name.charAt(0)}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-semibold">{invoice.party.name}</p>
                  {meta && (
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>
                      Grade {invoice.party.qualityGrade}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-muted-foreground">{invoice.party.phone || ''}</p>
                {invoice.party.address && <p className="text-[11px] text-muted-foreground">{invoice.party.address}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Walk-in customer</p>
          )}
        </div>

        {/* Items table */}
        <div className="px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <th className="text-left py-2 font-medium">Item</th>
                <th className="text-center py-2 font-medium">HSN</th>
                <th className="text-right py-2 font-medium">Qty</th>
                <th className="text-right py-2 font-medium">Price</th>
                <th className="text-right py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items?.map((it, i) => (
                <tr key={it.id} className={i % 2 === 1 ? 'bg-muted/40' : ''}>
                  <td className="py-2.5 text-left">{it.name}</td>
                  <td className="py-2.5 text-center text-[11px] text-muted-foreground tabular">{(it as any).hsnCode || (it as any).hsn || '—'}</td>
                  <td className="py-2.5 text-right tabular">{it.quantity}</td>
                  <td className="py-2.5 text-right tabular">{formatCurrency(it.unitPrice, currency)}</td>
                  <td className="py-2.5 text-right tabular font-medium">{formatCurrency(it.total, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="px-5 py-4 border-t border-border bg-muted/30 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bill.subtotal')}</span>
            <span className="tabular">{formatCurrency(invoice.subtotal, currency)}</span>
          </div>
          {invoice.discountAmount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>{t('bill.discount')} {invoice.discountMode === 'percent' ? `(${invoice.discountValue}%)` : ''}</span>
              <span className="tabular">-{formatCurrency(invoice.discountAmount, currency)}</span>
            </div>
          )}
          {invoice.gstAmount > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('bill.gst')}</span>
              <span className="tabular">{formatCurrency(invoice.gstAmount, currency)}</span>
            </div>
          )}
          <div className="flex justify-between pt-2 border-t border-border">
            <span className="font-bold">{t('bill.grandTotal')}</span>
            <span className="font-bold tabular text-primary text-lg">{formatCurrency(invoice.grandTotal, currency)}</span>
          </div>
          <div className="flex justify-between pt-1">
            <span className="text-muted-foreground">Paid</span>
            <span className="tabular text-emerald-600">{formatCurrency(invoice.amountPaid, currency)}</span>
          </div>
          {invoice.amountDue > 0 && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Balance Due</span>
              <span className="tabular font-bold text-red-600">{formatCurrency(invoice.amountDue, currency)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 text-center border-t border-border">
          <p className="text-xs font-medium mb-0.5">Thank you for your business! 🙏</p>
          <p className="text-[10px] text-muted-foreground">
            {business?.name} · {business?.phone}{business?.upiId ? ` · UPI: ${business.upiId}` : ''}
          </p>
        </div>
      </div>

      {/* §3: Sticky bottom action footer — 1-click access */}
      <div className="sticky bottom-0 z-20 bg-card border-t border-border p-3 action-buttons shadow-lg">
        <div className="grid grid-cols-4 gap-2 max-w-2xl mx-auto">
          <Button variant="outline" onClick={handleWhatsAppShare} className="h-11 flex-col gap-0.5 text-emerald-600 border-emerald-300 dark:border-emerald-800">
            <MessageCircle className="w-4 h-4" />
            <span className="text-[9px]">WhatsApp</span>
          </Button>
          <Button variant="outline" onClick={handleSMSShare} className="h-11 flex-col gap-0.5">
            <Share2 className="w-4 h-4" />
            <span className="text-[9px]">Share</span>
          </Button>
          <Button variant="outline" onClick={handlePrint} className="h-11 flex-col gap-0.5">
            <Printer className="w-4 h-4" />
            <span className="text-[9px]">Print</span>
          </Button>
          <Button variant="outline" onClick={handlePrint} className="h-11 flex-col gap-0.5">
            <Download className="w-4 h-4" />
            <span className="text-[9px]">PDF</span>
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
