'use client'

import React from 'react'

/**
 * §FUZZY-HIGHLIGHT: Highlight matched characters in search results.
 *
 * Handles two matching scenarios:
 * 1. Exact substring (case-insensitive): query "Fi" in "Firdosh" → <mark>Fi</mark>rdosh
 * 2. Fuzzy subsequence: query "Fidohhi" in "Firdosh" → <mark>Fi</mark>r<mark>do</mark>sh
 *
 * §CRITICAL: Cross-lingual highlighting (English query → Bengali text) is
 * DISABLED because proportional position mapping breaks Bengali combining
 * characters (virama, vowel marks, etc.). The search STILL WORKS via Fuse.js
 * + phonetic matching — results are found and shown — but the Bengali text
 * is displayed as-is without highlighting, so characters never break.
 *
 * Bengali combining characters are also protected in buildSegments via
 * Intl.Segmenter (when available) to never split mid-grapheme.
 */

interface HighlightSegment {
  text: string
  highlight: boolean
}

function segmentsToReact(segments: HighlightSegment[]): React.ReactNode {
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
 * §GRAPHENE-SAFE: Split text into grapheme clusters so combining marks
 * (Bengali virama, vowel signs, etc.) never get separated from their base
 * consonant. Uses Intl.Segmenter when available; falls back to char-by-char.
 */
function getGraphemes(text: string): Array<{ char: string; start: number; end: number }> {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    const result: Array<{ char: string; start: number; end: number }> = []
    for (const seg of segmenter.segment(text)) {
      result.push({ char: seg.segment, start: seg.index, end: seg.index + seg.segment.length })
    }
    return result
  }
  // Fallback: char-by-char (less safe for combining marks, but works for ASCII)
  const result: Array<{ char: string; start: number; end: number }> = []
  for (let i = 0; i < text.length; i++) {
    result.push({ char: text[i], start: i, end: i + 1 })
  }
  return result
}

/**
 * Build segments from a set of character indices to highlight.
 * §GRAPHENE-SAFE: Uses grapheme clusters so combining marks are never split
 * from their base character.
 */
function buildSegments(text: string, highlightSet: Set<number>): HighlightSegment[] {
  if (highlightSet.size === 0) return [{ text, highlight: false }]

  const graphemes = getGraphemes(text)
  const segments: HighlightSegment[] = []
  let currentText = ''
  let currentHighlight = graphemes.length > 0 && graphemes[0].start <= [...highlightSet][0] && highlightSet.has(graphemes[0].start)

  for (const g of graphemes) {
    // A grapheme is highlighted if ANY of its character positions are in the set
    let isHighlight = false
    for (let i = g.start; i < g.end; i++) {
      if (highlightSet.has(i)) { isHighlight = true; break }
    }

    if (isHighlight === currentHighlight) {
      currentText += g.char
    } else {
      if (currentText) segments.push({ text: currentText, highlight: currentHighlight })
      currentText = g.char
      currentHighlight = isHighlight
    }
  }
  if (currentText) segments.push({ text: currentText, highlight: currentHighlight })
  return segments
}

/**
 * Find all case-insensitive substring match positions.
 * Returns a Set of character indices that are part of a match.
 */
function findSubstringPositions(text: string, query: string): Set<number> {
  const result = new Set<number>()
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let idx = 0
  while (true) {
    const found = t.indexOf(q, idx)
    if (found < 0) break
    for (let i = found; i < found + q.length; i++) {
      result.add(i)
    }
    idx = found + q.length
  }
  return result
}

/**
 * Find fuzzy subsequence match positions.
 * Walks through the text and matches query characters in order (not necessarily
 * consecutive). Returns positions of matched characters.
 */
function findFuzzyPositions(text: string, query: string): Set<number> {
  const result = new Set<number>()
  const t = text.toLowerCase()
  const q = query.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      result.add(ti)
      qi++
    }
  }
  // Only return if we matched at least 60% of query characters
  if (result.size < Math.ceil(q.length * 0.6)) return new Set()
  return result
}

/**
 * highlightFuzzyFromQuery — the main highlighting function.
 *
 * §CRITICAL: Only highlights same-script matches (exact substring + fuzzy).
 * Cross-lingual highlighting is DISABLED to prevent Bengali character
 * breaking. The search still finds cross-lingual results via Fuse.js +
 * phonetic matching — they just display without highlighting.
 */
export function highlightFuzzyFromQuery(text: string, query: string): React.ReactNode {
  if (!text || !query || !query.trim()) return text

  const q = query.trim()

  // 1. Try exact substring match (case-insensitive) — same script only
  let positions = findSubstringPositions(text, q)
  if (positions.size > 0) {
    return segmentsToReact(buildSegments(text, positions))
  }

  // 2. Try fuzzy subsequence match — same script only
  positions = findFuzzyPositions(text, q)
  if (positions.size > 0) {
    return segmentsToReact(buildSegments(text, positions))
  }

  // 3. Cross-lingual: NO highlighting. Display the text as-is.
  // The search still works (Fuse.js + phonetic found the result),
  // but we don't highlight to avoid breaking Bengali combining characters.
  return text
}

// Keep highlightMatch for backward compatibility
export function highlightMatch(text: string, query: string): React.ReactNode {
  return highlightFuzzyFromQuery(text, query)
}

// Keep highlightFuzzy for backward compatibility
export function highlightFuzzy(text: string, indices: Array<[number, number]>): React.ReactNode {
  if (!text || !indices || indices.length === 0) return text
  const highlightSet = new Set<number>()
  for (const [start, end] of indices) {
    for (let i = start; i <= end && i < text.length; i++) {
      highlightSet.add(i)
    }
  }
  return segmentsToReact(buildSegments(text, highlightSet))
}
