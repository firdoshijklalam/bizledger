'use client'

/**
 * §DETERMINISTIC-SEARCH: Positional weighting + cross-lingual highlighting.
 *
 * §DESIGN-PRINCIPLE: Fuzzy matching MUST NOT create search results.
 * Only exact, token, prefix, and alias matches can generate candidates.
 * Fuzzy is used ONLY for highlight range generation on already-matched items.
 *
 * Match hierarchy (lower score = better):
 *   0.0 = Exact full-query substring match (prefix position)
 *   1.0 = Exact full-query substring match (infix position)
 *   2.0 = Exact full-query substring match (suffix position)
 *   3.0 = Token match (all query tokens found in name, prefix positions)
 *   4.0 = Token match (some query tokens found in name)
 *   5.0 = searchTag match (query token found in searchTags)
 *   6.0 = Secondary field match (phone, sku, etc.)
 *   7.0 = Bengali-normalized match (vowel variant equivalence)
 *   8.0 = Cross-lingual alias match (via searchTags)
 *
 * Items that don't match ANY of these are FILTERED OUT.
 * No fuzzy matching generates candidates.
 */

import { transliterateBengaliToEnglish, transliterateEnglishToBengali } from './transliteration'

// ─── Types ──────────────────────────────────────────────────────────────────

export type MatchPosition = 'prefix' | 'infix' | 'suffix' | 'none'

export interface RankedMatch<T> {
  item: T
  position: MatchPosition
  matchIndex: number
  matchLength: number
  matchedText: string
  score: number
}

// ─── Bengali vowel normalization ───────────────────────────────────────────

/**
 * §BENGALI-NORMALIZE: Normalize common Bengali vowel variations for
 * phonetic equivalent matching within Bengali script.
 *
 * Example: ফিরদৌস → ফেরদৌস (ি ≈ ে in certain contexts)
 * The normalization makes both produce the same canonical form.
 */
function normalizeBengaliVowels(text: string): string {
  let result = text.normalize('NFC')
  // Common vowel sign equivalences (phonetically similar in Bengali):
  // ি (i) ≈ ে (e) — common in names: ফিরদৌস/ফেরদৌস, সিমেন্ট/সেমেন্ট
  result = result.replace(/ি/g, 'ে')
  // ৌ (ou) ≈ ো (o) — দৌস/দোস
  result = result.replace(/ৌ/g, 'ো')
  // ী (ii) ≈ ি (i) — less common but valid
  result = result.replace(/ী/g, 'ি')
  return result
}

/**
 * §COMMON-BENGALI-WORDS: Map common Bengali product/word names to their
 * English equivalents. This is used for cross-lingual search of English
 * product names when the user searches in Bengali.
 *
 * This is NOT a general transliteration — it's a controlled dictionary
 * of verified equivalents. Transliteration is unreliable for these words
 * (e.g., সিমেন্ট → 'siment' ≠ 'cement'), so we use explicit mappings.
 */
const COMMON_BENGALI_WORDS: Record<string, string[]> = {
  'সিমেন্ট': ['cement'],
  'চাল': ['rice'],
  'ভাত': ['rice'],
  'তেল': ['oil'],
  'সরিষার তেল': ['mustard oil'],
  'পানি': ['water'],
  'লবণ': ['salt'],
  'চিনি': ['sugar'],
  'আটা': ['flour'],
  'ডাল': ['lentil', 'dal'],
  'ব্রেড': ['bread'],
  'দুধ': ['milk'],
  'ডিম': ['egg'],
  'পেঁয়াজ': ['onion'],
  'আলু': ['potato'],
  'রসুন': ['garlic'],
  'আদা': ['ginger'],
  'মরিচ': ['chili', 'chilli'],
  'হালদি': ['turmeric'],
  'জিরা': ['cumin'],
  'ধনে': ['coriander'],
  'চায়': ['tea'],
  'কাগজ': ['paper'],
  'বাল্ব': ['bulb'],
  'চেয়ার': ['chair'],
  কাচ: ['glass'],
  থালা: ['plate'],
  গ্লাস: ['glass'],
  বালতি: ['bucket'],
  ছাতা: ['umbrella'],
  জুতো: ['shoe'],
  সাবান: ['soap'],
}

/**
 * Get English equivalents for a Bengali query word.
 * Returns an array of English words that should be searched.
 */
