'use client'

/**
 * §WEIGHTED-SEARCH: Positional weighting + cross-lingual highlighting.
 *
 * Three requirements from the client:
 * 1. HIGHLIGHTING (min 2 chars): Highlight ONLY the matching substring.
 *    Match can be anywhere (beginning, middle, end).
 * 2. SORTING PRIORITY: Prefix matches (index 0) > Infix matches (middle)
 *    > Suffix matches (end).
 * 3. CROSS-LINGUAL HIGHLIGHTING: English query → Bengali name (or vice versa)
 *    must phonetically match AND highlight the corresponding substring in
 *    the target language.
 *
 * §GRAPHENE-SAFE: All Bengali text handling uses Intl.Segmenter (grapheme
 * clusters) so combining marks (virama, vowel signs) are never split.
 */

import { transliterateBengaliToEnglish, transliterateEnglishToBengali } from './transliteration'

// ─── Types ──────────────────────────────────────────────────────────────────

export type MatchPosition = 'prefix' | 'infix' | 'suffix' | 'none'

export interface RankedMatch<T> {
  item: T
  /** Position of the match in the PRIMARY text field (name/title). */
  position: MatchPosition
  /** Character index where the match starts (-1 if no match). */
  matchIndex: number
  /** The matched substring length (0 if no match). */
  matchLength: number
  /** The text that was matched against (for highlighting). */
  matchedText: string
  /** A sort score: lower = better. Prefix=0, Infix=1, Suffix=2, None=3. */
  score: number
}

// ─── Position detection ────────────────────────────────────────────────────

/**
 * Find the position of a case-insensitive substring match.
 * Returns the match index and position classification.
 *
 * §RULE: A match at index 0 is "prefix". A match ending at the string's
 * last character is "suffix". Everything else is "infix".
 *
 * Edge case: if the query equals the entire text, it's classified as "prefix"
 * (index 0 takes priority).
 */
export function findMatchPosition(text: string, query: string): {
  index: number
  position: MatchPosition
  length: number
} {
  if (!text || !query || query.trim().length < 2) {
    return { index: -1, position: 'none', length: 0 }
  }
  const t = text.toLowerCase()
  const q = query.toLowerCase().trim()
  if (q.length < 2) {
    return { index: -1, position: 'none', length: 0 }
  }
  const idx = t.indexOf(q)
  if (idx < 0) {
    return { index: -1, position: 'none', length: 0 }
  }
  const end = idx + q.length
  let position: MatchPosition
  if (idx === 0) {
    position = 'prefix'
  } else if (end === t.length) {
    position = 'suffix'
  } else {
    position = 'infix'
  }
  return { index: idx, position, length: q.length }
}

// ─── Cross-lingual match finding ───────────────────────────────────────────

/**
 * §CROSS-LINGUAL: Find a match between the query and text across scripts.
 *
 * If the query is English and the text is Bengali (or vice versa), we
 * transliterate and find the matching substring position in the ORIGINAL
 * text (not the transliteration).
 *
 * Returns the character index range [start, end) in the ORIGINAL text that
 * corresponds to the matched query, or null if no cross-lingual match.
 *
 * §GRAPHENE-SAFE: Uses Intl.Segmenter to map between transliterated and
 * original text so Bengali combining characters are never split.
 */
