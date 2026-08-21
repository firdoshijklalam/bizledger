/**
 * §UNIFIED-SEARCH-ENGINE
 *
 * A single cohesive pipeline that produces deterministic ranked search results
 * WITH highlight metadata that maps back to the visible canonical text.
 *
 * Stages:
 *   A. Alias generation (per-token + full-name, with visible spans)
 *   B. Candidate generation (deterministic only — exact / prefix / infix / alias-tag)
 *   C. Relevance scoring (deterministic tiers, multi-token > single-token)
 *   D. Highlight range resolution (alias match → visible canonical range)
 *
 * Fuzzy matching is used ONLY for alias expansion at generation time (so the
 * alias set itself contains spelling variants). It is NEVER used as a candidate
 * generator at query time, which prevents 3–4 char false positives.
 *
 * §CONTRACT: Every SearchMatch carries enough metadata (highlightRanges) for
 * the UI to highlight the VISIBLE canonical text — even when the match was
 * found via a searchTag alias that the user cannot see.
 */

import { transliterateBengaliToEnglish, transliterateEnglishToBengali } from './transliteration'

// ─── Public types ──────────────────────────────────────────────────────────

export interface VisibleRange {
  start: number // char index in visible canonical text
  end: number // exclusive
}

export type MatchType =
  | 'full-exact-prefix'
  | 'full-exact-infix'
  | 'full-exact-suffix'
  | 'full-bengali-variant'
  | 'full-alias'
  | 'all-tokens'
  | 'multi-token'
  | 'single-token-prefix'
  | 'single-token'
  | 'single-alias'
  | 'bengali-variant'
  | 'common-word'
  | 'controlled-fuzzy-alias'
  | 'secondary-field'

export interface SearchMatch<T> {
  item: T
  score: number
  matchType: MatchType
  matchedQueryTokens: string[]
  matchedAliases: string[]
  highlightRanges: VisibleRange[] // ranges in canonical visible text
  /** For invoices/transactions: the linked party (for related-record display) */
  relatedPartyId?: string
  relatedPartyName?: string
  relatedPartyHighlightRanges?: VisibleRange[]
}

export interface SearchableEntity<T> {
  id: string
  item: T
  /** The canonical visible name (party.name, product.name, invoice.invoiceNumber, etc.) */
  canonical: string
  /** Secondary fields (phone, sku, category, etc.) — searched after primary */
  secondary?: string[]
  /** Aliases with visible spans. If absent, generated from `canonical`. */
  aliases?: AliasEntry[]
  /** For invoices/transactions: linked party info */
  partyId?: string
  partyName?: string
}

// ─── Alias data model ──────────────────────────────────────────────────────

export interface AliasEntry {
  alias: string
  normalized: string
  visibleSpans: VisibleRange[] // ranges in canonical visible text
  isFull: boolean // true if alias spans whole canonical name
}

// ─── Bengali normalization + dictionary ────────────────────────────────────

/**
 * Normalize common Bengali vowel variations.
 *   ি (i) ≈ ে (e)   — ফিরদৌস / ফেরদৌস
 *   ৌ (ou) ≈ ো (o) — দৌস / দোস
 *   ী (ii) ≈ ি (i)
 */
export function normalizeBengaliVowels(text: string): string {
  let result = text.normalize('NFC')
  result = result.replace(/ি/g, 'ে')
  result = result.replace(/ৌ/g, 'ো')
  result = result.replace(/ী/g, 'ি')
  return result
}

/** Lowercase + NFC normalize for case-insensitive comparison. */
function normalize(s: string): string {
  return s.normalize('NFC').toLowerCase().trim()
}

/**
 * Controlled English↔Bengali common-word dictionary.
 * Used for cross-lingual product search like সিমেন্ট → cement.
 */
const COMMON_WORD_PAIRS: Array<{ en: string; bn: string }> = [
  { en: 'cement', bn: 'সিমেন্ট' },
  { en: 'rice', bn: 'চাল' },
  { en: 'rice', bn: 'ভাত' },
  { en: 'oil', bn: 'তেল' },
  { en: 'mustard', bn: 'সরিষা' },
  { en: 'water', bn: 'পানি' },
  { en: 'salt', bn: 'লবণ' },
  { en: 'sugar', bn: 'চিনি' },
  { en: 'flour', bn: 'আটা' },
  { en: 'lentil', bn: 'ডাল' },
  { en: 'dal', bn: 'ডাল' },
  { en: 'bread', bn: 'ব্রেড' },
  { en: 'milk', bn: 'দুধ' },
  { en: 'egg', bn: 'ডিম' },
  { en: 'onion', bn: 'পেঁয়াজ' },
  { en: 'potato', bn: 'আলু' },
  { en: 'garlic', bn: 'রসুন' },
  { en: 'ginger', bn: 'আদা' },
  { en: 'chili', bn: 'মরিচ' },
  { en: 'turmeric', bn: 'হালদি' },
  { en: 'cumin', bn: 'জিরা' },
  { en: 'coriander', bn: 'ধনে' },
  { en: 'tea', bn: 'চায়' },
  { en: 'paper', bn: 'কাগজ' },
  { en: 'bulb', bn: 'বাল্ব' },
  { en: 'chair', bn: 'চেয়ার' },
  { en: 'glass', bn: 'গ্লাস' },
  { en: 'bucket', bn: 'বালতি' },
  { en: 'umbrella', bn: 'ছাতা' },
  { en: 'shoe', bn: 'জুতো' },
  { en: 'soap', bn: 'সাবান' },
]

/** Map English word → Bengali equivalents (for generating bn aliases on en names). */
const ENGLISH_TO_BENGALI: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const { en, bn } of COMMON_WORD_PAIRS) {
    if (!m[en]) m[en] = []
    if (!m[en].includes(bn)) m[en].push(bn)
  }
  return m
})()

/** Map Bengali word → English equivalents (for resolving bn queries against en names). */
const BENGALI_TO_ENGLISH: Record<string, string[]> = (() => {
  const m: Record<string, string[]> = {}
  for (const { en, bn } of COMMON_WORD_PAIRS) {
    if (!m[bn]) m[bn] = []
    if (!m[bn].includes(en)) m[bn].push(en)
  }
  return m
})()

