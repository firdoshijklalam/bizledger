'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, User, Package, Receipt, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Party, Product, Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, GRADE_META } from '@/lib/utils'

export function SearchOverlay() {
  const { showSearch, setShowSearch, setActiveView, setSelectedPartyId, setSelectedProductId, setSelectedInvoiceId } = useAppStore()
  const { t } = useI18n()
  const [q, setQ] = useState('')
  const [parties, setParties] = useState<Party[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [txns, setTxns] = useState<Transaction[]>([])

  useEffect(() => {
    if (!showSearch) return
    Promise.all([
      fetch('/api/parties').then((r) => r.json()),
      fetch('/api/products').then((r) => r.json()),
      fetch('/api/invoices').then((r) => r.json()),
      fetch('/api/transactions').then((r) => r.json()),
    ]).then(([p, pr, inv, tx]) => {
      setParties(p || [])
      setProducts(pr || [])
      setInvoices(inv || [])
      setTxns(tx || [])
    })
  }, [showSearch])

  const results = useMemo(() => {
    if (!q.trim()) return { parties: [], products: [], invoices: [], txns: [] }
    const query = q.toLowerCase()
    return {
      parties: parties.filter((p) => p.name.toLowerCase().includes(query) || (p.phone || '').includes(query)).slice(0, 4),
      products: products.filter((p) => p.name.toLowerCase().includes(query) || (p.sku || '').toLowerCase().includes(query)).slice(0, 4),
      invoices: invoices.filter((i) => i.invoiceNumber.toLowerCase().includes(query)).slice(0, 4),
      txns: txns.filter((t) => (t.description || '').toLowerCase().includes(query)).slice(0, 4),
    }
  }, [q, parties, products, invoices, txns])

  const close = () => {
    setQ('')
    setShowSearch(false)
  }

  const openParty = (id: string) => {
    setSelectedPartyId(id)
    setActiveView('khata')
    close()
  }
  const openProduct = (id: string) => {
    setSelectedProductId(id)
    setActiveView('inventory')
    close()
  }
  const openInvoice = (id: string) => {
    setSelectedInvoiceId(id)
    setActiveView('billing')
    close()
  }

  return (
    <AnimatePresence>
      {showSearch && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-background flex flex-col"
        >
          <div className="flex items-center gap-2 p-3 border-b border-border">
            <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 h-11">
              <Search className="w-5 h-5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('header.search')}
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
              />
            </div>
            <button onClick={close} className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-muted" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto scroll-area p-3 space-y-4 max-w-2xl w-full mx-auto">
            {!q.trim() && (
              <p className="text-sm text-muted-foreground text-center py-12">
                {t('header.search')}
              </p>
            )}
            {q.trim() && results.parties.length === 0 && results.products.length === 0 && results.invoices.length === 0 && results.txns.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-12">No results for “{q}”.</p>
            )}

            {results.parties.length > 0 && (
              <Section title="Parties">
                {results.parties.map((p) => {
                  const meta = GRADE_META[p.qualityGrade]
                  return (
                    <button key={p.id} onClick={() => openParty(p.id)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left">
                      <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                        <User className="w-4 h-4 text-emerald-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.phone || 'No phone'}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{p.qualityGrade}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {results.products.length > 0 && (
              <Section title="Products">
                {results.products.map((p) => (
                  <button key={p.id} onClick={() => openProduct(p.id)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                      <Package className="w-4 h-4 text-amber-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{p.name}</p>
                      <p className="text-xs text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                    </div>
                    <span className="text-sm font-semibold tabular">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
              </Section>
            )}

            {results.invoices.length > 0 && (
              <Section title="Invoices">
                {results.invoices.map((i) => (
                  <button key={i.id} onClick={() => openInvoice(i.id)} className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center">
                      <Receipt className="w-4 h-4 text-orange-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{i.invoiceNumber}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(i.createdAt)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular">{formatCurrency(i.grandTotal)}</span>
                  </button>
                ))}
              </Section>
            )}

            {results.txns.length > 0 && (
              <Section title="Transactions">
                {results.txns.map((tx) => (
                  <div key={tx.id} className="w-full flex items-center gap-3 p-3 rounded-xl">
                    <span className="w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center">
                      <ArrowLeftRight className="w-4 h-4 text-teal-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{tx.description || tx.type}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(tx.createdAt)}</p>
                    </div>
                    <span className={`text-sm font-semibold tabular ${tx.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
                      {tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                    </span>
                  </div>
                ))}
              </Section>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">{title}</p>
      <div className="bg-card rounded-2xl border border-border overflow-hidden divide-y divide-border">{children}</div>
    </div>
  )
}