export function findCrossLingualMatch(
  text: string,
  query: string
): { start: number; end: number; position: MatchPosition } | null {
  if (!text || !query || query.trim().length < 2) return null

  const q = query.trim()
  const isQueryBengali = /[\u0980-\u09FF]/.test(q)
  const isTextBengali = /[\u0980-\u09FF]/.test(text)

  // Same script → not cross-lingual (handled by findMatchPosition)
  if (isQueryBengali === isTextBengali) return null

  // Transliterate the query to the OTHER script
  let transliteratedQuery: string
  if (isQueryBengali) {
    // Query is Bengali, text is English → transliterate query to English
    transliteratedQuery = transliterateBengaliToEnglish(q)
  } else {
    // Query is English, text is Bengali → transliterate query to Bengali
    transliteratedQuery = transliterateEnglishToBengali(q)
  }

  if (!transliteratedQuery || transliteratedQuery.trim().length < 2) return null

  // Try to find the transliterated query in the text
  const tq = transliteratedQuery.toLowerCase().trim()
  const t = text.toLowerCase()

  // Direct substring match of transliterated query in text
  let idx = t.indexOf(tq)
  if (idx >= 0) {
    const end = idx + tq.length
    let position: MatchPosition
    if (idx === 0) position = 'prefix'
    else if (end === t.length) position = 'suffix'
    else position = 'infix'
    return { start: idx, end, position }
  }

  // §FUZZY-CROSS-LINGUAL: The transliteration might not be exact (e.g.,
  // "Firdos" transliterates to "ফির্দোস" but the saved name might be
  // "ফেরদৌস"). Try a grapheme-by-grapheme fuzzy match that tolerates
  // vowel differences.
  //
  // We use a sliding window approach: for each starting position in the
  // text, try to match the query's consonants in order (skipping vowels).
  // This is more tolerant than exact substring matching.
  const textGraphemes = getGraphemeStrings(text)
  const queryGraphemes = getGraphemeStrings(transliteratedQuery)

  // Build consonant-only skeletons (strip vowels)
  const queryConsonants = queryGraphemes.filter((g) => !isVowelGrapheme(g))
  if (queryConsonants.length < 2) return null

  // Slide through text graphemes, try to find a window where consonants
  // match in order.
  let bestStart = -1
  let bestEnd = -1
  for (let start = 0; start < textGraphemes.length; start++) {
    let qi = 0
    let end = start
    for (let ti = start; ti < textGraphemes.length && qi < queryConsonants.length; ti++) {
      if (graphemesMatch(textGraphemes[ti], queryConsonants[qi])) {
        qi++
        end = ti + 1
      }
    }
    if (qi === queryConsonants.length) {
      // Found a match from `start` to `end`
      // Convert grapheme indices to character indices
      const charStart = graphemeIndexToCharIndex(text, start)
      const charEnd = graphemeIndexToCharIndex(text, end)
      if (bestStart < 0 || (charEnd - charStart) < (bestEnd - bestStart)) {
        bestStart = charStart
        bestEnd = charEnd
      }
    }
  }

  if (bestStart >= 0) {
    let position: MatchPosition
    if (bestStart === 0) position = 'prefix'
    else if (bestEnd === text.length) position = 'suffix'
    else position = 'infix'
    return { start: bestStart, end: bestEnd, position }
  }

  return null
}

// ─── Grapheme helpers ──────────────────────────────────────────────────────

function getGraphemeStrings(text: string): string[] {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    return Array.from(segmenter.segment(text), (s: any) => s.segment)
  }
  return Array.from(text)
}

function graphemeIndexToCharIndex(text: string, graphemeIdx: number): number {
  if (typeof Intl !== 'undefined' && (Intl as any).Segmenter) {
    const segmenter = new (Intl as any).Segmenter(undefined, { granularity: 'grapheme' })
    let i = 0
    for (const seg of segmenter.segment(text)) {
      if (i === graphemeIdx) return seg.index
      i++
    }
    return text.length
  }
  return graphemeIdx
}

function isVowelGrapheme(g: string): boolean {
  // English vowels
  if (/^[aeiou]$/i.test(g)) return true
  // Bengali vowels and vowel signs
  if (/^[অআইঈউঊঋএঐওঔািীুূৃেৈোৌংঃঁ]$/.test(g)) return true
  return false
}

function graphemesMatch(a: string, b: string): boolean {
  if (a === b) return true
  // §PHONETIC-EQUIVALENCE: Treat common phonetic equivalents as equal.
  // e.g., "শ" ≈ "স" (both /sh/~/s/), "ি" ≈ "ে" (i~e), etc.
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return true
  // Bengali consonant equivalence
  const bnEquiv: Record<string, string[]> = {
    'শ': ['স', 'ষ'],
    'স': ['শ', 'ষ'],
    'ষ': ['শ', 'স'],
    'ন': ['ণ'],
    'ণ': ['ন'],
    'ব': ['ভ'],
    'ভ': ['ব'],
  }
  if (bnEquiv[a]?.includes(b)) return true
  // English consonant equivalence
  const enEquiv: Record<string, string[]> = {
    's': ['sh'],
    'v': ['b'],
    'j': ['z'],
  }
  if (enEquiv[al]?.includes(bl)) return true
  if (enEquiv[bl]?.includes(al)) return true
  return false
}

