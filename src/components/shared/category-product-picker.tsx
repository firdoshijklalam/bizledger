'use client'

import { createPortal } from 'react-dom'
import { Search, X, ChevronRight, Package } from 'lucide-react'
import { useEffect, useRef, useState, useMemo } from 'react'
import { formatCurrency } from '@/lib/utils'

interface ProductItem {
  id: string
  name: string
  subtitle?: string
  trailing?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (item: ProductItem) => void
  items: ProductItem[]
  categories: string[]
  placeholder?: string
  emptyText?: string
}

/**
 * Category-based hybrid product selection (PRD Part 3 §2.4).
 * Shows categories first, then products within selected category.
 * Search overrides category flow — typing finds any product directly.
 */
export function CategoryProductPicker({ open, onClose, onSelect, items, categories, placeholder = 'Search…', emptyText = 'No results' }: Props) {
  const [query, setQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [prevOpen, setPrevOpen] = useState(false)
  // Reset on open
  if (open && !prevOpen) {
    setPrevOpen(true)
    setQuery('')
    setSelectedCategory(null)
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open && selectedCategory === null) {
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open, selectedCategory])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  // Filter items by category — items have category in subtitle like "Electronics · Stock: 240 pcs"
  const categoryItems = items.filter((i) => {
    if (!selectedCategory) return false
    return (i.subtitle || '').toLowerCase().includes(selectedCategory.toLowerCase())
  })

  // Search results override category flow
  const searchResults = query.trim()
    ? items.filter((i) => i.name.toLowerCase().includes(query.toLowerCase()) || (i.subtitle || '').toLowerCase().includes(query.toLowerCase()))
    : []

  const handleSelect = (item: ProductItem) => {
    onSelect(item)
    setQuery('')
    setSelectedCategory(null)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      style={{ pointerEvents: 'auto' }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
      {/* Search bar — always visible */}
      <div className="flex items-center gap-2 p-3 border-b border-border">
        <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 h-11">
          <Search className="w-5 h-5 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
        </div>
        <button onClick={onClose} className="w-11 h-11 flex items-center justify-center rounded-xl hover:bg-muted shrink-0" aria-label="Close">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto scroll-area p-3">
        {/* Search results override category flow */}
        {query.trim() ? (
          <div className="space-y-1">
            <p className="text-xs font-semibold text-muted-foreground uppercase px-1 mb-2">Search Results ({searchResults.length})</p>
            {searchResults.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">{emptyText}</p>
            ) : (
              searchResults.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted active:bg-accent text-left transition-colors min-h-[56px]"
                >
                  <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.subtitle && <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>}
                  </div>
                  {item.trailing && <span className="text-sm font-semibold tabular shrink-0">{item.trailing}</span>}
                </button>
              ))
            )}
          </div>
        ) : selectedCategory === null ? (
          /* Category list — shown first */
          <div className="space-y-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase px-1 mb-2">Select Category</p>
            {categories.map((cat) => {
              const count = items.filter((i) => (i.subtitle || '').includes(cat) || i.name.toLowerCase().includes(cat.toLowerCase())).length
              return (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className="w-full flex items-center gap-3 p-4 rounded-xl bg-card border border-border hover:bg-muted transition-colors text-left min-h-[56px]"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                    <Package className="w-5 h-5 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold">{cat}</p>
                    <p className="text-[11px] text-muted-foreground">{count} product{count !== 1 ? 's' : ''}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </button>
              )
            })}
          </div>
        ) : (
          /* Products within selected category */
          <div className="space-y-1">
            <button
              onClick={() => setSelectedCategory(null)}
              className="text-xs text-primary font-medium flex items-center gap-1 mb-2 px-1"
            >
              ← All Categories
            </button>
            <p className="text-xs font-semibold text-muted-foreground uppercase mb-2">{selectedCategory}</p>
            {categoryItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-12">No products in this category</p>
            ) : (
              categoryItems.map((item) => (
                <button
                  key={item.id}
                  onClick={() => handleSelect(item)}
                  className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted active:bg-accent text-left transition-colors min-h-[56px]"
                >
                  <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center shrink-0">
                    <Package className="w-4 h-4 text-amber-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.name}</p>
                    {item.subtitle && <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>}
                  </div>
                  {item.trailing && <span className="text-sm font-semibold tabular shrink-0">{item.trailing}</span>}
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
