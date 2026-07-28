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

    // Helper: extract the "name" from an item (uses custom getName if provided)
    const extractName = (item: any): string => {
      if (getName) return getName(item).toLowerCase()
      return (item.name || '').toString().toLowerCase()
    }

    // Helper: extract all searchable values from an item
    const extractSearchValues = (item: any): string[] => {
      const values: string[] = []
      for (const field of searchFields) {
        const val = (item[field] || '').toString().toLowerCase()
        if (val) values.push(val)
      }
      if (getSearchValues) {
        for (const v of getSearchValues(item)) {
          if (v) values.push(v.toLowerCase())
        }
      }
      return values
    }

    // Phase 1: Fast path — exact substring matches (highest priority)
    const exactMatches: T[] = []
    const remaining: T[] = []
    for (const item of data) {
      const name = extractName(item)
      let matched = name.includes(q)
      if (!matched && item.searchTags) {
        try {
          const tags = typeof item.searchTags === 'string' ? JSON.parse(item.searchTags) : item.searchTags
          if (Array.isArray(tags) && tags.some((tag: string) => tag.toLowerCase().includes(q))) matched = true
        } catch {}
      }
      if (!matched) {
        // Check searchFields + getSearchValues
        for (const val of extractSearchValues(item)) {
          if (val.includes(q)) { matched = true; break }
        }
      }
      if (matched) exactMatches.push(item)
      else remaining.push(item)
    }

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
      // §STRICT: Lowered threshold from 0.4 to 0.25 to prevent false positives.
      // 0.4 was too loose — it matched scattered characters (e.g., "Das"
      // matching "Maa Lakshmi Bhandar" because 'd' and 's' appear somewhere).
      // 0.25 requires a much closer match (typo tolerance only, not scattered chars).
      threshold: 0.25,
      // §STRICT: ignoreLocation: false means Fuse considers WHERE the match
      // occurs. With ignoreLocation: true, Fuse matches anywhere in a long
      // string, causing false positives. Setting to false requires the match
      // to be near the start or in a reasonable location.
      ignoreLocation: false,
      // §STRICT: minMatchCharLength: 2 means at least 2 consecutive characters
      // must match. This prevents single-character scattered matches.
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
