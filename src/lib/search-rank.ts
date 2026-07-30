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

    // 4. §SMART-FUZZY-FALLBACK: Items found by usePhoneticSearch via fuzzy
    //    matching but without an exact substring/cross-lingual/field match.
    //    We include them ONLY if they can be highlighted — i.e., at least
    //    one word in the query has a consecutive consonant match OR an exact
    //    word match in the primary text. This prevents false positives like
    //    "Das" matching "Maa Lakshmi Bhandar" (no consecutive consonant match)
    //    while allowing "Firdaus Alam" to match "Firdosh Alam" (Alam is exact,
    //    Fird is a consonant match).
    const words = q.split(/\s+/).filter((w) => w.length >= 2)
    let hasHighlightableMatch = false

    for (const word of words) {
      // 4a. Exact word match in primary text
      const wordExact = findMatchPosition(primaryText, word)
      if (wordExact.index >= 0) {
        hasHighlightableMatch = true
        break
      }
      // 4b. Cross-lingual word match
      const wordCross = findCrossLingualMatch(primaryText, word)
      if (wordCross) {
        hasHighlightableMatch = true
        break
      }
      // 4c. Consonant-skeleton fuzzy match (consecutive consonants)
      const fuzzy = findFuzzyHighlightRange(primaryText, word)
      if (fuzzy) {
        hasHighlightableMatch = true
        break
      }
    }

    // Also check secondary search fields for word matches
    if (!hasHighlightableMatch && getSearchFields) {
      const fields = getSearchFields(item)
      for (const field of fields) {
        if (!field) continue
        for (const word of words) {
          if (field.toLowerCase().includes(word.toLowerCase())) {
            hasHighlightableMatch = true
            break
          }
        }
        if (hasHighlightableMatch) break
      }
    }

    if (hasHighlightableMatch) {
      ranked.push({
        item,
        position: 'none' as MatchPosition,
        matchIndex: -1,
        matchLength: 0,
        matchedText: '',
        score: 3, // lowest priority (below suffix)
      })
    }
    // If no highlightable match, the item is FILTERED OUT — not returned.
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
 * §HIGHLIGHT: Highlight the matching substring(s) in the text.
 *
 * For same-script matches: highlights the exact substring.
 * For cross-lingual matches: highlights the corresponding substring in the
 * original text (found via transliteration + grapheme mapping).
 * For fuzzy/phonetic matches: highlights the best-matching portion of the
 * text using subsequence matching (e.g., "Firdaus" highlights "Firdo" in
 * "Firdosh" because the consonant skeleton "frd" matches).
 *
 * §MULTI-WORD: For multi-word queries like "Firdaus Alam", ALL matching
 * words are highlighted. Each word is matched independently — exact
 * substring first, then cross-lingual, then consonant-skeleton fuzzy.
 *
 * §MIN-2-CHARS: Only highlights if the query is 2+ characters.
 * §GRAPHENE-SAFE: Uses Intl.Segmenter so Bengali combining characters
 * (virama, vowel marks) are never split.
 *
 * Returns { before, match, after, matched } where `match` is a single
 * highlighted segment. For multi-word queries, this returns the FIRST
 * match — but the caller (highlightWeighted) handles multi-segment
 * highlighting by calling this function for each word.
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

  // 1. Try exact substring match (same script) for the FULL query
  const exact = findMatchPosition(text, q)
  if (exact.index >= 0) {
    return {
      before: text.substring(0, exact.index),
      match: text.substring(exact.index, exact.index + exact.length),
      after: text.substring(exact.index + exact.length),
      matched: true,
    }
  }

  // 2. Try cross-lingual match for the FULL query
  const cross = findCrossLingualMatch(text, q)
  if (cross) {
    return {
      before: text.substring(0, cross.start),
      match: text.substring(cross.start, cross.end),
      after: text.substring(cross.end),
      matched: true,
    }
  }

  // 3. §MULTI-WORD: Try each word separately.
  // For "Firdaus Alam", try "Firdaus" and "Alam" independently.
  // Collect ALL highlight ranges, then merge them.
  const words = q.split(/\s+/).filter((w) => w.length >= 2)
  if (words.length > 0) {
    const ranges: Array<{ start: number; end: number }> = []

    for (const word of words) {
      // 3a. Try exact substring match for this word
      const wordExact = findMatchPosition(text, word)
      if (wordExact.index >= 0) {
        ranges.push({ start: wordExact.index, end: wordExact.index + wordExact.length })
        continue
      }
      // 3b. Try cross-lingual match for this word
      const wordCross = findCrossLingualMatch(text, word)
      if (wordCross) {
        ranges.push({ start: wordCross.start, end: wordCross.end })
        continue
      }
      // 3c. Try consonant-skeleton fuzzy match for this word
      const fuzzy = findFuzzyHighlightRange(text, word)
      if (fuzzy) {
        ranges.push(fuzzy)
        continue
      }
    }

    if (ranges.length > 0) {
      // Sort ranges by start position
      ranges.sort((a, b) => a.start - b.start)
      // Merge overlapping/adjacent ranges
      const merged: Array<{ start: number; end: number }> = []
      for (const r of ranges) {
        if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
        } else {
          merged.push({ ...r })
        }
      }
      // Build the result with ALL highlighted segments
      // Return the first segment as before/match/after — the caller
      // (highlightWeighted) handles rendering multiple segments.
      // Actually, for multiple segments we need a different approach.
      // Let's return a combined result where `match` contains all
      // highlighted text with markers. But the return type is
      // { before, match, after } — so for multiple ranges, we'll
      // return the first range and let highlightWeighted handle the rest.
      // 
      // Actually, the simplest fix: return ALL ranges via a custom format.
      // But since the return type is fixed, let's return the first range
      // for backward compat. The highlightWeighted function will be updated
      // to handle multi-range highlighting directly.
      const first = merged[0]
      return {
        before: text.substring(0, first.start),
        match: text.substring(first.start, first.end),
        after: text.substring(first.end),
        matched: true,
      }
    }
  }

  // 4. No match — return text as-is (no highlighting)
  return { before: text, match: '', after: '', matched: false }
}

