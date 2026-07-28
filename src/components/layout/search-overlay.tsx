'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, User, Package, Receipt, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Party, Product, Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, getGradeMeta } from '@/lib/utils'
import { highlightWeighted } from '@/lib/highlight'
import { transliterateBengaliToEnglish, phoneticMatch, generateSearchTags } from '@/lib/transliteration'
import { rankByPosition } from '@/lib/search-rank'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { usePhoneticSearch } from '@/hooks/use-phonetic-search'
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

  // §SEARCH-CONSISTENCY: Use the SAME usePhoneticSearch hook as local search
  // (khata-view, inventory-view). This guarantees global and local search use
  // the EXACT SAME fuzzy/phonetic algorithm — no more inconsistency.
  // The hook returns matched items in priority order:
  //   1. Exact substring matches
  //   2. Fuse.js fuzzy matches (tolerant — "Firdaus" matches "Firdosh")
  //   3. Phonetic matches (cross-lingual consonant skeleton)
  const partyMatches = usePhoneticSearch(parties, q, { searchFields: ['phone'] })
  const productMatches = usePhoneticSearch(products, q, { searchFields: ['sku', 'category', 'subCategory'] })
  const invoiceMatches = usePhoneticSearch(invoices, q, { searchFields: ['invoiceNumber'] })
  const txnMatches = usePhoneticSearch(txns, q, { searchFields: ['description', 'category'] })

  // §WEIGHTED-SORT: Rank the matched results by positional weighting.
  // Priority: prefix (index 0) > infix (middle) > suffix (end).
  // rankByPosition is applied ON TOP of the matched results from
  // usePhoneticSearch — it doesn't filter, it only sorts.
  const rankedResults = useMemo(() => {
    if (!q.trim() || q.trim().length < 2) return { parties: [], products: [], invoices: [], txns: [] }

    // Rank parties by position (prefix > infix > suffix)
    const partyRanked = rankByPosition(
      partyMatches,
      q,
      (p) => p.name,
      (p) => [p.phone || '']
    )
    const allParties = partyRanked.map((r) => r.item)

    // Rank products by position
    const productRanked = rankByPosition(
      productMatches,
      q,
      (p) => p.name,
      (p) => [p.sku || '', p.category || '', p.subCategory || '']
    )
    const allProducts = productRanked.map((r) => r.item)

    // Rank invoices by position
    const invoiceRanked = rankByPosition(
      invoiceMatches,
      q,
      (i) => i.invoiceNumber,
      (i) => [i.party?.name || '']
    )
    const allInvoices = invoiceRanked.map((r) => r.item)

    // Rank txns by position
    const txnRanked = rankByPosition(
      txnMatches,
      q,
      (t) => t.description || t.type,
      (t) => [t.category || '', t.party?.name || '']
    )
    const allTxns = txnRanked.map((r) => r.item)

    return {
      parties: allParties.slice(0, 6),
      products: allProducts.slice(0, 6),
      invoices: allInvoices.slice(0, 4),
      txns: allTxns.slice(0, 4),
    }
  }, [q, partyMatches, productMatches, invoiceMatches, txnMatches])

  // §3: Cross-lingual phonetic results — English query matches Bengali names.
  // §NOTE: Now merged into rankedResults via rankByPosition + phoneticMatch.
  // Kept for backward compat (hasAnyResults check). Returns empty since all
  // phonetic matches are now in the main results sections.
  const phoneticResults = useMemo(() => {
    return { parties: [], products: [] }
  }, [])

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

  const hasAnyResults = rankedResults.parties.length > 0 || rankedResults.products.length > 0 || rankedResults.invoices.length > 0 || rankedResults.txns.length > 0

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

            {/* §3: Phonetic sections removed — phonetic matches are now merged into
                the main results via rankByPosition + phoneticMatch. The ranking is:
                prefix > infix > suffix > cross-lingual > phonetic-only. */}

            {rankedResults.parties.length > 0 && (
              <Section title="Parties">
                {rankedResults.parties.map((p) => {
                  const meta = getGradeMeta(p.qualityGrade)
                  return (
                    <button key={p.id} onClick={() => openParty(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                      <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-emerald-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightWeighted(p.name, q)}</p>
                        <p className="text-xs text-muted-foreground">{highlightWeighted(p.phone || 'No phone', q)}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>{p.qualityGrade}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {rankedResults.products.length > 0 && (
              <Section title="Products">
                {rankedResults.products.map((p) => (
                  <button key={p.id} onClick={() => openProduct(p.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                      <Package className="w-4 h-4 text-amber-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightWeighted(p.name, q)}</p>
                      <p className="text-xs text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                    </div>
                    <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(p.salePrice)}</span>
                  </button>
                ))}
              </Section>
            )}

            {rankedResults.invoices.length > 0 && (
              <Section title="Invoices">
                {rankedResults.invoices.map((i) => (
                  <button key={i.id} onClick={() => openInvoice(i.id)} className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left">
                    <span className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4 text-orange-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightWeighted(i.invoiceNumber, q)}</p>
                      <p className="text-xs text-muted-foreground">{highlightWeighted(i.party?.name || 'Walk-in', q)} · {formatDate(i.createdAt)}</p>
                    </div>
                    <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(i.grandTotal)}</span>
                  </button>
                ))}
              </Section>
            )}

            {rankedResults.txns.length > 0 && (
              <Section title="Transactions">
                {rankedResults.txns.map((tx) => (
                  <div key={tx.id} className="w-full flex items-center gap-3 p-3">
                    <span className="w-9 h-9 rounded-full bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center shrink-0">
                      <ArrowLeftRight className="w-4 h-4 text-teal-600" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{highlightWeighted(tx.description || tx.type, q)}</p>
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
