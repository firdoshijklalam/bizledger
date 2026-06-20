// Cross-language phonetic search (PRD v2 §12.2)
// Bengali ↔ English sound matching using a simplified Soundex-like algorithm.
//
// Use case: DB has "মিনিকেট" (Bengali). Voice says "Miniket" (English).
// We transliterate Bengali → Latin, then compare phonetic codes.

// Bengali to Latin transliteration map (common letters)
const BN_TO_LATIN: Record<string, string> = {
  'অ': 'a', 'আ': 'a', 'ই': 'i', 'ঈ': 'i', 'উ': 'u', 'ঊ': 'u',
  'এ': 'e', 'ঐ': 'oi', 'ও': 'o', 'ঔ': 'ou',
  'ক': 'k', 'খ': 'kh', 'গ': 'g', 'ঘ': 'gh', 'ঙ': 'ng',
  'চ': 'ch', 'ছ': 'chh', 'জ': 'j', 'ঝ': 'jh', 'ঞ': 'n',
  'ট': 't', 'ঠ': 'th', 'ড': 'd', 'ঢ': 'dh', 'ণ': 'n',
  'ত': 't', 'থ': 'th', 'দ': 'd', 'ধ': 'dh', 'ন': 'n',
  'প': 'p', 'ফ': 'ph', 'ব': 'b', 'ভ': 'bh', 'ম': 'm',
  'য': 'j', 'র': 'r', 'ল': 'l', 'শ': 'sh', 'ষ': 'sh', 'স': 's', 'হ': 'h',
  'ড়': 'r', 'ঢ়': 'rh',
  'ৎ': 't', 'ং': 'ng', 'ঃ': 'h', 'ঁ': '',
  'ি': 'i', 'ী': 'i', 'ু': 'u', 'ূ': 'u', 'ে': 'e', 'ৈ': 'oi', 'ো': 'o', 'ৌ': 'ou', 'া': 'a',
  'ৃ': 'ri',
  '়': '',
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
}

/** Transliterate Bengali text to Latin script. */
export function transliterate(text: string): string {
  let result = ''
  for (const ch of text) {
    result += BN_TO_LATIN[ch] ?? ch
  }
  return result
}

/** Normalize text for phonetic comparison: lowercase, remove vowels, collapse consonants. */
export function phoneticCode(text: string): string {
  // Transliterate if Bengali
  const latin = /[\u0980-\u09FF]/.test(text) ? transliterate(text) : text
  // Lowercase, remove non-alpha
  const cleaned = latin.toLowerCase().replace(/[^a-z]/g, '')
  if (!cleaned) return ''

  // Simple Soundex-like: keep first letter, then map consonants to groups
  const first = cleaned[0]
  const map: Record<string, string> = {
    b: '1', f: '1', p: '1', v: '1',
    c: '2', g: '2', j: '2', k: '2', q: '2', s: '2', x: '2', z: '2',
    d: '3', t: '3',
    l: '4',
    m: '5', n: '5',
    r: '6',
  }
  let code = first
  let prev = map[first] || ''
  for (let i = 1; i < cleaned.length && code.length < 6; i++) {
    const c = cleaned[i]
    const digit = map[c] || ''
    if (digit && digit !== prev) {
      code += digit
    }
    if (digit) prev = digit
  }
  return code.padEnd(4, '0').substring(0, 4)
}

/** Check if two strings sound alike (phonetic match). */
export function soundsLike(a: string, b: string): boolean {
  return phoneticCode(a) === phoneticCode(b)
}

/**
 * Search an array of items by name, with exact → contains → phonetic fallback.
 * Returns items ranked by match quality.
 */
export function phoneticSearch<T extends { name: string; [k: string]: any }>(
  items: T[],
  query: string
): Array<{ item: T; score: number }> {
  if (!query.trim()) return items.map((item) => ({ item, score: 0 }))
  const q = query.toLowerCase().trim()
  const qPhonetic = phoneticCode(q)

  const results: Array<{ item: T; score: number }> = []
  for (const item of items) {
    const name = (item.name || '').toLowerCase()
    // Exact match — highest score
    if (name === q) {
      results.push({ item, score: 100 })
      continue
    }
    // Starts with query
    if (name.startsWith(q)) {
      results.push({ item, score: 80 })
      continue
    }
    // Contains query
    if (name.includes(q)) {
      results.push({ item, score: 60 })
      continue
    }
    // Phonetic match (transliterate if Bengali)
    const itemPhonetic = phoneticCode(item.name)
    if (qPhonetic && itemPhonetic === qPhonetic) {
      results.push({ item, score: 40 })
      continue
    }
    // Cross-language: transliterate Bengali name to Latin, then check contains
    const translitName = transliterate(item.name).toLowerCase()
    if (translitName.includes(q)) {
      results.push({ item, score: 50 })
      continue
    }
  }
  return results.sort((a, b) => b.score - a.score)
}
