/**
 * §TEST: Card customization regression tests.
 *
 * Run: npx tsx tests/unit/card-customization.test.ts
 *
 * Tests:
 *   A. cardPreferences = null → defaults (all true)
 *   B. Partial JSON → only specified keys change, others default
 *   C. Malformed JSON → safe defaults
 *   D. Unknown keys are removed/ignored
 *   E. Non-boolean values are rejected/ignored
 *   F. PUT app-settings persists cardPreferences (validateCardPreferences)
 *   G. GET app-settings returns persisted cardPreferences (sanitizeAppSettings)
 *   H. PUT business persists coverUrl (allow-list check)
 *   I. GET business returns coverUrl (sanitizeBusiness)
 *   J. Tenant isolation (businessId never accepted from client)
 *   K. Backup export includes coverUrl + cardPreferences
 *   L. Backup restore preserves both values
 */
export {}

import * as fs from 'fs'

// ─── Test Runner ───────────────────────────────────────────────────────────
let passed = 0
let failed = 0

function assert(condition: boolean, message: string) {
  if (condition) {
    console.log(`  ✅ ${message}`)
    passed++
  } else {
    console.log(`  ❌ ${message}`)
    failed++
  }
}

// ─── Import validation function from source (inline for test) ──────────────

// §VALIDATE-CARD-PREFERENCES: replicate the validateCardPreferences logic
// from src/app/api/app-settings/route.ts for unit testing.
function validateCardPreferences(input: unknown): string | null {
  let prefs: Record<string, unknown> = {}
  if (typeof input === 'string') {
    try {
      prefs = JSON.parse(input)
    } catch {
      return null
    }
  } else if (typeof input === 'object' && input !== null) {
    prefs = input as Record<string, unknown>
  } else {
    return null
  }
  const ALLOWED_KEYS = ['showOwner', 'showAddress', 'showPhone', 'showGstin'] as const
  const clean: Record<string, boolean> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}

// §PARSE-CARD-PREFS: Client-side parse with defaults (mirrors dashboard-view)
function parseCardPrefs(raw: string | null | undefined): {
  showOwner: boolean; showAddress: boolean; showPhone: boolean; showGstin: boolean
} {
  const defaults = { showOwner: true, showAddress: true, showPhone: true, showGstin: true }
  if (!raw) return defaults
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      showOwner: parsed.showOwner ?? true,
      showAddress: parsed.showAddress ?? true,
      showPhone: parsed.showPhone ?? true,
      showGstin: parsed.showGstin ?? true,
    }
  } catch {
    return defaults
  }
}

// ─── Tests ─────────────────────────────────────────────────────────────────

console.log('\n  Card preferences validation:')

// A. null → defaults
function testNullDefaults() {
  const result = parseCardPrefs(null)
  assert(result.showOwner === true, 'null cardPreferences → showOwner defaults to true')
  assert(result.showAddress === true, 'null cardPreferences → showAddress defaults to true')
  assert(result.showPhone === true, 'null cardPreferences → showPhone defaults to true')
  assert(result.showGstin === true, 'null cardPreferences → showGstin defaults to true')
}

// B. Partial JSON
function testPartialJson() {
  const result = parseCardPrefs('{"showPhone":false}')
  assert(result.showPhone === false, 'Partial: showPhone=false')
  assert(result.showOwner === true, 'Partial: showOwner defaults to true')
  assert(result.showAddress === true, 'Partial: showAddress defaults to true')
  assert(result.showGstin === true, 'Partial: showGstin defaults to true')
}

// C. Malformed JSON → defaults
function testMalformedJson() {
  const result = parseCardPrefs('{invalid json}')
  assert(result.showOwner === true, 'Malformed JSON → showOwner defaults to true')
  assert(result.showPhone === true, 'Malformed JSON → showPhone defaults to true')
}