/** Get English equivalents for a Bengali query word (dictionary lookup). */
function getBengaliEnglishEquivalents(word: string): string[] {
  const n = normalize(word)
  return BENGALI_TO_ENGLISH[n] || []
}

// ─── Tokenization ──────────────────────────────────────────────────────────

export interface TokenSpan {
  text: string
  start: number
  end: number
}

/** Split a canonical name into tokens with their visible spans. */
export function tokenizeWithSpans(name: string): TokenSpan[] {
  const tokens: TokenSpan[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(name)) !== null) {
    tokens.push({ text: m[0], start: m.index, end: m.index + m[0].length })
  }
  return tokens
}

// ─── Per-token alias generation (controlled + deterministic) ──────────────

/**
 * §STOPWORDS: Short English connector words that should NOT generate weak
 * infix matches inside other words. For these tokens, only prefix (word-initial)
 * matches are accepted.
 *
 * Example: query "Das and Sons" — token "and" should NOT match "bhandar"
 * (where "and" is an infix substring), but it SHOULD match "Das & Sons"
 * (where the alias "and" replaces "&").
 */
const STOPWORDS = new Set(['and', 'or', 'the', 'a', 'an', 'of', 'for', 'to', 'in', 'on', 'at', 'by', 'with'])

/**
 * Generate phonetic aliases for a single token (English or Bengali).
 *
 * §CONTROLLED: The set is intentionally small and deterministic — we do NOT
 * generate hundreds of fuzzy variants. We generate:
 *   - Original token
 *   - If English: Bengali reverse-transliteration + common vowel variants
 *   - If Bengali: English transliteration + common vowel variants
 *   - Common dictionary mapping (cement ↔ সিমেন্ট)
 *   - Minor spelling variants (drop trailing vowel, swap adjacent vowels)
 *   - Combined vowel+consonant swaps (e.g., "firdosh" → "firdous" via o→ou + sh→s)
 *   - Bengali consonant variants (শ ↔ স, ণ ↔ ন) so "ফেরদৌস" matches "ফেরদৌশ"
 *   - Bengali initial vowel variants (অ ↔ আ) so "Alam" → both "অলম" and "আলম"
 *   - Special "&" handling: emit "and", "এন্ড", "অ্যান্ড" aliases
 */
function generateTokenAliases(token: string): string[] {
  if (!token || !token.trim()) return []
  const t = token.trim()
  const aliases = new Set<string>()
  aliases.add(normalize(t))

  // §AMPERSAND: Special-case "&" — emit "and", "এন্ড", "অ্যান্ড"
  if (t === '&') {
    aliases.add('and')
    aliases.add('এন্ড')
    aliases.add('অ্যান্ড')
    return Array.from(aliases).filter((a) => a.length >= 2)
  }

  const isBengali = /[\u0980-\u09FF]/.test(t)
  const isEnglish = /[a-zA-Z]/.test(t) && !isBengali

  if (isEnglish) {
    // English token → Bengali reverse transliteration
    const bn = transliterateEnglishToBengali(t)
    if (bn && bn.trim() && bn !== t) {
      // §BN-FORMS: Generate the 4 combinations of:
      //   {original initial vowel, swapped initial vowel} × {with vowel signs, skeleton (no vowel signs)}
      // This covers all common Bengali spellings users might type:
      //   "Alam" → bn = "অলাম" (formal), "আলাম" (long initial), "অলম" (skeleton), "আলম" (long initial + skeleton)
      const bnForms = new Set<string>([bn])
      // Initial vowel swap অ ↔ আ
      if (bn.startsWith('অ')) bnForms.add('আ' + bn.substring(1))
      if (bn.startsWith('আ')) bnForms.add('অ' + bn.substring(1))
      // Skeleton (remove vowel signs) — applied to all current forms
      const snapshot = Array.from(bnForms)
      for (const v of snapshot) {
        if (/[ািীুূৃেৈোৌংঃঁ]/.test(v)) {
          const sk = v.replace(/[ািীুূৃেৈোৌংঃঁ]/g, '')
          if (sk.length >= 2 && sk !== v) bnForms.add(sk)
        }
      }
      // Add all forms as aliases
      for (const v of bnForms) aliases.add(normalize(v))

      // Bengali vowel variants (ি ↔ ে, ৌ ↔ ো)
      aliases.add(normalize(bn.replace(/ি/g, 'ে')))
      aliases.add(normalize(bn.replace(/ে/g, 'ি')))
      aliases.add(normalize(bn.replace(/ৌ/g, 'ো')))
      aliases.add(normalize(bn.replace(/ো/g, 'ৌ')))
      // Bengali consonant variants: শ ↔ স ↔ ষ
      if (bn.includes('শ')) aliases.add(normalize(bn.replace(/শ/g, 'স')))
      if (bn.includes('স')) aliases.add(normalize(bn.replace(/স/g, 'শ')))
      if (bn.includes('ণ')) aliases.add(normalize(bn.replace(/ণ/g, 'ন')))
      if (bn.includes('ন')) aliases.add(normalize(bn.replace(/ন/g, 'ণ')))
      // Combined: শ→স + ো→ৌ (so "ফিরদৌশ" → "ফিরদৌস" variants)
      if (bn.includes('শ')) {
        const sw = bn.replace(/শ/g, 'স')
        aliases.add(normalize(sw))
        if (sw.includes('ো')) aliases.add(normalize(sw.replace(/ো/g, 'ৌ')))
        if (sw.startsWith('অ')) aliases.add(normalize('আ' + sw.substring(1)))
        if (sw.includes('ে')) {
          const sw2 = sw.replace(/ে/g, 'ি').replace(/ো/g, 'ৌ')
          aliases.add(normalize(sw2))
        }
      }
    }
    // English vowel swaps (controlled — only common phonetic variants)
    aliases.add(normalize(t.replace(/o/g, 'u'))) // firdosh → firdush
    aliases.add(normalize(t.replace(/o/g, 'ou'))) // firdosh → firdoush
    aliases.add(normalize(t.replace(/i/g, 'e'))) // firdosh → ferdosh
    aliases.add(normalize(t.replace(/e/g, 'i'))) // ferdosh → firdosh
    aliases.add(normalize(t.replace(/sh/g, 's'))) // firdosh → firdos
    // §COMBINED-SWAP: o→ou + sh→s = firdous (NOT just firdoush)
    aliases.add(normalize(t.replace(/o/g, 'ou').replace(/sh/g, 's'))) // firdosh → firdous
    // §COMBINED-SWAP: e→i + sh→s (Ferdous → firdous)
    const withE = t.replace(/e/g, 'i')
    if (withE !== t) aliases.add(normalize(withE.replace(/sh/g, 's')))
    // Drop trailing vowel for short-name tolerance
    if (/[aeiou]$/.test(t.toLowerCase()) && t.length > 3) {
      aliases.add(normalize(t.replace(/[aeiou]$/, '')))
    }
    // Common dictionary mapping (cement → সিমেন্ট)
    const dictBn = ENGLISH_TO_BENGALI[t.toLowerCase()]
    if (dictBn) for (const bn of dictBn) aliases.add(normalize(bn))
  } else if (isBengali) {
    // Bengali token → English transliteration
    const en = transliterateBengaliToEnglish(t)
    if (en && en.trim() && en !== t) {
      aliases.add(normalize(en))
      // English vowel variants of the transliteration
      aliases.add(normalize(en.replace(/o/g, 'u')))
      aliases.add(normalize(en.replace(/o/g, 'ou')))
      aliases.add(normalize(en.replace(/i/g, 'e')))
      aliases.add(normalize(en.replace(/e/g, 'i')))
      // Combined: o→ou + sh→s
      aliases.add(normalize(en.replace(/o/g, 'ou').replace(/sh/g, 's')))
      // Drop trailing vowel
      if (/[aeiou]$/.test(en) && en.length > 3) {
        aliases.add(normalize(en.replace(/[aeiou]$/, '')))
      }
    }
    // Bengali vowel variants of the original token
    aliases.add(normalize(t.replace(/ি/g, 'ে')))
    aliases.add(normalize(t.replace(/ে/g, 'ি')))
    aliases.add(normalize(t.replace(/ৌ/g, 'ো')))
    aliases.add(normalize(t.replace(/ো/g, 'ৌ')))
    // Bengali consonant variants: শ ↔ স ↔ ষ
    if (t.includes('শ')) aliases.add(normalize(t.replace(/শ/g, 'স')))
    if (t.includes('স')) aliases.add(normalize(t.replace(/স/g, 'শ')))
    if (t.includes('ণ')) aliases.add(normalize(t.replace(/ণ/g, 'ন')))
    if (t.includes('ন')) aliases.add(normalize(t.replace(/ন/g, 'ণ')))
    // Bengali initial vowel variant: অ ↔ আ
    if (t.startsWith('অ')) aliases.add(normalize('আ' + t.substring(1)))
    if (t.startsWith('আ')) aliases.add(normalize('অ' + t.substring(1)))
    // Common dictionary mapping (সিমেন্ট → cement)
    const dictEn = BENGALI_TO_ENGLISH[normalize(t)]
    if (dictEn) for (const en of dictEn) aliases.add(normalize(en))
  }

  return Array.from(aliases).filter((a) => a.length >= 2)
}

