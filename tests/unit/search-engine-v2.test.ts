/**
 * §SEARCH-V2-TESTS: Comprehensive acceptance tests for the new search engine.
 *
 * Covers:
 *   1. Ranking — full/multi-token match wins over single-token exact
 *   2. Alias/searchTag matching with visible highlight mapping
 *   3. False-positive suppression ("Das and Sons" doesn't return Firdosh Alam)
 *   4. Bengali ↔ English matching with correct visible highlight
 *   5. Bengali vowel variants (ফিরদৌস / ফেরদৌস / ফেরদোস)
 *   6. Related invoice expansion (party → its invoices)
 *   7. Related transaction expansion (party → its transactions)
 *   8. Controlled fuzzy (Abdullah → abdulah)
 *   9. Common word dictionary (সিমেন্ট → cement)
 *  10. No fuzzy candidate generation (no false positives from 3-4 char fragments)
 */
export {}

import {
  searchEntities,
  searchAll,
  generateAliasesWithSpans,
  expandRelated,
  type SearchableEntity,
} from '../../src/lib/search-engine'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string, extra?: any) {
  if (cond) {
    console.log(`  ✅ ${msg}`)
    passed++
  } else {
    console.log(`  ❌ ${msg}${extra !== undefined ? ` — got: ${JSON.stringify(extra)}` : ''}`)
    failed++
  }
}

function makeEntities(names: string[]): SearchableEntity<{ id: string; name: string }>[] {
  return names.map((name, i) => ({
    id: `p${i}`,
    item: { id: `p${i}`, name },
    canonical: name,
    aliases: generateAliasesWithSpans(name),
  }))
}

console.log('\n🧪 Search Engine V2 — Acceptance Tests\n')

// ─── TEST 1: "Firdous Alam" → "Firdosh Alam" first, "Alam" second ─────────
console.log('TEST 1: Query "Firdous Alam" → "Firdosh Alam" first, "Alam" second')
{
  const entities = makeEntities(['Firdosh Alam', 'Alam'])
  const results = searchEntities(entities, 'Firdous Alam')
  assert(results.length === 2, `2 results (got ${results.length})`)
  assert(results[0]?.item.name === 'Firdosh Alam', `first = "Firdosh Alam" (got "${results[0]?.item.name}")`)
  assert(results[1]?.item.name === 'Alam', `second = "Alam" (got "${results[1]?.item.name}")`)
  // Both visible portions should be highlighted
  const r0 = results[0]?.highlightRanges || []
  assert(r0.length >= 1, `Firdosh Alam has highlight ranges (got ${r0.length})`)
  const firstHighlight = 'Firdosh Alam'.substring(r0[0].start, r0[0].end)
  assert(firstHighlight === 'Firdosh', `first highlight = "Firdosh" (got "${firstHighlight}")`)
}

// ─── TEST 2: "Abdullah" → "আব্দুল্লাহ" with visible highlight ──────────────
console.log('\nTEST 2: Query "Abdullah" → "আব্দুল্লাহ" with highlight')
{
  const entities = makeEntities(['আব্দুল্লাহ'])
  const results = searchEntities(entities, 'Abdullah')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'আব্দুল্লাহ', `found "আব্দুল্লাহ"`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 1, `has highlight ranges (got ${r.length})`)
  if (r.length > 0) {
    const highlighted = 'আব্দুল্লাহ'.substring(r[0].start, r[0].end)
    assert(highlighted === 'আব্দুল্লাহ', `highlighted visible = "আব্দুল্লাহ" (got "${highlighted}")`)
  }
}

// ─── TEST 3: "Das and Sons" → "Das & Sons" only — no Firdosh Alam ────────
console.log('\nTEST 3: Query "Das and Sons" → "Das & Sons" only, no false positives')
{
  const entities = makeEntities(['Das & Sons', 'Firdosh Alam', 'Maa Lakshmi Bhandar'])
  const results = searchEntities(entities, 'Das and Sons')
  const names = results.map((r) => r.item.name)
  assert(results.length >= 1, `at least 1 result (got ${results.length})`)
  assert(names.includes('Das & Sons'), `Das & Sons found`)
  assert(!names.includes('Firdosh Alam'), `Firdosh Alam NOT in results (got: ${names.join(', ')})`)
  assert(!names.includes('Maa Lakshmi Bhandar'), `Maa Lakshmi Bhandar NOT in results`)
}