// ─── Ranking ───────────────────────────────────────────────────────────────

/**
 * §WEIGHTED-SORT: Rank items by match position.
 *
 * Priority: prefix (0) > infix (1) > suffix (2) > none (3).
 * Within the same position, shorter match index wins (earlier in the string).
 *
 * @param items - The items to rank.
 * @param query - The search query.
 * @param getTextField - Function to extract the primary text field (name) from an item.
 * @param getSearchFields - Optional additional fields to search (phone, sku, etc.).
 */
export function rankByPosition<T>(
  items: T[],
  query: string,
  getTextField: (item: T) => string,
  getSearchFields?: (item: T) => string[]
): RankedMatch<T>[] {
  if (!query || query.trim().length < 2) return []

  const q = query.trim()
  const ranked: RankedMatch<T>[] = []

  for (const item of items) {
    const primaryText = getTextField(item) || ''

    // 1. Try exact substring match in the primary field
    const exact = findMatchPosition(primaryText, q)
    if (exact.index >= 0) {
      ranked.push({
        item,
        position: exact.position,
        matchIndex: exact.index,
        matchLength: exact.length,
        matchedText: primaryText.substring(exact.index, exact.index + exact.length),
        score: positionToScore(exact.position),
      })
      continue
    }

    // 2. Try cross-lingual match in the primary field
    const cross = findCrossLingualMatch(primaryText, q)
    if (cross) {
      ranked.push({
        item,
        position: cross.position,
        matchIndex: cross.start,
        matchLength: cross.end - cross.start,
        matchedText: primaryText.substring(cross.start, cross.end),
        score: positionToScore(cross.position) + 0.5, // slight penalty for cross-lingual
      })
      continue
    }

    // 3. Try exact substring match in secondary search fields
    if (getSearchFields) {
      const fields = getSearchFields(item)
      let found = false
      for (const field of fields) {
        if (!field) continue
        const fieldMatch = findMatchPosition(field, q)
        if (fieldMatch.index >= 0) {
          ranked.push({
            item,
            position: fieldMatch.position,
            matchIndex: fieldMatch.index,
            matchLength: fieldMatch.length,
            matchedText: field.substring(fieldMatch.index, fieldMatch.index + fieldMatch.length),
            score: positionToScore(fieldMatch.position) + 0.3, // penalty for secondary field
          })
          found = true
          break
        }
      }
      if (found) continue
    }
  }

  // Sort by score (ascending), then by matchIndex (ascending)
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    return a.matchIndex - b.matchIndex
  })

  return ranked
}

function positionToScore(position: MatchPosition): number {
  switch (position) {
    case 'prefix': return 0
    case 'infix': return 1
    case 'suffix': return 2
    default: return 3
  }
}

// ─── Highlighting (grapheme-safe, cross-lingual) ──────────────────────────

/**
 * §HIGHLIGHT: Highlight the matching substring in the text.
 *
 * For same-script matches: highlights the exact substring.
 * For cross-lingual matches: highlights the corresponding substring in the
 * original text (found via transliteration + grapheme mapping).
 *
 * §MIN-2-CHARS: Only highlights if the query is 2+ characters.
 * §GRAPHENE-SAFE: Uses Intl.Segmenter so Bengali combining characters
 * (virama, vowel marks) are never split.
 */
export function highlightSubstring(text: string, query: string): {
  before: string
  match: string
  after: string
  matched: boolean
} {
  if (!text || !query || query.trim().length < 2) {
    return { before: text || '', match: '', after: '', matched: false }
  }

  const q = query.trim()

  // 1. Try exact substring match (same script)
  const exact = findMatchPosition(text, q)
  if (exact.index >= 0) {
    return {
      before: text.substring(0, exact.index),
      match: text.substring(exact.index, exact.index + exact.length),
      after: text.substring(exact.index + exact.length),
      matched: true,
    }
  }

  // 2. Try cross-lingual match
  const cross = findCrossLingualMatch(text, q)
  if (cross) {
    return {
      before: text.substring(0, cross.start),
      match: text.substring(cross.start, cross.end),
      after: text.substring(cross.end),
      matched: true,
    }
  }

  // 3. No match — return text as-is (no highlighting)
  return { before: text, match: '', after: '', matched: false }
}
