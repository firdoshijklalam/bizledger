/**
 * §TEST: XLSX Multi-Sheet Selection tests.
 * Run: npx tsx tests/unit/xlsx-multisheet.test.ts
 */
export {}

import {
  parseXlsx,
  getXlsxSheetMetadata,
  type SheetMetadata,
} from '../../src/lib/external-import'

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

console.log('\n🧪 XLSX Multi-Sheet Selection Tests\n')

// ─── Create a real XLSX workbook with SheetJS ─────────────────────────────

function createXlsxBuffer(sheets: Array<{ name: string; data: any[][] }>): ArrayBuffer {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const XLSX = require('xlsx')
  const wb = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.data)
    XLSX.utils.book_append_sheet(wb, ws, sheet.name)
  }
  // XLSX.write with type:'array' returns a Uint8Array in newer versions
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
  // Convert Uint8Array to ArrayBuffer if needed
  if (buf instanceof ArrayBuffer) return buf
  if (buf instanceof Uint8Array) return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return buf as ArrayBuffer
}

// ─── TEST 1: One-sheet workbook → auto-selected ──────────────────────────

console.log('TEST 1: One-sheet workbook → auto-selected')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name', 'Phone'], ['Rahul', '+919830012345'], ['Abdullah', '+919999999999']] }
  ])
  const metadata = getXlsxSheetMetadata(buf)
  assert(metadata.length === 1, '1 sheet in workbook')
  assert(metadata[0].name === 'Customers', 'sheet name = Customers')
  assert(metadata[0].rowCount === 2, '2 data rows')
  assert(metadata[0].columnCount === 2, '2 columns')
  assert(!metadata[0].isEmpty, 'sheet is not empty')

  // Auto-select: since only 1 non-empty sheet, should auto-parse
  const parsed = parseXlsx(buf, metadata[0].name)
  assert(parsed.headers.length === 2, 'parsed headers = 2')
  assert(parsed.rows.length === 2, 'parsed rows = 2')
  assert(parsed.usedSheet === 'Customers', 'usedSheet = Customers')
}

// ─── TEST 2: Two-sheet workbook → user selection required ────────────────

console.log('\nTEST 2: Two-sheet workbook → user selection required')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name', 'Phone'], ['Rahul', '+919830012345']] },
    { name: 'Products', data: [['Product Name', 'SKU'], ['Cement', 'CEM-001']] }
  ])
  const metadata = getXlsxSheetMetadata(buf)
  assert(metadata.length === 2, '2 sheets in workbook')
  const nonEmpty = metadata.filter((s) => !s.isEmpty)
  assert(nonEmpty.length === 2, '2 non-empty sheets → user must choose')
}

// ─── TEST 3: Select first sheet ──────────────────────────────────────────

console.log('\nTEST 3: Select first sheet')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name', 'Phone'], ['Rahul', '+919830012345']] },
    { name: 'Products', data: [['Product Name', 'SKU'], ['Cement', 'CEM-001']] }
  ])
  const parsed = parseXlsx(buf, 'Customers')
  assert(parsed.usedSheet === 'Customers', 'usedSheet = Customers')
  assert(parsed.headers[0] === 'Name', 'first header = Name')
  assert(parsed.rows.length === 1, '1 data row')
  assert(parsed.rows[0]['Name'] === 'Rahul', 'row data = Rahul')
}

// ─── TEST 4: Select second sheet ─────────────────────────────────────────

console.log('\nTEST 4: Select second sheet')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name', 'Phone'], ['Rahul', '+919830012345']] },
    { name: 'Products', data: [['Product Name', 'SKU'], ['Cement', 'CEM-001']] }
  ])
  const parsed = parseXlsx(buf, 'Products')
  assert(parsed.usedSheet === 'Products', 'usedSheet = Products')
  assert(parsed.headers[0] === 'Product Name', 'first header = Product Name')
  assert(parsed.rows.length === 1, '1 data row')
  assert(parsed.rows[0]['SKU'] === 'CEM-001', 'row data SKU = CEM-001')
}

// ─── TEST 5: Bengali sheet name ──────────────────────────────────────────

console.log('\nTEST 5: Bengali sheet name')
{
  const buf = createXlsxBuffer([
    { name: 'কাস্টমার', data: [['নাম', 'ফোন'], ['রাহুল', '+919830012345']] }
  ])
  const metadata = getXlsxSheetMetadata(buf)
  assert(metadata.length === 1, '1 sheet with Bengali name')
  assert(metadata[0].name === 'কাস্টমার', 'Bengali sheet name preserved')
  assert(metadata[0].rowCount === 1, '1 data row')

  const parsed = parseXlsx(buf, 'কাস্টমার')
  assert(parsed.usedSheet === 'কাস্টমার', 'usedSheet = Bengali name')
  assert(parsed.headers[0] === 'নাম', 'Bengali header preserved')
  assert(parsed.rows[0]['নাম'] === 'রাহুল', 'Bengali data preserved')
}

