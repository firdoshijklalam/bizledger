'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Invoice } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META, getGradeMeta } from '@/lib/utils'
import { motion } from 'framer-motion'
import { ArrowLeft, Download, Share2, Printer, X, MessageCircle, User, MoreVertical, Bell, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useRef, useState } from 'react'
import { toPng } from 'html-to-image'
import { apiDelete, apiPut } from '@/hooks/use-fetch'

export function InvoicePreview({ invoiceId }: { invoiceId: string }) {
  const { setSelectedInvoiceId, business, setSelectedPartyId, setActiveView, overlayInvoiceId, setOverlayInvoiceId, setOverlayPartyId, triggerRefresh, selectedInvoiceId } = useAppStore()
  const { t } = useI18n()
  const { data: invoice, loading, error } = useFetch<Invoice>(`/api/invoices/${invoiceId}`, [invoiceId])
  const printRef = useRef<HTMLDivElement>(null)
  const [capturing, setCapturing] = useState(false)
  const [showKebabMenu, setShowKebabMenu] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [updatingStatus, setUpdatingStatus] = useState(false)

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

  // §2: Correct math — GrandTotal already includes GST (from DB).
  // Subtotal + GST - Discount = GrandTotal (stored in DB).
  // Paid vs GrandTotal comparison:
  //   If Paid === GrandTotal → fully paid, no due, no change
  //   If Paid < GrandTotal → remaining due
  //   If Paid > GrandTotal → change due / advance (customer overpaid)
  const remainingDue = safeGrandTotal > safeAmountPaid ? (safeGrandTotal - safeAmountPaid) : 0
  const changeDue = safeAmountPaid > safeGrandTotal ? (safeAmountPaid - safeGrandTotal) : 0

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

  // §3: Fulfillment status — check if pickup pending
  const isPickupPending = (invoice as any).deliveryStatus === 'pickup'

  const handleMarkHandedOver = async () => {
    setUpdatingStatus(true)
    try {
      await apiPut(`/api/invoices/${invoice.id}`, { deliveryStatus: 'handed' })
      toast.success('মাল বুঝিয়ে দেওয়া হয়েছে ✓')
      // §FIX: Use triggerRefresh instead of window.location.reload().
      // reload() causes full SPA refresh (loses scroll, reloads everything).
      triggerRefresh()
      // Close the overlay to return to the invoice list
      if (overlayInvoiceId) setOverlayInvoiceId(null)
      else if (selectedInvoiceId) setSelectedInvoiceId(null)
    } catch (e) {
      toast.error('আপডেট ব্যর্থ')
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      className="space-y-4"
    >
      {/* §3: Pickup Pending banner — prominent button to mark as handed over */}
      {isPickupPending && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border-2 border-amber-400 flex items-center gap-3">
          <span className="text-2xl">📦</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">Pick Up Later — মাল এখনও দোকানে আছে</p>
            <p className="text-[11px] text-amber-600 dark:text-amber-400">গ্রাহক মাল বুঝে নিলে আপডেট করুন</p>
          </div>
          <Button
            onClick={handleMarkHandedOver}
            disabled={updatingStatus}
            className="h-10 px-4 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shrink-0"
          >
            {updatingStatus ? '⏳' : '✓ বুঝিয়ে দিন'}
          </Button>
        </div>
      )}
      {/* §1 Header — Back + invoice number + Profile icon + Kebab menu */}
      <div className="flex items-center gap-2 action-buttons relative">
        <button
          onClick={() => {
            // §2: If opened as overlay, close overlay (preserves underlying view + scroll)
            if (overlayInvoiceId) { setOverlayInvoiceId(null); return }
            setSelectedInvoiceId(null)
          }}
          className="w-10 h-10 rounded-full hover:bg-muted flex items-center justify-center"
          aria-label="Back"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold flex-1">{invoice.invoiceNumber}</h2>
        <div className="flex items-center gap-1">
          {/* Customer Profile — only if linked to a saved Party.
              §1: Uses overlay (push) instead of tab switch. Profile slides OVER invoice.
              Back from profile → returns to invoice → back from invoice → returns to dashboard. */}
          {invoice.partyId && (
            <button
              onClick={() => {
                // §1: Push party overlay ON TOP of invoice overlay — no tab switch
                setOverlayPartyId(invoice.partyId!)
              }}
              className="w-9 h-9 rounded-full hover:bg-emerald-50 dark:hover:bg-emerald-950/30 flex items-center justify-center text-emerald-600 transition-colors"
              aria-label="View customer profile"
              title="View customer profile"
            >
              <User className="w-4 h-4" />
            </button>
          )}
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
          {/* §1 Kebab menu (⋮) — replaces individual Edit/Delete icons */}
          <button
            onClick={() => setShowKebabMenu(!showKebabMenu)}
            className="w-9 h-9 rounded-full hover:bg-muted flex items-center justify-center text-muted-foreground transition-colors"
            aria-label="More options"
            title="More options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>
        </div>
        {/* §1 Kebab dropdown */}
        {showKebabMenu && (
          <>
            {/* Backdrop to close menu on outside click */}
            <div className="fixed inset-0 z-40" onClick={() => setShowKebabMenu(false)} />
            {/* Dropdown */}
            <div className="absolute top-full right-0 mt-1 z-50 bg-card border border-border rounded-xl shadow-2xl overflow-hidden min-w-[160px]">
              <button
                onClick={() => { setShowKebabMenu(false); toast.info('Edit invoice feature coming soon') }}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-accent text-sm text-left transition-colors"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
                Edit Invoice
              </button>
              <button
                onClick={async () => {
                  setShowKebabMenu(false)
                  if (deleting) return
                  setDeleting(true)
                  try {
                    await apiDelete(`/api/invoices/${invoice.id}`)
                    toast.success('Invoice deleted')
                    setSelectedInvoiceId(null)
                  } catch (e) {
                    toast.error('Failed to delete invoice')
                  } finally {
                    setDeleting(false)
                  }
                }}
                disabled={deleting}
                className="w-full flex items-center gap-2 px-4 py-3 hover:bg-red-50 dark:hover:bg-red-950/30 text-sm text-left text-red-600 transition-colors border-t border-border"
              >
                <Trash2 className="w-4 h-4" />
                {deleting ? 'Deleting…' : 'Delete Invoice'}
              </button>
            </div>
          </>
        )}
      </div>

      {/* §3: Premium Invoice — print area. FORCED LIGHT MODE for image export.
          §PAPER-EFFECT: Subtle drop shadow + rounded corners so it looks like a
          real physical paper receipt sitting on a slightly darker background. */}
      <div ref={printRef} className="invoice-content rounded-2xl overflow-hidden border border-gray-200 shadow-xl shadow-black/10" style={{ backgroundColor: '#FFFFFF', color: '#000000' }}>
        {/* §HEADER-THEME: Sophisticated deep teal gradient (was harsh emerald).
          Deep teal conveys trust, professionalism, and premium quality. */}
        <div className="p-5" style={{ background: 'linear-gradient(135deg, #0F766E 0%, #115E59 50%, #134E4A 100%)', color: '#FFFFFF' }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="text-xl font-bold leading-tight tracking-tight">{business?.name}</h1>
              {/* §TYPOGRAPHY: Secondary info in muted white/70 so it doesn't
                  fight for attention with the main content. */}
              <p className="text-xs opacity-70 mt-1">{business?.address}</p>
              <p className="text-xs opacity-70">
                {business?.phone}{business?.gstin ? ` · GSTIN: ${business.gstin}` : ''}
              </p>
              {/* §1: CIN No + Terminal/Counter ID */}
              <p className="text-[10px] opacity-50 mt-1">
                {business?.pan ? `CIN: U74110WB2018PTC${business.pan}` : ''}{invoice.collectedByRole ? ` · Terminal: ${invoice.collectedByRole.toUpperCase()}` : ' · Terminal: T01'}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[10px] uppercase opacity-50 tracking-widest font-medium">Tax Invoice</p>
              <p className="text-sm font-bold tracking-tight">{invoice.invoiceNumber}</p>
              <p className="text-[11px] opacity-70 mt-1">{formatDate(invoice.createdAt)}</p>
              <p className="text-[10px] opacity-50 mt-0.5">Counter: {(invoice as any).counterId || 'T01'}</p>
            </div>
          </div>
        </div>

        {/* Bill To — §3: hardcoded light-mode colors for export safety */}
        <div className="p-5 border-b border-gray-200" style={{ color: '#000000' }}>
          <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: '#6B7280' }}>Billed To</p>
          {invoice.party ? (
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold" style={{ backgroundColor: '#D1FAE5', color: '#047857' }}>
                {(invoice.party.name || '?').charAt(0)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: '#000000' }}>{invoice.party.name}</p>
                <p className="text-[11px]" style={{ color: '#6B7280' }}>{invoice.party.phone || ''}</p>
                {invoice.party.address && <p className="text-[11px]" style={{ color: '#6B7280' }}>{invoice.party.address}</p>}
              </div>
            </div>
          ) : (
            <p className="text-sm" style={{ color: '#6B7280' }}>Walk-in customer</p>
          )}
        </div>

        {/* Items table — §3: hardcoded colors */}
        <div className="px-5 py-3" style={{ color: '#000000' }}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase border-b border-gray-200" style={{ color: '#6B7280' }}>
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
                <tr key={it.id} style={i % 2 === 1 ? { backgroundColor: '#F3F4F6' } : {}}>
                  <td className="py-2.5 text-center text-[11px] tabular" style={{ color: '#6B7280' }}>{i + 1}</td>
                  <td className="py-2.5 text-left" style={{ color: '#000000' }}>{it.name}</td>
                  <td className="py-2.5 text-center text-[11px] tabular" style={{ color: '#6B7280' }}>{(it as any).hsnCode || (it as any).hsn || '—'}</td>
                  <td className="py-2.5 text-right tabular" style={{ color: '#000000' }}>{it.quantity}</td>
                  <td className="py-2.5 text-right tabular" style={{ color: '#000000' }}>{formatCurrency(it.unitPrice, currency)}</td>
                  <td className="py-2.5 text-right tabular font-medium" style={{ color: '#000000' }}>{formatCurrency(it.total, currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200">
                <td colSpan={3} className="py-2 text-right text-[11px] font-medium" style={{ color: '#6B7280' }}>Total Qty:</td>
                <td className="py-2 text-right text-[11px] font-bold tabular" style={{ color: '#000000' }}>{totalQty}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* §2: Totals — correct accounting labels. GrandTotal = Subtotal - Discount + GST.
            All text hardcoded black for light-mode export safety. */}
        <div className="px-5 py-4 border-t-2 border-dashed border-gray-400 space-y-1.5 text-sm" style={{ backgroundColor: '#F9FAFB', color: '#000000' }}>
          {/* Row 1: Subtotal */}
          <div className="flex justify-between">
            <span style={{ color: '#6B7280' }}>{t('bill.subtotal')}</span>
            <span className="tabular" style={{ color: '#000000' }}>{formatCurrency(safeSubtotal, currency)}</span>
          </div>
          {/* Row 2: Discount (if any) */}
          {safeDiscountAmount > 0 && (
            <div className="flex justify-between" style={{ color: '#DC2626' }}>
              <span>{t('bill.discount')} {invoice.discountMode === 'percent' ? `(${safeDiscountValue}%)` : ''}</span>
              <span className="tabular">-{formatCurrency(safeDiscountAmount, currency)}</span>
            </div>
          )}
          {/* Row 3: Total GST (if any) — labeled correctly, not "Previous Balance" */}
          {safeGstAmount > 0 && (
            <>
              <div className="flex justify-between">
                <span style={{ color: '#6B7280' }}>CGST</span>
                <span className="tabular" style={{ color: '#000000' }}>{formatCurrency(cgstAmount, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: '#6B7280' }}>SGST</span>
                <span className="tabular" style={{ color: '#000000' }}>{formatCurrency(sgstAmount, currency)}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: '#6B7280' }}>Total GST</span>
                <span className="tabular" style={{ color: '#000000' }}>+{formatCurrency(safeGstAmount, currency)}</span>
              </div>
            </>
          )}
          {/* Grand Total = Subtotal - Discount + GST (from DB)
              §TYPOGRAPHY: Grand Total pops more — larger font, bold, teal color
              (matches header theme) so it stands out from other totals. */}
          <div className="flex justify-between items-center pt-2.5 border-t-2 border-gray-300">
            <span className="font-bold text-base" style={{ color: '#000000' }}>{t('bill.grandTotal')}</span>
            <span className="font-bold tabular text-xl tracking-tight" style={{ color: '#0F766E' }}>{formatCurrency(safeGrandTotal, currency)}</span>
          </div>
          {/* Paid — shows actual amount paid. §TYPOGRAPHY: teal accent. */}
          <div className="flex justify-between pt-1">
            <span style={{ color: '#6B7280' }}>Paid {invoice.paymentMode ? `via ${invoice.paymentMode.toUpperCase()}` : ''}</span>
            <span className="tabular font-medium" style={{ color: '#0F766E' }}>{formatCurrency(safeAmountPaid, currency)}</span>
          </div>
          {/* Remaining Due — only if underpaid */}
          {remainingDue > 0 && (
            <div className="flex justify-between">
              <span className="font-bold" style={{ color: '#DC2626' }}>Due</span>
              <span className="tabular font-bold" style={{ color: '#DC2626' }}>{formatCurrency(remainingDue, currency)}</span>
            </div>
          )}
          {/* Change Due — only if overpaid (customer paid more than GrandTotal) */}
          {changeDue > 0 && (
            <div className="flex justify-between" style={{ color: '#0F766E' }}>
              <span className="font-medium">Change Due</span>
              <span className="tabular font-medium">{formatCurrency(changeDue, currency)}</span>
            </div>
          )}
          {/* Amount in Words */}
          <p className="text-[10px] italic pt-1 border-t border-dashed border-gray-200" style={{ color: '#6B7280' }}>
            {amountInWords}
          </p>
        </div>

        {/* §3: MOP Breakdown — hardcoded light colors */}
        <div className="px-5 py-3 border-t border-gray-200" style={{ backgroundColor: '#F9FAFB', color: '#000000' }}>
          <p className="text-[10px] uppercase font-medium mb-1.5" style={{ color: '#6B7280' }}>Mode of Payment</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="flex justify-between">
              <span style={{ color: '#6B7280' }}>{mopLabel}:</span>
              <span className="tabular font-medium" style={{ color: '#000000' }}>{formatCurrency(safeAmountPaid, currency)}</span>
            </div>
            {remainingDue > 0 && (
              <div className="flex justify-between">
                <span style={{ color: '#6B7280' }}>Credit:</span>
                <span className="tabular font-medium" style={{ color: '#DC2626' }}>{formatCurrency(remainingDue, currency)}</span>
              </div>
            )}
          </div>
          <p className="text-[10px] mt-2" style={{ color: '#6B7280' }}>
            Billed By: <span className="font-medium" style={{ color: '#000000' }}>{cashierName}</span>
          </p>
        </div>

        {/* §5: GST Summary — hardcoded light colors */}
        {safeGstAmount > 0 && Object.keys(gstGroups).length > 0 && (
          <div className="px-5 py-3 border-t border-gray-200" style={{ color: '#000000' }}>
            <p className="text-[10px] uppercase font-medium mb-2" style={{ color: '#6B7280' }}>GST Summary</p>
            <table className="w-full text-[10px]">
              <thead>
                <tr className="border-b border-gray-200" style={{ color: '#6B7280' }}>
                  <th className="text-left py-1 font-medium">Description</th>
                  <th className="text-right py-1 font-medium">Taxable</th>
                  <th className="text-right py-1 font-medium">CGST</th>
                  <th className="text-right py-1 font-medium">SGST</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(gstGroups).map(([rate, data]) => (
                  <tr key={rate} className="border-b border-gray-100">
                    <td className="py-1 text-left">GST {rate}%</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.taxable, currency)}</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.cgst, currency)}</td>
                    <td className="py-1 text-right tabular">{formatCurrency(data.sgst, currency)}</td>
                  </tr>
                ))}
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

        {/* Footer — hardcoded light colors */}
        <div className="px-5 py-4 text-center border-t border-gray-200" style={{ color: '#000000' }}>
          <p className="text-xs font-medium mb-0.5">Thank you for your business! 🙏</p>
          <p className="text-[10px]" style={{ color: '#6B7280' }}>
            {business?.name} · {business?.phone}{business?.upiId ? ` · UPI: ${business.upiId}` : ''}
          </p>
        </div>
      </div>

      {/* §3: Action footer — image-based sharing.
          §SCROLL-FLOW: NOT fixed/sticky — part of the scrollable document flow.
          The action bar scrolls WITH the invoice content. When the user scrolls
          to the bottom, the action bar sits ABOVE the global Bottom Navigation
          Bar (which is always visible). The parent <main> already has pb-28
          padding for the bottom nav, so we add a small mb-4 for breathing room.
          §GLASSMORPHISM: Translucent bg + backdrop-blur for modern app feel. */}
      <div className="action-buttons border-t border-border p-3 rounded-2xl dark:border-border mb-4" style={{ backgroundColor: 'color-mix(in srgb, var(--background) 85%, transparent)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}>
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
