'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Party, Product } from '@/lib/types'
import { formatCurrency } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { Search, X, Plus, Trash2, ShoppingCart, Percent, IndianRupee } from 'lucide-react'
import { GRADE_META } from '@/lib/utils'

interface LineItem {
  productId?: string
  name: string
  quantity: number
  unitPrice: number
  gstRate: number
  discount: number
  total: number
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function InvoiceForm({ open, onOpenChange }: Props) {
  const { business, triggerRefresh, setSelectedInvoiceId, setActiveView } = useAppStore()
  const { t } = useI18n()
  const { data: parties } = useFetch<Party[]>('/api/parties?type=customer', [open])
  const { data: products } = useFetch<Product[]>('/api/products', [open])

  const [customer, setCustomer] = useState<Party | null>(null)
  const [showCustSearch, setShowCustSearch] = useState(false)
  const [custQuery, setCustQuery] = useState('')
  const [items, setItems] = useState<LineItem[]>([])
  const [showProdSearch, setShowProdSearch] = useState(false)
  const [prodQuery, setProdQuery] = useState('')
  const [discountMode, setDiscountMode] = useState<'flat' | 'percent'>('flat')
  const [discountValue, setDiscountValue] = useState('0')
  const [isGst, setIsGst] = useState(true)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setCustomer(null); setItems([]); setDiscountValue('0'); setDiscountMode('flat')
      setIsGst(true); setPaymentMode('cash')
    }
  }, [open])

  const currency = business?.currency || 'INR'

  const subtotal = items.reduce((s, i) => s + i.total, 0)
  const discountAmount =
    discountMode === 'percent'
      ? (subtotal * (Number(discountValue) || 0)) / 100
      : Number(discountValue) || 0
  const taxable = Math.max(0, subtotal - discountAmount)
  const gstAmount = items.reduce((s, i) => s + (i.total * i.gstRate) / 100, 0) * (taxable / Math.max(subtotal, 1))
  const grandTotal = taxable + (isGst ? gstAmount : 0)

  const addProduct = (p: Product) => {
    if (items.some((i) => i.productId === p.id)) {
      toast.error(`${p.name} already added`)
      return
    }
    setItems([
      ...items,
      {
        productId: p.id,
        name: p.name,
        quantity: 1,
        unitPrice: p.salePrice,
        gstRate: isGst ? p.gstRate : 0,
        discount: 0,
        total: p.salePrice,
      },
    ])
    setShowProdSearch(false)
    setProdQuery('')
  }

  const updateItem = (idx: number, patch: Partial<LineItem>) => {
    setItems(items.map((it, i) => {
      if (i !== idx) return it
      const updated = { ...it, ...patch }
      updated.total = updated.quantity * updated.unitPrice - updated.discount
      return updated
    }))
  }

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx))

  const handleSave = async () => {
    if (!customer) {
      toast.error('Select a customer')
      return
    }
    if (items.length === 0) {
      toast.error('Add at least one item')
      return
    }
    if (customer.qualityGrade === 'E') {
      toast.warning('সতর্ক থাকুন — এই কাস্টমারের বকেয়া আছে (Grade E)')
    }
    setSaving(true)
    try {
      const invoice = await apiPost('/api/invoices', {
        partyId: customer.id,
        items: items.map((i) => ({ ...i, gstRate: isGst ? i.gstRate : 0 })),
        discountMode,
        discountValue: Number(discountValue) || 0,
        isGst,
        paymentMode,
        type: paymentMode === 'credit' ? 'sales' : 'retail',
        amountPaid: paymentMode === 'credit' ? 0 : grandTotal,
      })
      toast.success(t('bill.saved'))
      triggerRefresh()
      onOpenChange(false)
      setSelectedInvoiceId(invoice.id)
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  const filteredParties = (parties || []).filter((p) =>
    p.name.toLowerCase().includes(custQuery.toLowerCase()) || (p.phone || '').includes(custQuery)
  )
  const filteredProducts = (products || []).filter((p) =>
    p.name.toLowerCase().includes(prodQuery.toLowerCase()) || (p.sku || '').toLowerCase().includes(prodQuery)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[92vh] overflow-y-auto scroll-area">
        <DialogHeader>
          <DialogTitle>{t('bill.newInvoice')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Customer select */}
          <div>
            <Label className="text-xs mb-1.5 block">{t('bill.customer')}</Label>
            {customer ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-muted">
                <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold">
                  {customer.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium truncate">{customer.name}</p>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${GRADE_META[customer.qualityGrade].bg} ${GRADE_META[customer.qualityGrade].color}`}>
                      {customer.qualityGrade}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">{customer.phone || 'No phone'}</p>
                </div>
                <button onClick={() => setCustomer(null)} className="text-muted-foreground hover:text-foreground">
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowCustSearch(true)}
                className="w-full h-11 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted"
              >
                <Search className="w-4 h-4" /> {t('bill.selectCustomer')}
              </button>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Items ({items.length})</Label>
              <button
                onClick={() => setShowProdSearch(true)}
                className="text-xs text-primary font-medium flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> {t('bill.addItem')}
              </button>
            </div>
            {items.length === 0 ? (
              <div className="p-6 rounded-xl border border-dashed border-border text-center">
                <ShoppingCart className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No items added</p>
              </div>
            ) : (
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="p-3 rounded-xl bg-muted/50 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium truncate flex-1">{it.name}</p>
                      <button onClick={() => removeItem(idx)} className="text-red-500 hover:text-red-700">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Qty</Label>
                        <Input
                          value={String(it.quantity)}
                          onChange={(e) => updateItem(idx, { quantity: Number(e.target.value) || 0 })}
                          className="h-9 text-sm tabular"
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Price ₹</Label>
                        <Input
                          value={String(it.unitPrice)}
                          onChange={(e) => updateItem(idx, { unitPrice: Number(e.target.value) || 0 })}
                          className="h-9 text-sm tabular"
                          inputMode="numeric"
                        />
                      </div>
                      <div>
                        <Label className="text-[10px] text-muted-foreground">Total ₹</Label>
                        <div className="h-9 flex items-center text-sm font-semibold tabular">{formatCurrency(it.total, currency)}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discount */}
          <div className="space-y-2">
            <Label className="text-xs">{t('bill.discount')}</Label>
            <div className="flex gap-2">
              <div className="grid grid-cols-2 gap-1 w-28">
                <button
                  onClick={() => setDiscountMode('percent')}
                  className={`py-2 rounded-lg text-xs font-bold min-h-[40px] flex items-center justify-center gap-1 ${
                    discountMode === 'percent' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <Percent className="w-3 h-3" /> {t('bill.percent')}
                </button>
                <button
                  onClick={() => setDiscountMode('flat')}
                  className={`py-2 rounded-lg text-xs font-bold min-h-[40px] flex items-center justify-center gap-1 ${
                    discountMode === 'flat' ? 'bg-primary text-primary-foreground' : 'bg-muted'
                  }`}
                >
                  <IndianRupee className="w-3 h-3" /> {t('bill.flat')}
                </button>
              </div>
              <Input
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="h-11 flex-1 tabular"
                inputMode="numeric"
                placeholder="0"
              />
            </div>
          </div>

          {/* GST toggle + payment mode */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs mb-1.5 block">GST</Label>
              <button
                onClick={() => setIsGst(!isGst)}
                className={`w-full h-11 rounded-xl text-sm font-medium ${
                  isGst ? 'bg-primary text-primary-foreground' : 'bg-muted'
                }`}
              >
                {isGst ? 'GST Included' : 'No GST'}
              </button>
            </div>
            <div>
              <Label className="text-xs mb-1.5 block">Payment</Label>
              <select
                value={paymentMode}
                onChange={(e) => setPaymentMode(e.target.value)}
                className="w-full h-11 rounded-xl bg-muted px-3 text-sm border-0 outline-none"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="credit">Credit (Khata)</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          {/* Totals */}
          <div className="p-3 rounded-xl bg-muted space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('bill.subtotal')}</span>
              <span className="tabular">{formatCurrency(subtotal, currency)}</span>
            </div>
            {discountAmount > 0 && (
              <div className="flex justify-between text-red-600">
                <span>{t('bill.discount')}</span>
                <span className="tabular">-{formatCurrency(discountAmount, currency)}</span>
              </div>
            )}
            {isGst && gstAmount > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">{t('bill.gst')}</span>
                <span className="tabular">{formatCurrency(gstAmount, currency)}</span>
              </div>
            )}
            <div className="flex justify-between pt-1.5 border-t border-border">
              <span className="font-semibold">{t('bill.grandTotal')}</span>
              <span className="font-bold tabular text-primary">{formatCurrency(grandTotal, currency)}</span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('bill.save')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Customer search modal */}
      {showCustSearch && (
        <div className="fixed inset-0 z-[60] bg-background flex flex-col">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 h-11">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                autoFocus
                value={custQuery}
                onChange={(e) => setCustQuery(e.target.value)}
                placeholder="Search customer…"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            <button onClick={() => setShowCustSearch(false)} className="w-11 h-11 flex items-center justify-center">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filteredParties.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No customers found</p>
            ) : (
              filteredParties.map((p) => (
                <button
                  key={p.id}
                  onClick={() => { setCustomer(p); setShowCustSearch(false); setCustQuery('') }}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left"
                >
                  <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold">
                    {p.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">{p.phone || 'No phone'}</p>
                  </div>
                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${GRADE_META[p.qualityGrade].bg} ${GRADE_META[p.qualityGrade].color}`}>
                    {p.qualityGrade}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      {/* Product search modal */}
      {showProdSearch && (
        <div className="fixed inset-0 z-[60] bg-background flex flex-col">
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 h-11">
              <Search className="w-5 h-5 text-muted-foreground" />
              <input
                autoFocus
                value={prodQuery}
                onChange={(e) => setProdQuery(e.target.value)}
                placeholder="Search product…"
                className="flex-1 bg-transparent outline-none text-sm"
              />
            </div>
            <button onClick={() => setShowProdSearch(false)} className="w-11 h-11 flex items-center justify-center">
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-1">
            {filteredProducts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">No products found</p>
            ) : (
              filteredProducts.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left"
                >
                  <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                    <Plus className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{p.name}</p>
                    <p className="text-[11px] text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                  </div>
                  <span className="text-sm font-semibold tabular">{formatCurrency(p.salePrice, currency)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </Dialog>
  )
}