function getBengaliEnglishEquivalents(word: string): string[] {
  const normalized = word.normalize('NFC').toLowerCase().trim()
  return COMMON_BENGALI_WORDS[normalized] || []
}

// ─── Position detection ────────────────────────────────────────────────────

export function findMatchPosition(text: string, query: string): {
  index: number
  position: MatchPosition
  length: number
} {
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
  if (idx === 0) {
    position = 'prefix'
  } else if (end === t.length) {
    position = 'suffix'
  } else {
    position = 'infix'
  }
  return { index: idx, position, length: q.length }
}

/**
 * §BENGALI-VARIANT-MATCH: Try matching with Bengali vowel normalization.
 * This handles cases like ফিরদৌস vs ফেরদৌস where the only difference
 * is vowel signs (ি vs ে, ৌ vs ো).
 */
function findBengaliVariantMatch(text: string, query: string): {
  index: number
  position: MatchPosition
  length: number
} | null {
  if (!text || !query || query.trim().length < 2) return null
  const isBengali = /[\u0980-\u09FF]/.test(query)
  if (!isBengali) return null

  const normalizedText = normalizeBengaliVowels(text).toLowerCase()
  const normalizedQuery = normalizeBengaliVowels(query).toLowerCase().trim()

  if (normalizedQuery.length < 2) return null

  const idx = normalizedText.indexOf(normalizedQuery)
  if (idx < 0) return null

  const end = idx + normalizedQuery.length
  let position: MatchPosition
  if (idx === 0) position = 'prefix'
  else if (end === normalizedText.length) position = 'suffix'
  else position = 'infix'

  return { index: idx, position, length: normalizedQuery.length }
}

// ─── Cross-lingual match finding ───────────────────────────────────────────