/**
 * Generate ALL aliases for a canonical name, with visible spans mapping back
 * to the canonical text.
 *
 * Aliases come in three flavors:
 *   1. Token aliases — visible span = that token's span in the canonical name
 *   2. Full-name aliases — visible span = entire canonical name
 *   3. Multi-token aliases — visible span = union of token spans (e.g., "firdosh alam")
 */
export function generateAliasesWithSpans(name: string): AliasEntry[] {
  if (!name || !name.trim()) return []
  const canonical = name.normalize('NFC')
  const tokens = tokenizeWithSpans(canonical)
  const all: AliasEntry[] = []
  const seen = new Set<string>()

  const add = (alias: string, spans: VisibleRange[], isFull: boolean) => {
    const n = normalize(alias)
    if (n.length < 2) return
    // Dedup by (normalized alias, span signature)
    const key = `${n}|${spans.map((s) => `${s.start}-${s.end}`).join(',')}`
    if (seen.has(key)) return
    seen.add(key)
    all.push({ alias, normalized: n, visibleSpans: spans, isFull })
  }

  // 1. Token aliases
  for (const tok of tokens) {
    for (const a of generateTokenAliases(tok.text)) {
      add(a, [{ start: tok.start, end: tok.end }], false)
    }
  }

  // 2. Full-name aliases
  for (const a of generateTokenAliases(canonical)) {
    add(a, [{ start: 0, end: canonical.length }], true)
  }

  // 3. Multi-token aliases (concatenations of token aliases, joined by space)
  if (tokens.length > 1) {
    // For each token, get its aliases; then join one alias from each token.
    const tokenAliasSets = tokens.map((t) => generateTokenAliases(t.text))
    // Build all combinations but limit to avoid combinatorial explosion (max 4 tokens × 10 aliases)
    const MAX_COMBOS = 60
    let combos: string[][] = [[]]
    let aborted = false
    for (let i = 0; i < tokenAliasSets.length && !aborted; i++) {
      const next: string[][] = []
      for (const prefix of combos) {
        for (const alias of tokenAliasSets[i]) {
          next.push([...prefix, alias])
          if (next.length > MAX_COMBOS) {
            aborted = true
            break
          }
        }
        if (aborted) break
      }
      combos = next
    }
    for (const combo of combos) {
      if (combo.length === tokens.length) {
        const alias = combo.join(' ')
        const spans = tokens.map((t) => ({ start: t.start, end: t.end }))
        add(alias, spans, true)
      }
    }
  }

  return all
}

// ─── Position helpers ──────────────────────────────────────────────────────

type Position = 'prefix' | 'infix' | 'suffix' | 'none'

function positionOf(idx: number, length: number, textLen: number): Position {
  if (idx < 0) return 'none'
  if (idx === 0) return 'prefix'
  if (idx + length === textLen) return 'suffix'
  return 'infix'
}