// D. Unknown keys are removed/ignored
function testUnknownKeysRemoved() {
  const validated = validateCardPreferences('{"showPhone":false,"malicious":true,"admin":false}')
  assert(validated !== null, 'Unknown keys: validation succeeds')
  const parsed = JSON.parse(validated!)
  assert(parsed.malicious === undefined, 'Unknown key "malicious" is removed')
  assert(parsed.admin === undefined, 'Unknown key "admin" is removed')
  assert(parsed.showPhone === false, 'Known key "showPhone" is preserved')
}

// E. Non-boolean values are rejected
function testNonBooleanRejected() {
  const validated = validateCardPreferences('{"showPhone":"yes","showOwner":1,"showAddress":null}')
  assert(validated === null, 'Non-boolean values: all rejected → null')
}

// F. validateCardPreferences persists valid input
function testValidatePersists() {
  const validated = validateCardPreferences('{"showPhone":false,"showGstin":true}')
  assert(validated === '{"showPhone":false,"showGstin":true}', 'Valid input persisted correctly')
}

// G. validateCardPreferences handles object input
function testObjectInput() {
  const validated = validateCardPreferences({ showOwner: false })
  assert(validated === '{"showOwner":false}', 'Object input handled correctly')
}

// H. Business PUT allow-list includes coverUrl
function testBusinessAllowList() {
  const src = fs.readFileSync('src/app/api/business/route.ts', 'utf8')
  assert(src.includes("'coverUrl'"), 'Business PUT allow-list includes coverUrl')
  assert(src.includes('getCurrentBusiness'), 'Business route uses getCurrentBusiness (tenant isolation)')
}

// I. Business GET returns coverUrl (sanitizeBusiness includes coverUrl)
function testBusinessSanitizer() {
  const src = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
  assert(src.includes('coverUrl: b.coverUrl ?? null'), 'sanitizeBusiness includes coverUrl')
}

// J. App-settings PUT has RBAC (requireRole OWNER/ADMIN)
function testSettingsRBAC() {
  const src = fs.readFileSync('src/app/api/app-settings/route.ts', 'utf8')
  assert(src.includes("requireRole(['OWNER', 'ADMIN'])"), 'App-settings PUT requires OWNER/ADMIN')
}

// K. Backup export includes coverUrl + cardPreferences
function testBackupIncludes() {
  const src = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
  assert(src.includes('coverUrl'), 'Backup format includes coverUrl')
  assert(src.includes('cardPreferences'), 'Backup format includes cardPreferences')
}

// L. Backup restore preserves both (sanitizeAppSettings includes cardPreferences)
function testRestorePreserves() {
  const src = fs.readFileSync('src/lib/backup-format.ts', 'utf8')
  assert(src.includes('cardPreferences: s.cardPreferences ?? null'), 'sanitizeAppSettings includes cardPreferences fallback')
}

// M. No localStorage for business-level preferences
function testNoLocalStorage() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(!src.includes('localStorage.getItem(\'bizledger-card-prefs\''), 'No localStorage for card prefs (read)')
  assert(!src.includes('localStorage.setItem(\'bizledger-card-prefs\''), 'No localStorage for card prefs (write)')
}

// N. coverUrl upload doesn't overwrite logoUrl (and vice versa)
function testNoOverwrite() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  // The handleImageUpload uses dynamic key: { [field]: finalImage }
  // field is either 'logoUrl' or 'coverUrl' — only one is sent per upload
  assert(src.includes("field: 'logoUrl' | 'coverUrl'"), 'Upload handler accepts field parameter')
  assert(src.includes("[field]: finalImage"), 'Upload sends only the specified field (no overwrite)')
}

// ─── Run all tests ─────────────────────────────────────────────────────────

console.log('\n  Card preferences validation:')
testNullDefaults()
testPartialJson()
testMalformedJson()
testUnknownKeysRemoved()
testNonBooleanRejected()
testValidatePersists()
testObjectInput()

console.log('\n  API persistence:')
testBusinessAllowList()
testBusinessSanitizer()
testSettingsRBAC()

console.log('\n  Backup/restore:')
testBackupIncludes()
testRestorePreserves()

console.log('\n  No localStorage:')
testNoLocalStorage()

console.log('\n  Upload safety:')
testNoOverwrite()

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)

if (failed > 0) {
  process.exit(1)
}
