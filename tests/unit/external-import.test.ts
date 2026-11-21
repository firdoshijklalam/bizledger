/**
 * §TEST: External Import — normalization, auto-detect, duplicate detection, validation.
 *
 * Run: npx tsx tests/unit/external-import.test.ts
 *
 * Tests the pure functions in src/lib/external-import.ts WITHOUT a database.
 * The actual /api/external-import route is exercised via production browser QA.
 */
export {}

import {
  normalizePhone,
  normalizeGstin,
  normalizeCurrency,
  normalizeNumber,
  normalizeString,
  normalizeNameForMatching,
  normalizeUnit,
  autoDetectColumns,
  detectPartyDuplicate,
  detectProductDuplicate,
  validateRow,
  generateTemplate,
  getTemplateFilename,
  parseCsv,
  parseJsonArray,
  IMPORTABLE_FIELDS,
  type ImportEntityType,
} from '../../src/lib/external-import'

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

console.log('\n🧪 External Import — Normalization, Detection, Validation Tests\n')

// ─── TEST 1: Phone normalization ──────────────────────────────────────────

console.log('TEST 1: Phone normalization (Indian formats)')
{
  assert(normalizePhone('+91 98300 12345') === '+919830012345', '+91 format → digits')
  assert(normalizePhone('9830012345') === '+919830012345', '10-digit domestic → +91')
  assert(normalizePhone('09830012345') === '+919830012345', '11-digit with leading 0 → +91')
  assert(normalizePhone('919830012345') === '+919830012345', '12-digit with 91 prefix → +91')
  assert(normalizePhone('+919830012345') === '+919830012345', 'full international → preserved')
  assert(normalizePhone('') === '', 'empty → empty')
  assert(normalizePhone(null) === '', 'null → empty')
  assert(normalizePhone(undefined) === '', 'undefined → empty')
  assert(normalizePhone('Phone: +91-98300-12345') === '+919830012345', 'with label + dashes → digits only')
}

// ─── TEST 2: GSTIN normalization ───────────────────────────────────────────

console.log('\nTEST 2: GSTIN normalization')
{
  assert(normalizeGstin('19ABCDE1234F1Z5') === '19ABCDE1234F1Z5', 'already normalized → preserved')
  assert(normalizeGstin('19abcde1234f1z5') === '19ABCDE1234F1Z5', 'lowercase → uppercase')
  assert(normalizeGstin(' 19ABCDE1234F1Z5 ') === '19ABCDE1234F1Z5', 'with whitespace → trimmed')
  assert(normalizeGstin('') === '', 'empty → empty')
  assert(normalizeGstin(null) === '', 'null → empty')
}

// ─── TEST 3: Currency normalization ──────────────────────────────────────

console.log('\nTEST 3: Currency normalization (₹, commas, Bengali numerals)')
{
  assert(normalizeCurrency('₹1,250') === 1250, '₹ + comma → number')
  assert(normalizeCurrency('1,250.00') === 1250, 'comma + decimal → number')
  assert(normalizeCurrency('Rs. 1250') === 1250, 'Rs. prefix → number')
  assert(normalizeCurrency('INR 1250') === 1250, 'INR prefix → number')
  assert(normalizeCurrency('1250') === 1250, 'plain number → number')
  assert(normalizeCurrency(1250) === 1250, 'already number → preserved')
  assert(normalizeCurrency('') === 0, 'empty → 0')
  assert(normalizeCurrency(null) === 0, 'null → 0')
  assert(normalizeCurrency('১২৫০') === 1250, 'Bengali numerals → English')
  assert(normalizeCurrency('৳ 1250') === 1250, 'Bengali Taka symbol → number')
  assert(normalizeCurrency('₹ 1,250.50') === 1250.5, '₹ + comma + decimal → number')
  assert(normalizeCurrency('abc') === 0, 'invalid string → 0')
}

// ─── TEST 4: Number normalization ────────────────────────────────────────

console.log('\nTEST 4: Number normalization (GST rate, stock, Bengali numerals)')
{
  assert(normalizeNumber('18') === 18, 'plain number → number')
  assert(normalizeNumber('18%') === 18, 'with % → number')
  assert(normalizeNumber('1,000') === 1000, 'comma-separated → number')
  assert(normalizeNumber(18) === 18, 'already number → preserved')
  assert(normalizeNumber('') === 0, 'empty → 0')
  assert(normalizeNumber('১৮') === 18, 'Bengali numeral → English')
}

// ─── TEST 5: String normalization ────────────────────────────────────────

