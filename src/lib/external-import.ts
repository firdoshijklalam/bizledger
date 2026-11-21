/**
 * §EXTERNAL-IMPORT: Pure helpers for importing data from external software
 * (CSV/XLSX/JSON → BizLedger Parties/Products/Opening Balances).
 *
 * This module is SEPARATE from the BizLedger backup restore system
 * (src/lib/backup-format.ts). The backup system restores a versioned
 * BizLedger JSON envelope with known IDs. This module imports UNSTRUCTURED
 * data from arbitrary external sources with unknown column names, unknown
 * formats, and unknown duplicate-matching keys.
 *
 * §PIPELINE:
 *   1. parseFile → rows (CSV/XLSX/JSON parsing — done client-side)
 *   2. autoDetectColumns → mapping suggestions (source header → BizLedger field)
 *   3. normalizeRow → cleaned values (phone, GSTIN, currency, numbers, Bengali)
 *   4. detectDuplicates → classify each row as NEW / EXACT_MATCH / POSSIBLE_MATCH
 *   5. User reviews mapping + duplicate resolution
 *   6. importRows → atomic DB insert (server-side, in /api/external-import route)
 */

// ─── Import entity types ───────────────────────────────────────────────────

export type ImportEntityType = 'customers' | 'suppliers' | 'products' | 'opening-balances'

export interface ImportableField {
  key: string
  label: string
  required: boolean
  type: 'string' | 'phone' | 'gstin' | 'number' | 'currency' | 'enum' | 'unit'
  enumValues?: string[]
  bengaliLabel?: string
}

/**
 * §FIELD-DEFINITIONS: The BizLedger fields that can be imported for each
 * entity type. Only fields that exist in the Prisma schema are listed.
 * Fields NOT listed here (email, city, state, barcode, hsn) are NOT supported
 * by the current schema and will show "These fields will not be imported".
 */
export const IMPORTABLE_FIELDS: Record<ImportEntityType, ImportableField[]> = {
  customers: [
    { key: 'name', label: 'Party Name', required: true, type: 'string', bengaliLabel: 'নাম' },
    { key: 'phone', label: 'Phone', required: false, type: 'phone', bengaliLabel: 'ফোন' },
    { key: 'gstin', label: 'GSTIN', required: false, type: 'gstin', bengaliLabel: 'জিএসটিন' },
    { key: 'address', label: 'Address', required: false, type: 'string', bengaliLabel: 'ঠিকানা' },
    { key: 'openingBalance', label: 'Opening Balance (₹)', required: false, type: 'currency', bengaliLabel: 'শুরুর ব্যালেন্স' },
    { key: 'creditLimit', label: 'Credit Limit (₹)', required: false, type: 'currency', bengaliLabel: 'ক্রেডিট লিমিট' },
    { key: 'notes', label: 'Notes', required: false, type: 'string', bengaliLabel: 'মন্তব্য' },
  ],
  suppliers: [
    { key: 'name', label: 'Supplier Name', required: true, type: 'string', bengaliLabel: 'সাপ্লায়ার নাম' },
    { key: 'phone', label: 'Phone', required: false, type: 'phone', bengaliLabel: 'ফোন' },
    { key: 'gstin', label: 'GSTIN', required: false, type: 'gstin', bengaliLabel: 'জিএসটিন' },
    { key: 'address', label: 'Address', required: false, type: 'string', bengaliLabel: 'ঠিকানা' },
    { key: 'openingBalance', label: 'Opening Payable (₹)', required: false, type: 'currency', bengaliLabel: 'শুরুর পাওনা' },
    { key: 'notes', label: 'Notes', required: false, type: 'string', bengaliLabel: 'মন্তব্য' },
  ],
  products: [
    { key: 'name', label: 'Product Name', required: true, type: 'string', bengaliLabel: 'প্রোডাক্ট নাম' },
    { key: 'sku', label: 'SKU', required: false, type: 'string', bengaliLabel: 'এসকিইউ' },
    { key: 'category', label: 'Category', required: false, type: 'string', bengaliLabel: 'ক্যাটাগরি' },
    { key: 'unit', label: 'Unit', required: false, type: 'unit', enumValues: ['pcs', 'kg', 'bag', 'box'], bengaliLabel: 'একক' },
    { key: 'purchasePrice', label: 'Purchase Price (₹)', required: false, type: 'currency', bengaliLabel: 'ক্রয় মূল্য' },
    { key: 'salePrice', label: 'Sale Price (₹)', required: false, type: 'currency', bengaliLabel: 'বিক্রয় মূল্য' },
    { key: 'mrp', label: 'MRP (₹)', required: false, type: 'currency', bengaliLabel: 'এমআরপি' },
    { key: 'wholesalePrice', label: 'Wholesale Price (₹)', required: false, type: 'currency', bengaliLabel: 'পাইকারি মূল্য' },
    { key: 'gstRate', label: 'GST Rate (%)', required: false, type: 'number', bengaliLabel: 'জিএসটি হার' },
    { key: 'stock', label: 'Current Stock', required: false, type: 'number', bengaliLabel: 'বর্তমান স্টক' },
    { key: 'lowStockThreshold', label: 'Low Stock Threshold', required: false, type: 'number', bengaliLabel: 'লো স্টক থ্রেশহোল্ড' },
    { key: 'description', label: 'Description', required: false, type: 'string', bengaliLabel: 'বিবরণ' },
  ],
  'opening-balances': [
    { key: 'name', label: 'Party Name', required: true, type: 'string', bengaliLabel: 'নাম' },
    { key: 'phone', label: 'Phone (for matching)', required: false, type: 'phone', bengaliLabel: 'ফোন' },
    { key: 'gstin', label: 'GSTIN (for matching)', required: false, type: 'gstin', bengaliLabel: 'জিএসটিন' },
    { key: 'openingBalance', label: 'Opening Receivable (+) / Payable (-) (₹)', required: true, type: 'currency', bengaliLabel: 'শুরুর ব্যালেন্স' },
  ],
}

