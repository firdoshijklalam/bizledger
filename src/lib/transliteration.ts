/**
 * §3: Cross-Lingual Phonetic Transliteration Utility
 *
 * Generates English phonetic equivalents from Bengali text so that searching
 * "Utsab" finds "উৎসব", or "Amit" finds "অমিত".
 *
 * Implements a comprehensive Bengali→ISO-15919 (romanized) mapping covering:
 * - Vowels (স্বর)
 * - Consonants (ব্যঞ্জন)
 * - Conjuncts (যুক্তাক্ষর)
 * - Common digraphs
 *
 * Also includes reverse English→Bengali phonetic matching for search lookups.
 */

// Bengali vowel → romanized phonetic
const VOWEL_MAP: Record<string, string> = {
  'অ': 'a',
  'আ': 'aa',
  'ই': 'i',
  'ঈ': 'ii',
  'উ': 'u',
  'ঊ': 'uu',
  'ঋ': 'ri',
  'এ': 'e',
  'ঐ': 'oi',
  'ও': 'o',
  'ঔ': 'ou',
  'া': 'aa',
  'ি': 'i',
  'ী': 'ii',
  'ু': 'u',
  'ূ': 'uu',
  'ৃ': 'ri',
  'ে': 'e',
  'ৈ': 'oi',
  'ো': 'o',
  'ৌ': 'ou',
  'ং': 'ng',
  'ঃ': 'h',
  'ঁ': 'n',
  '্': '', // virama (hasanta) — suppresses inherent vowel
  '়': '', // nukta
}

// Bengali consonant → romanized phonetic
const CONSONANT_MAP: Record<string, string> = {
  'ক': 'k',
  'খ': 'kh',
  'গ': 'g',
  'ঘ': 'gh',
  'ঙ': 'ng',
  'চ': 'ch',
  'ছ': 'chh',
  'জ': 'j',
  'ঝ': 'jh',
  'ঞ': 'n',
  'ট': 't',
  'ঠ': 'th',
  'ড': 'd',
  'ঢ': 'dh',
  'ণ': 'n',
  'ত': 't',
  'থ': 'th',
  'দ': 'd',
  'ধ': 'dh',
  'ন': 'n',
  'প': 'p',
  'ফ': 'ph',
  'ব': 'b',
  'ভ': 'bh',
  'ম': 'm',
  'য': 'j',
  'র': 'r',
  'ল': 'l',
  'শ': 'sh',
  'ষ': 'sh',
  'স': 's',
  'হ': 'h',
  'ড়': 'r',
  'ঢ়': 'rh',
  'য়': 'y',
  'ৎ': 't',
}

