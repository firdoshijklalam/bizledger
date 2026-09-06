/**
 * §TEST: STEP-4E-FINAL — Quick Action resolver tests.
 *
 * Run: npx tsx tests/unit/quick-action-resolver.test.ts
 *
 * Tests the pure resolvePartyTypeFromAction + shouldOpenPartyForm helpers
 * that map quick action types to party form types.
 */
export {}

import { resolvePartyTypeFromAction, shouldOpenPartyForm } from '../../src/lib/quick-action-resolver'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

console.log('\n🧪 STEP-4E-FINAL: Quick Action Resolver Tests\n')

// ─── resolvePartyTypeFromAction ──────────────────────────────────────────
console.log('1. resolvePartyTypeFromAction')
{
  assert(resolvePartyTypeFromAction('add-customer') === 'customer', '1a: add-customer → customer')
  assert(resolvePartyTypeFromAction('add-supplier') === 'supplier', '1b: add-supplier → supplier')
  assert(resolvePartyTypeFromAction('add-party') === null, '1c: add-party → null (default)')
  assert(resolvePartyTypeFromAction('add-transaction') === null, '1d: add-transaction → null (not a party-creation action)')
  assert(resolvePartyTypeFromAction('new-invoice') === null, '1e: new-invoice → null')
  assert(resolvePartyTypeFromAction('unknown') === null, '1f: unknown → null')
}

// ─── shouldOpenPartyForm ────────────────────────────────────────────────
console.log('\n2. shouldOpenPartyForm')
{
  assert(shouldOpenPartyForm('add-party') === true, '2a: add-party → true')
  assert(shouldOpenPartyForm('add-customer') === true, '2b: add-customer → true')
  assert(shouldOpenPartyForm('add-supplier') === true, '2c: add-supplier → true')
  assert(shouldOpenPartyForm('add-transaction') === false, '2d: add-transaction → false')
  assert(shouldOpenPartyForm('new-invoice') === false, '2e: new-invoice → false')
  assert(shouldOpenPartyForm('view-invoices') === false, '2f: view-invoices → false')
  assert(shouldOpenPartyForm('unknown') === false, '2g: unknown → false')
}

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
if (failed > 0) process.exit(1)
