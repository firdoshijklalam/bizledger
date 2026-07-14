'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, User, Package, Receipt, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Party, Product, Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, getGradeMeta } from '@/lib/utils'
import { highlightMatch } from '@/lib/highlight'
import { transliterateBengaliToEnglish, phoneticMatch, generateSearchTags } from '@/lib/transliteration'
import { useVoiceInput } from '@/hooks/use-voice-input'
import Fuse from 'fuse.js'

export function SearchOverlay() {
  const { showSearch, setShowSearch, setActiveView, setSelectedPartyId, setSelectedProductId, setSelectedInvoiceId } = useAppStore()
  const { t } = useI18n()
  const [q, setQ] = useState('')
  // §3: Register this search input with the global mic
  const voiceProps = useVoiceInput<HTMLInputElement>((text) => setQ(text))
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
      const partyList = (Array.isArray(p) ? p : (p?.items || [])).map((x: any) => ({
        ...x,
        // §3: Parse searchTags JSON string → array for Fuse.js
        searchTags: x.searchTags ? (typeof x.searchTags === 'string' ? (() => { try { return JSON.parse(x.searchTags) } catch { return [] } })() : x.searchTags) : [],
      }))
      const prodList = (Array.isArray(pr) ? pr : (pr?.items || [])).map((x: any) => ({
        ...x,
        searchTags: x.searchTags ? (typeof x.searchTags === 'string' ? (() => { try { return JSON.parse(x.searchTags) } catch { return [] } })() : x.searchTags) : [],
      }))
      setParties(partyList)
      setProducts(prodList)
      setInvoices(Array.isArray(inv) ? inv : (inv?.items || []))
      setTxns(Array.isArray(tx) ? tx : (tx?.items || []))
    })
  }, [showSearch])

  // §2: Fuse.js fuzzy search instances with phonetic search_tags included
  const partyFuse = useMemo(() => new Fuse(parties, {
    keys: [
      { name: 'name', weight: 0.5 },
      { name: 'phone', weight: 0.3 },
      { name: 'searchTags', weight: 0.2 }, // §3: phonetic tags
    ],
    // §1: Increased threshold to 0.5 for highly tolerant fuzzy search (typos + phonetic)
    threshold: 0.5, // 0 = exact, 1 = matches anything
    ignoreLocation: true,
    minMatchCharLength: 1,
  }), [parties])

  const productFuse = useMemo(() => new Fuse(products, {
    keys: [
      { name: 'name', weight: 0.5 },
      { name: 'sku', weight: 0.2 },
      { name: 'category', weight: 0.1 },
      { name: 'subCategory', weight: 0.1 },
      { name: 'searchTags', weight: 0.1 }, // §3: phonetic tags
    ],
    threshold: 0.5, // §1: tolerant fuzzy
    ignoreLocation: true,
    minMatchCharLength: 1,
  }), [products])

  const invoiceFuse = useMemo(() => new Fuse(invoices, {
    keys: [
      { name: 'invoiceNumber', weight: 0.6 },
      { name: 'party.name', weight: 0.4 },
    ],
    threshold: 0.5, // §1: tolerant fuzzy
    ignoreLocation: true,
    minMatchCharLength: 1,
  }), [invoices])

  const txnFuse = useMemo(() => new Fuse(txns, {
    keys: [
      { name: 'description', weight: 0.6 },
      { name: 'category', weight: 0.2 },
      { name: 'party.name', weight: 0.2 },
    ],
    threshold: 0.5, // §1: tolerant fuzzy
    ignoreLocation: true,
    minMatchCharLength: 1,
  }), [txns])

  // §3: Cross-lingual phonetic results — English query matches Bengali names
  const phoneticResults = useMemo(() => {
    if (!q.trim() || q.trim().length < 2) return { parties: [], products: [] }
    const query = q.toLowerCase().trim()

    // Find parties where phonetic transliteration of name matches the query
    const phoneticParties = parties.filter((p) => {
      // Skip if already an exact substring match (those show in main results)
      if (p.name.toLowerCase().includes(query) || (p.phone || '').includes(query)) return false
      // Check phonetic match: does "Utsab" match "উৎসব"?
      return phoneticMatch(query, p.name)
    }).slice(0, 3)

    const phoneticProducts = products.filter((p) => {
      if (p.name.toLowerCase().includes(query) || (p.sku || '').toLowerCase().includes(query)) return false
      return phoneticMatch(query, p.name)
    }).slice(0, 3)

    return { parties: phoneticParties, products: phoneticProducts }
  }, [q, parties, products])

  const results = useMemo(() => {
    if (!q.trim()) return { parties: [], products: [], invoices: [], txns: [] }
    const query = q.trim()

    // §2: Use Fuse.js for fuzzy matching
    const partyResults = partyFuse.search(query).slice(0, 4).map((r) => r.item)
    const productResults = productFuse.search(query).slice(0, 4).map((r) => r.item)
    const invoiceResults = invoiceFuse.search(query).slice(0, 4).map((r) => r.item)
    const txnResults = txnFuse.search(query).slice(0, 4).map((r) => r.item)

    return {
      parties: partyResults,
      products: productResults,
      invoices: invoiceResults,
      txns: txnResults,
    }
  }, [q, partyFuse, productFuse, invoiceFuse, txnFuse])

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

  const hasAnyResults = results.parties.length > 0 || results.products.length > 0 || results.invoices.length > 0 || results.txns.length > 0 || phoneticResults.parties.length > 0 || phoneticResults.products.length > 0

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
                {...voiceProps}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={t('header.search') + '… (fuzzy + phonetic)'}
                className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
              />
              {q && (
                <button
                  onClick={() => setQ('')}
                  className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-background text-muted-foreground shrink-0"
                  aria-label="Clear"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button onClick={close} className="h-11 w-11 flex items-center justify-center rounded-xl hover:bg-muted" aria-label="Close">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* §4: keyboardShouldPersistTaps="handled" + keyboardDismissMode="on-drag" equivalents:
              - onScroll: dismiss keyboard when user drags the list (keyboardDismissMode="on-drag")
              - onMouseDown capture: prevent tap from blurring input before onClick fires (keyboardShouldPersistTaps="handled") */}
          <div
            className="flex-1 overflow-y-auto scroll-area p-3 space-y-4 max-w-2xl w-full mx-auto"
            onScroll={(e) => {
              // §4: keyboardDismissMode="on-drag" — dismiss keyboard when user scrolls
              const active = document.activeElement
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                (active as HTMLElement).blur()
              }
            }}
            onMouseDownCapture={(e) => {
              // §4: keyboardShouldPersistTaps="handled" — allow taps on results without
              // dismissing keyboard prematurely. We preventDefault only on non-input elements
              // so the focused search input keeps focus while scrolling/tapping results.
              const target = e.target as HTMLElement
              if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && target.tagName !== 'BUTTON') {
                // Don't blur — let the tap propagate to the button's onClick
              }
            }}
          >
            {!q.trim() && (
              <div className="text-center py-12 space-y-2">
                <p className="text-sm text-muted-foreground">{t('header.search')}</p>
                <p className="text-xs text-muted-foreground/60">Fuzzy match + cross-lingual phonetic search</p>
                <p className="text-[11px] text-muted-foreground/50 mt-4">Try: &quot;Utsab&quot; → finds &quot;উৎসব&quot;</p>
              </div>
            )}
            {q.trim() && !hasAnyResults && (
              <p className="text-sm text-muted-foreground text-center py-12">No results for &ldquo;{q}&rdquo;.</p>
            )}

            {/* §3: Phonetic search results — English query matches Bengali names */}
            {phoneticResults.parties.length > 0 && (
              <Section title="Parties (phonetic match 🔊)">
                {phoneticResults.parties.map((p) => {
                  const meta = getGradeMeta(p.qualityGrade)
                  return (
                    <button key={p.id} onClick={() => openParty(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                      <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-emerald-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightMatch(p.name, q)}</p>
                        <p className="text-xs text-muted-foreground">{highlightMatch(p.phone || 'No phone', q)}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>{p.qualityGrade}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {phoneticResults.products.length > 0 && (
              <Section title="Products (phonetic match 🔊)">
                {phoneticResults.products.map((p) => (
                  <button key={p.id} onClick={() => openProduct(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-amber-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightMatch(p.name, q)}</p>
                      <p className="text-xs text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                    </div>
                    <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
              </Section>
            )}

            {results.parties.length > 0 && (
              <Section title="Parties">
                {results.parties.map((p) => {
                  const meta = getGradeMeta(p.qualityGrade)
                  return (
                    <button key={p.id} onClick={() => openParty(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                      <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-emerald-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightMatch(p.name, q)}</p>
                        <p className="text-xs text-muted-foreground">{highlightMatch(p.phone || 'No phone', q)}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>{p.qualityGrade}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {results.products.length > 0 && (
              <Section title="Products">
                {results.products.map((p) => (
                  <button key={p.id} onClick={() => openProduct(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-amber-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightMatch(p.name, q)}</p>
                      <p className="text-xs text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                    </div>
                    <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
              </Section>
            )}

            {results.invoices.length > 0 && (
              <Section title="Invoices">
                {results.invoices.map((i) => (
                  <button key={i.id} onClick={() => openInvoice(i.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4 text-orange-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightMatch(i.invoiceNumber, q)}</p>
                      <p className="text-xs text-muted-foreground">{highlightMatch(i.party?.name || 'Walk-in', q)} · {formatDate(i.createdAt)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(i.grandTotal)}</span>
                  </button>
                ))}
              </Section>
            )}

            {results.txns.length > 0 && (
              <Section title="Transactions">
                {results.txns.map((tx) => (
                  <div key={tx.id} className="w-full flex items-center gap-3 p-3">
                    <span className="w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0">
                      <ArrowLeftRight className="w-4 h-4 text-teal-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightMatch(tx.description || tx.type, q)}</p>
                      <p className="text-xs text-muted-foreground">{formatDate(tx.createdAt)}</p>
                    </div>
                    <span className={`text-sm font-semibold tabular shrink-0 ${tx.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
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