// Common conjuncts (যুক্তাক্ষর) — must be checked before single-char mapping
const CONJUNCT_MAP: Record<string, string> = {
  'ক্ষ': 'kkho',
  'জ্ঞ': 'ggyo',
  'ত্র': 'tro',
  'ক্ত': 'kto',
  'ন্ত': 'nto',
  'ন্দ': 'ndo',
  'স্ত': 'sto',
  'স্ন': 'sno',
  'ষ্ট': 'shto',
  'ষ্ণ': 'shno',
  'ষ্ঠ': 'shtho',
  'হ্ম': 'hmo',
  'দ্ভ': 'dbho',
  'দ্ধ': 'ddho',
  'ণ্ঠ': 'ntho',
  'ণ্ড': 'ndo',
  'ল্প': 'lpo',
  'ল্ব': 'lbo',
  'ল্ম': 'lmo',
  'র্ক': 'rko',
  'র্গ': 'rgo',
  'র্ঘ': 'rgho',
  'র্চ': 'rcho',
  'র্জ': 'rjo',
  'র্ঝ': 'rjho',
  'র্ট': 'rto',
  'র্ড': 'rdo',
  'র্ণ': 'rno',
  'র্ত': 'rto',
  'র্থ': 'rtho',
  'র্ধ': 'rdho',
  'র্ন': 'rno',
  'র্প': 'rpo',
  'র্ফ': 'rpho',
  'র্ব': 'rbo',
  'র্ভ': 'rbho',
  'র্ম': 'rmo',
  'র্ল': 'rlo',
  'র্শ': 'rsho',
  'র্ষ': 'rsho',
  'র্স': 'rso',
  'র্হ': 'rho',
  'ম্প': 'mpo',
  'ম্ব': 'mbo',
  'ম্ভ': 'mbho',
  'ম্ম': 'mmo',
  'ঙ্ক': 'nko',
  'ঙ্গ': 'ngo',
  'ঞ্চ': 'ncho',
  'ঞ্জ': 'njo',
  'ন্ত': 'nto',
  'ন্থ': 'ntho',
  'ন্দ': 'ndo',
  'ন্ধ': 'ndho',
  'ন্ম': 'nmo',
  'ন্ন': 'nno',
  'প্ত': 'pto',
  'প্ন': 'pno',
  'প্প': 'ppo',
  'প্ল': 'plo',
  'প্স': 'pso',
  'ত্ত': 'tto',
  'ত্থ': 'ttho',
  'ত্ম': 'tmo',
  'থ্ত': 'thto',
  'দ্ম': 'dmo',
  'দ্য': 'dyo',
  'ধ্ম': 'dhmo',
  'য্য': 'yyo',
  'শ্চ': 'shcho',
  'শ্ন': 'shno',
  'শ্ম': 'shmo',
  'শ্র': 'shro',
  'শ্ল': 'shlo',
  'স্ক': 'sko',
  'স্খ': 'skho',
  'স্ট': 'sto',
  'স্ত': 'sto',
  'স্থ': 'stho',
  'স্ন': 'sno',
  'স্প': 'spo',
  'স্ফ': 'spho',
  'স্ম': 'smo',
  'স্ল': 'slo',
  'স্ব': 'sbo',
  'হ্ণ': 'hno',
  'হ্ন': 'hno',
  'হ্র': 'hro',
}

// Numerals
const NUMERAL_MAP: Record<string, string> = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

/**
 * Transliterate Bengali text to romanized English phonetic form.
 * Handles inherent vowels: a consonant NOT followed by a vowel sign or virama (্)
 * gets an inherent "a" sound (Bengali phonetic rule).
 *
 * Example: "উৎসব" → "utsab" (u + t[suppressed] + sa + b → utsab)
 * Example: "অমিত" → "omit" (o + mi + t → omit)
 * Example: "চাল" → "chaal" (ch + aa + l → chaal)
 */
export function transliterateBengaliToEnglish(text: string): string {
  if (!text) return ''

  let result = ''
  let i = 0
  const chars = Array.from(text) // Array.from handles surrogate pairs

  while (i < chars.length) {
    const remaining = chars.slice(i).join('')

    // Check 2-char conjuncts first (conjuncts already include the inherent vowel in their mapping)
    const twoChar = remaining.substring(0, 2)
    if (CONJUNCT_MAP[twoChar]) {
      result += CONJUNCT_MAP[twoChar]
      i += 2
      continue
    }

    const ch = chars[i]
    const nextCh = chars[i + 1]

    // Numerals
    if (NUMERAL_MAP[ch]) {
      result += NUMERAL_MAP[ch]
      i++
      continue
    }

    // Vowels and vowel signs
    if (VOWEL_MAP[ch] !== undefined) {
      result += VOWEL_MAP[ch]
      i++
      continue
    }

    // Consonants
    if (CONSONANT_MAP[ch]) {
      const consonantSound = CONSONANT_MAP[ch]
      // §3: ৎ (khanda ta) is a special consonant that inherently suppresses the following vowel
      // (it's equivalent to ত্). It should NOT add inherent "a" after itself.
      const isKhandaTa = ch === 'ৎ'
      // Inherent vowel rule: a consonant gets inherent "a" UNLESS:
      //  - it's followed by a vowel sign (which provides the vowel)
      //  - it's followed by virama (্) which suppresses the vowel
      //  - it's ৎ (khanda ta) which inherently suppresses
      if (isKhandaTa) {
        // ৎ gives "t" sound, no inherent vowel.
        // It also forms a conjunct with the following consonant — that consonant
        // should NOT get inherent "a" (e.g. ৎস = "ts", not "tasa").
        result += 't'
        i++
        if (nextCh && CONSONANT_MAP[nextCh]) {
          // Add the next consonant sound WITHOUT inherent vowel
          result += CONSONANT_MAP[nextCh]
          i++
        }
        continue
      } else if (nextCh && VOWEL_MAP[nextCh] !== undefined && nextCh !== '্') {
        // Next char is a vowel sign — it provides the vowel, no inherent "a"
        result += consonantSound
      } else if (nextCh && nextCh === '্') {
        // Next char is virama — suppress inherent vowel
        result += consonantSound
      } else if (!nextCh || (nextCh && !CONSONANT_MAP[nextCh] && !VOWEL_MAP[nextCh] && !NUMERAL_MAP[nextCh])) {
        // Last consonant or followed by non-Bengali char — add inherent "a"
        result += consonantSound + 'a'
      } else if (nextCh && CONSONANT_MAP[nextCh]) {
        // Next is another consonant — add inherent "a"
        result += consonantSound + 'a'
      } else {
        result += consonantSound
      }
      i++
      continue
    }

    // Virama (্) — skip, already handled by the preceding consonant
    if (ch === '্') {
      i++
      continue
    }

    // ASCII / other — keep as-is
    result += ch
    i++
  }

  // Post-processing: clean up for looser matching
  result = result
    .replace(/a{2,}/g, 'a') // collapse "aa" → "a"
    .replace(/([bcdfghjklmnpqrstvwxyz])\1+/g, '$1') // collapse double consonants (bb → b)

  return result.toLowerCase()
}