export function findCrossLingualMatch(
  text: string,
  query: string
): { start: number; end: number; position: MatchPosition } | null {
  if (!text || !query || query.trim().length < 2) return null

  const q = query.trim()
  const isQueryBengali = /[\u0980-\u09FF]/.test(q)
  const isTextBengali = /[\u0980-\u09FF]/.test(text)

  // Same script → not cross-lingual
  if (isQueryBengali === isTextBengali) return null

  let transliteratedQuery: string
  if (isQueryBengali) {
    transliteratedQuery = transliterateBengaliToEnglish(q)
  } else {
    transliteratedQuery = transliterateEnglishToBengali(q)
  }

  if (!transliteratedQuery || transliteratedQuery.trim().length < 2) return null

  const tq = transliteratedQuery.normalize('NFC').toLowerCase().trim()
  const t = text.normalize('NFC').toLowerCase()

  let idx = t.indexOf(tq)
  if (idx >= 0) {
    const end = idx + tq.length
    let position: MatchPosition
    if (idx === 0) position = 'prefix'
    else if (end === t.length) position = 'suffix'
    else position = 'infix'
    return { start: idx, end, position }
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
  if (/^[aeiou]$/i.test(g)) return true
  if (/^[অআইঈউঊঋএঐওঔািীুূৃেৈোৌংঃঁ]$/.test(g)) return true
  return false
}

function graphemesMatch(a: string, b: string): boolean {
  if (a === b) return true
  const al = a.toLowerCase()
  const bl = b.toLowerCase()
  if (al === bl) return true
  const bnEquiv: Record<string, string[]> = {
    'শ': ['স', 'ষ'], 'স': ['শ', 'ষ'], 'ষ': ['শ', 'স'],
    'ন': ['ণ'], 'ণ': ['ন'], 'ব': ['ভ'], 'ভ': ['ব'],
  }
  if (bnEquiv[a]?.includes(b)) return true
  const enEquiv: Record<string, string[]> = { 's': ['sh'], 'v': ['b'], 'j': ['z'] }
  if (enEquiv[al]?.includes(bl)) return true
  if (enEquiv[bl]?.includes(al)) return true
  return false
}

// ─── Token matching ────────────────────────────────────────────────────────

/**
 * §TOKEN-MATCH: Check if query tokens match candidate tokens.
 * Returns match count and best position.
 */
function tokenMatch(queryTokens: string[], candidateTokens: string[]): {
  matchCount: number
  bestPosition: MatchPosition
  bestIndex: number
} {
  let matchCount = 0
  let bestPosition: MatchPosition = 'none'
  let bestIndex = -1

  for (const qt of queryTokens) {
    if (qt.length < 2) continue
    const qtLower = qt.toLowerCase()

    // Check each candidate token
    for (let i = 0; i < candidateTokens.length; i++) {
      const ct = candidateTokens[i].toLowerCase()
      if (ct === qtLower) {
        matchCount++
        if (i === 0 && bestPosition !== 'prefix') {
          bestPosition = 'prefix'
          bestIndex = 0
        }
        break
      }
      // Token prefix match (candidate starts with query token)
      if (ct.startsWith(qtLower) && qtLower.length >= 3) {
        matchCount++
        if (i === 0 && bestPosition !== 'prefix') {
          bestPosition = 'prefix'
          bestIndex = 0
        }
        break
      }
      // Query token starts with candidate token (for short candidates like "Alam")
      if (qtLower.startsWith(ct) && ct.length >= 3) {
        matchCount++
        if (bestPosition === 'none') {
          bestPosition = i === 0 ? 'prefix' : 'infix'
          bestIndex = i
        }
        break
      }
    }
  }

  return { matchCount, bestPosition, bestIndex }
}

// ─── Ranking ───────────────────────────────────────────────────────────────

function positionToScore(position: MatchPosition): number {
  switch (position) {
    case 'prefix': return 0
    case 'infix': return 1
    case 'suffix': return 2
    default: return 3
  }
}

/**
 * §DETERMINISTIC-RANK: Rank items by deterministic match hierarchy.
 *
 * NO FUZZY MATCHING — fuzzy does NOT create candidates.
 * Only exact, token, prefix, searchTag, and secondary field matches generate results.
 */
export function rankByPosition<T>(
  items: T[],
  query: string,
  getTextField: (item: T) => string,
  getSearchFields?: (item: T) => string[]
): RankedMatch<T>[] {
  if (!query || query.trim().length < 2) return []

  const q = query.trim()
  const queryTokens = q.split(/\s+/).filter((w) => w.length >= 2)
  const ranked: RankedMatch<T>[] = []

  for (const item of items) {
    const primaryText = getTextField(item) || ''

    // ── LEVEL 1-3: Exact full-query substring match in primary field ──
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

    // ── LEVEL 7: Bengali-normalized match (vowel variant) ──
    const bnVariant = findBengaliVariantMatch(primaryText, q)
    if (bnVariant) {
      ranked.push({
        item,
        position: bnVariant.position,
        matchIndex: bnVariant.index,
        matchLength: bnVariant.length,
        matchedText: primaryText.substring(bnVariant.index, bnVariant.index + bnVariant.length),
        score: positionToScore(bnVariant.position) + 7.0,
      })
      continue
    }

    // ── LEVEL 8: Bengali→English common word match ──
    // Check if the query (or any query token) is a common Bengali word
    // with a known English equivalent (e.g., সিমেন্ট → cement)
    const queryWords = q.split(/\s+/).filter((w) => w.length >= 2)
    let bnEnMatched = false
    for (const word of queryWords) {
      const equivalents = getBengaliEnglishEquivalents(word)
      for (const eq of equivalents) {
        // Check primary field
        const eqMatch = findMatchPosition(primaryText, eq)
        if (eqMatch.index >= 0) {
          ranked.push({
            item,
            position: eqMatch.position,
            matchIndex: eqMatch.index,
            matchLength: eqMatch.length,
            matchedText: primaryText.substring(eqMatch.index, eqMatch.index + eqMatch.length),
            score: positionToScore(eqMatch.position) + 8.0,
          })
          bnEnMatched = true
          break
        }
        // Check searchTags/secondary fields
        if (getSearchFields) {
          const fields = getSearchFields(item)
          for (const field of fields) {
            if (!field) continue
            const fieldEqMatch = findMatchPosition(field, eq)
            if (fieldEqMatch.index >= 0) {
              ranked.push({
                item,
                position: fieldEqMatch.position,
                matchIndex: -1,
                matchLength: fieldEqMatch.length,
                matchedText: field.substring(fieldEqMatch.index, fieldEqMatch.index + fieldEqMatch.length),
                score: positionToScore(fieldEqMatch.position) + 8.5,
              })
              bnEnMatched = true
              break
            }
          }
          if (bnEnMatched) break
        }
      }
      if (bnEnMatched) break
    }
    if (bnEnMatched) continue

    // ── LEVEL 2: Cross-lingual match in primary field ──
    const cross = findCrossLingualMatch(primaryText, q)
    if (cross) {
      ranked.push({
        item,
        position: cross.position,
        matchIndex: cross.start,
        matchLength: cross.end - cross.start,
        matchedText: primaryText.substring(cross.start, cross.end),
        score: positionToScore(cross.position) + 2.0,
      })
      continue
    }

    // ── LEVEL 4-5: Token-based matching ──
    if (queryTokens.length > 0) {
      const candidateTokens = primaryText.split(/\s+/).filter((w) => w.length >= 1)
      const { matchCount, bestPosition, bestIndex } = tokenMatch(queryTokens, candidateTokens)

      if (matchCount > 0) {
        // §MULTI-TOKEN-BONUS: Each additional matching token improves score.
        // But position still dominates (1.0 gap between tiers).
        const multiTokenBonus = matchCount > 1 ? (matchCount - 1) * 0.25 : 0
        const baseScore = 3.0 + positionToScore(bestPosition)
        ranked.push({
          item,
          position: bestPosition,
          matchIndex: bestIndex,
          matchLength: 0,
          matchedText: '',
          score: baseScore - multiTokenBonus,
        })
        continue
      }

      // ── LEVEL 5: Token match against searchTags ──
      if (getSearchFields) {
        const fields = getSearchFields(item)
        let tagMatched = false
        for (const field of fields) {
          if (!field) continue
          // Exact substring in searchTag
          const tagExact = findMatchPosition(field, q)
          if (tagExact.index >= 0) {
            ranked.push({
              item,
              position: tagExact.position,
              matchIndex: -1,
              matchLength: tagExact.length,
              matchedText: field.substring(tagExact.index, tagExact.index + tagExact.length),
              score: positionToScore(tagExact.position) + 5.0,
            })
            tagMatched = true
            break
          }
          // Per-token match against searchTags
          for (const qt of queryTokens) {
            if (qt.length < 2) continue
            const tagTokenMatch = findMatchPosition(field, qt)
            if (tagTokenMatch.index >= 0) {
              ranked.push({
                item,
                position: tagTokenMatch.position,
                matchIndex: -1,
                matchLength: tagTokenMatch.length,
                matchedText: field.substring(tagTokenMatch.index, tagTokenMatch.index + tagTokenMatch.length),
                score: positionToScore(tagTokenMatch.position) + 5.5,
              })
              tagMatched = true
              break
            }
          }
          if (tagMatched) break
        }
        if (tagMatched) continue

        // ── LEVEL 6: Secondary field exact match (phone, sku, etc.) ──
        let fieldMatched = false
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
              score: positionToScore(fieldMatch.position) + 6.0,
            })
            fieldMatched = true
            break
          }
          // Per-token match against secondary fields
          for (const qt of queryTokens) {
            if (qt.length < 2) continue
            const tokenFieldMatch = findMatchPosition(field, qt)
            if (tokenFieldMatch.index >= 0) {
              ranked.push({
                item,
                position: tokenFieldMatch.position,
                matchIndex: tokenFieldMatch.index,
                matchLength: tokenFieldMatch.length,
                matchedText: field.substring(tokenFieldMatch.index, tokenFieldMatch.index + tokenFieldMatch.length),
                score: positionToScore(tokenFieldMatch.position) + 6.5,
              })
              fieldMatched = true
              break
            }
          }
          if (fieldMatched) break
        }
        if (fieldMatched) continue
      }
    }

    // ── NO MATCH: Item is FILTERED OUT ──
    // Fuzzy matching does NOT create candidates.
  }

  // Sort by score (ascending = best first), then by match length (descending),
  // then by name length (ascending = shorter name first)
  ranked.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    const aLen = (a.matchedText || '').length
    const bLen = (b.matchedText || '').length
    if (aLen !== bLen) return bLen - aLen
    const aNameLen = (a.item as any)?.name?.length || 0
    const bNameLen = (b.item as any)?.name?.length || 0
    return aNameLen - bNameLen
  })

  return ranked
}