/**
 * §MULTI-RANGE-HIGHLIGHT: Find ALL highlight ranges in the text for a query.
 * Returns an array of { start, end } ranges that should be highlighted.
 * Used by highlightWeighted to render multiple highlighted segments.
 */
export function findAllHighlightRanges(text: string, query: string): Array<{ start: number; end: number }> {
  if (!text || !query || query.trim().length < 2) return []

  const q = query.trim()
  const ranges: Array<{ start: number; end: number }> = []

  // 1. Try exact substring match for the FULL query
  const exact = findMatchPosition(text, q)
  if (exact.index >= 0) {
    ranges.push({ start: exact.index, end: exact.index + exact.length })
    return ranges
  }

  // 2. Try cross-lingual match for the FULL query
  const cross = findCrossLingualMatch(text, q)
  if (cross) {
    ranges.push({ start: cross.start, end: cross.end })
    return ranges
  }

  // 3. Try each word separately
  const words = q.split(/\s+/).filter((w) => w.length >= 2)
  for (const word of words) {
    // 3a. Exact substring
    const wordExact = findMatchPosition(text, word)
    if (wordExact.index >= 0) {
      ranges.push({ start: wordExact.index, end: wordExact.index + wordExact.length })
      continue
    }
    // 3b. Cross-lingual
    const wordCross = findCrossLingualMatch(text, word)
    if (wordCross) {
      ranges.push({ start: wordCross.start, end: wordCross.end })
      continue
    }
    // 3c. Consonant-skeleton fuzzy
    const fuzzy = findFuzzyHighlightRange(text, word)
    if (fuzzy) {
      ranges.push(fuzzy)
      continue
    }
  }

  // Sort and merge overlapping ranges
  if (ranges.length === 0) return []
  ranges.sort((a, b) => a.start - b.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const r of ranges) {
    if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
    } else {
      merged.push({ ...r })
    }
  }
  return merged
}

/**
 * §FUZZY-HIGHLIGHT-RANGE: Find the best matching range in text for a query
 * using consonant-skeleton matching. Strips vowels from both and finds the
 * longest CONSECUTIVE consonant match, then maps it back to the original
 * text positions.
 *
 * §STRICT: Only matches CONSECUTIVE consonants (no scattered subsequence
 * matching). This prevents false positives like "Das" matching "Bhandar"
 * just because 'd' and 's' appear somewhere in the text.
 *
 * Example: text="Firdosh Alam", query="Firdaus"
 *   → skeletons: text="frdshlm", query="frds"
 *   → CONSECUTIVE match "frds" at index 0 → highlight "Firdo" in original
 *
 * Example: text="Maa Lakshmi Bhandar", query="Das"
 *   → skeletons: text="mlkshmbhndr", query="ds"
 *   → NO consecutive match (d and s are not adjacent in the text) → null
 */
function findFuzzyHighlightRange(text: string, query: string): { start: number; end: number } | null {
  if (!text || !query || query.length < 2) return null

  const textGraphemes = getGraphemeStrings(text)
  const queryConsonants = getGraphemeStrings(query).filter((g) => !isVowelGrapheme(g))
  if (queryConsonants.length < 2) return null

  // §STRICT: We require CONSECUTIVE consonant matches.
  // Slide a window of the same length as queryConsonants through the text.
  // All consonants in the window must match in order.
  const windowSize = queryConsonants.length

  for (let start = 0; start <= textGraphemes.length - windowSize; start++) {
    // Extract consonants from the window [start, start+windowSize)
    // (skipping vowels in the text, but requiring all query consonants
    //  to appear CONSECUTIVELY in the text's consonant sequence)
    let qi = 0
    let end = start
    let matchCount = 0
    let consecutive = true

    for (let ti = start; ti < textGraphemes.length && qi < queryConsonants.length; ti++) {
      const tg = textGraphemes[ti]
      // Skip vowels in the text (they don't break consecutiveness for consonants)
      if (isVowelGrapheme(tg)) {
        continue
      }
      // This is a consonant — it must match the next query consonant
      if (graphemesMatch(tg, queryConsonants[qi])) {
        qi++
        end = ti + 1
        matchCount++
      } else {
        // Consonant mismatch → this window doesn't work
        consecutive = false
        break
      }
    }

    // All query consonants must be matched, and they must be consecutive
    // (no non-matching consonants between them in the text)
    if (consecutive && matchCount === queryConsonants.length) {
      const charStart = graphemeIndexToCharIndex(text, start)
      const charEnd = graphemeIndexToCharIndex(text, end)
      return { start: charStart, end: charEnd }
    }
  }

  return null
}
