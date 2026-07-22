'use client'

import React from 'react'

/**
 * §FUZZY-HIGHLIGHT: Highlight matched characters in search results.
 *
 * Two modes:
 * 1. Exact substring highlight (for .includes() matches):
 *    highlightMatch("Firdosh", "Fi") → <mark>Fi</mark>rdosh
 *    highlightMatch("Firdosh", "dos") → Fir<mark>dos</mark>h
 *
 * 2. Fuzzy character-level highlight (for Fuse.js matches):
 *    highlightFuzzy("Firdosh", [0,1]) → <mark>Fi</mark>rdosh  (positions 0-1)
 *    highlightFuzzy("Firdosh", [3,5]) → Fir<mark>dos</mark>h  (positions 3-5)
 *
 * Supports both English and Bengali characters seamlessly (works on
 * character indices, not byte indices).
 */

/**
 * highlightMatch — highlights exact substring matches (case-insensitive).
 * Used for .includes() and phonetic matches where the query appears verbatim.
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
          className="bg-transparent text-primary font-bold"
          style={{ background: 'transparent' }}
        >
          {part}
        </mark>
      )
    }
    return <React.Fragment key={i}>{part}</React.Fragment>
  })
}

/**
 * highlightFuzzy — highlights specific character positions (from Fuse.js indices).
 * Fuse.js returns matches as { indices: [[start, end], ...] } where each
 * [start, end] is a character range (inclusive) in the matched string.
 *
 * Example: highlightFuzzy("Firdosh", [[0,1], [3,5]])
 * → <mark>Fi</mark>r<mark>dos</mark>h
 */
export function highlightFuzzy(text: string, indices: Array<[number, number]>): React.ReactNode {
  if (!text || !indices || indices.length === 0) return text

  // Sort indices by start position
  const sorted = [...indices].sort((a, b) => a[0] - b[0])

  // Build a set of character positions to highlight
  const highlightSet = new Set<number>()
  for (const [start, end] of sorted) {
    for (let i = start; i <= end && i < text.length; i++) {
      highlightSet.add(i)
    }
  }

  // Split text into highlighted/non-highlighted segments
  const segments: Array<{ text: string; highlight: boolean }> = []
  let currentText = ''
  let currentHighlight = highlightSet.has(0)

  for (let i = 0; i < text.length; i++) {
    const isHighlight = highlightSet.has(i)
    if (isHighlight === currentHighlight) {
      currentText += text[i]
    } else {
      if (currentText) segments.push({ text: currentText, highlight: currentHighlight })
      currentText = text[i]
      currentHighlight = isHighlight
    }
  }
  if (currentText) segments.push({ text: currentText, highlight: currentHighlight })

  return segments.map((seg, i) => {
    if (seg.highlight) {
      return (
        <mark
          key={i}
          className="bg-transparent text-primary font-bold"
          style={{ background: 'transparent' }}
        >
          {seg.text}
        </mark>
      )
    }
    return <React.Fragment key={i}>{seg.text}</React.Fragment>
  })
}

/**
 * highlightFuzzyFromQuery — fuzzy highlights based on query characters.
 * When Fuse.js matches but we don't have exact indices, we find the best
 * matching subsequence of the query in the text and highlight those chars.
 *
 * Example: query "Fidohhi" → finds "Fi" + "do" + "h" in "Firdosh" → highlights them.
 */
export function highlightFuzzyFromQuery(text: string, query: string): React.ReactNode {
  if (!text || !query || !query.trim()) return text

  const q = query.trim().toLowerCase()
  const t = text.toLowerCase()

  // First try exact substring match (fast path)
  const idx = t.indexOf(q)
  if (idx >= 0) {
    return highlightMatch(text, query)
  }

  // Fuzzy: find matching character positions (subsequence match)
  const highlightPositions: number[] = []
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      highlightPositions.push(ti)
      qi++
    }
  }

  // If we matched at least 60% of query characters, highlight them
  if (highlightPositions.length >= Math.ceil(q.length * 0.6)) {
    // Group consecutive positions into ranges
    const indices: Array<[number, number]> = []
    let start = highlightPositions[0]
    let prev = highlightPositions[0]
    for (let i = 1; i < highlightPositions.length; i++) {
      if (highlightPositions[i] === prev + 1) {
        prev = highlightPositions[i]
      } else {
        indices.push([start, prev])
        start = highlightPositions[i]
        prev = highlightPositions[i]
      }
    }
    indices.push([start, prev])
    return highlightFuzzy(text, indices)
  }

  // Fallback: no highlighting
  return text
}