function findSubstring(haystack: string, needle: string): { idx: number; pos: Position; len: number } {
  if (!haystack || !needle || needle.length < 2) return { idx: -1, pos: 'none', len: 0 }
  const h = normalize(haystack)
  const n = normalize(needle)
  if (n.length < 2) return { idx: -1, pos: 'none', len: 0 }
  const idx = h.indexOf(n)
  if (idx < 0) return { idx: -1, pos: 'none', len: 0 }
  return { idx, pos: positionOf(idx, n.length, h.length), len: n.length }
}

function findBengaliVariant(haystack: string, needle: string): { idx: number; pos: Position; len: number } | null {
  if (!haystack || !needle || needle.trim().length < 2) return null
  if (!/[\u0980-\u09FF]/.test(needle)) return null
  const h = normalizeBengaliVowels(normalize(haystack))
  const n = normalizeBengaliVowels(normalize(needle))
  if (n.length < 2) return null
  const idx = h.indexOf(n)
  if (idx < 0) return null
  return { idx, pos: positionOf(idx, n.length, h.length), len: n.length }
}

// ─── Controlled fuzzy (alias-only, ≤2 edit distance) ────────────────────────

/**
 * §CONTROLLED-FUZZY: Compute Levenshtein distance (capped at maxDistance).
 * Returns -1 if distance exceeds maxDistance.
 *
 * Used ONLY against the alias set (which contains controlled phonetic variants).
 * Never used against the canonical name itself.
 */
function levenshteinCapped(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0
  const al = a.length
  const bl = b.length
  if (Math.abs(al - bl) > maxDistance) return -1
  if (al === 0) return bl
  if (bl === 0) return al
  const prev = new Array(bl + 1)
  const curr = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    curr[0] = i
    let rowMin = curr[0]
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
      if (curr[j] < rowMin) rowMin = curr[j]
    }
    if (rowMin > maxDistance) return -1
    for (let j = 0; j <= bl; j++) prev[j] = curr[j]
  }
  return prev[bl]
}

/**
 * Try a controlled fuzzy match between query token and alias.
 * Only matches when:
 *   - Both strings are >= 3 chars
 *   - Edit distance is 1 (for tokens >= 4 chars) or 2 (for tokens >= 6 chars)
 *   - The shorter string is at least 60% of the longer one's length
 *
 * This handles "Abdullah" → alias "abdullah" (exact, no fuzzy needed) AND
 * "Abdulah" → alias "abdullah" (1-char edit distance — controlled fuzzy).
 */
function controlledFuzzyMatchAlias(queryToken: string, alias: string): boolean {
  const q = normalize(queryToken)
  const a = normalize(alias)
  if (q.length < 3 || a.length < 3) return false
  const minLen = Math.min(q.length, a.length)
  const maxLen = Math.max(q.length, a.length)
  if (minLen / maxLen < 0.6) return false
  const maxDist = q.length >= 6 ? 2 : 1
  const d = levenshteinCapped(q, a, maxDist)
  return d >= 0 && d <= maxDist
}

// ─── Query tokens ──────────────────────────────────────────────────────────

export interface QueryToken {
  text: string
  normalized: string
}

function splitQuery(query: string): QueryToken[] {
  return query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length >= 2)
    .map((w) => ({ text: w, normalized: normalize(w) }))
}

// ─── Stage B: Per-item candidate evaluation ───────────────────────────────

interface TokenMatchResult {
  matched: boolean
  viaAlias: boolean
  aliasText?: string
  visibleSpans: VisibleRange[]
  position: Position
}

/**
 * Try to match a single query token against an item.
 *
 * Tries (in order):
 *   1. Exact substring in canonical name → visible span = matched range
 *      §STOPWORD-GUARD: For stopword tokens (and/or/the/etc.), only accept
 *      PREFIX (word-initial) matches. Infix matches of stopwords inside other
 *      words (e.g., "and" inside "bhandar") are rejected.
 *   2. Bengali vowel-variant match in canonical name → visible span = matched range
 *   3. Common dictionary (bn↔en) → visible span = matched range in canonical
 *   4. Exact alias-tag match → visible span = alias's recorded span
 *   5. Substring alias-tag match (alias contains query token, or vice versa)
 *      §STOPWORD-GUARD: stopword tokens can only match via exact alias equality
 *   6. Controlled fuzzy against alias-tag (only for tokens >= 4 chars)
 */
