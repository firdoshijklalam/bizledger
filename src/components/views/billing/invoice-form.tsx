'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { useFetch, apiPost } from '@/hooks/use-fetch'
import type { Party, Product } from '@/lib/types'
import { formatCurrency, GRADE_META } from '@/lib/utils'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { useEffect, useState } from 'react'
import { Search, Plus, Trash2, ShoppingCart, Percent, IndianRupee } from 'lucide-react'
import { FullScreenPicker } from '@/components/shared/full-screen-picker'
import { useBillingStore } from '@/store/billing-store'
import { useGateTrigger } from '@/store/biometric-gate-store'
import { useFetch as useFetchHook } from '@/hooks/use-fetch'

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
  const { tabs, activeTabId, updateTab, addTab } = useBillingStore()

  const [customer, setCustomer] = useState<Party | null>(null)
  const [showCustSearch, setShowCustSearch] = useState(false)
  const [items, setItems] = useState<LineItem[]>([])
  const [showProdSearch, setShowProdSearch] = useState(false)
  const [discountMode, setDiscountMode] = useState<'flat' | 'percent'>('flat')
  const [discountValue, setDiscountValue] = useState('0')
  const [isGst, setIsGst] = useState(true)
  const [paymentMode, setPaymentMode] = useState('cash')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      // Load draft from active billing tab if available (PRD Part 3 §2.1)
      const activeTab = tabs.find((t) => t.id === activeTabId)
      if (activeTab?.hasDraft && activeTab.items?.length > 0) {
        setItems(activeTab.items.map((it: any) => ({
          productId: it.productId,
          name: it.name,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          gstRate: it.gstRate,
          discount: it.discount,
          total: it.total,
        })))
        setDiscountMode(activeTab.discountMode || 'flat')
        setDiscountValue(String(activeTab.discountValue || 0))
        setIsGst(activeTab.isGst ?? true)
        setPaymentMode(activeTab.paymentMode || 'cash')
        // Try to find the customer from parties list
        if (activeTab.customerId && parties) {
          const found = parties.find((p) => p.id === activeTab.customerId)
          if (found) setCustomer(found)
        } else {
          setCustomer(null)
        }
      } else {
        setCustomer(null); setItems([]); setDiscountValue('0'); setDiscountMode('flat')
        setIsGst(true); setPaymentMode('cash')
      }
    }
  }, [open, tabs, activeTabId, parties])

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
    setShowProdSearch(false)
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

  // PRD Part 32 §1.2: High-Value Discount gate — fetch gate config
  const triggerGate = useGateTrigger()
  const { data: gateSettings } = useFetchHook<any>('/api/app-settings', [])
  const gateHighValueDiscountEnabled = gateSettings?.gateHighValueDiscount ?? true
  const gateDiscountLimit = gateSettings?.gateDiscountLimit ?? 5000

  const performSave = async () => {
    setSaving(true)
    try {
      const invoice = await apiPost('/api/invoices', {
        partyId: customer?.id,
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
      // Clear the active billing tab on successful save
      const activeTab = tabs.find((tb) => tb.id === activeTabId)
      if (activeTab) {
        updateTab(activeTab.id, {
          hasDraft: false,
          items: [],
          customerId: undefined,
          customerName: undefined,
          discountValue: 0,
        })
      }
    } catch (e) {
      toast.error('Failed: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

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
    // PRD Part 32 §1.2: High-Value Discount gate
    if (gateHighValueDiscountEnabled && discountAmount > gateDiscountLimit) {
      triggerGate(
        'high_value_discount',
        `Discount of ${formatCurrency(discountAmount, currency)} exceeds limit of ${formatCurrency(gateDiscountLimit, currency)}`,
        () => performSave()
      )
      return
    }
    await performSave()
  }

  const handleHold = () => {
    // Save current draft to the active billing tab (PRD v2 §10.6)
    const activeTab = tabs.find((tb) => tb.id === activeTabId)
    if (!activeTab) {
      const newId = addTab()
      if (newId) {
        updateTab(newId, {
          hasDraft: items.length > 0 || !!customer,
          customerId: customer?.id,
          customerName: customer?.name,
          items: items as any,
          discountMode,
          discountValue: Number(discountValue) || 0,
          isGst,
          paymentMode,
        })
      }
    } else {
      updateTab(activeTab.id, {
        hasDraft: items.length > 0 || !!customer,
        customerId: customer?.id,
        customerName: customer?.name,
        items: items as any,
        discountMode,
        discountValue: Number(discountValue) || 0,
        isGst,
        paymentMode,
      })
    }
    toast.success('Bill held — switch tabs to resume later')
    onOpenChange(false)
  }

  const partyItems = (parties || []).map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: p.phone || 'No phone',
    badge: p.qualityGrade,
    badgeClass: `${GRADE_META[p.qualityGrade].bg} ${GRADE_META[p.qualityGrade].color}`,
  }))

  const productItems = (products || []).map((p) => ({
    id: p.id,
    title: p.name,
    subtitle: `Stock: ${p.stock} ${p.unit}`,
    trailing: formatCurrency(p.salePrice, currency),
  }))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md max-h-[92vh] overflow-y-auto scroll-area"
        // When a child picker is open, allow pointer events to pass through to the picker portal
        onPointerDownOutside={(e) => {
          if (showCustSearch || showProdSearch) e.preventDefault()
        }}
        onInteractOutside={(e) => {
          if (showCustSearch || showProdSearch) e.preventDefault()
        }}
        style={showCustSearch || showProdSearch ? { pointerEvents: 'none' } : undefined}
      >
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
                <button onClick={() => setCustomer(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remove customer">
                  <Plus className="w-4 h-4 rotate-45" />
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <button
                  onClick={() => setShowCustSearch(true)}
                  className="flex-1 h-11 rounded-xl border border-dashed border-border flex items-center justify-center gap-2 text-sm text-muted-foreground hover:bg-muted"
                >
                  <Search className="w-4 h-4" /> {t('bill.selectCustomer')}
                </button>
                <button
                  onClick={() => {
                    // Close invoice form and open party form (PRD Part 3 §2.2)
                    onOpenChange(false)
                    useAppStore.getState().setActiveView('khata')
                    useAppStore.getState().setShowPartyForm(true)
                  }}
                  className="w-11 h-11 rounded-xl bg-primary text-primary-foreground flex items-center justify-center shrink-0"
                  aria-label="Add new customer"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            )}
          </div>

          {/* Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label className="text-xs">Items ({items.length})</Label>
            </div>
            {items.length === 0 ? (
              <button
                onClick={() => setShowProdSearch(true)}
                className="w-full p-6 rounded-xl border border-dashed border-border text-center hover:bg-muted transition-colors"
              >
                <ShoppingCart className="w-6 h-6 text-muted-foreground mx-auto mb-2" />
                <p className="text-xs text-muted-foreground">No items added — tap to add</p>
              </button>
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
            {/* Bigger Add Item button (PRD Part 3 §2.3) */}
            <button
              onClick={() => setShowProdSearch(true)}
              className="w-full mt-2 h-12 rounded-xl border-2 border-dashed border-primary/30 text-primary font-medium text-sm flex items-center justify-center gap-2 hover:bg-primary/5 transition-colors"
            >
              <Plus className="w-5 h-5" /> {t('bill.addItem')}
            </button>
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
          <Button variant="secondary" onClick={handleHold} className="h-11">
            Hold
          </Button>
          <Button onClick={handleSave} disabled={saving} className="h-11 flex-1">
            {saving ? 'Saving…' : t('bill.save')}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Customer search picker (portal — escapes Radix focus trap) */}
      <FullScreenPicker
        open={showCustSearch}
        onClose={() => setShowCustSearch(false)}
        onSelect={(item) => {
          const p = (parties || []).find((x) => x.id === item.id)
          if (p) setCustomer(p)
          setShowCustSearch(false)
        }}
        items={partyItems}
        placeholder="Search customer…"
        emptyText="No customers found"
      />

      {/* Product search picker (portal) */}
      <FullScreenPicker
        open={showProdSearch}
        onClose={() => setShowProdSearch(false)}
        onSelect={(item) => {
          const p = (products || []).find((x) => x.id === item.id)
          if (p) addProduct(p)
          setShowProdSearch(false)
        }}
        items={productItems}
        placeholder="Search product…"
        emptyText="No products found"
      />
    </Dialog>
  )
}
