'use client'

import { useMemo } from 'react'
import Fuse from 'fuse.js'
import { phoneticMatch, transliterateBengaliToEnglish, transliterateEnglishToBengali } from '@/lib/transliteration'

/**
 * §FUZZY-SEARCH: usePhoneticSearch — SHARED search hook used by ALL screens.
 *
 * Now uses Fuse.js for tolerant fuzzy matching (typos, misspellings) PLUS
 * the existing phonetic + searchTags + substring matching.
 *
 * Search priority:
 * 1. Exact substring match (fast path, .includes())
 * 2. Fuse.js fuzzy match (tolerant — "Fidohhi" matches "Firdosh")
 * 3. searchTags (phonetic aliases — "Utsab" for "উৎসব")
 * 4. Additional fields (phone, sku, category)
 * 5. Phonetic fallback (cross-lingual consonant skeleton matching)
 *
 * Usage:
 *   const filtered = usePhoneticSearch(parties, search, {
 *     searchFields: ['name', 'phone'],
 *   })
 */

interface SearchOptions {
  searchFields?: string[]
  phonetic?: boolean
  // §CUSTOM-NAME: Custom function to extract the "name" from each item.
  // Used for items that don't have a `name` field (e.g., invoices have
  // `invoiceNumber` + `party.name`, transactions have `description` + `party.name`).
  // When provided, this REPLACES the default `item.name` lookup.
  getName?: (item: any) => string
  // §CUSTOM-SEARCH-VALUES: Additional search values to check (beyond searchFields).
  // Used for nested fields like `party.name` that can't be accessed via `item[field]`.
  getSearchValues?: (item: any) => string[]
}