function matchToken(
  queryToken: QueryToken,
  canonical: string,
  canonicalNormalized: string,
  aliases: AliasEntry[]
): TokenMatchResult | null {
  const isStopword = STOPWORDS.has(queryToken.normalized)

  // 1. Exact substring in canonical
  const exact = findSubstring(canonical, queryToken.text)
  if (exact.idx >= 0) {
    // §STOPWORD-GUARD: stopword tokens only match at word boundaries (prefix).
    if (isStopword && exact.pos !== 'prefix') {
      // Reject infix/suffix stopword matches (e.g., "and" inside "bhandar")
      // unless the match starts at a word boundary in the canonical.
      if (exact.idx > 0 && /\S/.test(canonical[exact.idx - 1])) {
        // Not at a word boundary — reject
      } else {
        return {
          matched: true,
          viaAlias: false,
          visibleSpans: [{ start: exact.idx, end: exact.idx + exact.len }],
          position: exact.pos,
        }
      }
    } else {
      return {
        matched: true,
        viaAlias: false,
        visibleSpans: [{ start: exact.idx, end: exact.idx + exact.len }],
        position: exact.pos,
      }
    }
  }

  // 2. Bengali vowel variant in canonical
  const bnVar = findBengaliVariant(canonical, queryToken.text)
  if (bnVar && !isStopword) {
    const ranges = findVariantRangesInOriginal(canonical, queryToken.text)
    if (ranges.length > 0) {
      return {
        matched: true,
        viaAlias: false,
        visibleSpans: ranges,
        position: bnVar.pos,
      }
    }
  }

  // 3. Common dictionary mapping (e.g., query "সিমেন্ট" → English "cement")
  const bnEq = getBengaliEnglishEquivalents(queryToken.text)
  for (const eq of bnEq) {
    const eqMatch = findSubstring(canonical, eq)
    if (eqMatch.idx >= 0) {
      return {
        matched: true,
        viaAlias: false,
        visibleSpans: [{ start: eqMatch.idx, end: eqMatch.idx + eqMatch.len }],
        position: eqMatch.pos,
      }
    }
    // Also check alias entries (in case canonical is not English)
    for (const alias of aliases) {
      if (alias.normalized === normalize(eq)) {
        return {
          matched: true,
          viaAlias: true,
          aliasText: alias.alias,
          visibleSpans: alias.visibleSpans,
          position: 'prefix',
        }
      }
    }
  }

  // 4. Exact alias-tag match (alias === query token)
  for (const alias of aliases) {
    if (alias.normalized === queryToken.normalized) {
      return {
        matched: true,
        viaAlias: true,
        aliasText: alias.alias,
        visibleSpans: alias.visibleSpans,
        position: 'prefix',
      }
    }
    // Substring alias match (alias contains query token, or vice versa)
    // §STOPWORD-GUARD: stopword tokens can ONLY match via exact alias equality
    // (already checked above). Skip substring matches for stopwords.
    if (isStopword) continue
    // Alias is a single-word tag and contains the query token as substring
    // (e.g., query "দৌস" → alias "ফেরদৌস")
    if (!alias.isFull && alias.normalized.includes(queryToken.normalized) && queryToken.normalized.length >= 3) {
      return {
        matched: true,
        viaAlias: true,
        aliasText: alias.alias,
        visibleSpans: alias.visibleSpans,
        position: 'infix',
      }
    }
    // Query token contains the alias (e.g., query "firdosh" → alias "firdos")
    if (!alias.isFull && queryToken.normalized.includes(alias.normalized) && alias.normalized.length >= 4) {
      return {
        matched: true,
        viaAlias: true,
        aliasText: alias.alias,
        visibleSpans: alias.visibleSpans,
        position: 'prefix',
      }
    }
  }

  // 5. Controlled fuzzy against alias-tag (alias-only, ≤2 edit distance)
  // §STOPWORD-GUARD: no fuzzy for stopwords
  if (queryToken.normalized.length >= 4 && !isStopword) {
    for (const alias of aliases) {
      if (alias.isFull) continue // skip full-name aliases for fuzzy (too broad)
      if (controlledFuzzyMatchAlias(queryToken.text, alias.alias)) {
        return {
          matched: true,
          viaAlias: true,
          aliasText: alias.alias,
          visibleSpans: alias.visibleSpans,
          position: 'infix',
        }
      }
    }
  }

  return null
}

/**
 * Find character ranges in the ORIGINAL canonical string that correspond to a
 * Bengali vowel-normalized match. We do this by walking both strings in lock-step
 * (since NFC normalization preserves char count for Bengali text in practice).
 */
function findVariantRangesInOriginal(canonical: string, query: string): VisibleRange[] {
  const canonNorm = normalizeBengaliVowels(normalize(canonical))
  const queryNorm = normalizeBengaliVowels(normalize(query))
  if (queryNorm.length < 2) return []
  const ranges: VisibleRange[] = []
  let from = 0
  while (true) {
    const idx = canonNorm.indexOf(queryNorm, from)
    if (idx < 0) break
    ranges.push({ start: idx, end: idx + queryNorm.length })
    from = idx + queryNorm.length
  }
  return ranges
}

// ─── Stage B: Scoring (deterministic tiers) ────────────────────────────────

function positionTier(p: Position): number {
  switch (p) {
    case 'prefix': return 0
    case 'infix': return 1
    case 'suffix': return 2
    default: return 3
  }
}

/**
 * §SCORE-TIERS (lower = better):
 *   0.0  full-exact-prefix    — full query exact substring, prefix
 *   0.5  full-exact-infix     — full query exact substring, infix
 *   1.0  full-exact-suffix    — full query exact substring, suffix
 *   1.5  full-bengali-variant — full query matches via bn vowel normalization
 *   2.0  full-alias           — full query matches an alias tag
 *   3.0  all-tokens           — all query tokens matched (any combination)
 *   4.0  multi-token           — multiple (but not all) tokens matched
 *   4.5  single-token-prefix  — single token exact match, prefix
 *   5.0  single-token          — single token exact match
 *   5.5  single-alias          — single token via alias
 *   6.0  bengali-variant      — single token via bn vowel variant
 *   6.5  common-word           — via common word dictionary
 *   7.0  controlled-fuzzy-alias — via controlled fuzzy on alias (≤2 edit)
 *   8.0  secondary-field        — phone/sku match
 */
function tierScore(matchType: MatchType): number {
  switch (matchType) {
    case 'full-exact-prefix': return 0.0
    case 'full-exact-infix': return 0.5
    case 'full-exact-suffix': return 1.0
    case 'full-bengali-variant': return 1.5
    case 'full-alias': return 2.0
    case 'all-tokens': return 3.0
    case 'multi-token': return 4.0
    case 'single-token-prefix': return 4.5
    case 'single-token': return 5.0
    case 'single-alias': return 5.5
    case 'bengali-variant': return 6.0
    case 'common-word': return 6.5
    case 'controlled-fuzzy-alias': return 7.0
    case 'secondary-field': return 8.0
  }
}

// ─── Stage A+B+C: Main search function ─────────────────────────────────────

/**
 * §SEARCH-PIPELINE: Single entry point that produces ranked matches with
 * highlight metadata.
 *
 * Items are passed as SearchableEntity[] so each item carries its own canonical
 * text + aliases. The function returns SearchMatch[] sorted by score (best first).
 */
