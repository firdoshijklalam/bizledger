'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch } from '@/hooks/use-fetch'
import { formatCurrency, formatDate } from '@/lib/utils'
import { motion } from 'framer-motion'
import { Shield, Phone, Smartphone, BookOpen, CheckCircle2, Volume2, VolumeX } from 'lucide-react'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { useSoundBox } from '@/hooks/use-sound-box'

interface PaymentData {
  invoice: {
    id: string
    invoiceNumber: string
    grandTotal: number
    amountPaid: number
    amountDue: number
    status: string
    createdAt: string
    items: any[]
  }
  party: { name: string; phone: string | null } | null
  business: {
    name: string
    phone: string | null
    upiId: string | null
    logoUrl: string | null
    address: string | null
    currency: string
  }
}

export function PaymentLandingPage({ token }: { token: string }) {
  const { setActiveView } = useAppStore()
  const { t } = useI18n()
  const { data, loading } = useFetch<PaymentData>(`/api/payment?token=${token}`, [token])
  const [qrUrl, setQrUrl] = useState<string>('')
  const { speak, speaking, soundBoxEnabled, supported: ttsSupported } = useSoundBox()

  useEffect(() => {
    if (!data?.business?.upiId) return
    // Build UPI deep link for QR
    const upiId = data.business.upiId
    const name = encodeURIComponent(data.business.name)
    const amount = data.invoice.amountDue > 0 ? data.invoice.amountDue : data.invoice.grandTotal
    const note = encodeURIComponent(`Invoice ${data.invoice.invoiceNumber}`)
    const upiLink = `upi://pay?pa=${upiId}&pn=${name}&am=${amount}&cu=INR&tn=${note}`
    QRCode.toDataURL(upiLink, { width: 280, margin: 1, color: { dark: '#0f172a', light: '#ffffff' } })
      .then(setQrUrl)
      .catch(() => {})
  }, [data])

  // PRD Part 37 — Sound Box: announce payment amount when page loads (if invoice is paid)
  useEffect(() => {
    if (data?.invoice?.status === 'paid') {
      const amount = data.invoice.amountDue > 0 ? data.invoice.amountDue : data.invoice.grandTotal
      speak({ amount, customerName: data.party?.name })
    }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-emerald-50 dark:bg-emerald-950/20">
        <div className="w-10 h-10 border-[3px] border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-red-50 dark:bg-red-950/20 p-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center mb-4">
          <span className="text-red-600 text-2xl">!</span>
        </div>
        <h1 className="text-lg font-bold text-red-700 dark:text-red-300">Invalid Payment Link</h1>
        <p className="text-sm text-muted-foreground mt-1">This payment link is invalid or expired.</p>
      </div>
    )
  }

  const amount = data.invoice.amountDue > 0 ? data.invoice.amountDue : data.invoice.grandTotal
  const isPaid = data.invoice.status === 'paid'

  const handlePayNow = () => {
    const upiId = data.business.upiId
    if (!upiId) return
    const name = encodeURIComponent(data.business.name)
    const note = encodeURIComponent(`Invoice ${data.invoice.invoiceNumber}`)
    const upiLink = `upi://pay?pa=${upiId}&pn=${name}&am=${amount}&cu=INR&tn=${note}`
    window.location.href = upiLink
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-50 to-background dark:from-emerald-950/20 dark:to-background flex flex-col">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 p-6 text-primary-foreground text-center"
      >
        <div className="w-12 h-12 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center mx-auto mb-3">
          <BookOpen className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold">{data.business.name}</h1>
        {data.business.address && <p className="text-xs opacity-90 mt-1">{data.business.address}</p>}
        {data.business.phone && (
          <p className="text-xs opacity-90 flex items-center justify-center gap-1 mt-1">
            <Phone className="w-3 h-3" /> {data.business.phone}
          </p>
        )}
      </motion.div>

      <div className="flex-1 max-w-md w-full mx-auto px-4 py-6 space-y-4">
        {/* Invoice summary */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-2xl border border-border p-5 shadow-sm"
        >
          <p className="text-center text-sm text-muted-foreground mb-1">আপনার বিল পেমেন্ট করুন</p>
          <h2 className="text-center text-3xl font-bold tabular text-primary">{formatCurrency(amount, data.business.currency)}</h2>
          <div className="mt-4 pt-4 border-t border-border space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Invoice No.</span>
              <span className="font-medium">{data.invoice.invoiceNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Date</span>
              <span>{formatDate(data.invoice.createdAt)}</span>
            </div>
            {data.party && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer</span>
                <span className="font-medium">{data.party.name}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Items</span>
              <span>{data.invoice.items.length}</span>
            </div>
            {data.invoice.amountPaid > 0 && (
              <div className="flex justify-between text-emerald-600">
                <span>Already Paid</span>
                <span className="tabular">{formatCurrency(data.invoice.amountPaid, data.business.currency)}</span>
              </div>
            )}
          </div>
          {isPaid && (
            <div className="mt-4 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center gap-2 justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              <span className="text-sm font-medium text-emerald-700 dark:text-emerald-300">Payment Complete — Thank you!</span>
            </div>
          )}
        </motion.div>

        {/* UPI QR — PRD v2 §10.5: QR only on landing page, not in PDF/share */}
        {!isPaid && data.business.upiId && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-card rounded-2xl border border-border p-6 shadow-sm text-center"
          >
            <p className="text-sm font-semibold mb-1">Scan & Pay (UPI)</p>
            <p className="text-xs text-muted-foreground mb-4">অন্য ফোন থেকে স্ক্যান করুন</p>
            {qrUrl && (
              <div className="inline-block p-4 bg-white rounded-2xl shadow-sm">
                <img src={qrUrl} alt="UPI QR Code" width={250} height={250} className="rounded-lg" />
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-3">UPI ID: {data.business.upiId}</p>
          </motion.div>
        )}

        {/* Pay Now button — UPI deep link */}
        {!isPaid && data.business.upiId && (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            onClick={handlePayNow}
            className="w-full h-14 rounded-2xl bg-gradient-to-r from-primary to-emerald-700 dark:from-primary dark:to-emerald-900 text-primary-foreground font-bold text-base shadow-lg shadow-primary/30 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
          >
            <Smartphone className="w-5 h-5" />
            এই ফোনে পেমেন্ট করুন
          </motion.button>
        )}

        {!isPaid && !data.business.upiId && (
          <div className="bg-amber-50 dark:bg-amber-950/30 rounded-2xl p-4 text-center">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              এই ব্যবসায়ীর UPI ID সেট করা নেই। সরাসরি যোগাযোগ করুন: {data.business.phone}
            </p>
          </div>
        )}

        {/* Items breakdown */}
        {data.invoice.items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-card rounded-2xl border border-border p-5 shadow-sm"
          >
            <p className="text-sm font-semibold mb-3">Bill Details</p>
            <div className="space-y-2">
              {data.invoice.items.map((it: any) => (
                <div key={it.id} className="flex justify-between text-sm">
                  <span className="flex-1 truncate">{it.name} × {it.quantity}</span>
                  <span className="tabular font-medium">{formatCurrency(it.total, data.business.currency)}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Footer */}
        <div className="text-center pt-4 pb-8">
          <p className="text-xs text-muted-foreground flex items-center justify-center gap-1">
            <Shield className="w-3 h-3" /> Secured by BizLedger
          </p>
          {data.business.phone && (
            <a href={`tel:${data.business.phone}`} className="text-xs text-primary mt-1 inline-block">
              Need help? Call {data.business.phone}
            </a>
          )}
        </div>
      </div>
    </div>
  )
}