export function usePhoneticSearch<T extends Record<string, any>>(
  data: T[] | null | undefined,
  query: string,
  options: SearchOptions = {}
): T[] {
  const { searchFields = [], phonetic = true, getName, getSearchValues } = options

  return useMemo(() => {
    if (!data) return []
    if (!query || !query.trim()) return data

    const q = query.toLowerCase().trim()

    // §SYMBOL-NORMALIZATION: Normalize symbols like '&' → 'and', '@' → 'at'
    // in both the query and the target strings. This ensures that
    // "দাস এন্ড সন্স" (→ "das end sans") matches "Das & Sons" because
    // after normalization, both become "das and sons".
    const normalizeSymbols = (s: string): string => {
      return s
        .replace(/&/g, ' and ')
        .replace(/@/g, ' at ')
        .replace(/\s+/g, ' ')
        .trim()
    }

    // Helper: extract the "name" from an item (uses custom getName if provided)
    // §SYMBOL-NORMALIZATION: Apply symbol normalization to the name.
    const extractName = (item: any): string => {
      if (getName) return normalizeSymbols(getName(item).toLowerCase())
      return normalizeSymbols((item.name || '').toString().toLowerCase())
    }

    // Helper: extract all searchable values from an item
    const extractSearchValues = (item: any): string[] => {
      const values: string[] = []
      for (const field of searchFields) {
        const val = normalizeSymbols((item[field] || '').toString().toLowerCase())
        if (val) values.push(val)
      }
      if (getSearchValues) {
        for (const v of getSearchValues(item)) {
          if (v) values.push(normalizeSymbols(v.toLowerCase()))
        }
      }
      return values
    }

    // §STOP-WORDS: Filter out common conjunctions/prepositions that cause
    // false positive matches. "and" matches "Bhandar" which is irrelevant.
    const STOP_WORDS = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'in', 'on', 'at', 'to', 'for', 'is', 'are', 'was', 'were', 'end', 'sans'])

    // Phase 1: Fast path — exact substring + cross-lingual + token-based matches
    // §CROSS-LINGUAL: Transliterate the query to the other script.
    // §SYMBOL-NORMALIZATION: Normalize both query and name so '&' → 'and'.
    const normalizedQuery = normalizeSymbols(q)
    const isQueryBengali = /[\u0980-\u09FF]/.test(q)
    const queryTransliterated = isQueryBengali
      ? normalizeSymbols(transliterateBengaliToEnglish(query).toLowerCase().trim())
      : transliterateEnglishToBengali(query).toLowerCase().trim()
    const queryTransliteratedNormalized = normalizeSymbols(queryTransliterated)
    // Split both original and transliterated query into tokens
    const queryTokens = normalizedQuery.split(/\s+/).filter((w) => w.length >= 2)
    const transliteratedTokens = queryTransliteratedNormalized.split(/\s+/).filter((w) => w.length >= 2)
    // Unique tokens from both original and transliterated
    const allTokens = Array.from(new Set([...queryTokens, ...transliteratedTokens]))
    // §STOP-WORDS: Filter out stop words from token matching.
    // These tokens are too common and cause false positives (e.g., "and" in "Bhandar").
    const significantTokens = allTokens.filter((t) => !STOP_WORDS.has(t))

    // §SCORED-MATCHES: Each item gets a score based on how well it matches.
    // Higher score = better match = appears higher in results.
    // Scoring hierarchy:
    //   1000+ = Full query exact substring match
    //   900+  = Full transliterated query match
    //   500+  = Prefix match (token at index 0 of name)
    //   300+  = Infix match (token in the middle of name)
    //   100+  = Suffix match (token at end of name)
    //   50+   = Search tag match
    //   10+   = Search field match
    //   1+    = 3-char substring fallback
    const scoredMatches: Array<{ item: T; score: number }> = []
    const remaining: T[] = []

    for (const item of data) {
      const name = extractName(item)
      let matched = false
      let score = 0

      // §EXACT-SUBSTRING: Full query as substring (highest priority)
      if (name.includes(normalizedQuery)) {
        matched = true
        score = 1000
        // Bonus: if it's a prefix match (starts at index 0)
        if (name.startsWith(normalizedQuery)) score += 500
      }

      // §CROSS-LINGUAL-SUBSTRING: Full transliterated query as substring
      if (!matched && queryTransliteratedNormalized) {
        if (name.includes(queryTransliteratedNormalized)) {
          matched = true
          score = 900
          if (name.startsWith(queryTransliteratedNormalized)) score += 400
        }
      }

      // §TOKEN-BASED: Check each SIGNIFICANT token (stop words filtered out).
      // Prefix matches score much higher than infix matches.
      if (!matched || score < 500) {
        for (const token of significantTokens) {
          const idx = name.indexOf(token)
          if (idx >= 0) {
            matched = true
            if (idx === 0) {
              // Prefix match — highest token score
              score = Math.max(score, 500 + token.length * 10)
            } else if (idx + token.length === name.length) {
              // Suffix match — lower score
              score = Math.max(score, 100 + token.length * 5)
            } else {
              // Infix match — middle score
              score = Math.max(score, 300 + token.length * 5)
            }
          }
        }
      }

      // §3-CHAR-SUBSTRING: If no token match, check if any 3+ char consecutive
      // substring from the query exists in the name. This catches typos.
      // Very low score — these are fuzzy fallbacks.
      if (!matched) {
        for (const token of allTokens) {
          if (token.length >= 4 && !STOP_WORDS.has(token)) {
            for (let i = 0; i <= token.length - 3; i++) {
              const sub = token.substring(i, i + 3)
              if (name.includes(sub)) { matched = true; score = 10; break }
            }
            if (matched) break
          }
        }
      }

      // §SEARCH-TAGS: Check searchTags with same token-based logic
      if (!matched && item.searchTags) {
        try {
          const tags = typeof item.searchTags === 'string' ? JSON.parse(item.searchTags) : item.searchTags
          if (Array.isArray(tags) && tags.some((tag: string) => {
            const tagNormalized = normalizeSymbols(tag.toLowerCase())
            if (tagNormalized.includes(normalizedQuery)) { score = Math.max(score, 50); return true }
            if (queryTransliteratedNormalized && tagNormalized.includes(queryTransliteratedNormalized)) { score = Math.max(score, 45); return true }
            return significantTokens.some((w) => { if (tagNormalized.includes(w)) { score = Math.max(score, 40); return true }; return false })
          })) matched = true
        } catch {}
      }

      // §SEARCH-FIELDS: Check searchFields + getSearchValues with token logic
      if (!matched) {
        for (const val of extractSearchValues(item)) {
          if (val.includes(normalizedQuery)) { matched = true; score = Math.max(score, 20); break }
          if (queryTransliteratedNormalized && val.includes(queryTransliteratedNormalized)) { matched = true; score = Math.max(score, 15); break }
          if (significantTokens.some((w) => { if (val.includes(w)) { score = Math.max(score, 10); return true }; return false })) { matched = true; break }
        }
      }

      if (matched) scoredMatches.push({ item, score })
      else remaining.push(item)
    }

    // §SORT: Sort by score DESCENDING — highest score (best match) first.
    scoredMatches.sort((a, b) => b.score - a.score)
    const exactMatches = scoredMatches.map((s) => s.item)

    // Phase 2: Fuse.js fuzzy match on remaining items (tolerant of typos)
    // §CUSTOM-NAME: If getName is provided, we add a virtual `__searchName` field
    // to each item so Fuse can search it. We also add `__searchValues` for
    // getSearchValues.
    const fuseKeys = [
      { name: 'name', weight: 0.5 },
      { name: '__searchName', weight: 0.5 }, // §CUSTOM-NAME virtual field
      ...searchFields.map((f) => ({ name: f, weight: 0.2 })),
      { name: 'searchTags', weight: 0.1 },
      { name: '__searchValues', weight: 0.15 }, // §CUSTOM-SEARCH-VALUES virtual field
    ]

    const fuseData = remaining.map((item) => ({
      ...item,
      __searchName: getName ? getName(item) : '',
      __searchValues: getSearchValues ? getSearchValues(item).join(' ') : '',
    }))

    const fuse = new Fuse(fuseData, {
      keys: fuseKeys,
      // §BALANCED: threshold 0.35 — sweet spot between too loose (0.5, false
      // positives like "Das" matching "Maa Lakshmi Bhandar") and too strict
      // (0.25, rejects "Firdaus" vs "Firdosh" which is a common typo).
      // At 0.35, Fuse tolerates 1-2 character differences (typos) but
      // requires the majority of characters to match in order.
      threshold: 0.35,
      // §BALANCED: ignoreLocation: true allows matches anywhere in the string.
      // This is needed because "Alam" at the end of "Firdosh Alam" must match
      // even though it's far from the start. Without this, multi-word queries
      // that match at the end would be missed.
      ignoreLocation: true,
      // §BALANCED: minMatchCharLength: 2 — at least 2 consecutive chars must
      // match. Prevents single-char scattered matches but allows 2-char
      // substrings like "Fi" or "Al" to contribute to the score.
      minMatchCharLength: 2,
      includeScore: true,
    })
    const fuzzyResults = fuse.search(query).map((r) => {
      // Strip the virtual fields before returning
      const { __searchName, __searchValues, ...rest } = r.item
      return rest as unknown as T
    })

    // Phase 3: Phonetic fallback on items not yet matched
    const phoneticResults: T[] = []
    if (phonetic) {
      const alreadyMatched = new Set([...exactMatches, ...fuzzyResults])
      for (const item of remaining) {
        if (alreadyMatched.has(item)) continue
        const name = extractName(item)
        if (name && phoneticMatch(query, name)) {
          phoneticResults.push(item)
        }
        // Also check search values phonetically
        if (!name || !phoneticMatch(query, name)) {
          for (const val of extractSearchValues(item)) {
            if (val && phoneticMatch(query, val)) {
              phoneticResults.push(item)
              break
            }
          }
        }
      }
    }

    return [...exactMatches, ...fuzzyResults, ...phoneticResults]
  }, [data, query, searchFields, phonetic, getName, getSearchValues])
}

/**
 * §1: matchItem — standalone function (not a hook) for one-off searches.
 * Same logic as usePhoneticSearch but can be called directly.
 */
export function matchItem(
  item: Record<string, any>,
  query: string,
  searchFields: string[] = [],
  usePhonetic = true
): boolean {
  if (!query || !query.trim()) return true
  const q = query.toLowerCase().trim()

  // 1. Name
  const name = (item.name || '').toString().toLowerCase()
  if (name.includes(q)) return true

  // 2. searchTags
  if (item.searchTags) {
    try {
      const tags = typeof item.searchTags === 'string'
        ? JSON.parse(item.searchTags)
        : item.searchTags
      if (Array.isArray(tags) && tags.some((tag: string) => tag.toLowerCase().includes(q))) {
        return true
      }
    } catch {}
  }

  // 3. Additional fields
  for (const field of searchFields) {
    const val = (item[field] || '').toString().toLowerCase()
    if (val.includes(q)) return true
  }

  // 4. Phonetic
  if (usePhonetic && item.name) {
    if (phoneticMatch(query, item.name)) return true
  }

  return false
}
