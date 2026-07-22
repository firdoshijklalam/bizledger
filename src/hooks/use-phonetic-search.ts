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
}

export function usePhoneticSearch<T extends Record<string, any>>(
  data: T[] | null | undefined,
  query: string,
  options: SearchOptions = {}
): T[] {
  const { searchFields = [], phonetic = true } = options

  return useMemo(() => {
    if (!data) return []
    if (!query || !query.trim()) return data

    const q = query.toLowerCase().trim()

    // Phase 1: Fast path — exact substring matches (highest priority)
    const exactMatches: T[] = []
    const remaining: T[] = []
    for (const item of data) {
      const name = (item.name || '').toString().toLowerCase()
      let matched = name.includes(q)
      if (!matched && item.searchTags) {
        try {
          const tags = typeof item.searchTags === 'string' ? JSON.parse(item.searchTags) : item.searchTags
          if (Array.isArray(tags) && tags.some((tag: string) => tag.toLowerCase().includes(q))) matched = true
        } catch {}
      }
      if (!matched) {
        for (const field of searchFields) {
          if ((item[field] || '').toString().toLowerCase().includes(q)) { matched = true; break }
        }
      }
      if (matched) exactMatches.push(item)
      else remaining.push(item)
    }

    // Phase 2: Fuse.js fuzzy match on remaining items (tolerant of typos)
    const fuseKeys = [
      { name: 'name', weight: 0.5 },
      ...searchFields.map((f) => ({ name: f, weight: 0.2 })),
      { name: 'searchTags', weight: 0.1 },
    ].filter((k) => k.name)

    const fuse = new Fuse(remaining, {
      keys: fuseKeys,
      threshold: 0.4, // tolerant but not too loose
      ignoreLocation: true,
      minMatchCharLength: 1,
      includeScore: true,
    })
    const fuzzyResults = fuse.search(query).map((r) => r.item)

    // Phase 3: Phonetic fallback on items not yet matched
    const phoneticResults: T[] = []
    if (phonetic) {
      const alreadyMatched = new Set([...exactMatches, ...fuzzyResults])
      for (const item of remaining) {
        if (alreadyMatched.has(item)) continue
        if (item.name && phoneticMatch(query, item.name)) {
          phoneticResults.push(item)
        }
      }
    }

    return [...exactMatches, ...fuzzyResults, ...phoneticResults]
  }, [data, query, searchFields, phonetic])
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
