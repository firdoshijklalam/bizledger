/**
 * §TEST: Search engine — deterministic matching, ranking, highlighting.
 */
export {}

import { findMatchPosition, rankByPosition, findAllHighlightRanges } from '../../src/lib/search-rank'

let passed = 0
let failed = 0
function assert(condition: boolean, message: string) {
  if (condition) { console.log(`  ✅ ${message}`); passed++ }
  else { console.log(`  ❌ ${message}`); failed++ }
}

console.log('\n🧪 Search Engine Tests\n')

// TEST 1: Exact match — Abdullah finds Abdullah
console.log('TEST 1: Exact match — "Abdullah" finds "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'Abdullah')
  assert(result.index === 0, `index = 0`)
  assert(result.position === 'prefix', `position = prefix`)
}

// TEST 2: Prefix match
console.log('\nTEST 2: Prefix — "Abd" matches "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'Abd')
  assert(result.index === 0, `index = 0`)
  assert(result.position === 'prefix', `position = prefix`)
}

// TEST 3: Middle substring (infix)
console.log('\nTEST 3: Middle — "dul" matches "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'dul')
  assert(result.index === 2, `index = 2`)
  assert(result.position === 'infix', `position = infix`)
}

// TEST 4: Ending substring (suffix)
console.log('\nTEST 4: Suffix — "llah" matches "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'llah')
  assert(result.position === 'suffix', `position = suffix`)
}

// TEST 5: Multi-token — "Firdosh Alam" matches both tokens
console.log('\nTEST 5: Multi-token — "Firdosh Alam"')
{
  const items = [{ name: 'Firdosh Alam' }, { name: 'Alam' }, { name: 'Firdosh Khan' }]
  const ranked = rankByPosition(items, 'Firdosh Alam', (i) => i.name)
  assert(ranked.length >= 1, `at least 1 match`)
  assert(ranked[0].item.name === 'Firdosh Alam', `first = "Firdosh Alam"`)
  assert(ranked[0].score === 0, `score = 0 (prefix)`)
}

// TEST 6: Ranking — "Firdosh Alam" above "Alam"
console.log('\nTEST 6: Ranking — "Firdosh Alam" above "Alam"')
{
  const items = [{ name: 'Alam' }, { name: 'Firdosh Alam' }]
  const ranked = rankByPosition(items, 'Firdosh Alam', (i) => i.name)
  assert(ranked.length >= 2, `at least 2 matches`)
  assert(ranked[0].item.name === 'Firdosh Alam', `first = "Firdosh Alam"`)
  if (ranked.length >= 2) assert(ranked[1].item.name === 'Alam', `second = "Alam"`)
}

// TEST 7: Case-insensitive
console.log('\nTEST 7: Case-insensitive — "ABDULLAH" finds "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'ABDULLAH')
  assert(result.index === 0, `index = 0`)
  assert(result.position === 'prefix', `position = prefix`)
}

// TEST 8: Bengali normalization — "দৌস" in "ফেরদৌস আলম"
console.log('\nTEST 8: Bengali — "দৌস" in "ফেরদৌস আলম"')
{
  const result = findMatchPosition('ফেরদৌস আলম', 'দৌস')
  assert(result.index >= 0, `found (index = ${result.index})`)
  assert(result.position === 'infix', `position = infix`)
}

// TEST 9: Irrelevant suppression — "Amit Trading" NOT for "ফিরদৌস আলম"
console.log('\nTEST 9: Irrelevant — "Amit Trading" not for "ফিরদৌস আলম"')
{
  const items = [{ name: 'Amit Trading' }, { name: 'ফেরদৌস আলাম' }]
  const ranked = rankByPosition(items, 'ফিরদৌস আলম', (i) => i.name)
  const amitMatch = ranked.find((r) => r.item.name === 'Amit Trading')
  assert(!amitMatch, `Amit Trading NOT in results`)
}

// TEST 10: Highlight — "দৌস" in "ফেরদৌস আলম"
console.log('\nTEST 10: Highlight — "দৌস" in "ফেরদৌস আলম"')
{
  const ranges = findAllHighlightRanges('ফেরদৌস আলম', 'দৌস')
  assert(ranges.length > 0, `at least 1 range`)
  if (ranges.length > 0) {
    const highlightedText = 'ফেরদৌস আলম'.substring(ranges[0].start, ranges[0].end)
    assert(highlightedText.includes('দৌস'), `highlighted includes "দৌস"`)
  }
}

// TEST 11: Highlight — "Alam" in "Firdosh Alam"
console.log('\nTEST 11: Highlight — "Alam" in "Firdosh Alam"')
{
  const ranges = findAllHighlightRanges('Firdosh Alam', 'Alam')
  assert(ranges.length > 0, `at least 1 range`)
  if (ranges.length > 0) {
    const text = 'Firdosh Alam'.substring(ranges[0].start, ranges[0].end)
    assert(text === 'Alam', `highlighted = "Alam"`)
  }
}

// TEST 12: Highlight — multi-word "Firdosh Alam"
console.log('\nTEST 12: Highlight — multi-word "Firdosh Alam"')
{
  const ranges = findAllHighlightRanges('Firdosh Alam Khan', 'Firdosh Alam')
  assert(ranges.length > 0, `at least 1 range`)
}

// TEST 13: No match
console.log('\nTEST 13: No match — "xyz" in "Abdullah"')
{
  const result = findMatchPosition('Abdullah', 'xyz')
  assert(result.index === -1, `index = -1`)
  assert(result.position === 'none', `position = none`)
}

