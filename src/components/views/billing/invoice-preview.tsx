'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Invoice } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META, getGradeMeta } from '@/lib/utils'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Share2, Printer, X, MessageCircle, User, Pencil, Bell, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'

export function InvoicePreview({ invoiceId }: { invoiceId: string }) {
  const { setSelectedInvoiceId, business, setSelectedPartyId, setActiveView } = useAppStore()
  const { t } = useI18n()
  const { data: invoice, loading, error } = useFetch<Invoice>(`/api/invoices/${invoiceId}`, [invoiceId])
  const printRef = useRef<HTMLDivElement>(null)
  const [capturing, setCapturing] = useState(false)

  // §1: Loading state — show spinner while fetching
  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  // §1: Error state — show error message if fetch failed (not silent null)
  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-red-600">Failed to load invoice: {error}</p>
        <p className="text-xs text-muted-foreground">Invoice ID: {invoiceId}</p>
        <button onClick={() => setSelectedInvoiceId(null)} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm">
          Go Back
        </button>
      </div>
    )
  }

  if (!invoice) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-3">
        <p className="text-sm text-muted-foreground">Invoice not found</p>
        <p className="text-xs text-muted-foreground">Invoice ID: {invoiceId}</p>
        <button onClick={() => setSelectedInvoiceId(null)} className="px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm">
          Go Back
        </button>
      </div>
    )
  }

  const currency = business?.currency || 'INR'
  const meta = invoice.party ? getGradeMeta(invoice.party.qualityGrade) : null

  // §1: Safe numeric fallbacks — prevent NaN when fields are undefined/null
  const safeSubtotal = Number(invoice.subtotal) || 0
  const safeDiscountAmount = Number(invoice.discountAmount) || 0
  const safeDiscountValue = Number(invoice.discountValue) || 0
  const safeGstAmount = Number(invoice.gstAmount) || 0
  const safeGrandTotal = Number(invoice.grandTotal) || 0
  const safeAmountPaid = Number(invoice.amountPaid) || 0
  const safeAmountDue = Number(invoice.amountDue) || 0
  const safeItems = Array.isArray(invoice.items) ? invoice.items : []

  const handlePrint = () => {
    window.print()
  }

  // §1: Capture invoice as image and share
  const captureInvoiceImage = async (): Promise<string | null> => {
    if (!printRef.current) return null
    setCapturing(true)
    try {
      const dataUrl = await toPng(printRef.current, {
        quality: 0.95,
        pixelRatio: 2,
        backgroundColor: '#ffffff',
      })
      return dataUrl
    } catch (e) {
      console.error('Image capture failed:', e)
      toast.error('Image capture failed')
      return null
    } finally {
      setCapturing(false)
    }
  }

  // Convert dataURL to File for native sharing
  const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
    const res = await fetch(dataUrl)
    const blob = await res.blob()
    return new File([blob], filename, { type: 'image/png' })
  }

  const handleShare = async () => {
    const dataUrl = await captureInvoiceImage()
    if (!dataUrl) return
    try {
      const file = await dataUrlToFile(dataUrl, `invoice-${invoice.invoiceNumber}.png`)
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Invoice ${invoice.invoiceNumber}`,
          files: [file],
        })
        toast.success('Invoice shared as image!')
      } else {
        // Fallback: download the image
        const link = document.createElement('a')
        link.download = `invoice-${invoice.invoiceNumber}.png`
        link.href = dataUrl
        link.click()
        toast.success('Invoice image downloaded')
      }
    } catch (e) {
      toast.error('Share failed')
    }
  }

  const handleWhatsAppShare = async () => {
    const dataUrl = await captureInvoiceImage()
    if (!dataUrl) return
    try {
      const file = await dataUrlToFile(dataUrl, `invoice-${invoice.invoiceNumber}.png`)
      if (navigator.share && navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: `Invoice ${invoice.invoiceNumber}`,
          text: `Bill from ${business?.name}`,
          files: [file],
        })
        toast.success('Invoice image shared!')
      } else {
        // Fallback: open WhatsApp with text + download image
        const phone = invoice.party?.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
        const text = encodeURIComponent(`Bill from ${business?.name}\nInvoice: ${invoice.invoiceNumber}\nTotal: ${formatCurrency(safeGrandTotal, currency)}`)
        window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
        const link = document.createElement('a')
        link.download = `invoice-${invoice.invoiceNumber}.png`
        link.href = dataUrl
        link.click()
        toast.success('Image downloaded — attach in WhatsApp')
      }
    } catch (e) {
      toast.error('Share failed')
    }
  }

  const handleDownloadImage = async () => {
    const dataUrl = await captureInvoiceImage()
    if (!dataUrl) return
    const link = document.createElement('a')
    link.download = `invoice-${invoice.invoiceNumber}.png`
    link.href = dataUrl
    link.click()
    toast.success('Invoice image downloaded')
  }

  const handleSMSShare = () => {
    const payUrl = `${window.location.origin}/payment/${invoice.paymentLandingToken || invoice.id}`
    const phone = invoice.party?.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const text = encodeURIComponent(
      `${business?.name} বিল: #${invoice.invoiceNumber}, মোট: ${formatCurrency(safeGrandTotal, currency)}। পেমেন্ট করতে ক্লিক করুন: ${payUrl}`
    )
    window.location.href = phone ? `sms:${phone}?body=${text}` : `sms:?body=${text}`
  }

  // §2: GST breakdown — CGST = SGST = gstAmount / 2 (safe from NaN)
  const cgstAmount = safeGstAmount / 2
  const sgstAmount = safeGstAmount / 2

  // §1: Total Quantity (sum of all item quantities, safe from NaN)
  const totalQty = safeItems.reduce((s, it) => s + (Number(it.quantity) || 0), 0)

  // §2: Amount in Words
  function numberToWords(num: number): string {
    if (num === 0) return 'Zero'
    const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen']
    const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']
    function two(n: number): string {
      if (n < 20) return ones[n]
      return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '')
    }
    function three(n: number): string {
      const h = Math.floor(n / 100), r = n % 100
      let s = ''
      if (h > 0) s += ones[h] + ' Hundred'
      if (r > 0) s += (h > 0 ? ' ' : '') + two(r)
      return s
    }
    let n = Math.floor(num), w = ''
    const cr = Math.floor(n / 10000000); n %= 10000000
    const lk = Math.floor(n / 100000); n %= 100000
    const th = Math.floor(n / 1000); n %= 1000
    const rem = n
    if (cr > 0) w += three(cr) + ' Crore '
    if (lk > 0) w += three(lk) + ' Lakh '
    if (th > 0) w += three(th) + ' Thousand '
    if (rem > 0) w += three(rem)
    return w.trim()
  }
  const amountInWords = `Rupees ${numberToWords(Math.round(safeGrandTotal))} Only`

  // §3: MOP breakdown — parse from collectedByName/Role or paymentMode
  const mopLabel = invoice.paymentMode ? invoice.paymentMode.toUpperCase() : 'CASH'

  // §4: Cashier name
  const cashierName = invoice.collectedByName || business?.ownerName || 'Staff'

  // §3: Math fix — calculate previous balance and change due
  // If amountPaid > grandTotal, customer overpaid (clearing previous due or advance)
  // If amountPaid < grandTotal, customer has remaining due
  const previousBalance = safeAmountPaid > safeGrandTotal ? (safeAmountPaid - safeGrandTotal) : 0
  const changeDue = safeAmountPaid > safeGrandTotal ? (safeAmountPaid - safeGrandTotal) : 0
  const remainingDue = safeGrandTotal > safeAmountPaid ? (safeGrandTotal - safeAmountPaid) : 0
  // §3: Actual amount applied to THIS invoice (capped at grandTotal)
  const actualPaid = Math.min(safeAmountPaid, safeGrandTotal)

  // §5: GST Summary — group by GST rate (safe from NaN)
  const gstGroups: Record<number, { taxable: number; cgst: number; sgst: number }> = {}
  safeItems.forEach((it: any) => {
    const rate = Number(it.gstRate) || 0
    const itemTotal = Number(it.total) || 0
    if (!gstGroups[rate]) gstGroups[rate] = { taxable: 0, cgst: 0, sgst: 0 }
    gstGroups[rate].taxable += itemTotal
    gstGroups[rate].cgst += (itemTotal * rate) / 200
    gstGroups[rate].sgst += (itemTotal * rate) / 200
  })

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      {/* §2 Header — Back + invoice number + action icons row (Profile, Edit, Reminder, Delete) */}
      <div className="flex items-center gap-2 action-buttons">
        <button
          onClick={() => setSelectedInvoiceId(null)}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">{invoice.invoiceNumber}</h2>
        {/* §2 Action icons — flex row, gap 4 */}
        <div className="flex items-center gap-1">
          {/* Customer Profile — only if linked to a saved Party */}
          {invoice.partyId && (
            <button
              onClick={() => {
                setSelectedInvoiceId(null)
                setSelectedPartyId(invoice.partyId!)
                setActiveView('khata')
              }}
              className="w-9 h-9 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center justify-center text-emerald-600 transition-colors"
              aria-label="View customer profile"
              title="View customer profile"
            >
              <User className="w-4 h-4" />
            </button>
          )}
          {/* Edit */}
          <button
            onClick={() => toast.info('Edit invoice feature coming soon')}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
            aria-label="Edit invoice"
            title="Edit invoice"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {/* Reminder — only if invoice has due amount */}
          {remainingDue > 0 && (
            <button
              onClick={() => toast.info('Payment reminder sent!')}
              className="w-9 h-9 rounded-full hover:bg-amber-50 dark:hover:bg-amber-950/30 flex items-center justify-center text-amber-600 transition-colors"
              aria-label="Send payment reminder"
              title="Send payment reminder"
            >
              <Bell className="w-4 h-4" />
            </button>
          )}
          {/* Delete */}
          <button
            onClick={() => toast.info('Delete invoice feature coming soon')}
            className="w-9 h-9 rounded-full hover:bg-red-50 dark:hover:bg-red-950/30 flex items-center justify-center text-red-600 transition-colors"
            aria-label="Delete invoice"
            title="Delete invoice"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
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

        {/* Bill To — §1: Grade badge REMOVED (internal rating should never show on shared bill) */}
        <div className="p-5 border-b border-border">
          <p className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Billed To</p>
          {invoice.party ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center font-bold text-emerald-700 dark:text-emerald-300">
                {(invoice.party.name || '?').charAt(0)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{invoice.party.name}</p>
                <p className="text-[11px] text-muted-foreground">{invoice.party.phone || ''}</p>
                {invoice.party.address && <p className="text-[11px] text-muted-foreground">{invoice.party.address}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Walk-in customer</p>
          )}
        </div>

        {/* Items table — §1: S.No column added */}
        <div className="px-5 py-3">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                <th className="text-center py-2 font-medium w-8">S.No</th>
                <th className="text-left py-2 font-medium">Item</th>
                <th className="text-center py-2 font-medium">HSN</th>
                <th className="text-right py-2 font-medium">Qty</th>
                <th className="text-right py-2 font-medium">Price</th>
                <th className="text-right py-2 font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {safeItems.map((it, i) => (
                <tr key={it.id} className={i % 2 === 1 ? 'bg-muted/40' : ''}>
                  <td className="py-2.5 text-center text-[11px] text-muted-foreground tabular">{i + 1}</td>
                  <td className="py-2.5 text-left">{it.name}</td>
                  <td className="py-2.5 text-center text-[11px] text-muted-foreground tabular">{(it as any).hsnCode || (it as any).hsn || '—'}</td>
                  <td className="py-2.5 text-right tabular">{it.quantity}</td>
                  <td className="py-2.5 text-right tabular">{formatCurrency(it.unitPrice, currency)}</td>
                  <td className="py-2.5 text-right tabular font-medium">{formatCurrency(it.total, currency)}</td>
                </tr>
              ))}
            </tbody>
            {/* §1: Total Qty row */}
            <tfoot>
              <tr className="border-t border-border">
                <td colSpan={3} className="py-2 text-right text-[11px] text-muted-foreground font-medium">Total Qty:</td>
                <td className="py-2 text-right text-[11px] font-bold tabular">{totalQty}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Totals — §2: Premium thermal-receipt feel with dashed dividers */}
        <div className="px-5 py-4 border-t-2 border-dashed border-gray-400 bg-muted/30 space-y-1.5 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">{t('bill.subtotal')}</span>
            <span className="tabular">{formatCurrency(safeSubtotal, currency)}</span>
          </div>
          {safeDiscountAmount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>{t('bill.discount')} {invoice.discountMode === 'percent' ? `(${safeDiscountValue}%)` : ''}</span>
              <span className="tabular">-{formatCurrency(safeDiscountAmount, currency)}</span>
            </div>
          )}
          {safeGstAmount > 0 && (
            <>
              <div className="flex justify-between">
                <span className="text-muted-foreground">CGST</span>
                <span className="tabular">{formatCurrency(cgstAmount, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">SGST</span>
                <span className="tabular">{formatCurrency(sgstAmount, currency)}</span>
              </div>
            </>
          )}
          <div className="flex justify-between pt-2 border-t border-dashed border-gray-300">
            <span className="font-bold">{t('bill.grandTotal')}</span>
            <span className="font-bold tabular text-primary text-lg">{formatCurrency(safeGrandTotal, currency)}</span>
          </div>
          {/* §3: Previous Balance — shown when customer paid more than grandTotal */}
          {previousBalance > 0 && (
            <div className="flex justify-between text-amber-600">
              <span>Previous Balance Cleared</span>
              <span className="tabular">+{formatCurrency(previousBalance, currency)}</span>
            </div>
          )}
          {/* §3: Actual paid amount (capped at grandTotal, not the raw overpaid amount) */}
          <div className="flex justify-between pt-1">
            <span className="text-muted-foreground">Paid {invoice.paymentMode ? `via ${invoice.paymentMode.toUpperCase()}` : ''}</span>
            <span className="tabular text-emerald-600">{formatCurrency(actualPaid, currency)}</span>
          </div>
          {/* §3: Change Due — when customer overpaid (green, money to return) */}
          {changeDue > 0 && (
            <div className="flex justify-between text-emerald-600 font-medium">
              <span>Change Due / Advance</span>
              <span className="tabular">{formatCurrency(changeDue, currency)}</span>
            </div>
          )}
          {/* §3: Remaining Due — when customer underpaid (red, money still owed) */}
          {remainingDue > 0 && (
            <div className="flex justify-between">
              <span className="font-bold text-red-600">Due</span>
              <span className="tabular font-bold text-red-600">{formatCurrency(remainingDue, currency)}</span>
            </div>
          )}
          {/* §2: Amount in Words */}
          <p className="text-[10px] italic text-muted-foreground pt-1 border-t border-dashed border-gray-200">
            {amountInWords}
          </p>
        </div>

        {/* §3: Mode of Payment (MOP) Breakdown */}
        <div className="px-5 py-3 border-t border-border bg-muted/20">
          <p className="text-[10px] uppercase text-muted-foreground font-medium mb-1.5">Mode of Payment</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{mopLabel}:</span>
              <span className="tabular font-medium">{formatCurrency(actualPaid, currency)}</span>
            </div>
            {remainingDue > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Credit:</span>
                <span className="tabular font-medium text-red-600">{formatCurrency(remainingDue, currency)}</span>
              </div>
            )}
          </div>
          {/* §4: Cashier/Biller Identification */}
          <p className="text-[10px] text-muted-foreground mt-2">
            Billed By: <span className="font-medium text-foreground">{cashierName}</span>
          </p>
        </div>

        {/* §5: GST Summary Table — grouped by rate */}
        {safeGstAmount > 0 && Object.keys(gstGroups).length > 0 && (
          <div className="px-5 py-3 border-t border-border">
            <p className="text-[10px] uppercase text-muted-foreground font-medium mb-2">GST Summary</p>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-right py-1 font-medium">Taxable</th>
                  <th className="text-right py-1 font-medium">CGST</th>
                  <th className="text-right py-1 font-medium">SGST</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(gstGroups).map(([rate, data]) => (
                  <tr key={rate} className="border-b border-border/50">
                    <td className="py-1 text-left">GST {rate}%</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.taxable, currency)}</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.cgst, currency)}</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.sgst, currency)}</td>
                  </tr>
                ))}
                {/* Total row */}
                <tr className="font-bold">
                  <td className="py-1 text-left">Total</td>
                  <td className="py-1 text-right tabular">{formatCurrency(safeSubtotal, currency)}</td>
                  <td className="py-1 text-right tabular">{formatCurrency(cgstAmount, currency)}</td>
                  <td className="py-1 text-right tabular">{formatCurrency(sgstAmount, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="px-5 py-4 text-center border-t border-border">
          <p className="text-xs font-medium mb-0.5">Thank you for your business! 🙏</p>
          <p className="text-[10px] text-muted-foreground">
            {business?.name} · {business?.phone}{business?.upiId ? ` · UPI: ${business.upiId}` : ''}
          </p>
        </div>
      </div>

      {/* §3: Sticky bottom action footer — image-based sharing */}
      <div className="sticky bottom-0 z-20 bg-card border-t border-border p-3 action-buttons shadow-lg">
        <div className="grid grid-cols-4 gap-2 max-w-2xl mx-auto">
          <Button variant="outline" onClick={handleWhatsAppShare} disabled={capturing} className="h-11 flex-col gap-0.5 text-emerald-600 border-emerald-300 dark:border-emerald-800">
            <MessageCircle className="w-4 h-4" />
            <span className="text-[9px]">{capturing ? 'Capturing…' : 'WhatsApp'}</span>
          </Button>
          <Button variant="outline" onClick={handleShare} disabled={capturing} className="h-11 flex-col gap-0.5">
            <Share2 className="w-4 h-4" />
            <span className="text-[9px]">Share</span>
          </Button>
          <Button variant="outline" onClick={handlePrint} className="h-11 flex-col gap-0.5">
            <Printer className="w-4 h-4" />
            <span className="text-[9px]">Print</span>
          </Button>
          <Button variant="outline" onClick={handleDownloadImage} disabled={capturing} className="h-11 flex-col gap-0.5">
            <Download className="w-4 h-4" />
            <span className="text-[9px]">{capturing ? '…' : 'Image'}</span>
          </Button>
        </div>
      </div>
    </motion.div>
  )
}