// ─── Highlighting (grapheme-safe, cross-lingual) ──────────────────────────

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

  // 1. Exact substring match
  const exact = findMatchPosition(text, q)
  if (exact.index >= 0) {
    return {
      before: text.substring(0, exact.index),
      match: text.substring(exact.index, exact.index + exact.length),
      after: text.substring(exact.index + exact.length),
      matched: true,
    }
  }

  // 2. Bengali variant match
  const bnVariant = findBengaliVariantMatch(text, q)
  if (bnVariant) {
    return {
      before: text.substring(0, bnVariant.index),
      match: text.substring(bnVariant.index, bnVariant.index + bnVariant.length),
      after: text.substring(bnVariant.index + bnVariant.length),
      matched: true,
    }
  }

  // 3. Cross-lingual match
  const cross = findCrossLingualMatch(text, q)
  if (cross) {
    return {
      before: text.substring(0, cross.start),
      match: text.substring(cross.start, cross.end),
      after: text.substring(cross.end),
      matched: true,
    }
  }

  // 4. Per-word match
  const words = q.split(/\s+/).filter((w) => w.length >= 2)
  if (words.length > 0) {
    const ranges: Array<{ start: number; end: number }> = []

    for (const word of words) {
      const wordExact = findMatchPosition(text, word)
      if (wordExact.index >= 0) {
        ranges.push({ start: wordExact.index, end: wordExact.index + wordExact.length })
        continue
      }
      const wordBnVariant = findBengaliVariantMatch(text, word)
      if (wordBnVariant) {
        ranges.push({ start: wordBnVariant.index, end: wordBnVariant.index + wordBnVariant.length })
        continue
      }
      const wordCross = findCrossLingualMatch(text, word)
      if (wordCross) {
        ranges.push({ start: wordCross.start, end: wordCross.end })
        continue
      }
    }

    if (ranges.length > 0) {
      ranges.sort((a, b) => a.start - b.start)
      const merged: Array<{ start: number; end: number }> = []
      for (const r of ranges) {
        if (merged.length > 0 && r.start <= merged[merged.length - 1].end) {
          merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, r.end)
        } else {
          merged.push({ ...r })
        }
      }
      const first = merged[0]
      return {
        before: text.substring(0, first.start),
        match: text.substring(first.start, first.end),
        after: text.substring(first.end),
        matched: true,
      }
    }
  }

  return { before: text, match: '', after: '', matched: false }
}

