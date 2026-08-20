'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, User, Package, Receipt, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Party, Product, Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, getGradeMeta } from '@/lib/utils'
import { highlightWeighted } from '@/lib/highlight'
import { rankByPosition } from '@/lib/search-rank'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { generateSearchTags } from '@/lib/transliteration'

export function SearchOverlay() {
  const { showSearch, setShowSearch, setActiveView, setSelectedPartyId, setSelectedProductId, setSelectedInvoiceId, setOverlayInvoiceId } = useAppStore()
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
      // §AUTO-TAGS: For items with empty searchTags, generate them on the fly.
      // Many production parties/products were created before the searchTags
      // feature was added — they have empty tags. We generate tags here
      // using the same generateSearchTags function that the API uses on create.
      const ensureTags = (x: any) => {
        let tags: string[] = []
        if (x.searchTags) {
          try {
            tags = typeof x.searchTags === 'string' ? JSON.parse(x.searchTags) : x.searchTags
            if (!Array.isArray(tags)) tags = []
          } catch { tags = [] }
        }
        // If tags are empty, generate them from the name
        if (tags.length === 0 && x.name) {
          tags = generateSearchTags(x.name)
        }
        return { ...x, searchTags: tags }
      }
      const partyList = (Array.isArray(p) ? p : (p?.items || [])).map(ensureTags)
      const prodList = (Array.isArray(pr) ? pr : (pr?.items || [])).map(ensureTags)
      setParties(partyList)
      setProducts(prodList)
      setInvoices(Array.isArray(inv) ? inv : (inv?.items || []))
      setTxns(Array.isArray(tx) ? tx : (tx?.items || []))
    })
  }, [showSearch])

  // §DETERMINISTIC-SEARCH: Single-stage search using rankByPosition directly.
  // No Fuse.js, no usePhoneticSearch — these caused false positives.
  // rankByPosition handles: exact match, Bengali variant match, cross-lingual,
  // token match, searchTag match, and secondary field match.
  // Fuzzy matching does NOT create candidates — only deterministic matches do.
  const rankedResults = useMemo(() => {
    if (!q.trim() || q.trim().length < 2) return { parties: [], products: [], invoices: [], txns: [] }

    // Rank ALL parties — searchTags included as secondary fields
    const partyRanked = rankByPosition(
      parties,
      q,
      (p) => p.name,
      (p) => {
        const tags = Array.isArray(p.searchTags) ? p.searchTags : []
        return [p.phone || '', ...tags.map((t: string) => t)]
      }
    )
    const allParties = partyRanked.map((r) => r.item)

    // Rank ALL products — searchTags included for cross-lingual (e.g. সিমেন্ট → cement)
    const productRanked = rankByPosition(
      products,
      q,
      (p) => p.name,
      (p) => {
        const tags = Array.isArray(p.searchTags) ? p.searchTags : []
        return [p.sku || '', p.category || '', p.subCategory || '', ...tags.map((t: string) => t)]
      }
    )
    const allProducts = productRanked.map((r) => r.item)

    // Rank ALL invoices — search invoiceNumber + party.name
    const invoiceRanked = rankByPosition(
      invoices,
      q,
      (i) => i.invoiceNumber,
      (i) => [i.party?.name || '']
    )
    const allInvoices = invoiceRanked.map((r) => r.item)

    // Rank ALL transactions — search description + category + party.name
    const txnRanked = rankByPosition(
      txns,
      q,
      (t) => t.description || t.type,
      (t) => [t.category || '', (t as any).party?.name || '']
    )
    const allTxns = txnRanked.map((r) => r.item)

    return {
      parties: allParties.slice(0, 6),
      products: allProducts.slice(0, 6),
      invoices: allInvoices.slice(0, 4),
      txns: allTxns.slice(0, 4),
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

          <div
            className="flex-1 overflow-y-auto scroll-area p-3 space-y-4 max-w-2xl w-full mx-auto"
            onScroll={() => {
              // §4: keyboardDismissMode="on-drag" — dismiss keyboard when user scrolls
              const active = document.activeElement
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                (active as HTMLElement).blur()
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
                  <button
                    key={tx.id}
                    onClick={() => {
                      // §CLICKABLE: If the transaction has a linked invoice, open it.
                      // Otherwise, navigate to the party's khata if we have a partyId.
                      if ((tx as any).invoiceId) {
                        setOverlayInvoiceId((tx as any).invoiceId)
                      } else if ((tx as any).partyId) {
                        setSelectedPartyId((tx as any).partyId)
                        setActiveView('khata')
                      }
                      close()
                    }}
                    className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                  >
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
                  </button>
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