// ─── TEST 6: Empty sheet is not selectable ──────────────────────────────

console.log('\nTEST 6: Empty sheet is not selectable')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name', 'Phone'], ['Rahul', '+919830012345']] },
    { name: 'EmptySheet', data: [] }
  ])
  const metadata = getXlsxSheetMetadata(buf)
  assert(metadata.length === 2, '2 sheets')
  const emptySheet = metadata.find((s) => s.name === 'EmptySheet')
  assert(!!emptySheet, 'EmptySheet found')
  assert(emptySheet!.isEmpty === true, 'EmptySheet.isEmpty = true')
  assert(emptySheet!.rowCount === 0, 'EmptySheet.rowCount = 0')

  const nonEmpty = metadata.filter((s) => !s.isEmpty)
  assert(nonEmpty.length === 1, 'only 1 non-empty sheet → auto-select')
}

// ─── TEST 7: All sheets empty → clear validation error ───────────────────

console.log('\nTEST 7: All sheets empty → clear validation error')
{
  const buf = createXlsxBuffer([
    { name: 'Sheet1', data: [] },
    { name: 'Sheet2', data: [] }
  ])
  const metadata = getXlsxSheetMetadata(buf)
  const nonEmpty = metadata.filter((s) => !s.isEmpty)
  assert(nonEmpty.length === 0, '0 non-empty sheets → error state')
}

// ─── TEST 8: Invalid sheet selection → safe error ───────────────────────

console.log('\nTEST 8: Invalid sheet selection → safe fallback')
{
  const buf = createXlsxBuffer([
    { name: 'Customers', data: [['Name'], ['Rahul']] }
  ])
  // Try to select a sheet that doesn't exist
  const parsed = parseXlsx(buf, 'NonExistentSheet')
  // Should fall back to first sheet (not crash)
  assert(parsed.usedSheet === 'Customers', 'invalid sheet → falls back to first sheet')
  assert(parsed.rows.length === 1, 'still parses data from first sheet')
}

// ─── TEST 9: Selected sheet headers parsed correctly ─────────────────────

console.log('\nTEST 9: Selected sheet headers parsed correctly')
{
  const buf = createXlsxBuffer([
    { name: 'Sheet1', data: [['Customer Name', 'Mobile No', 'GST Number'], ['Rahul', '9830012345', 'GST001']] },
    { name: 'Sheet2', data: [['Product Name', 'SKU'], ['Cement', 'CEM-001']] }
  ])
  const parsed1 = parseXlsx(buf, 'Sheet1')
  assert(parsed1.headers.length === 3, 'Sheet1 has 3 headers')
  assert(parsed1.headers[0] === 'Customer Name', 'header 0 = Customer Name')
  assert(parsed1.headers[1] === 'Mobile No', 'header 1 = Mobile No')

  const parsed2 = parseXlsx(buf, 'Sheet2')
  assert(parsed2.headers.length === 2, 'Sheet2 has 2 headers')
  assert(parsed2.headers[0] === 'Product Name', 'header 0 = Product Name')
  assert(parsed2.headers[1] === 'SKU', 'header 1 = SKU')
}

// ─── TEST 10: Selected sheet row count correct ───────────────────────────

console.log('\nTEST 10: Selected sheet row count correct')
{
  const buf = createXlsxBuffer([
    { name: 'Sheet1', data: [['Name'], ['R1'], ['R2'], ['R3'], ['R4'], ['R5']] },
    { name: 'Sheet2', data: [['Name'], ['Only1']] }
  ])
  const parsed1 = parseXlsx(buf, 'Sheet1')
  assert(parsed1.rows.length === 5, 'Sheet1 has 5 data rows')

  const parsed2 = parseXlsx(buf, 'Sheet2')
  assert(parsed2.rows.length === 1, 'Sheet2 has 1 data row')

  const metadata = getXlsxSheetMetadata(buf)
  const meta1 = metadata.find((s) => s.name === 'Sheet1')
  const meta2 = metadata.find((s) => s.name === 'Sheet2')
  assert(meta1!.rowCount === 5, 'metadata Sheet1 rowCount = 5')
  assert(meta2!.rowCount === 1, 'metadata Sheet2 rowCount = 1')
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