console.log('\nTEST 5: String normalization (trim, collapse whitespace)')
{
  assert(normalizeString('  Rahul  Enterprise  ') === 'Rahul Enterprise', 'trim + collapse internal spaces')
  assert(normalizeString('') === '', 'empty → empty')
  assert(normalizeString(null) === '', 'null → empty')
  assert(normalizeString(123) === '123', 'number → string')
}

// ─── TEST 6: Name matching normalization ─────────────────────────────────

console.log('\nTEST 6: Name matching normalization (lowercase, no punctuation)')
{
  assert(normalizeNameForMatching('Rahul Enterprise') === 'rahul enterprise', 'lowercase')
  assert(normalizeNameForMatching('Rahul, Enterprise!') === 'rahul enterprise', 'remove punctuation')
  assert(normalizeNameForMatching('  Rahul   Enterprise  ') === 'rahul enterprise', 'trim + collapse')
  assert(normalizeNameForMatching('') === '', 'empty → empty')
  assert(normalizeNameForMatching('আব্দুল্লাহ') === 'আব্দুল্লাহ', 'Bengali text preserved (for matching)')
}

// ─── TEST 7: Unit normalization ──────────────────────────────────────────

console.log('\nTEST 7: Unit normalization (aliases → BizLedger units)')
{
  assert(normalizeUnit('piece') === 'pcs', 'piece → pcs')
  assert(normalizeUnit('pieces') === 'pcs', 'pieces → pcs')
  assert(normalizeUnit('pc') === 'pcs', 'pc → pcs')
  assert(normalizeUnit('kg') === 'kg', 'kg → kg')
  assert(normalizeUnit('kilo') === 'kg', 'kilo → kg')
  assert(normalizeUnit('কেজি') === 'kg', 'Bengali কেজি → kg')
  assert(normalizeUnit('bag') === 'bag', 'bag → bag')
  assert(normalizeUnit('বস্তা') === 'bag', 'Bengali বস্তা → bag')
  assert(normalizeUnit('box') === 'box', 'box → box')
  assert(normalizeUnit('unknown') === 'pcs', 'unknown → default pcs')
  assert(normalizeUnit('') === 'pcs', 'empty → default pcs')
}

// ─── TEST 8: Auto-detect columns ─────────────────────────────────────────

console.log('\nTEST 8: Auto-detect column mapping (header aliases)')
{
  const headers = ['Customer Name', 'Mobile No', 'GST Number', 'Opening Due', 'Address']
  const suggestions = autoDetectColumns(headers, 'customers')

  assert(suggestions.length === 5, '5 suggestions for 5 headers')
  assert(suggestions[0].suggestedField === 'name', '"Customer Name" → name')
  assert(suggestions[0].confidence === 100, 'exact match → 100% confidence')
  assert(suggestions[1].suggestedField === 'phone', '"Mobile No" → phone')
  assert(suggestions[2].suggestedField === 'gstin', '"GST Number" → gstin')
  assert(suggestions[3].suggestedField === 'openingBalance', '"Opening Due" → openingBalance')
  assert(suggestions[4].suggestedField === 'address', '"Address" → address')

  // Unmapped header
  const s2 = autoDetectColumns(['Random Column'], 'customers')
  assert(s2[0].suggestedField === null, '"Random Column" → no match')
  assert(s2[0].confidence === 0, 'no match → 0% confidence')
}

// ─── TEST 9: Auto-detect with Bengali headers ────────────────────────────

console.log('\nTEST 9: Auto-detect with Bengali headers')
{
  const headers = ['নাম', 'ফোন', 'ঠিকানা']
  const suggestions = autoDetectColumns(headers, 'customers')
  assert(suggestions[0].suggestedField === 'name', '"নাম" → name')
  assert(suggestions[1].suggestedField === 'phone', '"ফোন" → phone')
  assert(suggestions[2].suggestedField === 'address', '"ঠিকানা" → address')
}

// ─── TEST 10: Party duplicate detection — phone match ───────────────────

console.log('\nTEST 10: Party duplicate detection — exact phone match')
{
  const existing = [
    { id: 'p1', name: 'Rahul Enterprise', phone: '+919830012345', gstin: null },
  ]
  const result = detectPartyDuplicate(
    { name: 'Rahul Enterprise', phone: '9830012345', gstin: '' },
    existing
  )
  assert(result.status === 'EXACT_MATCH', 'phone match → EXACT_MATCH')
  assert(result.matchedRecordId === 'p1', 'matched p1')
  assert(result.confidence === 100, 'phone match → 100% confidence')
}

// ─── TEST 11: Party duplicate detection — GSTIN match ───────────────────