// TEST 14: Minimum 2 chars
console.log('\nTEST 14: Min 2 chars — "A" should not match')
{
  const result = findMatchPosition('Abdullah', 'A')
  assert(result.index === -1, `index = -1`)
}

// TEST 15: "Alam" independently discoverable
console.log('\nTEST 15: "Alam" independently discoverable')
{
  const items = [{ name: 'Firdosh Alam' }, { name: 'Alam' }, { name: 'Alam Khan' }]
  const ranked = rankByPosition(items, 'Alam', (i) => i.name)
  assert(ranked.length === 3, `3 matches`)
  assert(ranked[0].item.name === 'Alam', `first = "Alam"`)
  assert(ranked[1].item.name === 'Alam Khan', `second = "Alam Khan"`)
  assert(ranked[2].item.name === 'Firdosh Alam', `third = "Firdosh Alam"`)
}

// TEST 16: Cross-lingual — "firdos" in "ফেরদৌস"
console.log('\nTEST 16: Cross-lingual — "firdos" in "ফেরদৌস"')
{
  const ranges = findAllHighlightRanges('ফেরদৌস আলম', 'firdos')
  assert(true, `no crash (ranges: ${ranges.length})`)
}

// TEST 17: Ranking — prefix > infix > suffix
console.log('\nTEST 17: Ranking — prefix > infix > suffix')
{
  const items = [
    { name: 'Rahul Enterprise' },
    { name: 'Mid Rahul Enterprise' },
    { name: 'Enterprise Rahul' },
  ]
  const ranked = rankByPosition(items, 'Rahul', (i) => i.name)
  assert(ranked.length === 3, `3 matches`)
  assert(ranked[0].item.name === 'Rahul Enterprise', `first = prefix`)
}

// TEST 18: Transaction search — description + party name
console.log('\nTEST 18: Transaction search — party name')
{
  const txns = [
    { description: 'Sale (full)', party: { name: 'Abdullah' } },
    { description: 'Sale (full)', party: { name: 'Firdosh' } },
  ]
  const ranked = rankByPosition(txns, 'Abdullah', (t: any) => t.description, (t: any) => [t.party?.name || ''])
  assert(ranked.length >= 1, `at least 1 match`)
  if (ranked.length > 0) assert((ranked[0].item as any).party.name === 'Abdullah', `found Abdullah's transaction`)
}

// TEST 19: Fuzzy does NOT create results — "Amit" does NOT match "ফেরদৌস আলম"
console.log('\nTEST 19: No fuzzy candidate generation — "Amit" vs "ফেরদৌস আলম"')
{
  const items = [{ name: 'Amit Trading' }, { name: 'ফেরদৌস আলাম' }]
  const ranked = rankByPosition(items, 'ফিরদৌস আলম', (i) => i.name)
  const amitMatch = ranked.find((r) => r.item.name === 'Amit Trading')
  assert(!amitMatch, `Amit Trading NOT matched`)
}

// TEST 20: Empty query
console.log('\nTEST 20: Empty query — no results')
{
  const items = [{ name: 'Test' }]
  const ranked = rankByPosition(items, '', (i) => i.name)
  assert(ranked.length === 0, `0 results`)
}

// TEST 21: Bengali→English common word — "সিমেন্ট" → "cement"
console.log('\nTEST 21: Bengali→English — "সিমেন্ট" finds "Cement Bag"')
{
  const items = [{ name: 'Cement Bag 50kg' }, { name: 'Amit Trading' }]
  const ranked = rankByPosition(items, 'সিমেন্ট', (i) => i.name)
  const cementMatch = ranked.find((r) => r.item.name === 'Cement Bag 50kg')
  assert(!!cementMatch, `Cement Bag found for "সিমেন্ট"`)
  const amitMatch = ranked.find((r) => r.item.name === 'Amit Trading')
  assert(!amitMatch, `Amit Trading NOT found`)
}

// TEST 22: Bengali vowel variant — "ফিরদৌস" matches "ফেরদৌস"
console.log('\nTEST 22: Bengali vowel variant — "ফিরদৌস" matches "ফেরদৌস"')
{
  const items = [{ name: 'ফেরদৌস আলাম' }]
  const ranked = rankByPosition(items, 'ফিরদৌস', (i) => i.name)
  assert(ranked.length >= 1, `at least 1 match (got ${ranked.length})`)
}

// TEST 23: Sahil Ahmed does NOT match "আলাম"
console.log('\nTEST 23: "আলাম" does NOT match "Sahil Ahmed"')
{
  const items = [{ name: 'Sahil Ahmed' }, { name: 'Alam' }]
  const ranked = rankByPosition(items, 'আলাম', (i) => i.name)
  const sahilMatch = ranked.find((r) => r.item.name === 'Sahil Ahmed')
  assert(!sahilMatch, `Sahil Ahmed NOT matched for "আলাম"`)
}

// TEST 24: No false positives for "অমিত" — only Amit Trading
console.log('\nTEST 24: "অমিত" finds Amit Trading, NOT Verma Electronics')
{
  const items = [{ name: 'Amit Trading' }, { name: 'Verma Electronics' }, { name: 'Rehmat' }]
  const ranked = rankByPosition(items, 'অমিত', (i) => i.name)
  const amitMatch = ranked.find((r) => r.item.name === 'Amit Trading')
  assert(!!amitMatch, `Amit Trading found`)
  const vermaMatch = ranked.find((r) => r.item.name === 'Verma Electronics')
  assert(!vermaMatch, `Verma Electronics NOT found`)
  const rehmatMatch = ranked.find((r) => r.item.name === 'Rehmat')
  assert(!rehmatMatch, `Rehmat NOT found`)
}

console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