/**
 * §MULTI-RANGE-HIGHLIGHT: Find ALL highlight ranges in the text for a query.
 * Uses the SAME matching as rankByPosition — no separate highlight algorithm.
 */
export function findAllHighlightRanges(text: string, query: string): Array<{ start: number; end: number }> {
  if (!text || !query || query.trim().length < 2) return []

  const q = query.normalize('NFC').trim()
  const normalizedText = text.normalize('NFC')
  const ranges: Array<{ start: number; end: number }> = []

  // 1. Exact full-query match
  const exact = findMatchPosition(normalizedText, q)
  if (exact.index >= 0) {
    ranges.push({ start: exact.index, end: exact.index + exact.length })
    return ranges
  }

  // 2. Bengali variant match (full query)
  const bnVariant = findBengaliVariantMatch(normalizedText, q)
  if (bnVariant) {
    ranges.push({ start: bnVariant.index, end: bnVariant.index + bnVariant.length })
    return ranges
  }

  // 2b. Bengali→English common word match (e.g., সিমেন্ট → cement)
  const queryWords = q.split(/\s+/).filter((w) => w.length >= 2)
  for (const word of queryWords) {
    const equivalents = getBengaliEnglishEquivalents(word)
    for (const eq of equivalents) {
      const eqMatch = findMatchPosition(normalizedText, eq)
      if (eqMatch.index >= 0) {
        ranges.push({ start: eqMatch.index, end: eqMatch.index + eqMatch.length })
        return ranges
      }
    }
  }

  // 3. Cross-lingual match (full query)
  const cross = findCrossLingualMatch(normalizedText, q)
  if (cross) {
    ranges.push({ start: cross.start, end: cross.end })
    return ranges
  }

  // 4. Per-word match
  const words = q.split(/\s+/).filter((w) => w.length >= 2)
  for (const word of words) {
    const wordExact = findMatchPosition(normalizedText, word)
    if (wordExact.index >= 0) {
      ranges.push({ start: wordExact.index, end: wordExact.index + wordExact.length })
      continue
    }
    const wordBnVariant = findBengaliVariantMatch(normalizedText, word)
    if (wordBnVariant) {
      ranges.push({ start: wordBnVariant.index, end: wordBnVariant.index + wordBnVariant.length })
      continue
    }
    const wordCross = findCrossLingualMatch(normalizedText, word)
    if (wordCross) {
      ranges.push({ start: wordCross.start, end: wordCross.end })
      continue
    }
  }

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