// ─── Normalizers ───────────────────────────────────────────────────────────

/**
 * Normalize a phone number to digits-only, with India default.
 * - Strips all non-digits
 * - Removes leading 0 (domestic) → +91
 * - Removes leading 91 if length > 10 (already international)
 * - Returns empty string if input is null/empty
 */
export function normalizePhone(input: any): string {
  if (input === null || input === undefined) return ''
  const digits = String(input).replace(/\D/g, '')
  if (digits.length === 0) return ''
  // §INDIA-DEFAULT: 10-digit → assume Indian domestic
  if (digits.length === 10) return '+91' + digits
  // 11-digit starting with 0 → strip leading 0
  if (digits.length === 11 && digits.startsWith('0')) return '+91' + digits.substring(1)
  // 12-digit starting with 91 → already international
  if (digits.length === 12 && digits.startsWith('91')) return '+' + digits
  // 13-digit starting with +91 already
  if (digits.length === 13 && digits.startsWith('91')) return '+' + digits
  // §FALLBACK: Return digits as-is if pattern doesn't match known formats
  return digits
}

/**
 * Normalize a GSTIN: uppercase + trim.
 * GSTIN format: 2-digit state code + 10-char PAN + 1 entity + 1 Z + 1 checksum = 15 chars
 */
export function normalizeGstin(input: any): string {
  if (input === null || input === undefined) return ''
  return String(input).toUpperCase().trim()
}

/**
 * Normalize a currency/number value.
 * Handles:
 *   - "₹1,250" → 1250
 *   - "1,250.00" → 1250
 *   - "Rs. 1250" → 1250
 *   - "৳ 1250" → 1250 (Bengali Taka symbol — common in cross-border data)
 *   - "১২৫০" (Bengali numerals) → 1250
 *   - "1,250.50" → 1250.5
 */
export function normalizeCurrency(input: any): number {
  if (input === null || input === undefined || input === '') return 0
  if (typeof input === 'number') return isNaN(input) ? 0 : input
  let str = String(input).trim()
  // §BENGALI-NUMERALS: Convert Bengali digits to English
  const bengaliDigits = '০১২৩৪৫৬৭৮৯'
  for (let i = 0; i < 10; i++) {
    str = str.replace(new RegExp(bengaliDigits[i], 'g'), String(i))
  }
  // §CURRENCY-SYMBOLS: Strip ₹, Rs, Rs., INR, ৳, comma, space
  str = str.replace(/[₹৳,]/g, '').replace(/Rs\.?\s*/gi, '').replace(/INR\s*/gi, '').trim()
  const n = Number(str)
  return isNaN(n) ? 0 : n
}

/**
 * Normalize a plain number (e.g., GST rate, stock quantity).
 */
export function normalizeNumber(input: any): number {
  if (input === null || input === undefined || input === '') return 0
  if (typeof input === 'number') return isNaN(input) ? 0 : input
  let str = String(input).trim()
  // §BENGALI-NUMERALS: Convert Bengali digits
  const bengaliDigits = '০১২৩৪৫৬৭৮৯'
  for (let i = 0; i < 10; i++) {
    str = str.replace(new RegExp(bengaliDigits[i], 'g'), String(i))
  }
  // Strip commas + percentage sign + spaces (Indian number format)
  str = str.replace(/[,%\s]/g, '')
  const n = Number(str)
  return isNaN(n) ? 0 : n
}