console.log('\nTEST 11: Party duplicate detection — exact GSTIN match')
{
  const existing = [
    { id: 'p1', name: 'Different Name', phone: '+919999999999', gstin: '19ABCDE1234F1Z5' },
  ]
  const result = detectPartyDuplicate(
    { name: 'New Name', phone: '+918888888888', gstin: '19abcde1234f1z5' },
    existing
  )
  assert(result.status === 'EXACT_MATCH', 'GSTIN match (case-insensitive) → EXACT_MATCH')
  assert(result.matchedRecordId === 'p1', 'matched p1')
  assert(result.confidence === 95, 'GSTIN match → 95% confidence')
}

// ─── TEST 12: Party duplicate detection — possible name match ────────────

console.log('\nTEST 12: Party duplicate detection — possible name match')
{
  const existing = [
    { id: 'p1', name: 'Rahul Enterprise', phone: null, gstin: null },
  ]
  const result = detectPartyDuplicate(
    { name: 'Rahul Enterprise', phone: '', gstin: '' },
    existing
  )
  assert(result.status === 'POSSIBLE_MATCH', 'same name, no phone/GSTIN → POSSIBLE_MATCH')
  assert(result.confidence === 80, 'possible match → 80% confidence')
}

// ─── TEST 13: Party duplicate detection — NEW record ────────────────────

console.log('\nTEST 13: Party duplicate detection — NEW record (no match)')
{
  const existing = [
    { id: 'p1', name: 'Rahul Enterprise', phone: '+919830012345', gstin: null },
  ]
  const result = detectPartyDuplicate(
    { name: 'Completely Different', phone: '+919999999999', gstin: '' },
    existing
  )
  assert(result.status === 'NEW', 'no match → NEW')
}

// ─── TEST 14: Product duplicate detection — SKU match ───────────────────

console.log('\nTEST 14: Product duplicate detection — exact SKU match')
{
  const existing = [
    { id: 'pr1', name: 'Cement Bag', sku: 'CEM-50', unit: 'bag' },
  ]
  const result = detectProductDuplicate(
    { name: 'Cement Bag 50kg', sku: 'cem-50', unit: 'bag' },
    existing
  )
  assert(result.status === 'EXACT_MATCH', 'SKU match (case-insensitive) → EXACT_MATCH')
  assert(result.confidence === 100, 'SKU match → 100% confidence')
}

// ─── TEST 15: Product duplicate detection — name + unit match ───────────

console.log('\nTEST 15: Product duplicate detection — name + unit match')
{
  const existing = [
    { id: 'pr1', name: 'Miniket Rice', sku: null, unit: 'kg' },
  ]
  const result = detectProductDuplicate(
    { name: 'Miniket Rice', sku: null, unit: 'kg' },
    existing
  )
  assert(result.status === 'EXACT_MATCH', 'name + unit match → EXACT_MATCH')
  assert(result.confidence === 95, 'name + unit → 95% confidence')
}

// ─── TEST 16: Row validation — missing required field ───────────────────

console.log('\nTEST 16: Row validation — missing required field')
{
  const result = validateRow(
    { 'Customer Name': '', 'Phone': '+919830012345' },
    { 'Customer Name': 'name', 'Phone': 'phone' },
    'customers',
    1,
    { status: 'NEW' }
  )
  assert(result.status === 'ERROR', 'missing name → ERROR')
  assert(result.errors.length > 0, 'has error message')
  assert(result.errors[0].includes('Party Name'), 'error mentions Party Name')
}

// ─── TEST 17: Row validation — valid row ────────────────────────────────

console.log('\nTEST 17: Row validation — valid row')
{
  const result = validateRow(
    { 'Customer Name': 'Rahul Enterprise', 'Phone': '+919830012345', 'GST Number': '19ABCDE1234F1Z5' },
    { 'Customer Name': 'name', 'Phone': 'phone', 'GST Number': 'gstin' },
    'customers',
    1,
    { status: 'NEW' }
  )
  assert(result.status === 'VALID', 'valid row → VALID')
  assert(result.errors.length === 0, 'no errors')
  assert(result.mappedData.name === 'Rahul Enterprise', 'name mapped + normalized')
  assert(result.mappedData.phone === '+919830012345', 'phone mapped + normalized')
  assert(result.mappedData.gstin === '19ABCDE1234F1Z5', 'gstin mapped + normalized')
}

// ─── TEST 18: Row validation — warning for no phone/GSTIN ────────────────

