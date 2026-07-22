'use client'

import React from 'react'
import { transliterateBengaliToEnglish, transliterateEnglishToBengali } from '@/lib/transliteration'

/**
 * §FUZZY-HIGHLIGHT: Highlight matched characters in search results.
 *
 * Handles three matching scenarios:
 * 1. Exact substring (case-insensitive): query "Fi" in "Firdosh" → <mark>Fi</mark>rdosh
 * 2. Fuzzy subsequence: query "Fidohhi" in "Firdosh" → <mark>Fi</mark>r<mark>do</mark>sh
 * 3. Cross-lingual phonetic: query "ab" (English) in "আব্দুল্লাহ" (Bengali)
 *    → highlights the phonetically matching Bengali chars: <mark>আব</mark>্দুল্লাহ
 *
 * Works on character indices (not byte indices) so Bengali multi-byte
 * characters are handled correctly by JavaScript's string indexing.
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
 * Build segments from a set of character indices to highlight.
 */
function buildSegments(text: string, highlightSet: Set<number>): HighlightSegment[] {
  if (highlightSet.size === 0) return [{ text, highlight: false }]
  const segments: HighlightSegment[] = []
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
 * §CROSS-LINGUAL: Find phonetically matching positions in Bengali text
 * for an English query (and vice versa).
 *
 * Strategy: transliterate the text to the query's script, then find
 * substring/fuzzy matches in the transliterated version, and map those
 * positions back to the original text.
 *
 * Example: query "ab" → text "আব্দুল্লাহ"
 *   transliterate("আব্দুল্লাহ") → "abdullah" (approximate)
 *   find "ab" in "abdullah" → positions [0,1]
 *   map back to original Bengali text → highlight "আব"
 */
function findCrossLingualPositions(text: string, query: string): Set<number> {
  const q = query.toLowerCase().trim()
  if (!q || !text) return new Set()

  // Try transliterating Bengali text → English
  const transliterated = transliterateBengaliToEnglish(text)
  if (transliterated && transliterated.toLowerCase() !== text.toLowerCase()) {
    // Find substring match in transliterated text
    const transLower = transliterated.toLowerCase()
    const idx = transLower.indexOf(q)
    if (idx >= 0) {
      // Map transliterated positions back to original text positions.
      // This is approximate because transliteration can change character count.
      // We use a simple proportional mapping: if transliteration is N chars and
      // original is M chars, position i in transliteration → i * M / N in original.
      const ratio = text.length / transliterated.length
      const origStart = Math.round(idx * ratio)
      const origEnd = Math.round((idx + q.length) * ratio)
      const result = new Set<number>()
      for (let i = origStart; i < origEnd && i < text.length; i++) {
        result.add(i)
      }
      if (result.size > 0) return result
    }

    // Also try fuzzy match on transliterated text
    const fuzzyPositions = findFuzzyPositions(transliterated, q)
    if (fuzzyPositions.size > 0) {
      // Map fuzzy positions back to original via ratio
      const ratio = text.length / transliterated.length
      const result = new Set<number>()
      fuzzyPositions.forEach((pos) => {
        const origPos = Math.round(pos * ratio)
        if (origPos < text.length) result.add(origPos)
      })
      if (result.size > 0) return result
    }
  }

  // Try transliterating English query → Bengali, then find in Bengali text
  const bengaliQuery = transliterateEnglishToBengali(query)
  if (bengaliQuery && bengaliQuery !== query) {
    const positions = findSubstringPositions(text, bengaliQuery)
    if (positions.size > 0) return positions
    // Also try fuzzy on the Bengali query
    const fuzzyPos = findFuzzyPositions(text, bengaliQuery)
    if (fuzzyPos.size > 0) return fuzzyPos
  }

  return new Set()
}

/**
 * highlightFuzzyFromQuery — the main highlighting function.
 * Handles exact, fuzzy, and cross-lingual matches.
 */
export function highlightFuzzyFromQuery(text: string, query: string): React.ReactNode {
  if (!text || !query || !query.trim()) return text

  const q = query.trim()

  // 1. Try exact substring match (case-insensitive)
  let positions = findSubstringPositions(text, q)
  if (positions.size > 0) {
    return segmentsToReact(buildSegments(text, positions))
  }

  // 2. Try fuzzy subsequence match
  positions = findFuzzyPositions(text, q)
  if (positions.size > 0) {
    return segmentsToReact(buildSegments(text, positions))
  }

  // 3. Try cross-lingual phonetic match (English query → Bengali text, or vice versa)
  positions = findCrossLingualPositions(text, q)
  if (positions.size > 0) {
    return segmentsToReact(buildSegments(text, positions))
  }

  // 4. Fallback: no highlighting
  return text
}

// Keep highlightMatch for backward compatibility (used by some components)
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
