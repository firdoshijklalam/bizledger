'use client'

import { useAppStore } from '@/store/app-store'
import { useI18n } from '@/store/i18n-store'
import { AnimatePresence, motion } from 'framer-motion'
import { Search, X, User, Package, Receipt, ArrowLeftRight } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { Party, Product, Invoice, Transaction } from '@/lib/types'
import { formatCurrency, formatDate, getGradeMeta } from '@/lib/utils'
import {
  searchAll,
  generateAliasesWithSpans,
  type SearchableEntity,
} from '@/lib/search-engine'
import { highlightRanges } from '@/lib/highlight'
import { useVoiceInput } from '@/hooks/use-voice-input'

export function SearchOverlay() {
  const { showSearch, setShowSearch, setActiveView, setSelectedPartyId, setSelectedProductId, setSelectedInvoiceId, setOverlayInvoiceId } = useAppStore()
  const { t } = useI18n()
  const [q, setQ] = useState('')
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
      const partyList = (Array.isArray(p) ? p : (p?.items || []))
      const prodList = (Array.isArray(pr) ? pr : (pr?.items || []))
      const invList = (Array.isArray(inv) ? inv : (inv?.items || []))
      const txList = (Array.isArray(tx) ? tx : (tx?.items || []))
      setParties(partyList)
      setProducts(prodList)
      setInvoices(invList)
      setTxns(txList)
    })
  }, [showSearch])

  // §UNIFIED-SEARCH: One engine handles parties, products, invoices, transactions.
  // Each entity is wrapped in a SearchableEntity carrying its canonical name +
  // pre-computed aliases (so the engine knows which alias maps to which visible
  // span — this is what makes highlight mapping correct).
  const results = useMemo(() => {
    if (!q.trim() || q.trim().length < 2) return null

    // §ENTITY-MAPPERS: Convert each domain entity to a SearchableEntity
    // carrying canonical text + aliases. Aliases are precomputed once per
    // entity so the engine doesn't regenerate them on every keystroke.
    const partyEntities: SearchableEntity<Party>[] = parties.map((p) => {
      const tags = parseTags(p.searchTags)
      const aliases = generateAliasesWithSpans(p.name || '')
      // §MERGE-DB-TAGS: Merge DB-stored searchTags into the alias set
      // (assigning them the FULL visible span, since we don't know which
      // token they correspond to — but DB tags are usually the full name).
      for (const tag of tags) {
        if (!aliases.find((a) => a.normalized === tag.toLowerCase().trim())) {
          aliases.push({
            alias: tag,
            normalized: tag.toLowerCase().trim(),
            visibleSpans: [{ start: 0, end: (p.name || '').length }],
            isFull: true,
          })
        }
      }
      return {
        id: p.id,
        item: p,
        canonical: p.name || '',
        secondary: [p.phone || ''].filter(Boolean),
        aliases,
      }
    })

    const productEntities: SearchableEntity<Product>[] = products.map((p) => {
      const tags = parseTags(p.searchTags)
      const aliases = generateAliasesWithSpans(p.name || '')
      for (const tag of tags) {
        if (!aliases.find((a) => a.normalized === tag.toLowerCase().trim())) {
          aliases.push({
            alias: tag,
            normalized: tag.toLowerCase().trim(),
            visibleSpans: [{ start: 0, end: (p.name || '').length }],
            isFull: true,
          })
        }
      }
      return {
        id: p.id,
        item: p,
        canonical: p.name || '',
        secondary: [p.sku || '', p.category || '', p.subCategory || ''].filter(Boolean),
        aliases,
      }
    })

    const invoiceEntities: SearchableEntity<Invoice>[] = invoices.map((i) => ({
      id: i.id,
      item: i,
      canonical: i.invoiceNumber || '',
      secondary: [i.party?.name || ''].filter(Boolean),
      aliases: generateAliasesWithSpans(i.invoiceNumber || ''),
      partyId: i.partyId || undefined,
      partyName: i.party?.name || undefined,
    }))

    const txnEntities: SearchableEntity<Transaction>[] = txns.map((t) => ({
      id: t.id,
      item: t,
      canonical: t.description || t.type || '',
      secondary: [t.category || '', (t as any).party?.name || ''].filter(Boolean),
      aliases: generateAliasesWithSpans(t.description || t.type || ''),
      partyId: t.partyId || undefined,
      partyName: (t as any).party?.name || undefined,
    }))

    const result = searchAll({
      parties,
      products,
      invoices,
      transactions: txns,
      query: q,
      partyToEntity: (p: Party) => partyEntities.find((e) => e.id === p.id)!,
      productToEntity: (p: Product) => productEntities.find((e) => e.id === p.id)!,
      invoiceToEntity: (i: Invoice) => invoiceEntities.find((e) => e.id === i.id)!,
      txnToEntity: (t: Transaction) => txnEntities.find((e) => e.id === t.id)!,
      maxPerSection: 6,
      maxInvoicesPerParty: 3,
      maxTxnsPerParty: 3,
    })
    return result
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

  const hasAnyResults =
    !!results &&
    (results.parties.length > 0 ||
      results.products.length > 0 ||
      results.invoices.length > 0 ||
      results.transactions.length > 0 ||
      results.relatedInvoices.length > 0 ||
      results.relatedTransactions.length > 0)

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
                placeholder={t('header.search') + '…'}
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
              const active = document.activeElement
              if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) {
                (active as HTMLElement).blur()
              }
            }}
          >
            {!q.trim() && (
              <div className="text-center py-12 space-y-2">
                <p className="text-sm text-muted-foreground">{t('header.search')}</p>
                <p className="text-xs text-muted-foreground/60">Cross-lingual search · Bengali ↔ English</p>
                <p className="text-[11px] text-muted-foreground/50 mt-4">Try: &quot;Utsab&quot; → finds &quot;উৎসব&quot;</p>
              </div>
            )}
            {q.trim() && !hasAnyResults && (
              <p className="text-sm text-muted-foreground text-center py-12">No results for &ldquo;{q}&rdquo;.</p>
            )}

            {/* §PARTIES: Highlight visible canonical name using SearchMatch.highlightRanges */}
            {results && results.parties.length > 0 && (
              <Section title="Parties">
                {results.parties.map((m) => {
                  const p = m.item
                  const meta = getGradeMeta(p.qualityGrade)
                  return (
                    <button
                      key={p.id}
                      onClick={() => openParty(p.id)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                    >
                      <span className="w-9 h-9 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center shrink-0">
                        <User className="w-4 h-4 text-emerald-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightRanges(p.name, m.highlightRanges)}</p>
                        <p className="text-xs text-muted-foreground">{p.phone || 'No phone'}</p>
                      </div>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${meta.bg} ${meta.color} shrink-0`}>{p.qualityGrade}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {/* §PRODUCTS: Same engine, same highlight mapping */}
            {results && results.products.length > 0 && (
              <Section title="Products">
                {results.products.map((m) => {
                  const p = m.item
                  return (
                    <button
                      key={p.id}
                      onClick={() => openProduct(p.id)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                    >
                      <span className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                        <Package className="w-4 h-4 text-amber-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightRanges(p.name, m.highlightRanges)}</p>
                        <p className="text-xs text-muted-foreground">Stock: {p.stock} {p.unit}</p>
                      </div>
                      <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(p.salePrice)}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {/* §INVOICES: Direct invoice matches — show party name + highlight */}
            {results && results.invoices.length > 0 && (
              <Section title="Invoices">
                {results.invoices.map((m) => {
                  const i = m.item
                  const partyName = i.party?.name || 'Walk-in'
                  // §INVOICE-HIGHLIGHT: If matched via party name, highlight the party
                  // name on the invoice row. Otherwise highlight invoiceNumber.
                  const invoiceRanges = m.matchType === 'secondary-field' && m.relatedPartyName
                    ? []
                    : m.highlightRanges
                  const partyRanges = m.matchType === 'secondary-field' ? m.highlightRanges : []
                  return (
                    <button
                      key={i.id}
                      onClick={() => openInvoice(i.id)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                    >
                      <span className="w-9 h-9 rounded-full bg-orange-100 dark:bg-orange-900/30 flex items-center justify-center shrink-0">
                        <Receipt className="w-4 h-4 text-orange-600" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{highlightRanges(i.invoiceNumber, invoiceRanges)}</p>
                        <p className="text-xs text-muted-foreground">
                          {highlightRanges(partyName, partyRanges)} · {formatDate(i.createdAt)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(i.grandTotal)}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {/* §RELATED-INVOICES: Invoices belonging to matched parties (Stage D) */}
            {results && results.relatedInvoices.length > 0 && (
              <Section title="Related Invoices">
                {results.relatedInvoices.map((m, idx) => {
                  const i = m.item
                  const partyName = m.relatedPartyName || i.party?.name || 'Walk-in'
                  const partyRanges = m.relatedPartyHighlightRanges || []
                  return (
                    <button
                      key={`${i.id}-${idx}`}
                      onClick={() => openInvoice(i.id)}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                    >
                      <span className="w-9 h-9 rounded-full bg-orange-50 dark:bg-orange-900/20 flex items-center justify-center shrink-0">
                        <Receipt className="w-4 h-4 text-orange-500" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{i.invoiceNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {highlightRanges(partyName, partyRanges)} · {formatDate(i.createdAt)}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular shrink-0">{formatCurrency(i.grandTotal)}</span>
                    </button>
                  )
                })}
              </Section>
            )}

            {/* §TRANSACTIONS: Direct transaction matches — show party name */}
            {results && results.transactions.length > 0 && (
              <Section title="Transactions">
                {results.transactions.map((m) => {
                  const tx = m.item
                  const partyName = (tx as any).party?.name || m.relatedPartyName || ''
                  const descRanges = m.matchType === 'secondary-field' && partyName ? [] : m.highlightRanges
                  const partyRanges = m.matchType === 'secondary-field' ? m.highlightRanges : []
                  return (
                    <button
                      key={tx.id}
                      onClick={() => {
                        if ((tx as any).invoiceId) {
                          setOverlayInvoiceId((tx as any).invoiceId)
                        } else if (tx.partyId) {
                          setSelectedPartyId(tx.partyId)
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
                        <p className="text-sm font-medium truncate">{highlightRanges(tx.description || tx.type, descRanges)}</p>
                        <p className="text-xs text-muted-foreground">
                          {partyName ? <>{highlightRanges(partyName, partyRanges)} · </> : null}
                          {formatDate(tx.createdAt)}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold tabular shrink-0 ${tx.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </button>
                  )
                })}
              </Section>
            )}

            {/* §RELATED-TRANSACTIONS: Transactions belonging to matched parties */}
            {results && results.relatedTransactions.length > 0 && (
              <Section title="Related Transactions">
                {results.relatedTransactions.map((m, idx) => {
                  const tx = m.item
                  const partyName = m.relatedPartyName || (tx as any).party?.name || ''
                  const partyRanges = m.relatedPartyHighlightRanges || []
                  return (
                    <button
                      key={`${tx.id}-${idx}`}
                      onClick={() => {
                        if ((tx as any).invoiceId) {
                          setOverlayInvoiceId((tx as any).invoiceId)
                        } else if (tx.partyId) {
                          setSelectedPartyId(tx.partyId)
                          setActiveView('khata')
                        }
                        close()
                      }}
                      className="w-full flex items-center gap-3 p-3 hover:bg-muted text-left"
                    >
                      <span className="w-9 h-9 rounded-full bg-teal-50 dark:bg-teal-900/20 flex items-center justify-center shrink-0">
                        <ArrowLeftRight className="w-4 h-4 text-teal-500" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{tx.description || tx.type}</p>
                        <p className="text-xs text-muted-foreground">
                          {partyName ? <>{highlightRanges(partyName, partyRanges)} · </> : null}
                          {formatDate(tx.createdAt)}
                        </p>
                      </div>
                      <span className={`text-sm font-semibold tabular shrink-0 ${tx.type === 'credit' ? 'text-emerald-600' : 'text-red-600'}`}>
                        {tx.type === 'credit' ? '+' : '-'}{formatCurrency(tx.amount)}
                      </span>
                    </button>
                  )
                })}
              </Section>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Parse the searchTags field (string JSON or array) into a string[]. */
function parseTags(raw: any): string[] {
  if (!raw) return []
  try {
    const arr = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!Array.isArray(arr)) return []
    return arr.filter((x) => typeof x === 'string' && x.trim().length >= 2)
  } catch {
    return []
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide px-1 mb-2">{title}</p>
      <div className="bg-card rounded-2xl border border-border overflow-hidden divide-y divide-border">{children}</div>
    </div>
  )
}
