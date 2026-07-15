'use client'

import { useMemo } from 'react'
import { phoneticMatch, transliterateBengaliToEnglish, transliterateEnglishToBengali } from '@/lib/transliteration'

/**
 * §1: usePhoneticSearch — SHARED search hook used by ALL screens.
 * 
 * Replaces the fragmented `.includes()` checks with a unified search that:
 * 1. Checks the primary name field (case-insensitive substring)
 * 2. Checks searchTags (JSON array of phonetic aliases — e.g. "Utsab" for "উৎসব")
 * 3. Checks additional fields (phone, sku, category, etc.)
 * 4. Falls back to phoneticMatch (consonant skeleton + transliteration)
 * 
 * Usage:
 *   const filtered = usePhoneticSearch(parties, search, {
 *     searchFields: ['name', 'phone'],
 *   })
 * 
 * Every search bar in the app uses this SAME logic → consistent behavior.
 */

interface SearchOptions {
  // Fields to check with simple .includes() (besides name + searchTags)
  searchFields?: string[]
  // Whether to use phonetic fallback (default: true)
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

    const filtered = data.filter((item) => {
      // 1. Check primary name field
      const name = (item.name || '').toString().toLowerCase()
      if (name.includes(q)) return true

      // 2. Check searchTags (JSON array of phonetic aliases)
      if (item.searchTags) {
        try {
          const tags = typeof item.searchTags === 'string'
            ? JSON.parse(item.searchTags)
            : item.searchTags
          if (Array.isArray(tags)) {
            if (tags.some((tag: string) => tag.toLowerCase().includes(q))) return true
          }
        } catch {}
      }

      // 3. Check additional fields (phone, sku, category, etc.)
      for (const field of searchFields) {
        const val = (item[field] || '').toString().toLowerCase()
        if (val.includes(q)) return true
      }

      // 4. Phonetic fallback — cross-lingual matching
      // "Utsab" matches "উৎসব", "Abdullah" matches "আব্দুল্লাহ"
      if (phonetic && item.name) {
        if (phoneticMatch(query, item.name)) return true
      }

      return false
    })

    return filtered
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