export function searchEntities<T>(entities: SearchableEntity<T>[], query: string): SearchMatch<T>[] {
  if (!query || query.trim().length < 2) return []
  const q = query.trim()
  const qTokens = splitQuery(q)
  if (qTokens.length === 0) return []

  const matches: SearchMatch<T>[] = []
  // Pre-compute per-entity aliases (memoized outside if caller reuses entities)
  for (const ent of entities) {
    const canonical = (ent.canonical || '').normalize('NFC')
    if (!canonical) continue
    const canonicalNormalized = normalize(canonical)
    const aliases = ent.aliases && ent.aliases.length > 0 ? ent.aliases : generateAliasesWithSpans(canonical)

    // ── LEVEL 1: Full-query exact substring in canonical
    const fullExact = findSubstring(canonical, q)
    if (fullExact.idx >= 0) {
      const pos: Position = fullExact.pos
      const matchType: MatchType =
        pos === 'prefix' ? 'full-exact-prefix' : pos === 'suffix' ? 'full-exact-suffix' : 'full-exact-infix'
      matches.push({
        item: ent.item,
        score: tierScore(matchType),
        matchType,
        matchedQueryTokens: qTokens.map((t) => t.text),
        matchedAliases: [],
        highlightRanges: [{ start: fullExact.idx, end: fullExact.idx + fullExact.len }],
        relatedPartyId: ent.partyId,
        relatedPartyName: ent.partyName,
      })
      continue
    }

    // ── LEVEL 2: Full-query Bengali vowel-variant match in canonical
    const fullBnVar = findBengaliVariant(canonical, q)
    if (fullBnVar) {
      const ranges = findVariantRangesInOriginal(canonical, q)
      if (ranges.length > 0) {
        matches.push({
          item: ent.item,
          score: tierScore('full-bengali-variant'),
          matchType: 'full-bengali-variant',
          matchedQueryTokens: qTokens.map((t) => t.text),
          matchedAliases: [],
          highlightRanges: ranges,
          relatedPartyId: ent.partyId,
          relatedPartyName: ent.partyName,
        })
        continue
      }
    }

    // ── LEVEL 3: Full-query alias-tag EXACT match (alias === query)
    // (Substring matches are deferred to after per-token matching, so that
    // token-level matches — which carry more precise visible spans — win.)
    //
    // §MULTI-SPAN-PREFERENCE: When multiple aliases share the same normalized
    // form (e.g., the full-name alias "firdous alam" with single span [0,12]
    // AND the multi-token alias "firdous alam" with spans [0,7]+[8,12]), we
    // PREFER the one with MORE visible spans — that's the more precise mapping
    // back to the visible canonical text.
    let fullAliasExactMatched = false
    {
      const qNorm = normalize(q)
      const matching = aliases.filter((a) => a.normalized === qNorm)
      if (matching.length > 0) {
        // Sort by span count descending (most spans first)
        matching.sort((a, b) => b.visibleSpans.length - a.visibleSpans.length)
        const alias = matching[0]
        matches.push({
          item: ent.item,
          score: tierScore('full-alias'),
          matchType: 'full-alias',
          matchedQueryTokens: qTokens.map((t) => t.text),
          matchedAliases: [alias.alias],
          highlightRanges: alias.visibleSpans,
          relatedPartyId: ent.partyId,
          relatedPartyName: ent.partyName,
        })
        fullAliasExactMatched = true
      }
    }
    if (fullAliasExactMatched) continue

    // ── LEVEL 4: Per-token matching — compute results FIRST so per-token
    //    spans (which are more precise than full-alias spans) win.
    const tokenResults: Array<{ token: QueryToken; result: TokenMatchResult }> = []
    for (const qt of qTokens) {
      const r = matchToken(qt, canonical, canonicalNormalized, aliases)
      if (r) tokenResults.push({ token: qt, result: r })
    }

    if (tokenResults.length > 0) {
      const allTokensMatched = tokenResults.length === qTokens.length
      const visibleSpans = mergeVisibleSpans(tokenResults.flatMap((tr) => tr.result.visibleSpans))
      const matchedAliases = tokenResults.filter((tr) => tr.result.viaAlias && tr.result.aliasText).map((tr) => tr.result.aliasText!)
      const matchedQueryTokens = tokenResults.map((tr) => tr.token.text)

      let matchType: MatchType
      if (allTokensMatched) {
        matchType = 'all-tokens'
      } else if (tokenResults.length > 1) {
        matchType = 'multi-token'
      } else {
        const only = tokenResults[0]
        if (only.result.viaAlias) {
          matchType = 'single-alias'
        } else if (only.result.position === 'prefix') {
          matchType = 'single-token-prefix'
        } else {
          matchType = 'single-token'
        }
      }

      // Refine: if any token matched via common-word dictionary, bump tier
      if (matchType === 'all-tokens' || matchType === 'multi-token' || matchType === 'single-token' || matchType === 'single-token-prefix') {
        const viaCommonWord = tokenResults.some((tr) => {
          if (tr.result.viaAlias) return false
          const eq = getBengaliEnglishEquivalents(tr.token.text)
          return eq.length > 0
        })
        if (viaCommonWord && !allTokensMatched) {
          matchType = 'common-word'
        }
      }

      // Refine: single-token Bengali variant
      if (matchType === 'single-token' || matchType === 'single-token-prefix') {
        const only = tokenResults[0]
        if (!only.result.viaAlias) {
          const bnVariant = findBengaliVariant(canonical, only.token.text)
          if (bnVariant) {
            matchType = 'bengali-variant'
          }
        }
      }

      // Refine: controlled fuzzy alias → tier 7.0
      if (matchType === 'single-alias') {
        const only = tokenResults[0]
        if (only.result.aliasText && only.result.position === 'infix') {
          const a = normalize(only.result.aliasText!)
          const q2 = only.token.normalized
          if (a !== q2 && !a.includes(q2) && !q2.includes(a)) {
            matchType = 'controlled-fuzzy-alias'
          }
        }
      }

      matches.push({
        item: ent.item,
        score: tierScore(matchType),
        matchType,
        matchedQueryTokens,
        matchedAliases,
        highlightRanges: visibleSpans,
        relatedPartyId: ent.partyId,
        relatedPartyName: ent.partyName,
      })
      continue
    }

    // ── LEVEL 5: Full-query alias-tag SUBSTRING match (deferred from LEVEL 3)
    // Only reached if NO per-token match. This catches cases like query
    // "das sons" → alias "das and sons". The visible span is the full alias's
    // span (less precise, but at least the entity is found).
    // §MIN-LEN: Require query length >= 4 to avoid 3-char false positives.
    let fullAliasSubstringMatched = false
    for (const alias of aliases) {
      if (alias.isFull && alias.normalized.includes(normalize(q)) && q.length >= 4) {
        matches.push({
          item: ent.item,
          score: tierScore('full-alias') + 0.1,
          matchType: 'full-alias',
          matchedQueryTokens: qTokens.map((t) => t.text),
          matchedAliases: [alias.alias],
          highlightRanges: alias.visibleSpans,
          relatedPartyId: ent.partyId,
          relatedPartyName: ent.partyName,
        })
        fullAliasSubstringMatched = true
        break
      }
    }
    if (fullAliasSubstringMatched) continue

    // ── LEVEL 6: Secondary field exact match (phone, sku, etc.)
    if (ent.secondary && ent.secondary.length > 0) {
      let secMatched = false
      for (const sf of ent.secondary) {
        if (!sf) continue
        const sfMatch = findSubstring(sf, q)
        if (sfMatch.idx >= 0) {
          matches.push({
            item: ent.item,
            score: tierScore('secondary-field'),
            matchType: 'secondary-field',
            matchedQueryTokens: qTokens.map((t) => t.text),
            matchedAliases: [],
            highlightRanges: [],
            relatedPartyId: ent.partyId,
            relatedPartyName: ent.partyName,
          })
          secMatched = true
          break
        }
      }
      if (secMatched) continue
    }
    // No token evidence → FILTER OUT (no fuzzy candidate generation)
  }

  // Sort by score (ascending), then by canonical-name length (shorter first)
  matches.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score
    const aName = (a.item as any)?.name || (a.item as any)?.invoiceNumber || (a.item as any)?.description || ''
    const bName = (b.item as any)?.name || (b.item as any)?.invoiceNumber || (b.item as any)?.description || ''
    if (aName.length !== bName.length) return aName.length - bName.length
    return 0
  })

  return matches
}