// ─── TEST 4: "ফেরদৌস আলম" → "Firdosh Alam" with visible highlight ────────
console.log('\nTEST 4: Query "ফেরদৌস আলম" → "Firdosh Alam" with highlight')
{
  const entities = makeEntities(['Firdosh Alam'])
  const results = searchEntities(entities, 'ফেরদৌস আলম')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'Firdosh Alam', `found "Firdosh Alam"`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 2, `>= 2 highlight ranges (got ${r.length})`, r)
  if (r.length >= 2) {
    const h1 = 'Firdosh Alam'.substring(r[0].start, r[0].end)
    const h2 = 'Firdosh Alam'.substring(r[1].start, r[1].end)
    assert(h1 === 'Firdosh', `first highlight = "Firdosh" (got "${h1}")`)
    assert(h2 === 'Alam', `second highlight = "Alam" (got "${h2}")`)
  }
}

// ─── TEST 5: "দাস এন্ড সন্স" → "Das & Sons" only ──────────────────────────
console.log('\nTEST 5: Query "দাস এন্ড সন্স" → "Das & Sons" only')
{
  const entities = makeEntities(['Das & Sons', 'Firdosh Alam', 'Maa Lakshmi Bhandar'])
  const results = searchEntities(entities, 'দাস এন্ড সন্স')
  const names = results.map((r) => r.item.name)
  assert(names.includes('Das & Sons'), `Das & Sons found`)
  assert(!names.includes('Firdosh Alam'), `Firdosh Alam NOT in results`)
  assert(!names.includes('Maa Lakshmi Bhandar'), `Maa Lakshmi Bhandar NOT in results`)
}

// ─── TEST 6: "সিমেন্ট" → "Cement Bag 50kg" with "Cement" highlighted ─────
console.log('\nTEST 6: Query "সিমেন্ট" → "Cement Bag 50kg" with "Cement" highlighted')
{
  const entities = makeEntities(['Cement Bag 50kg'])
  const results = searchEntities(entities, 'সিমেন্ট')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'Cement Bag 50kg', `found "Cement Bag 50kg"`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 1, `has highlight ranges (got ${r.length})`, r)
  if (r.length >= 1) {
    const highlighted = 'Cement Bag 50kg'.substring(r[0].start, r[0].end)
    assert(highlighted === 'Cement', `highlighted visible = "Cement" (got "${highlighted}")`)
  }
}

// ─── TEST 7: "অমিত" → "Amit Trading", not Verma/Rehmat/Miniket/Cement/Mustard ─
console.log('\nTEST 7: Query "অমিত" → "Amit Trading" only')
{
  const entities = makeEntities([
    'Amit Trading',
    'Verma Electronics',
    'Rehmat',
    'Miniket Rice',
    'Mustard Oil',
    'Cement Bag',
  ])
  const results = searchEntities(entities, 'অমিত')
  const names = results.map((r) => r.item.name)
  assert(names.includes('Amit Trading'), `Amit Trading found`)
  assert(!names.includes('Verma Electronics'), `Verma Electronics NOT in results`)
  assert(!names.includes('Rehmat'), `Rehmat NOT in results`)
  assert(!names.includes('Miniket Rice'), `Miniket Rice NOT in results`)
  assert(!names.includes('Mustard Oil'), `Mustard Oil NOT in results`)
  assert(!names.includes('Cement Bag'), `Cement Bag NOT in results`)
  // Highlight should be on "Amit"
  if (results.length > 0) {
    const r = results[0].highlightRanges
    const h = 'Amit Trading'.substring(r[0].start, r[0].end)
    assert(h === 'Amit', `highlighted visible = "Amit" (got "${h}")`)
  }
}

