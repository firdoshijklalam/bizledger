/**
 * §BACKWARD-COMPAT: This file re-exports from the new unified search engine
 * (`search-engine.ts`) so existing callers keep working.
 *
 * New code should import directly from `./search-engine`.
 */

import {
  searchEntities,
  generateAliasesWithSpans,
  computeHighlightRanges,
  type SearchMatch,
  type AliasEntry,
  type VisibleRange,
  type MatchType,
  type SearchableEntity,
} from './search-engine'

export type MatchPosition = 'prefix' | 'infix' | 'suffix' | 'none'

export interface RankedMatch<T> {
  item: T
  position: MatchPosition
  matchIndex: number
  matchLength: number
  matchedText: string
  score: number
}

// ─── Position helpers (kept for backward compat) ──────────────────────────

export function findMatchPosition(
  text: string,
  query: string
): { index: number; position: MatchPosition; length: number } {
  if (!text || !query || query.trim().length < 2) {
    return { index: -1, position: 'none', length: 0 }
  }
  const t = text.normalize('NFC').toLowerCase()
  const q = query.normalize('NFC').toLowerCase().trim()
  if (q.length < 2) {
    return { index: -1, position: 'none', length: 0 }
  }
  const idx = t.indexOf(q)
  if (idx < 0) {
    return { index: -1, position: 'none', length: 0 }
  }
  const end = idx + q.length
  let position: MatchPosition
  if (idx === 0) position = 'prefix'
  else if (end === t.length) position = 'suffix'
  else position = 'infix'
  return { index: idx, position, length: q.length }
}

// ─── rankByPosition (backward compat) ──────────────────────────────────────

/**
 * §LEGACY: rankByPosition wraps the new searchEntities API to maintain
 * backward compatibility with existing callers (search-overlay, tests).
 *
 * Returns RankedMatch[] with the same shape as before, but the underlying
 * scoring now uses the new deterministic tier system.
 */
export function rankByPosition<T>(
  items: T[],
  query: string,
  getTextField: (item: T) => string,
  getSearchFields?: (item: T) => string[]
): RankedMatch<T>[] {
  const entities: SearchableEntity<T>[] = items.map((item) => ({
    id: (item as any)?.id || String(Math.random()),
    item,
    canonical: getTextField(item) || '',
    secondary: getSearchFields ? getSearchFields(item) : [],
    aliases: generateAliasesWithSpans(getTextField(item) || ''),
  }))

  const matches = searchEntities(entities, query)

  return matches.map((m) => {
    // Map the new SearchMatch back to the legacy RankedMatch shape.
    const position: MatchPosition =
      m.matchType === 'full-exact-prefix' || m.matchType === 'single-token-prefix'
        ? 'prefix'
        : m.matchType === 'full-exact-suffix'
        ? 'suffix'
        : m.matchType === 'full-exact-infix'
        ? 'infix'
        : m.highlightRanges && m.highlightRanges.length > 0
        ? 'infix'
        : 'none'

    const firstRange = m.highlightRanges && m.highlightRanges.length > 0 ? m.highlightRanges[0] : null
    const matchIndex = firstRange ? firstRange.start : -1
    const matchLength = firstRange ? firstRange.end - firstRange.start : 0
    const matchedText = firstRange
      ? (m.item as any)?.name?.substring(firstRange.start, firstRange.end) || ''
      : m.matchedAliases[0] || ''

    return {
      item: m.item,
      position,
      matchIndex,
      matchLength,
      matchedText,
      score: m.score,
    }
  })
}

// ─── Highlight helpers (backward compat) ──────────────────────────────────

/**
 * Find all highlight ranges in `text` for the given `query`.
 * Delegates to the new search engine's `computeHighlightRanges`.
 */
export function findAllHighlightRanges(
  text: string,
  query: string
): Array<{ start: number; end: number }> {
  return computeHighlightRanges(text, query)
}

/**
 * Single-range highlight (legacy). Returns the first match range.
 */
export function highlightSubstring(
  text: string,
  query: string
): { before: string; match: string; after: string; matched: boolean } {
  const ranges = computeHighlightRanges(text, query)
  if (ranges.length === 0) {
    return { before: text || '', match: '', after: '', matched: false }
  }
  const r = ranges[0]
  return {
    before: text.substring(0, r.start),
    match: text.substring(r.start, r.end),
    after: text.substring(r.end),
    matched: true,
  }
}

// ─── Cross-lingual match finder (legacy) ──────────────────────────────────

/**
 * Try a cross-lingual match: Bengali query → English text or vice versa.
 * Uses the new engine's alias generation to find a match.
 */
export function findCrossLingualMatch(
  text: string,
  query: string
): { start: number; end: number; position: MatchPosition } | null {
  if (!text || !query || query.trim().length < 2) return null
  const aliases = generateAliasesWithSpans(text)
  const q = query.normalize('NFC').toLowerCase().trim()
  for (const alias of aliases) {
    if (alias.normalized === q) {
      const span = alias.visibleSpans[0]
      if (span) {
        return { start: span.start, end: span.end, position: 'prefix' }
      }
    }
  }
  return null
}

// ─── Re-exports for new code ───────────────────────────────────────────────

export type {
  SearchMatch,
  AliasEntry,
  VisibleRange,
  MatchType,
  SearchableEntity,
}
export { searchEntities, generateAliasesWithSpans, computeHighlightRanges }