/** Merge overlapping/adjacent visible ranges into a sorted, deduped list. */
function mergeVisibleSpans(ranges: VisibleRange[]): VisibleRange[] {
  if (ranges.length === 0) return []
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const merged: VisibleRange[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1]
    if (sorted[i].start <= last.end) {
      last.end = Math.max(last.end, sorted[i].end)
    } else {
      merged.push(sorted[i])
    }
  }
  return merged
}

// ─── Stage D: Related-record expansion ─────────────────────────────────────

/**
 * §RELATED-EXPANSION: When a party matches the search, also display its
 * related invoices and transactions. These are pulled in by partyId (not by
 * re-searching the query against the invoice/transaction text — that would
 * accidentally pull in records from other parties).
 *
 * The party's highlight metadata is reused on the related records' party-name
 * display, so the user sees the same highlight on the party row AND on its
 * related invoice/transaction rows.
 */
export interface ExpandedResults<TParty, TInvoice, TTransaction> {
  parties: SearchMatch<TParty>[]
  /** Invoices belonging to matched parties (max N per party) */
  relatedInvoices: Array<SearchMatch<TInvoice> & { relatedPartyName?: string; relatedPartyHighlightRanges?: VisibleRange[] }>
  /** Transactions belonging to matched parties (max N per party) */
  relatedTransactions: Array<SearchMatch<TTransaction> & { relatedPartyName?: string; relatedPartyHighlightRanges?: VisibleRange[] }>
}

export function expandRelated<TParty, TInvoice, TTransaction>(args: {
  partyMatches: SearchMatch<TParty>[]
  invoices: TInvoice[]
  transactions: TTransaction[]
  invoiceToPartyId: (inv: TInvoice) => string | null | undefined
  invoiceToCanonical: (inv: TInvoice) => string
  invoiceToId: (inv: TInvoice) => string
  txnToPartyId: (t: TTransaction) => string | null | undefined
  txnToCanonical: (t: TTransaction) => string
  txnToId: (t: TTransaction) => string
  maxInvoicesPerParty?: number
  maxTxnsPerParty?: number
}): ExpandedResults<TParty, TInvoice, TTransaction> {
  const maxInv = args.maxInvoicesPerParty ?? 3
  const maxTxn = args.maxTxnsPerParty ?? 3
  const relatedInvoices: ExpandedResults<TParty, TInvoice, TTransaction>['relatedInvoices'][number][] = []
  const relatedTransactions: ExpandedResults<TParty, TInvoice, TTransaction>['relatedTransactions'][number][] = []

  for (const pm of args.partyMatches) {
    const partyId = (pm.item as any)?.id
    if (!partyId) continue
    // §PARTY-HIGHLIGHT: Reuse the party's highlightRanges on related rows
    const partyName = (pm.item as any)?.name || ''
    const partyRanges = pm.highlightRanges || []

    // Find invoices belonging to this party
    let invCount = 0
    for (const inv of args.invoices) {
      if (invCount >= maxInv) break
      if (args.invoiceToPartyId(inv) === partyId) {
        relatedInvoices.push({
          item: inv,
          score: pm.score + 0.1, // related records rank just below the party
          matchType: 'secondary-field', // mark as related
          matchedQueryTokens: pm.matchedQueryTokens,
          matchedAliases: [],
          highlightRanges: [], // the invoice's own canonical (number) isn't matched
          relatedPartyId: partyId,
          relatedPartyName: partyName,
          relatedPartyHighlightRanges: partyRanges,
        })
        invCount++
      }
    }
    // Find transactions belonging to this party
    let txnCount = 0
    for (const t of args.transactions) {
      if (txnCount >= maxTxn) break
      if (args.txnToPartyId(t) === partyId) {
        relatedTransactions.push({
          item: t,
          score: pm.score + 0.1,
          matchType: 'secondary-field',
          matchedQueryTokens: pm.matchedQueryTokens,
          matchedAliases: [],
          highlightRanges: [],
          relatedPartyId: partyId,
          relatedPartyName: partyName,
          relatedPartyHighlightRanges: partyRanges,
        })
        txnCount++
      }
    }
  }

  return {
    parties: args.partyMatches,
    relatedInvoices,
    relatedTransactions,
  }
}

// ─── Convenience: full search across all entity types ───────────────────────