/**
 * Normalize a string: trim + collapse internal whitespace.
 * Does NOT change case (name case matters for businesses).
 */
export function normalizeString(input: any): string {
  if (input === null || input === undefined) return ''
  return String(input).trim().replace(/\s+/g, ' ')
}

/**
 * Normalize a name for duplicate matching: lowercase + remove punctuation +
 * collapse whitespace. Used ONLY for duplicate detection, NOT for storage.
 */
export function normalizeNameForMatching(input: any): string {
  if (input === null || input === undefined) return ''
  return String(input)
    .toLowerCase()
    // §UNICODE-AWARE: Remove only ASCII punctuation (not Bengali letters).
    // Bengali Unicode block is \u0980-\u09FF — preserve it for Bengali name matching.
    .replace(/[!-/:-@\[-`{-~]/g, '') // remove ASCII punctuation only
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Normalize a unit string to the nearest BizLedger unit.
 * Accepts: "piece", "pieces", "pc", "pcs", "কিলো", "kg", "kilo" → "pcs"/"kg"
 */
export function normalizeUnit(input: any): string {
  if (input === null || input === undefined) return 'pcs'
  const s = String(input).toLowerCase().trim()
  if (/^(pc|pcs|piece|pieces|ইট|পিস)$/.test(s)) return 'pcs'
  if (/^(kg|kilo|kilogram|কেজি|কিলো)$/.test(s)) return 'kg'
  if (/^(bag|bags|বস্তা|থলে)$/.test(s)) return 'bag'
  if (/^(box|boxes|বাক্স|প্যাকেট)$/.test(s)) return 'box'
  return 'pcs'
}

/**
 * Apply the correct normalizer based on field type.
 */
export function normalizeValue(value: any, fieldType: ImportableField['type']): any {
  switch (fieldType) {
    case 'phone': return normalizePhone(value)
    case 'gstin': return normalizeGstin(value)
    case 'currency': return normalizeCurrency(value)
    case 'number': return normalizeNumber(value)
    case 'unit': return normalizeUnit(value)
    case 'string':
    case 'enum':
    default: return normalizeString(value)
  }
}

// ─── Auto-detect column mapping ────────────────────────────────────────────

export interface ColumnMappingSuggestion {
  sourceHeader: string
  suggestedField: string | null
  confidence: number // 0-100
  reason: string
}

/**
 * §HEADER-ALIASES: Known aliases for each BizLedger field.
 * Used for fuzzy header detection.
 * The first entry is the canonical BizLedger field name itself.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  name: ['name', 'party name', 'customer name', 'supplier name', 'product name', 'নাম', 'নাম ', 'party'],
  phone: ['phone', 'mobile', 'mobile no', 'mobile number', 'contact', 'contact no', 'phone number', 'ফোন', 'মোবাইল', 'মোবাইল নম্বর', 'tel', 'telephone'],
  gstin: ['gstin', 'gst number', 'gst no', 'gst', 'tax id', 'tax number', 'জিএসটিন', 'জিএসটি'],
  address: ['address', 'addr', 'location', 'ঠিকানা', 'ঠিকানা '],
  openingBalance: ['opening balance', 'opening due', 'opening', 'balance', 'due', 'ob', 'opening receivable', 'opening payable', 'পাওনা', 'শুরুর ব্যালেন্স', 'ব্যালেন্স'],
  creditLimit: ['credit limit', 'credit', 'cl', 'ক্রেডিট লিমিট', 'ক্রেডিট'],
  notes: ['notes', 'note', 'remarks', 'comment', 'comments', 'description', 'মন্তব্য', 'মন্তব্য '],
  sku: ['sku', 'product code', 'code', 'item code', 'এসকিইউ', 'কোড'],
  category: ['category', 'cat', 'group', 'type', 'ক্যাটাগরি', 'গ্রুপ'],
  unit: ['unit', 'uom', 'unit of measure', 'একক'],
  purchasePrice: ['purchase price', 'cost', 'cost price', 'buy price', 'purchase rate', 'ক্রয় মূল্য', 'ক্রয়'],
  salePrice: ['sale price', 'selling price', 'sales price', 'sell price', 'mrp', 'rate', 'price', 'বিক্রয় মূল্য', 'বিক্রয়', 'দাম'],
  mrp: ['mrp', 'maximum retail price', 'রেট', 'এমআরপি'],
  wholesalePrice: ['wholesale price', 'wholesale', 'wholesale rate', 'পাইকারি', 'পাইকারি মূল্য'],
  gstRate: ['gst rate', 'gst %', 'tax rate', 'tax %', 'gst', 'জিএসটি হার'],
  stock: ['stock', 'qty', 'quantity', 'current stock', 'inventory', 'স্টক', 'পরিমাণ'],
  lowStockThreshold: ['low stock', 'reorder level', 'minimum stock', 'min stock', 'লো স্টক'],
  description: ['description', 'desc', 'details', 'বিবরণ', 'বিস্তারিত'],
}

/**
 * Auto-detect the best BizLedger field for each source header.
 * Uses exact match → contains match → fuzzy (Levenshtein) match.
 */
export function autoDetectColumns(
  sourceHeaders: string[],
  entityType: ImportEntityType
): ColumnMappingSuggestion[] {
  const fields = IMPORTABLE_FIELDS[entityType]
  const usedFields = new Set<string>()

  return sourceHeaders.map((header) => {
    const normalizedHeader = header.toLowerCase().trim()

    // §EXACT-MATCH: Check each field's aliases for exact match
    for (const field of fields) {
      const aliases = HEADER_ALIASES[field.key] || []
      if (aliases.includes(normalizedHeader)) {
        if (!usedFields.has(field.key)) {
          usedFields.add(field.key)
          return { sourceHeader: header, suggestedField: field.key, confidence: 100, reason: 'Exact match' }
        }
      }
    }

    // §CONTAINS-MATCH: Source header contains an alias
    for (const field of fields) {
      const aliases = HEADER_ALIASES[field.key] || []
      for (const alias of aliases) {
        if (normalizedHeader.includes(alias) && alias.length >= 3) {
          if (!usedFields.has(field.key)) {
            usedFields.add(field.key)
            return { sourceHeader: header, suggestedField: field.key, confidence: 85, reason: `Contains "${alias}"` }
          }
        }
      }
    }

    // §FUZZY-MATCH: Levenshtein distance to aliases
    let bestField: string | null = null
    let bestScore = 0
    let bestReason = ''
    for (const field of fields) {
      const aliases = HEADER_ALIASES[field.key] || []
      for (const alias of aliases) {
        const similarity = computeSimilarity(normalizedHeader, alias)
        if (similarity > bestScore) {
          bestScore = similarity
          bestField = field.key
          bestReason = `Similar to "${alias}" (${Math.round(similarity)}%)`
        }
      }
    }

    if (bestField && bestScore >= 60 && !usedFields.has(bestField)) {
      usedFields.add(bestField)
      return { sourceHeader: header, suggestedField: bestField, confidence: bestScore, reason: bestReason }
    }

    return { sourceHeader: header, suggestedField: null, confidence: 0, reason: 'No match' }
  })
}

/**
 * Compute similarity between two strings (0-100).
 * Uses a simplified Levenshtein-distance-based ratio.
 */
function computeSimilarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 100
  const maxLen = Math.max(a.length, b.length)
  if (maxLen === 0) return 100
  const dist = levenshtein(a, b)
  return Math.round(((maxLen - dist) / maxLen) * 100)
}

function levenshtein(a: string, b: string): number {
  const al = a.length
  const bl = b.length
  if (al === 0) return bl
  if (bl === 0) return al
  const prev = new Array(bl + 1)
  const curr = new Array(bl + 1)
  for (let j = 0; j <= bl; j++) prev[j] = j
  for (let i = 1; i <= al; i++) {
    curr[0] = i
    for (let j = 1; j <= bl; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= bl; j++) prev[j] = curr[j]
  }
  return prev[bl]
}

// ─── Duplicate detection ──────────────────────────────────────────────────

export type DuplicateStatus = 'NEW' | 'EXACT_MATCH' | 'POSSIBLE_MATCH'

export interface DuplicateMatch {
  status: DuplicateStatus
  matchedRecordId?: string
  matchedRecordName?: string
  matchReason?: string
  confidence?: number
}

/**
 * §DUPLICATE-DETECTION: Check if a row matches an existing record.
 *
 * For Parties (customers/suppliers):
 *   1. Exact phone match → EXACT_MATCH
 *   2. Exact GSTIN match → EXACT_MATCH
 *   3. Name + phone combo → EXACT_MATCH
 *   4. Strong normalized name match → POSSIBLE_MATCH
 *
 * For Products:
 *   1. Exact SKU match → EXACT_MATCH
 *   2. Name + unit match → EXACT_MATCH
 *   3. Name-only match → POSSIBLE_MATCH
 */
export function detectPartyDuplicate(
  row: { name: string; phone: string; gstin: string },
  existing: Array<{ id: string; name: string; phone: string | null; gstin: string | null }>
): DuplicateMatch {
  const normalizedName = normalizeNameForMatching(row.name)
  const normalizedPhone = row.phone ? normalizePhone(row.phone) : ''
  const normalizedGstin = row.gstin ? normalizeGstin(row.gstin) : ''

  // §EXACT-PHONE: Match by phone (most reliable for Indian SMB)
  if (normalizedPhone) {
    const match = existing.find((e) => {
      if (!e.phone) return false
      return normalizePhone(e.phone) === normalizedPhone
    })
    if (match) {
      return { status: 'EXACT_MATCH', matchedRecordId: match.id, matchedRecordName: match.name, matchReason: 'Phone matches', confidence: 100 }
    }
  }

  // §EXACT-GSTIN: Match by GSTIN
  if (normalizedGstin) {
    const match = existing.find((e) => {
      if (!e.gstin) return false
      return normalizeGstin(e.gstin) === normalizedGstin
    })
    if (match) {
      return { status: 'EXACT_MATCH', matchedRecordId: match.id, matchedRecordName: match.name, matchReason: 'GSTIN matches', confidence: 95 }
    }
  }

  // §NAME+PHONE: Name + phone combo (phone may be in a different format)
  if (normalizedName && normalizedPhone) {
    const match = existing.find((e) => {
      if (!e.phone) return false
      return normalizeNameForMatching(e.name) === normalizedName && normalizePhone(e.phone) === normalizedPhone
    })
    if (match) {
      return { status: 'EXACT_MATCH', matchedRecordId: match.id, matchedRecordName: match.name, matchReason: 'Name + phone match', confidence: 90 }
    }
  }

  // §POSSIBLE-NAME: Strong normalized name match (user must decide)
  if (normalizedName && normalizedName.length >= 3) {
    const possibleMatch = existing.find((e) => {
      const existingName = normalizeNameForMatching(e.name)
      if (existingName === normalizedName) return true
      // §FUZZY-NAME: 80%+ similarity is a possible match
      const sim = computeSimilarity(existingName, normalizedName)
      return sim >= 80
    })
    if (possibleMatch) {
      return { status: 'POSSIBLE_MATCH', matchedRecordId: possibleMatch.id, matchedRecordName: possibleMatch.name, matchReason: 'Similar name', confidence: 80 }
    }
  }

  return { status: 'NEW' }
}

/**
 * Detect product duplicates by SKU or name+unit.
 */
export function detectProductDuplicate(
  row: { name: string; sku: string | null; unit: string },
  existing: Array<{ id: string; name: string; sku: string | null; unit: string }>
): DuplicateMatch {
  const normalizedName = normalizeNameForMatching(row.name)
  const normalizedSku = row.sku ? row.sku.toUpperCase().trim() : ''

  // §EXACT-SKU: Match by SKU
  if (normalizedSku) {
    const match = existing.find((e) => {
      if (!e.sku) return false
      return e.sku.toUpperCase().trim() === normalizedSku
    })
    if (match) {
      return { status: 'EXACT_MATCH', matchedRecordId: match.id, matchedRecordName: match.name, matchReason: 'SKU matches', confidence: 100 }
    }
  }

  // §NAME+UNIT: Name + unit combo
  if (normalizedName) {
    const match = existing.find((e) => {
      return normalizeNameForMatching(e.name) === normalizedName && e.unit === row.unit
    })
    if (match) {
      return { status: 'EXACT_MATCH', matchedRecordId: match.id, matchedRecordName: match.name, matchReason: 'Name + unit match', confidence: 95 }
    }
  }

  // §POSSIBLE-NAME: Name-only match (user must decide)
  if (normalizedName && normalizedName.length >= 3) {
    const possibleMatch = existing.find((e) => {
      const existingName = normalizeNameForMatching(e.name)
      if (existingName === normalizedName) return true
      const sim = computeSimilarity(existingName, normalizedName)
      return sim >= 80
    })
    if (possibleMatch) {
      return { status: 'POSSIBLE_MATCH', matchedRecordId: possibleMatch.id, matchedRecordName: possibleMatch.name, matchReason: 'Similar name', confidence: 80 }
    }
  }

  return { status: 'NEW' }
}

// ─── Row validation ────────────────────────────────────────────────────────

export type RowStatus = 'VALID' | 'WARNING' | 'ERROR'

export interface ValidatedRow {
  rowNumber: number
  sourceData: Record<string, any>
  mappedData: Record<string, any>
  status: RowStatus
  errors: string[]
  warnings: string[]
  duplicate: DuplicateMatch
}

/**
 * Validate a single row against the required fields for the entity type.
 */
export function validateRow(
  row: Record<string, any>,
  mapping: Record<string, string>, // sourceHeader → bizledgerField
  entityType: ImportEntityType,
  rowNumber: number,
  duplicate: DuplicateMatch
): ValidatedRow {
  const fields = IMPORTABLE_FIELDS[entityType]
  const errors: string[] = []
  const warnings: string[] = []
  const mappedData: Record<string, any> = {}

  // §APPLY-MAPPING: For each mapped field, normalize the value
  for (const [sourceHeader, targetField] of Object.entries(mapping)) {
    if (!targetField || targetField === '__ignore__') continue
    const fieldDef = fields.find((f) => f.key === targetField)
    if (!fieldDef) continue

    const rawValue = row[sourceHeader]
    const normalized = normalizeValue(rawValue, fieldDef.type)
    mappedData[targetField] = normalized
  }

  // §CHECK-REQUIRED: All required fields must be present + non-empty
  for (const field of fields) {
    if (field.required) {
      const val = mappedData[field.key]
      if (val === '' || val === null || val === undefined) {
        errors.push(`Missing required field: ${field.label}`)
      }
    }
  }

  // §WARNINGS: Non-blocking issues
  if (entityType === 'customers' || entityType === 'suppliers') {
    if (!mappedData.phone && !mappedData.gstin) {
      warnings.push('No phone or GSTIN — duplicate detection will be less accurate')
    }
  }
  if (entityType === 'products') {
    if (!mappedData.sku) {
      warnings.push('No SKU — duplicate detection will rely on name only')
    }
  }

  let status: RowStatus = 'VALID'
  if (errors.length > 0) status = 'ERROR'
  else if (warnings.length > 0) status = 'WARNING'

  return {
    rowNumber,
    sourceData: row,
    mappedData,
    status,
    errors,
    warnings,
    duplicate,
  }
}

// ─── Import templates ─────────────────────────────────────────────────────

/**
 * Generate a CSV template for the given entity type.
 * Includes: header row + 1 sample row + instructions as comments.
 */
export function generateTemplate(entityType: ImportEntityType): string {
  const fields = IMPORTABLE_FIELDS[entityType]
  const headers = fields.map((f) => f.label + (f.required ? ' *' : ''))
  const sampleRow = fields.map((f) => {
    switch (f.key) {
      case 'name': return entityType === 'products' ? 'Cement Bag 50kg' : 'Rahul Enterprise'
      case 'phone': return '+91 98300 12345'
      case 'gstin': return '19ABCDE1234F1Z5'
      case 'address': return '12 Station Road, Howrah'
      case 'openingBalance': return '5000'
      case 'creditLimit': return '10000'
      case 'notes': return 'VIP customer'
      case 'sku': return 'CEM-50'
      case 'category': return 'Construction'
      case 'unit': return 'bag'
      case 'purchasePrice': return '304'
      case 'salePrice': return '380'
      case 'mrp': return '400'
      case 'wholesalePrice': return '350'
      case 'gstRate': return '0'
      case 'stock': return '20'
      case 'lowStockThreshold': return '5'
      case 'description': return '50kg cement bag'
      default: return ''
    }
  })

  // §BOM: UTF-8 BOM for Bengali text in Excel
  const bom = '\uFEFF'
  const headerLine = headers.join(',')
  const sampleLine = sampleRow.map((v) => {
    // §RFC4180: Quote if contains comma
    if (v.includes(',')) return `"${v}"`
    return v
  }).join(',')

  return `${bom}${headerLine}\r\n${sampleLine}\r\n`
}

/**
 * Get the filename for a template download.
 */
export function getTemplateFilename(entityType: ImportEntityType): string {
  const names: Record<ImportEntityType, string> = {
    customers: 'BizLedger_Customer_Import_Template.csv',
    suppliers: 'BizLedger_Supplier_Import_Template.csv',
    products: 'BizLedger_Product_Import_Template.csv',
    'opening-balances': 'BizLedger_Opening_Balance_Import_Template.csv',
  }
  return names[entityType]
}

// ─── Simple CSV parser (client-side, no dependency) ────────────────────────

/**
 * §CSV-PARSER: Parse CSV text into an array of row objects.
 *
 * Handles:
 * - Comma-separated values
 * - Double-quoted fields (with escaped "" inside)
 * - Newlines inside quoted fields
 * - UTF-8 BOM (stripped)
 * - First row = headers
 *
 * Does NOT handle:
 * - Semicolon-separated (auto-detect could be added later)
 * - XLSX (needs a library like SheetJS)
 *
 * For XLSX support, the user can convert to CSV first in Excel/Google Sheets.
 */
export function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  // Strip UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.substring(1)

  const lines: string[][] = []
  let currentLine: string[] = []
  let currentField = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const nextChar = text[i + 1]

    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        // Escaped quote
        currentField += '"'
        i++ // skip next
      } else if (char === '"') {
        // End of quoted field
        inQuotes = false
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === ',') {
        currentLine.push(currentField)
        currentField = ''
      } else if (char === '\r') {
        // Carriage return — handle \r\n or \r
        if (nextChar !== '\n') {
          currentLine.push(currentField)
          lines.push(currentLine)
          currentLine = []
          currentField = ''
        }
        // If \r\n, the \n will handle the line break
      } else if (char === '\n') {
        currentLine.push(currentField)
        lines.push(currentLine)
        currentLine = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }
  // Last field
  if (currentField || currentLine.length > 0) {
    currentLine.push(currentField)
    lines.push(currentLine)
  }

  // Remove empty trailing lines
  while (lines.length > 0 && (lines[lines.length - 1].length === 0 || (lines[lines.length - 1].length === 1 && lines[lines.length - 1][0] === ''))) {
    lines.pop()
  }

  if (lines.length === 0) return { headers: [], rows: [] }

  const headers = lines[0].map((h) => h.trim())
  const rows = lines.slice(1).map((line) => {
    const obj: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) {
      obj[headers[i]] = line[i] ?? ''
    }
    return obj
  })

  return { headers, rows }
}

/**
 * Parse a JSON array of objects into rows.
 * Used for JSON imports (each object = one row).
 */
export function parseJsonArray(text: string): { headers: string[]; rows: Record<string, string>[] } {
  let data: any
  try {
    data = JSON.parse(text)
  } catch {
    return { headers: [], rows: [] }
  }
  if (!Array.isArray(data)) return { headers: [], rows: [] }
  if (data.length === 0) return { headers: [], rows: [] }

  // Collect all unique keys as headers
  const headerSet = new Set<string>()
  for (const item of data) {
    if (item && typeof item === 'object') {
      for (const key of Object.keys(item)) {
        headerSet.add(key)
      }
    }
  }
  const headers = Array.from(headerSet)

  const rows = data.map((item) => {
    const obj: Record<string, string> = {}
    for (const key of headers) {
      const val = item?.[key]
      obj[key] = val === null || val === undefined ? '' : String(val)
    }
    return obj
  })

  return { headers, rows }
}

// ─── XLSX parser (uses SheetJS/xlsx) ──────────────────────────────────────

/**
 * §XLSX-PARSER: Parse an Excel .xlsx file into rows.
 *
 * Uses SheetJS (xlsx) — a well-maintained, pure-JS XLSX parser.
 * Handles:
 * - Multiple sheets (returns the FIRST sheet by default, or a named sheet)
 * - Header row detection (first non-empty row)
 * - Empty rows (skipped)
 * - Numeric cells (converted to string for consistency)
 * - Date cells (converted to ISO string)
 * - Formula cells (uses the cached calculated value, NOT the formula)
 * - Bengali/Unicode text (preserved)
 * - Merged cells (uses the top-left value — limitation noted below)
 *
 * §SAFETY:
 * - Does NOT execute Excel formulas (uses calculated values only)
 * - Does NOT load external references (images, links, macros)
 * - SheetJS `cellNF: false` + `cellStyles: false` for minimal parsing
 * - Row limit: 10,000 rows (prevents memory issues with very large sheets)
 *
 * §LIMITATIONS:
 * - Merged header cells: only the top-left cell's value is used. If a merged
 *   cell spans multiple header columns, the secondary columns will have empty
 *   headers. The user must manually map these in the column-mapping step.
 * - Very large sheets (>10,000 rows) are truncated with a warning.
 */
export function parseXlsx(
  arrayBuffer: ArrayBuffer,
  sheetName?: string
): { headers: string[]; rows: Record<string, string>[]; sheetNames: string[]; usedSheet: string } {
  // §DYNAMIC-IMPORT: Load xlsx only when needed (keeps the initial bundle small).
  // SheetJS is a CommonJS module — require() is the correct way to load it.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')

  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellNF: false,    // Don't load number formats
    cellStyles: false, // Don't load cell styles
    cellDates: true,   // Parse date cells as JS Date objects
    cellFormula: false, // Don't load formulas (use cached values)
  })

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return { headers: [], rows: [], sheetNames: [], usedSheet: '' }
  }

  // §SHEET-SELECTION: Use the named sheet if provided, otherwise the first sheet
  const usedSheet = sheetName && workbook.SheetNames.includes(sheetName)
    ? sheetName
    : workbook.SheetNames[0]
  const worksheet = workbook.Sheets[usedSheet]

  if (!worksheet) {
    return { headers: [], rows: [], sheetNames: workbook.SheetNames, usedSheet }
  }

  // §HEADER-DETECTION: Convert sheet to array-of-arrays, first row = headers
  const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
    header: 1,        // Return array-of-arrays (not array-of-objects)
    blankrows: false, // Skip empty rows
    defval: '',       // Return empty string for empty cells (not undefined)
    raw: false,       // Use formatted text (not raw values) — handles dates + numbers
  })

  if (rawData.length === 0) {
    return { headers: [], rows: [], sheetNames: workbook.SheetNames, usedSheet }
  }

  // §ROW-LIMIT: 10,000 rows max (including header)
  const MAX_XLSX_ROWS = 10001
  const truncated = rawData.length > MAX_XLSX_ROWS
  const limitedData = truncated ? rawData.slice(0, MAX_XLSX_ROWS) : rawData

  // §HEADERS: First non-empty row
  const headers = (limitedData[0] || []).map((h: any) => String(h || '').trim())

  // §ROWS: Convert each remaining row to an object keyed by header
  const rows: Record<string, string>[] = []
  for (let i = 1; i < limitedData.length; i++) {
    const line = limitedData[i]
    // Skip completely empty rows
    const isEmpty = line.every((cell: any) => cell === '' || cell === null || cell === undefined)
    if (isEmpty) continue

    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      const val = line[j]
      // §DATE-HANDLING: Date objects → ISO string (for display + normalization)
      if (val instanceof Date) {
        obj[headers[j]] = val.toISOString().split('T')[0] // YYYY-MM-DD
      } else if (val === null || val === undefined) {
        obj[headers[j]] = ''
      } else {
        obj[headers[j]] = String(val)
      }
    }
    rows.push(obj)
  }

  return {
    headers,
    rows,
    sheetNames: workbook.SheetNames,
    usedSheet,
  }
}

/**
 * Parse a file based on its extension.
 * Dispatches to parseCsv, parseXlsx, or parseJsonArray.
 */
export function parseFile(
  fileName: string,
  content: string | ArrayBuffer
): { headers: string[]; rows: Record<string, string>[]; sheetNames?: string[]; usedSheet?: string } {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  if (ext === '.json') return parseJsonArray(content as string)
  if (ext === '.xlsx' || ext === '.xls') {
    // §XLSX-REQUIRES-ARRAYBUFFER: SheetJS needs an ArrayBuffer, not a string
    if (typeof content === 'string') {
      // Convert string to ArrayBuffer (for files read as text — not recommended for XLSX)
      const encoder = new TextEncoder()
      const bytes = encoder.encode(content)
      return parseXlsx(bytes.buffer)
    }
    return parseXlsx(content as ArrayBuffer)
  }
  // Default: CSV
  return parseCsv(content as string)
}

// ─── XLSX sheet metadata ──────────────────────────────────────────────────

export interface SheetMetadata {
  name: string
  rowCount: number
  columnCount: number
  headers: string[]
  isEmpty: boolean
}

/**
 * §SHEET-METADATA: Get metadata for all sheets in an XLSX workbook.
 * Used by the UI to show sheet names, row counts, and column counts
 * in the sheet selection step.
 */
export function getXlsxSheetMetadata(arrayBuffer: ArrayBuffer): SheetMetadata[] {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')

  const workbook = XLSX.read(arrayBuffer, {
    type: 'array',
    cellNF: false,
    cellStyles: false,
    cellDates: true,
    cellFormula: false,
  })

  if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
    return []
  }

  return workbook.SheetNames.map((sheetName: string) => {
    const worksheet = workbook.Sheets[sheetName]
    if (!worksheet) {
      return { name: sheetName, rowCount: 0, columnCount: 0, headers: [], isEmpty: true }
    }

    const rawData: any[][] = XLSX.utils.sheet_to_json(worksheet, {
      header: 1,
      blankrows: false,
      defval: '',
      raw: false,
    })

    if (rawData.length === 0) {
      return { name: sheetName, rowCount: 0, columnCount: 0, headers: [], isEmpty: true }
    }

    const headers = (rawData[0] || []).map((h: any) => String(h || '').trim()).filter((h: string) => h !== '')
    // Count non-empty data rows (exclude header)
    let dataRows = 0
    for (let i = 1; i < rawData.length; i++) {
      const isEmpty = rawData[i].every((cell: any) => cell === '' || cell === null || cell === undefined)
      if (!isEmpty) dataRows++
    }

    return {
      name: sheetName,
      rowCount: dataRows,
      columnCount: headers.length,
      headers: headers.slice(0, 5), // preview first 5 headers
      isEmpty: dataRows === 0 || headers.length === 0,
    }
  })
}