console.log('\nTEST 18: Row validation — warning for no phone/GSTIN')
{
  const result = validateRow(
    { 'Customer Name': 'Rahul' },
    { 'Customer Name': 'name' },
    'customers',
    1,
    { status: 'NEW' }
  )
  assert(result.status === 'WARNING', 'no phone/GSTIN → WARNING')
  assert(result.warnings.length > 0, 'has warning message')
  assert(result.warnings[0].includes('duplicate detection'), 'warning mentions duplicate detection')
}

// ─── TEST 19: Template generation ────────────────────────────────────────

console.log('\nTEST 19: Template generation (CSV with BOM + header + sample)')
{
  const csv = generateTemplate('customers')
  assert(csv.charCodeAt(0) === 0xfeff, 'template starts with UTF-8 BOM')
  assert(csv.includes('Party Name'), 'template has Party Name column')
  assert(csv.includes('*'), 'required fields marked with *')
  assert(csv.includes('Rahul Enterprise'), 'template has sample row')

  const productTemplate = generateTemplate('products')
  assert(productTemplate.includes('Product Name'), 'product template has Product Name')
  assert(productTemplate.includes('Cement Bag 50kg'), 'product template has sample product')
}

// ─── TEST 20: Template filenames ─────────────────────────────────────────

console.log('\nTEST 20: Template filenames')
{
  assert(getTemplateFilename('customers') === 'BizLedger_Customer_Import_Template.csv', 'customers filename')
  assert(getTemplateFilename('suppliers') === 'BizLedger_Supplier_Import_Template.csv', 'suppliers filename')
  assert(getTemplateFilename('products') === 'BizLedger_Product_Import_Template.csv', 'products filename')
  assert(getTemplateFilename('opening-balances') === 'BizLedger_Opening_Balance_Import_Template.csv', 'opening-balances filename')
}

// ─── TEST 21: CSV parser ────────────────────────────────────────────────

console.log('\nTEST 21: CSV parser (RFC 4180 + BOM + quoted fields)')
{
  const csv = '\uFEFFName,Phone,GSTIN\r\n"Rahul, Enterprise","+919830012345","19ABCDE1234F1Z5"\r\nAbdullah,+919999999999,\r\n'
  const { headers, rows } = parseCsv(csv)
  assert(headers.length === 3, '3 headers')
  assert(headers[0] === 'Name', 'header 0 = Name')
  assert(rows.length === 2, '2 data rows')
  assert(rows[0]['Name'] === 'Rahul, Enterprise', 'quoted field with comma preserved')
  assert(rows[0]['Phone'] === '+919830012345', 'phone field')
  assert(rows[1]['Name'] === 'Abdullah', 'second row name')
  assert(rows[1]['GSTIN'] === '', 'second row GSTIN empty')
}

// ─── TEST 22: CSV parser — handles newlines in quoted fields ─────────────

console.log('\nTEST 22: CSV parser — newlines inside quoted fields')
{
  const csv = 'Name,Address\r\n"Multi Line","Line 1\r\nLine 2"\r\n'
  const { headers, rows } = parseCsv(csv)
  assert(headers.length === 2, '2 headers')
  assert(rows.length === 1, '1 data row (despite internal newline)')
  assert(rows[0]['Address'] === 'Line 1\r\nLine 2', 'newline preserved inside quotes')
}

// ─── TEST 23: JSON array parser ─────────────────────────────────────────

console.log('\nTEST 23: JSON array parser')
{
  const json = '[{"Name":"Rahul","Phone":"+919830012345"},{"Name":"Abdullah","Phone":"+919999999999"}]'
  const { headers, rows } = parseJsonArray(json)
  assert(headers.length === 2, '2 headers')
  assert(headers.includes('Name'), 'headers include Name')
  assert(headers.includes('Phone'), 'headers include Phone')
  assert(rows.length === 2, '2 data rows')
  assert(rows[0]['Name'] === 'Rahul', 'first row name')
  assert(rows[1]['Phone'] === '+919999999999', 'second row phone')
}

// ─── TEST 24: Importable fields — required fields marked ────────────────

console.log('\nTEST 24: Importable fields — required fields')
{
  assert(IMPORTABLE_FIELDS.customers[0].key === 'name', 'first customer field = name')
  assert(IMPORTABLE_FIELDS.customers[0].required === true, 'name is required')
  assert(IMPORTABLE_FIELDS.customers[1].required === false, 'phone is NOT required')

  assert(IMPORTABLE_FIELDS.products[0].key === 'name', 'first product field = name')
  assert(IMPORTABLE_FIELDS.products[0].required === true, 'product name is required')

  assert(IMPORTABLE_FIELDS['opening-balances'][3].key === 'openingBalance', 'opening-balances has openingBalance')
  assert(IMPORTABLE_FIELDS['opening-balances'][3].required === true, 'openingBalance is required')
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