// ─── TEST 8: "ফিরদৌস" → "Firdosh Alam" with "Firdosh" highlighted ─────────
console.log('\nTEST 8: Query "ফিরদৌস" → "Firdosh Alam" with "Firdosh" highlighted')
{
  const entities = makeEntities(['Firdosh Alam'])
  const results = searchEntities(entities, 'ফিরদৌস')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'Firdosh Alam', `found "Firdosh Alam"`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 1, `has highlight ranges`, r)
  if (r.length >= 1) {
    const h = 'Firdosh Alam'.substring(r[0].start, r[0].end)
    assert(h === 'Firdosh', `highlighted visible = "Firdosh" (got "${h}")`)
  }
}

// ─── TEST 9: "দৌস" → "Firdosh Alam" with "Firdosh" highlighted ───────────
console.log('\nTEST 9: Query "দৌস" → "Firdosh Alam" with "Firdosh" highlighted')
{
  const entities = makeEntities(['Firdosh Alam'])
  const results = searchEntities(entities, 'দৌস')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'Firdosh Alam', `found "Firdosh Alam"`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 1, `has highlight ranges`, r)
  if (r.length >= 1) {
    const h = 'Firdosh Alam'.substring(r[0].start, r[0].end)
    assert(h === 'Firdosh', `highlighted visible = "Firdosh" (got "${h}")`)
  }
}

// ─── TEST 10: Related invoice expansion — Abdullah's invoices ──────────────
console.log('\nTEST 10: Query "Abdullah" — related invoices expand')
{
  const party = { id: 'p1', name: 'আব্দুল্লাহ' }
  const partyMatches = searchEntities(
    [{ id: party.id, item: party, canonical: party.name, aliases: generateAliasesWithSpans(party.name) }],
    'Abdullah'
  )
  const invoices = [
    { id: 'i1', invoiceNumber: 'INV-001', partyId: 'p1' },
    { id: 'i2', invoiceNumber: 'INV-002', partyId: 'p2' },
    { id: 'i3', invoiceNumber: 'INV-003', partyId: 'p1' },
  ]
  const expanded = expandRelated({
    partyMatches,
    invoices,
    transactions: [],
    invoiceToPartyId: (i: any) => i.partyId,
    invoiceToCanonical: (i: any) => i.invoiceNumber,
    invoiceToId: (i: any) => i.id,
    txnToPartyId: () => null,
    txnToCanonical: () => '',
    txnToId: () => '',
  })
  assert(expanded.relatedInvoices.length === 2, `2 related invoices (got ${expanded.relatedInvoices.length})`)
  const invIds = expanded.relatedInvoices.map((r) => (r.item as any).id)
  assert(invIds.includes('i1'), `INV-001 found`)
  assert(invIds.includes('i3'), `INV-003 found`)
  assert(!invIds.includes('i2'), `INV-002 (other party) NOT included`)
  // §PARTY-NAME-CARRIED: each related invoice carries the party name
  assert(
    expanded.relatedInvoices.every((r) => r.relatedPartyName === 'আব্দুল্লাহ'),
    `every related invoice carries party name`
  )
}

// ─── TEST 11: Related transaction expansion ──────────────────────────────
console.log('\nTEST 11: Query "Abdullah" — related transactions expand')
{
  const party = { id: 'p1', name: 'আব্দুল্লাহ' }
  const partyMatches = searchEntities(
    [{ id: party.id, item: party, canonical: party.name, aliases: generateAliasesWithSpans(party.name) }],
    'Abdullah'
  )
  const txns = [
    { id: 't1', description: 'Sale', partyId: 'p1' },
    { id: 't2', description: 'Sale', partyId: 'p2' },
  ]
  const expanded = expandRelated({
    partyMatches,
    invoices: [],
    transactions: txns,
    invoiceToPartyId: () => null,
    invoiceToCanonical: () => '',
    invoiceToId: () => '',
    txnToPartyId: (t: any) => t.partyId,
    txnToCanonical: (t: any) => t.description,
    txnToId: (t: any) => t.id,
  })
  assert(expanded.relatedTransactions.length === 1, `1 related txn (got ${expanded.relatedTransactions.length})`)
  assert(
    expanded.relatedTransactions[0].relatedPartyName === 'আব্দুল্লাহ',
    `related txn carries party name`
  )
}