/**
 * Generate search tags for an entity. Returns an array of phonetic variants
 * that a user might type in English to find the Bengali-named item.
 *
 * Example: "উৎসব" → ["utsab", "utshob", "utsob", "utsav", "উৎসব"]
 * Example: "অমিত" → ["omit", "amit", "অমিত"]
 */
export function generateSearchTags(name: string): string[] {
  if (!name || typeof name !== 'string') return []

  const tags = new Set<string>()
  // Original name (for Bengali text search)
  tags.add(name.toLowerCase())

  const romanized = transliterateBengaliToEnglish(name)
  if (romanized && romanized.trim()) {
    tags.add(romanized)

    // Common phonetic variants for looser matching
    // Replace 'o' with 'a' (Bengali অ can be either "o" or "a")
    tags.add(romanized.replace(/o/g, 'a'))
    // Replace 'a' with 'o' (reverse direction)
    tags.add(romanized.replace(/a/g, 'o'))
    // Replace 'aa' with 'a'
    tags.add(romanized.replace(/aa/g, 'a'))
    // Replace 'b' with 'v' (common in Bengali — ব can be b or v)
    tags.add(romanized.replace(/b/g, 'v'))
    // Replace 'j' with 'z' (common confusion)
    tags.add(romanized.replace(/j/g, 'z'))
    // Replace 'sh' with 's'
    tags.add(romanized.replace(/sh/g, 's'))
    // Replace 't' with 'th'
    tags.add(romanized.replace(/t/g, 'th'))
    // Replace 'v' with 'b'
    tags.add(romanized.replace(/v/g, 'b'))
    // Replace 'ph' with 'f'
    tags.add(romanized.replace(/ph/g, 'f'))
    // Replace 'chh' with 'ch'
    tags.add(romanized.replace(/chh/g, 'ch'))
    // Replace 'ng' with 'n'
    tags.add(romanized.replace(/ng/g, 'n'))

    // §3: Also generate variants with trailing vowel removed (utsaba → utsab)
    tags.add(romanized.replace(/a$/, ''))
    // And with trailing vowel added (utsab → utsaba)
    if (!romanized.match(/[aeiou]$/)) {
      tags.add(romanized + 'a')
      tags.add(romanized + 'o')
    }
  }

  // Remove empty strings and very short tags (< 2 chars)
  return Array.from(tags).filter((t) => t.trim().length >= 2)
}

/**
 * Check if an English query phonetically matches a Bengali name.
 * Used for cross-lingual search matching.
 */
export function phoneticMatch(query: string, name: string): boolean {
  if (!query || !name) return false
  const q = query.toLowerCase().trim()
  const tags = generateSearchTags(name)
  return tags.some((tag) => tag.includes(q) || q.includes(tag))
}
