'use client'

import React from 'react'
import { computeHighlightRanges, type VisibleRange } from './search-engine'

/**
 * §HIGHLIGHT: Render visible text with highlighted segments.
 *
 * The preferred path is for callers to pass `ranges` directly (from a
 * SearchMatch.highlightRanges). When ranges are not available, we compute
 * them on the fly via `computeHighlightRanges` — useful for components that
 * do not have access to a SearchMatch (e.g., the khata-view search bar).
 *
 * §GRAPHENE-SAFE: Ranges are computed against NFC-normalized text, so
 * Bengali combining marks (virama, vowel signs) stay attached to their
 * base consonant.
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

function buildSegmentsFromRanges(text: string, ranges: VisibleRange[]): HighlightSegment[] {
  if (!ranges || ranges.length === 0) return [{ text, highlight: false }]
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const segments: HighlightSegment[] = []
  let lastEnd = 0
  for (const r of sorted) {
    const start = Math.max(0, Math.min(r.start, text.length))
    const end = Math.max(start, Math.min(r.end, text.length))
    if (start > lastEnd) {
      segments.push({ text: text.substring(lastEnd, start), highlight: false })
    }
    if (end > start) {
      segments.push({ text: text.substring(start, end), highlight: true })
    }
    lastEnd = end
  }
  if (lastEnd < text.length) {
    segments.push({ text: text.substring(lastEnd), highlight: false })
  }
  return segments
}

/**
 * Highlight text using precomputed ranges (preferred).
 */
export function highlightRanges(text: string, ranges: VisibleRange[]): React.ReactNode {
  if (!text) return text
  if (!ranges || ranges.length === 0) return text
  return segmentsToReact(buildSegmentsFromRanges(text, ranges))
}

/**
 * §HIGHLIGHT-WEIGHTED: Highlight text by computing ranges from the query.
 * This is the backward-compat entry point used by `khata-view.tsx` and the
 * old search-overlay implementation.
 *
 * Internally delegates to `computeHighlightRanges` from the new search engine.
 */
export function highlightWeighted(text: string, query: string): React.ReactNode {
  if (!text || !query || !query.trim()) return text
  const ranges = computeHighlightRanges(text, query)
  if (ranges.length === 0) return text
  return segmentsToReact(buildSegmentsFromRanges(text, ranges))
}

// ─── Backward-compat exports ──────────────────────────────────────────────

/**
 * Highlight text given Fuse.js-style [start, end] indices (legacy).
 */
export function highlightFuzzy(text: string, indices: Array<[number, number]>): React.ReactNode {
  if (!text || !indices || indices.length === 0) return text
  const ranges: VisibleRange[] = indices.map(([s, e]) => ({ start: s, end: e + 1 }))
  return segmentsToReact(buildSegmentsFromRanges(text, ranges))
}

/**
 * Legacy: simple case-insensitive substring highlight.
 */
export function highlightMatch(text: string, query: string): React.ReactNode {
  return highlightWeighted(text, query)
}

/**
 * Legacy: fuzzy subsequence highlight.
 */
export function highlightFuzzyFromQuery(text: string, query: string): React.ReactNode {
  return highlightWeighted(text, query)
}