export interface SearchAllResult<TParty, TProduct, TInvoice, TTransaction> {
  parties: SearchMatch<TParty>[]
  products: SearchMatch<TProduct>[]
  invoices: SearchMatch<TInvoice>[]
  transactions: SearchMatch<TTransaction>[]
  /** Invoices belonging to matched parties (related-record expansion) */
  relatedInvoices: Array<SearchMatch<TInvoice> & { relatedPartyName?: string; relatedPartyHighlightRanges?: VisibleRange[] }>
  /** Transactions belonging to matched parties (related-record expansion) */
  relatedTransactions: Array<SearchMatch<TTransaction> & { relatedPartyName?: string; relatedPartyHighlightRanges?: VisibleRange[] }>
}

export interface SearchAllArgs<TParty, TProduct, TInvoice, TTransaction> {
  parties: TParty[]
  products: TProduct[]
  invoices: TInvoice[]
  transactions: TTransaction[]
  query: string
  partyToEntity: (p: TParty) => SearchableEntity<TParty>
  productToEntity: (p: TProduct) => SearchableEntity<TProduct>
  invoiceToEntity: (i: TInvoice) => SearchableEntity<TInvoice>
  txnToEntity: (t: TTransaction) => SearchableEntity<TTransaction>
  maxPerSection?: number
  maxInvoicesPerParty?: number
  maxTxnsPerParty?: number
}

/**
 * §FULL-SEARCH: Run the unified search across parties, products, invoices,
 * and transactions, plus related-record expansion for matched parties.
 *
 * Invoices and transactions that match directly via their own text
 * (invoiceNumber, description) appear in the `invoices` and `transactions`
 * sections. Invoices/transactions that belong to a matched party appear
 * in `relatedInvoices` and `relatedTransactions`.
 */
export function searchAll<TParty, TProduct, TInvoice, TTransaction>(
  args: SearchAllArgs<TParty, TProduct, TInvoice, TTransaction>
): SearchAllResult<TParty, TProduct, TInvoice, TTransaction> {
  const max = args.maxPerSection ?? 6

  // Stage A+B+C: search each entity type with the SAME engine
  const partyMatches = searchEntities(args.parties.map(args.partyToEntity), args.query).slice(0, max)
  const productMatches = searchEntities(args.products.map(args.productToEntity), args.query).slice(0, max)
  const invoiceMatches = searchEntities(args.invoices.map(args.invoiceToEntity), args.query).slice(0, max)
  const txnMatches = searchEntities(args.transactions.map(args.txnToEntity), args.query).slice(0, max)

  // Stage D: related-record expansion for matched parties
  const expanded = expandRelated({
    partyMatches,
    invoices: args.invoices,
    transactions: args.transactions,
    invoiceToPartyId: (inv: TInvoice) => {
      const e = args.invoiceToEntity(inv)
      return e.partyId
    },
    invoiceToCanonical: (inv: TInvoice) => args.invoiceToEntity(inv).canonical,
    invoiceToId: (inv: TInvoice) => args.invoiceToEntity(inv).id,
    txnToPartyId: (t: TTransaction) => {
      const e = args.txnToEntity(t)
      return e.partyId
    },
    txnToCanonical: (t: TTransaction) => args.txnToEntity(t).canonical,
    txnToId: (t: TTransaction) => args.txnToEntity(t).id,
    maxInvoicesPerParty: args.maxInvoicesPerParty,
    maxTxnsPerParty: args.maxTxnsPerParty,
  })

  return {
    parties: partyMatches,
    products: productMatches,
    invoices: invoiceMatches,
    transactions: txnMatches,
    relatedInvoices: expanded.relatedInvoices,
    relatedTransactions: expanded.relatedTransactions,
  }
}

// ─── Highlight helpers (for UI) ────────────────────────────────────────────

/**
 * Build React-renderable segments from visible text + highlight ranges.
 * Combines adjacent highlighted ranges into a single segment to avoid
 * breaking graphemes.
 *
 * §GRAPHENE-SAFE: We rely on the fact that our visible ranges were computed
 * by matching against the NFC-normalized text. For Bengali text, NFC preserves
 * code-point boundaries so combining marks stay with their base consonant.
 */
export function buildHighlightSegments(text: string, ranges: VisibleRange[]): Array<{ text: string; highlight: boolean }> {
  if (!text) return [{ text: '', highlight: false }]
  if (!ranges || ranges.length === 0) return [{ text, highlight: false }]
  const sorted = [...ranges].sort((a, b) => a.start - b.start)
  const segments: Array<{ text: string; highlight: boolean }> = []
  let lastEnd = 0
  for (const r of sorted) {
    const start = Math.max(0, Math.min(r.start, text.length))
    const end = Math.max(start, Math.min(r.end, text.length))
    if (start > lastEnd) {
      segments.push({ text: text.substring(lastEnd, start), highlight: false })
    }
    if (end > start) {
      segments.push({ text: text.substring(start, end), highlight: true })
    }
    lastEnd = end
  }
  if (lastEnd < text.length) {
    segments.push({ text: text.substring(lastEnd), highlight: false })
  }
  return segments
}

// ─── Backward-compat exports (for existing code) ───────────────────────────

/**
 * Compute highlight ranges for a query against arbitrary text.
 * Used by `highlight.tsx` for components that don't have access to a SearchMatch
 * (e.g., the khata-view search bar).
 *
 * This is a fallback — the preferred path is to use SearchMatch.highlightRanges
 * directly.
 */
export function computeHighlightRanges(text: string, query: string): VisibleRange[] {
  if (!text || !query || query.trim().length < 2) return []
  const canonical = text.normalize('NFC')
  const q = query.trim()
  const qTokens = splitQuery(q)
  if (qTokens.length === 0) return []

  // Try full-query exact
  const fullExact = findSubstring(canonical, q)
  if (fullExact.idx >= 0) {
    return [{ start: fullExact.idx, end: fullExact.idx + fullExact.len }]
  }
  // Try full-query Bengali variant
  const fullBn = findBengaliVariant(canonical, q)
  if (fullBn) {
    const r = findVariantRangesInOriginal(canonical, q)
    if (r.length > 0) return r
  }
  // Per-token
  const aliases = generateAliasesWithSpans(canonical)
  const ranges: VisibleRange[] = []
  for (const qt of qTokens) {
    const r = matchToken(qt, canonical, normalize(canonical), aliases)
    if (r) ranges.push(...r.visibleSpans)
  }
  return mergeVisibleSpans(ranges)
}
