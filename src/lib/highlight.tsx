'use client'

import React from 'react'

/**
 * §2: Highlight matched substrings in search results (like Truecaller/Google).
 * Wraps the exact matched portion in a <mark> element with red bold styling.
 *
 * Example: highlightMatch("Utsab Rice", "utsab")
 * → <>U<mark>tsab</mark> Rice</>  (wait, it highlights the matched case-insensitive substring)
 * → <><mark>Utsab</mark> Rice</>
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  if (!text || !query || !query.trim()) return text

  const q = query.trim()
  // Escape regex special chars in query
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const regex = new RegExp(`(${escaped})`, 'gi')
  const parts = text.split(regex)

  return parts.map((part, i) => {
    if (part.toLowerCase() === q.toLowerCase()) {
      return (
        <mark
          key={i}
          className="bg-transparent text-red-600 dark:text-red-400 font-bold"
          style={{ background: 'transparent' }}
        >
          {part}
        </mark>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}
