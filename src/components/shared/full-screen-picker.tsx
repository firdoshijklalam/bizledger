'use client'

import { createPortal } from 'react-dom'
import { Search, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface PickerItem {
  id: string
  title: string
  subtitle?: string
  badge?: string
  badgeClass?: string
  trailing?: string
  iconColor?: string
  iconBg?: string
}

interface Props {
  open: boolean
  onClose: () => void
  onSelect: (item: PickerItem) => void
  items: PickerItem[]
  placeholder?: string
  emptyText?: string
}

export function FullScreenPicker({ open, onClose, onSelect, items, placeholder = 'Search…', emptyText = 'No results' }: Props) {
  const [query, setQuery] = useState('')
  const [prevOpen, setPrevOpen] = useState(false)
  // Reset query when opening (render-time adjustment, not in-effect setState)
  if (open && !prevOpen) {
    setPrevOpen(true)
    setQuery('')
  } else if (!open && prevOpen) {
    setPrevOpen(false)
  }
  const inputRef = useRef<HTMLInputElement>(null)

  // When open, disable pointer events on all Radix overlay siblings so clicks land on us
  useEffect(() => {
    if (!open) return
    // Find Radix dialog overlays/content in the body and disable pointer events
    const radixElements = document.querySelectorAll('[data-radix-popper-content-wrapper], [role="dialog"][data-state="open"], .vaul-drawer')
    const hidden: HTMLElement[] = []
    radixElements.forEach((el) => {
      const htmlEl = el as HTMLElement
      if (htmlEl.style.pointerEvents !== 'none') {
        hidden.push(htmlEl)
        htmlEl.style.pointerEvents = 'none'
      }
    })
    return () => {
      hidden.forEach((el) => { el.style.pointerEvents = '' })
    }
  }, [open])

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        inputRef.current?.focus()
      }, 50)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  const q = query.toLowerCase()
  const filtered = q
    ? items.filter((i) => i.title.toLowerCase().includes(q) || (i.subtitle || '').toLowerCase().includes(q))
    : items

  return createPortal(
    <div
      className="fixed inset-0 z-[100] bg-background flex flex-col"
      style={{ pointerEvents: 'auto' }}
      // Stop propagation so clicks inside don't bubble to Radix
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
    >
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
      <div className="flex-1 overflow-y-auto scroll-area p-3 space-y-1">
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">{emptyText}</p>
        ) : (
          filtered.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-muted active:bg-accent text-left transition-colors min-h-[56px]"
            >
              <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center font-bold shrink-0 text-emerald-600">
                {item.title.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{item.title}</p>
                {item.subtitle && <p className="text-[11px] text-muted-foreground truncate">{item.subtitle}</p>}
              </div>
              {item.badge && (
                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${item.badgeClass || 'bg-muted'}`}>
                  {item.badge}
                </span>
              )}
              {item.trailing && <span className="text-sm font-semibold tabular shrink-0">{item.trailing}</span>}
            </button>
          ))
        )}
      </div>
    </div>,
    document.body
  )
}