// ─── TEST 12: Controlled fuzzy — "Abdulah" → "Abdullah" via alias ─────────
console.log('\nTEST 12: Controlled fuzzy — "Abdulah" → "Abdullah" via alias')
{
  // The canonical name is "Abdullah" (English); user types "Abdulah" (1 L).
  // Our alias generation should NOT generate "abdulah", but controlled fuzzy
  // (edit distance 1) should match it.
  const entities = makeEntities(['Abdullah'])
  const results = searchEntities(entities, 'Abdulah')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'Abdullah', `found "Abdullah"`)
}

// ─── TEST 13: Bengali vowel variant — "ফিরদৌস" matches "ফেরদৌস" ─────────
console.log('\nTEST 13: Bengali vowel variant — "ফিরদৌস" matches "ফেরদৌস"')
{
  const entities = makeEntities(['ফেরদৌস আলাম'])
  const results = searchEntities(entities, 'ফিরদৌস')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  assert(results[0]?.item.name === 'ফেরদৌস আলাম', `found`)
}

// ─── TEST 14: False positive — short fuzzy fragments don't create matches ─
console.log('\nTEST 14: No false positives — "ami" should not match "Verma" or "Amit Trading"')
{
  const entities = makeEntities(['Verma Electronics', 'Amit Trading'])
  // Query "ami" is a 3-char fragment — should not match "Verma" via fuzzy
  // (we only allow controlled fuzzy on aliases for tokens >= 4 chars).
  const results = searchEntities(entities, 'ami')
  // Expected: "Amit Trading" should match (its alias "amit" includes "ami" as substring)
  // But "Verma Electronics" should NOT match
  const names = results.map((r) => r.item.name)
  assert(!names.includes('Verma Electronics'), `Verma NOT matched for "ami" (got: ${names.join(', ')})`)
}

// ─── TEST 15: Cross-script common word — "চাল" → "Rice" ──────────────────
console.log('\nTEST 15: Common word — "চাল" → "Miniket Rice"')
{
  const entities = makeEntities(['Miniket Rice'])
  const results = searchEntities(entities, 'চাল')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  if (results.length > 0) {
    const r = results[0].highlightRanges
    const h = 'Miniket Rice'.substring(r[0].start, r[0].end)
    assert(h === 'Rice', `highlighted visible = "Rice" (got "${h}")`)
  }
}

// ─── TEST 16: Full search with related expansion via searchAll ─────────────
console.log('\nTEST 16: searchAll — "Abdullah" finds party + related invoices + txns')
{
  const party = { id: 'p1', name: 'আব্দুল্লাহ' }
  const parties = [party]
  const invoices = [
    { id: 'i1', invoiceNumber: 'INV-001', partyId: 'p1', party: { name: 'আব্দুল্লাহ' } },
    { id: 'i2', invoiceNumber: 'INV-002', partyId: 'p2', party: { name: 'Other' } },
  ]
  const txns = [
    { id: 't1', description: 'Sale', partyId: 'p1', type: 'credit', amount: 100, createdAt: '' },
  ]
  const result = searchAll({
    parties,
    products: [],
    invoices,
    transactions: txns,
    query: 'Abdullah',
    partyToEntity: (p: any) => ({
      id: p.id,
      item: p,
      canonical: p.name,
      aliases: generateAliasesWithSpans(p.name),
    }),
    productToEntity: () => ({ id: '', item: null as any, canonical: '' }),
    invoiceToEntity: (i: any) => ({
      id: i.id,
      item: i,
      canonical: i.invoiceNumber,
      aliases: generateAliasesWithSpans(i.invoiceNumber),
      partyId: i.partyId,
      partyName: i.party?.name,
    }),
    txnToEntity: (t: any) => ({
      id: t.id,
      item: t,
      canonical: t.description || t.type,
      aliases: generateAliasesWithSpans(t.description || t.type),
      partyId: t.partyId,
    }),
  })
  assert(result.parties.length >= 1, `party found`)
  assert(result.relatedInvoices.length >= 1, `related invoices found (got ${result.relatedInvoices.length})`)
  assert(
    result.relatedInvoices.every((r) => (r.item as any).partyId === 'p1'),
    `all related invoices belong to party p1`
  )
  assert(result.relatedTransactions.length >= 1, `related txns found`)
  assert(
    result.relatedTransactions.every((r) => (r.item as any).partyId === 'p1'),
    `all related txns belong to party p1`
  )
}

