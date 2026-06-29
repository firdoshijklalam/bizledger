'use client'

import { useAppStore } from '@/store/app-store'
import { useFetch } from '@/hooks/use-fetch'
import type { Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { X, ChevronRight, Share2, MessageCircle, Printer, User, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { useScrollRetention } from '@/hooks/use-scroll-retention'

interface InvoiceWithDetails extends Invoice {
  party?: { id?: string; name: string; phone: string | null; qualityGrade: string } | null
  items?: Array<{ id: string; name: string; quantity: number; unitPrice: number; total: number }>
}

/**
 * Universal Floating Modal for Invoice/Transaction preview (PRD Part 7 §2 + Part 16 §4).
 * Opens as a floating window instead of page redirect.
 * Has "View All" shortcut link in header for explicit navigation.
 * PRD Part 16 §4: "Full View" button dismisses overlay but keeps selectedInvoiceId,
 * then navigates to billing where InvoicePreview is rendered.
 */
export function FloatingInvoiceModal() {
  const {
    selectedInvoiceId,
    setSelectedInvoiceId,
    floatingInvoiceOpen,
    setFloatingInvoiceOpen,
    setActiveView,
    setReturnToView,
    setSelectedPartyId,
    business,
  } = useAppStore()
  const { saveScroll, restoreScroll } = useScrollRetention()

  // Fetch invoice details when an invoice is selected
  const { data: invoice } = useFetch<InvoiceWithDetails>(
    selectedInvoiceId ? `/api/invoices/${selectedInvoiceId}` : null,
    [selectedInvoiceId]
  )

  const handleClose = () => {
    setSelectedInvoiceId(null)
    setFloatingInvoiceOpen(false)
    restoreScroll()
  }

  const handleViewAll = () => {
    setReturnToView(null)
    setSelectedInvoiceId(null)
    setFloatingInvoiceOpen(false)
    setActiveView('billing')
  }

  // Customer Profile button (PRD Part 16 §4): navigates to party in Khata
  const handleCustomerProfile = () => {
    if (!invoice?.party?.id) {
      toast.info('Walk-in customer — no profile to view')
      return
    }
    saveScroll()
    setFloatingInvoiceOpen(false)
    setSelectedPartyId(invoice.party.id)
    setActiveView('khata')
  }

  // Full View button (PRD Part 16 §4): dismiss overlay, keep selectedInvoiceId, navigate to billing
  const handleFullView = () => {
    setFloatingInvoiceOpen(false)
    setActiveView('billing')
    // selectedInvoiceId remains set → BillingView will render InvoicePreview
  }

  if (!selectedInvoiceId || !invoice || !floatingInvoiceOpen) return null

  const currency = business?.currency || 'INR'
  const payUrl = `${window.location.origin}/?payment=${invoice.paymentLandingToken || invoice.id}`

  const handleWhatsApp = () => {
    const phone = invoice.party?.phone?.replace(/[^0-9]/g, '').replace(/^0/, '91') || ''
    const lines = [
      `*${business?.name || 'BizLedger'}*`,
      `${business?.address || ''}`,
      `${business?.phone || ''}${business?.gstin ? ` | GSTIN: ${business.gstin}` : ''}`,
      ``,
      `*Invoice: ${invoice.invoiceNumber}*`,
      `Date: ${formatDate(invoice.createdAt)}`,
      ``,
      `*Billed To:* ${invoice.party?.name || 'Walk-in Customer'}`,
      invoice.party?.phone ? `Phone: ${invoice.party.phone}` : '',
      ``,
      `*Items:*`,
    ]
    if (invoice.items && invoice.items.length > 0) {
      invoice.items.forEach((it) => {
        lines.push(`${it.name} × ${it.quantity} = ${formatCurrency(it.total, currency)}`)
      })
    }
    lines.push(``, `Subtotal: ${formatCurrency(invoice.subtotal, currency)}`)
    if (invoice.discountAmount > 0) lines.push(`Discount: -${formatCurrency(invoice.discountAmount, currency)}`)
    if (invoice.gstAmount > 0) lines.push(`GST: ${formatCurrency(invoice.gstAmount, currency)}`)
    lines.push(`*Grand Total: ${formatCurrency(invoice.grandTotal, currency)}*`)
    if (invoice.amountDue > 0) {
      lines.push(`⚠️ Due: ${formatCurrency(invoice.amountDue, currency)}`)
    } else {
      lines.push(`✓ Paid`)
    }
    if (business?.upiId) {
      lines.push(``, `💳 Pay Now: ${payUrl}`)
    }
    lines.push(``, `Thank you! 🙏`)
    const text = encodeURIComponent(lines.filter(Boolean).join('\n'))
    window.open(phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`, '_blank')
    toast.success('Opening WhatsApp with full invoice…')
  }

  return (
    <AnimatePresence>
      {invoice && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={handleClose}
          className="fixed inset-0 z-[80] bg-black/40 backdrop-blur-[2px] flex items-end sm:items-center justify-center"
        >
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
            className="bg-card rounded-t-3xl sm:rounded-3xl border-t sm:border border-border w-full max-w-md max-h-[85vh] flex flex-col"
          >
            {/* Header with shortcut links (PRD Part 7 §2.1 + Part 16 §4) */}
            <div className="flex items-center justify-between p-4 border-b border-border">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate">{invoice.invoiceNumber}</p>
                <p className="text-[11px] text-muted-foreground">
                  {invoice.party?.name || 'Walk-in'} · {formatDate(invoice.createdAt)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={handleViewAll}
                  className="text-[10px] font-medium text-primary bg-primary/10 px-2 py-1 rounded-lg whitespace-nowrap"
                >
                  All →
                </button>
                <button onClick={handleClose} className="text-muted-foreground" aria-label="Close">
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto scroll-area p-4 space-y-3">
              {/* Amount summary */}
              <div className="text-center p-4 rounded-2xl bg-muted/50">
                <p className="text-[10px] text-muted-foreground uppercase">Grand Total</p>
                <p className="text-2xl font-bold tabular text-primary">{formatCurrency(invoice.grandTotal, currency)}</p>
                {invoice.amountDue > 0 ? (
                  <p className="text-sm text-red-600 mt-1">Due: {formatCurrency(invoice.amountDue, currency)}</p>
                ) : (
                  <p className="text-sm text-emerald-600 mt-1">✓ Paid</p>
                )}
              </div>

              {/* Customer Profile button (PRD Part 16 §4) */}
              {invoice.party && (
                <button
                  onClick={handleCustomerProfile}
                  className="w-full flex items-center gap-3 p-3 rounded-xl bg-muted/50 hover:bg-muted transition-colors text-left"
                >
                  <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                    <User className="w-4 h-4 text-emerald-600" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{invoice.party.name}</p>
                    <p className="text-[10px] text-muted-foreground">{invoice.party.phone || 'No phone'} · View profile</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                </button>
              )}

              {/* Items */}
              {invoice.items && invoice.items.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">Items</p>
                  <div className="space-y-1">
                    {invoice.items.map((it) => (
                      <div key={it.id} className="flex justify-between text-sm py-1.5 border-b border-border last:border-0">
                        <span className="flex-1 truncate">{it.name} × {it.quantity}</span>
                        <span className="tabular font-medium">{formatCurrency(it.total, currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="p-3 rounded-xl bg-muted/30 space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span>
                  <span className="tabular">{formatCurrency(invoice.subtotal, currency)}</span>
                </div>
                {invoice.discountAmount > 0 && (
                  <div className="flex justify-between text-red-600">
                    <span>Discount</span>
                    <span className="tabular">-{formatCurrency(invoice.discountAmount, currency)}</span>
                  </div>
                )}
                {invoice.gstAmount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">GST</span>
                    <span className="tabular">{formatCurrency(invoice.gstAmount, currency)}</span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-border font-bold">
                  <span>Total</span>
                  <span className="tabular text-primary">{formatCurrency(invoice.grandTotal, currency)}</span>
                </div>
              </div>
            </div>

            {/* Action buttons — Full View dismisses overlay, keeps selectedInvoiceId, navigates to billing (PRD Part 16 §4) */}
            <div className="p-3 border-t border-border grid grid-cols-3 gap-2">
              <Button variant="outline" size="sm" onClick={handleWhatsApp} className="h-10 text-emerald-600 border-emerald-300">
                <MessageCircle className="w-4 h-4" />
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()} className="h-10">
                <Printer className="w-4 h-4" />
              </Button>
              <Button size="sm" onClick={handleFullView} className="h-10">
                Full View <ChevronRight className="w-3 h-3" />
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