// ─── TEST 17: Score tiers — full-exact < all-tokens < single-token ────────
console.log('\nTEST 17: Score tiers — full-exact < all-tokens < single-token')
{
  const entities = makeEntities(['Firdosh Alam', 'Alam'])
  // Query "Firdosh Alam" — full-exact match for "Firdosh Alam", token-only for "Alam"
  const results = searchEntities(entities, 'Firdosh Alam')
  assert(results[0].item.name === 'Firdosh Alam', `first = "Firdosh Alam"`)
  assert(results[0].score === 0, `first score = 0 (full-exact-prefix) (got ${results[0].score})`)
  // "Alam" should only match via single-token (score 4.5 or 5.0)
  const alam = results.find((r) => r.item.name === 'Alam')
  assert(!!alam, `Alam found`)
  if (alam) {
    assert(
      alam.score >= 4.5 && alam.score <= 5.5,
      `Alam score = ${alam.score} (single-token tier)`
    )
  }
}

// ─── TEST 18: Aliases contain visible spans ───────────────────────────────
console.log('\nTEST 18: Aliases contain visible spans')
{
  const aliases = generateAliasesWithSpans('Firdosh Alam')
  // Find an alias for "Firdosh" (e.g., "firdous")
  const firdousAlias = aliases.find((a) => a.normalized === 'firdous')
  assert(!!firdousAlias, `alias "firdous" exists`)
  if (firdousAlias) {
    assert(
      firdousAlias.visibleSpans.length === 1 &&
        firdousAlias.visibleSpans[0].start === 0 &&
        firdousAlias.visibleSpans[0].end === 7,
      `visible span for "firdous" = [0,7] (got ${JSON.stringify(firdousAlias.visibleSpans)})`
    )
  }
  // Find an alias for "Alam"
  const alamAlias = aliases.find((a) => a.normalized === 'alam')
  assert(!!alamAlias, `alias "alam" exists`)
  if (alamAlias) {
    assert(
      alamAlias.visibleSpans.length === 1 &&
        alamAlias.visibleSpans[0].start === 8 &&
        alamAlias.visibleSpans[0].end === 12,
      `visible span for "alam" = [8,12] (got ${JSON.stringify(alamAlias.visibleSpans)})`
    )
  }
}

// ─── TEST 19: Highlight ranges on alias match ─────────────────────────────
console.log('\nTEST 19: Highlight ranges on alias match — query "firdous" on "Firdosh Alam"')
{
  const entities = makeEntities(['Firdosh Alam'])
  const results = searchEntities(entities, 'firdous')
  assert(results.length >= 1, `1 result (got ${results.length})`)
  const r = results[0]?.highlightRanges || []
  assert(r.length >= 1, `has highlight ranges`, r)
  if (r.length >= 1) {
    const h = 'Firdosh Alam'.substring(r[0].start, r[0].end)
    assert(h === 'Firdosh', `highlighted visible = "Firdosh" (got "${h}")`)
  }
}

// ─── TEST 20: Empty / short query ─────────────────────────────────────────
console.log('\nTEST 20: Empty query — no results')
{
  const entities = makeEntities(['Test'])
  assert(searchEntities(entities, '').length === 0, `empty query → 0 results`)
  assert(searchEntities(entities, 'A').length === 0, `1-char query → 0 results`)
}

console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
