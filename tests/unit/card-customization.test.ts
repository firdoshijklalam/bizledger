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
  const clean: Record<string, unknown> = {}
  const BOOL_KEYS = ['showOwner', 'showAddress', 'showPhone', 'showGstin'] as const
  for (const key of BOOL_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }
  if ('greetingText' in prefs && typeof prefs.greetingText === 'string') {
    clean.greetingText = prefs.greetingText.trim().slice(0, 30)
  }
  if ('coverBlur' in prefs && typeof prefs.coverBlur === 'number' && !isNaN(prefs.coverBlur)) {
    clean.coverBlur = Math.max(0, Math.min(20, Math.round(prefs.coverBlur)))
  }
  if ('coverOverlay' in prefs && typeof prefs.coverOverlay === 'number' && !isNaN(prefs.coverOverlay)) {
    clean.coverOverlay = Math.max(0, Math.min(0.9, Math.round(prefs.coverOverlay * 100) / 100))
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}

// §PARSE-CARD-PREFS: Client-side parse with defaults (mirrors dashboard-view)
function parseCardPrefs(raw: any): {
  showOwner: boolean; showAddress: boolean; showPhone: boolean; showGstin: boolean
  greetingText: string; coverBlur: number; coverOverlay: number
} {
  const defaults = { showOwner: true, showAddress: true, showPhone: true, showGstin: true, greetingText: 'Namaste', coverBlur: 8, coverOverlay: 0.35 }
  if (!raw) return defaults
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
    return {
      showOwner: parsed.showOwner ?? defaults.showOwner,
      showAddress: parsed.showAddress ?? defaults.showAddress,
      showPhone: parsed.showPhone ?? defaults.showPhone,
      showGstin: parsed.showGstin ?? defaults.showGstin,
      greetingText: typeof parsed.greetingText === 'string' ? parsed.greetingText.slice(0, 30) : defaults.greetingText,
      coverBlur: typeof parsed.coverBlur === 'number' ? Math.max(0, Math.min(20, parsed.coverBlur)) : defaults.coverBlur,
      coverOverlay: typeof parsed.coverOverlay === 'number' ? Math.max(0, Math.min(0.9, parsed.coverOverlay)) : defaults.coverOverlay,
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
  assert(src.includes("field: 'logoUrl' | 'coverUrl'"), 'Upload handler accepts field parameter')
  assert(src.includes("setDraftLogo(finalImage)") || src.includes("setDraftCover(finalImage)"), 'Upload sets draft (not DB) and only the specified field')
}

// O. Cover blur clamping
function testCoverBlurClamp() {
  const validated = validateCardPreferences('{"coverBlur":50}')
  const parsed = JSON.parse(validated!)
  assert(parsed.coverBlur === 20, 'Cover blur clamped to max 20')
  const validated2 = validateCardPreferences('{"coverBlur":-5}')
  const parsed2 = JSON.parse(validated2!)
  assert(parsed2.coverBlur === 0, 'Cover blur clamped to min 0')
}

// P. Cover overlay clamping
function testCoverOverlayClamp() {
  const validated = validateCardPreferences('{"coverOverlay":1.5}')
  const parsed = JSON.parse(validated!)
  assert(parsed.coverOverlay === 0.9, 'Cover overlay clamped to max 0.9')
  const validated2 = validateCardPreferences('{"coverOverlay":-0.5}')
  const parsed2 = JSON.parse(validated2!)
  assert(parsed2.coverOverlay === 0, 'Cover overlay clamped to min 0')
}

// Q. Greeting text max length
function testGreetingMaxLength() {
  const longText = 'A'.repeat(50)
  const validated = validateCardPreferences(`{"greetingText":"${longText}"}`)
  const parsed = JSON.parse(validated!)
  assert(parsed.greetingText.length === 30, 'Greeting text truncated to 30 chars')
}

// R. Greeting text default when empty
function testGreetingDefaultEmpty() {
  const result = parseCardPrefs('{"greetingText":""}')
  assert(result.greetingText === '', 'Empty greeting returns empty string (UI falls back to default)')
}

// S. Cover blur default
function testCoverBlurDefault() {
  const result = parseCardPrefs(null)
  assert(result.coverBlur === 8, 'Default cover blur is 8')
}

// T. Cover overlay default
function testCoverOverlayDefault() {
  const result = parseCardPrefs(null)
  assert(result.coverOverlay === 0.35, 'Default cover overlay is 0.35')
}

// U. Greeting default
function testGreetingDefault() {
  const result = parseCardPrefs(null)
  assert(result.greetingText === 'Namaste', 'Default greeting is Namaste')
}

// V. Non-number coverBlur rejected
function testNonNumberBlurRejected() {
  const validated = validateCardPreferences('{"coverBlur":"high"}')
  assert(validated === null, 'Non-number coverBlur rejected (null result)')
}

// W. Non-number coverOverlay rejected
function testNonNumberOverlayRejected() {
  const validated = validateCardPreferences('{"coverOverlay":"strong"}')
  assert(validated === null, 'Non-number coverOverlay rejected (null result)')
}

// X. All fields persist together
function testAllFieldsPersist() {
  const input = '{"showOwner":false,"showAddress":true,"showPhone":false,"showGstin":true,"greetingText":"Welcome","coverBlur":5,"coverOverlay":0.6}'
  const validated = validateCardPreferences(input)
  const parsed = JSON.parse(validated!)
  assert(parsed.showOwner === false, 'showOwner persisted')
  assert(parsed.showAddress === true, 'showAddress persisted')
  assert(parsed.showPhone === false, 'showPhone persisted')
  assert(parsed.showGstin === true, 'showGstin persisted')
  assert(parsed.greetingText === 'Welcome', 'greetingText persisted')
  assert(parsed.coverBlur === 5, 'coverBlur persisted')
  assert(parsed.coverOverlay === 0.6, 'coverOverlay persisted')
}

// Y. Draft model: no window.location.reload in save flow
function testNoPageReload() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(!src.includes('window.location.reload()'), 'No page reload after save (uses store update)')
}

// Z. Save persists via API calls
function testSaveUsesApi() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes("fetch('/api/card-customization'"), 'Save uses atomic /api/card-customization endpoint')
  assert(!src.includes("window.location.reload()"), 'No page reload after save')
}

// AA. Cancel discards draft
function testCancelDiscards() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('cancelCustomizer'), 'Cancel function exists')
  assert(src.includes('setDraft(cardPrefs)'), 'Cancel restores saved state')
}

// BB. Atomic endpoint exists
function testAtomicEndpoint() {
  const exists = fs.existsSync('src/app/api/card-customization/route.ts')
  assert(exists, 'POST /api/card-customization endpoint exists')
}

// CC. Atomic endpoint uses $transaction
function testAtomicTransaction() {
  const src = fs.readFileSync('src/app/api/card-customization/route.ts', 'utf8')
  assert(src.includes('db.$transaction'), 'Card customization uses Prisma $transaction')
}

// DD. Atomic endpoint has RBAC
function testAtomicRBAC() {
  const src = fs.readFileSync('src/app/api/card-customization/route.ts', 'utf8')
  assert(src.includes("requireRole(['OWNER', 'ADMIN'])"), 'Card customization requires OWNER/ADMIN')
}

// EE. Atomic endpoint uses getCurrentBusiness (tenant isolation)
function testAtomicTenantIsolation() {
  const src = fs.readFileSync('src/app/api/card-customization/route.ts', 'utf8')
  assert(src.includes('getCurrentBusiness'), 'Card customization uses getCurrentBusiness (tenant isolation)')
}

// FF. isDirty state tracking
function testDirtyStateTracking() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('isDirty'), 'isDirty state exists')
  assert(src.includes('disabled={saving || !isDirty}'), 'Save button disabled when not dirty')
}

// GG. No separate app-settings or business API calls in save flow
function testNoSeparateApiCalls() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  // The save function should NOT contain separate PUT /api/app-settings or PUT /api/business calls
  const saveStart = src.indexOf('const saveChanges')
  const saveEnd = src.indexOf('}', saveStart + 200)
  const saveFunc = src.substring(saveStart, saveEnd + 1)
  assert(!saveFunc.includes("fetch('/api/app-settings'"), 'Save does not call /api/app-settings separately')
  assert(!saveFunc.includes("fetch('/api/business'"), 'Save does not call /api/business separately')
}

// HH. Image upload uses awaited FileReader (not async callback)
function testAwaitedFileReader() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('await new Promise<string>'), 'FileReader wrapped in awaited Promise')
  assert(!src.includes('reader.onload = async'), 'No async onload callback (old bug)')
}

// II. Upload error state exists
function testUploadErrorState() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('uploadError'), 'uploadError state exists')
  assert(src.includes('Could not process image'), 'Visible error message on upload failure')
}

// JJ. Input value reset after file select
function testInputValueReset() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes("e.target.value = ''"), 'File input value reset after select')
}

// KK. Save uses server response as source of truth (not stale business)
function testServerResponseSource() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('data.business'), 'Save uses server response data.business')
  assert(src.includes('useAppStore.getState().setBusiness(data.business)'), 'Uses server response for setBusiness')
  // Old buggy pattern should NOT be present
  const saveStart = src.indexOf('const saveChanges')
  const saveEnd = src.indexOf('}', saveStart + 400)
  const saveFunc = src.substring(saveStart, saveEnd + 1)
  assert(!saveFunc.includes('setBusiness({ ...business, logoUrl'), 'Does NOT use stale business for logo update')
  assert(!saveFunc.includes('setBusiness({ ...business, coverUrl'), 'Does NOT use stale business for cover update')
}

// LL. API input validation: rejects non-image strings
function testApiInputValidation() {
  const src = fs.readFileSync('src/app/api/card-customization/route.ts', 'utf8')
  assert(src.includes('validateImageUrl'), 'API has validateImageUrl function')
  assert(src.includes('data:image/'), 'API accepts data:image/ URLs')
  assert(src.includes('linear-gradient('), 'API accepts linear-gradient (CSS presets)')
  assert(src.includes('MAX_IMAGE_SIZE'), 'API has max image size limit')
}

// MM. MIME type validation on client
function testClientMimeValidation() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('file.type.startsWith'), 'Client validates MIME type')
}

// NN. Upload error cleared on new upload
function testErrorClearedOnNewUpload() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  assert(src.includes('setUploadError(null)'), 'Upload error cleared on new upload start')
}

// OO. Upload error cleared on save success
function testErrorClearedOnSaveSuccess() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  const saveStart = src.indexOf('const saveChanges')
  const saveEnd = src.indexOf('}', saveStart + 300)
  const saveFunc = src.substring(saveStart, saveEnd + 1)
  assert(saveFunc.includes('setUploadError(null)'), 'Upload error cleared on save start')
}

// PP. Upload error cleared on openCustomizer
function testErrorClearedOnOpen() {
  const src = fs.readFileSync('src/components/views/dashboard-view.tsx', 'utf8')
  const openStart = src.indexOf('const openCustomizer')
  const openEnd = src.indexOf('}', openStart + 100)
  const openFunc = src.substring(openStart, openEnd + 1)
  assert(openFunc.includes('setUploadError(null)'), 'Upload error cleared on editor open')
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

console.log('\n  Blur / overlay / greeting:')
testCoverBlurClamp()
testCoverOverlayClamp()
testGreetingMaxLength()
testGreetingDefaultEmpty()
testCoverBlurDefault()
testCoverOverlayDefault()
testGreetingDefault()
testNonNumberBlurRejected()
testNonNumberOverlayRejected()
testAllFieldsPersist()

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

console.log('\n  Draft / save / cancel:')
testNoPageReload()
testSaveUsesApi()
testCancelDiscards()

console.log('\n  Atomic endpoint:')
testAtomicEndpoint()
testAtomicTransaction()
testAtomicRBAC()
testAtomicTenantIsolation()
testDirtyStateTracking()
testNoSeparateApiCalls()

console.log('\n  Image upload fix:')
testAwaitedFileReader()
testUploadErrorState()
testInputValueReset()
testServerResponseSource()
testApiInputValidation()
testClientMimeValidation()
testErrorClearedOnNewUpload()
testErrorClearedOnSaveSuccess()
testErrorClearedOnOpen()

console.log(`\n✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)

if (failed > 0) {
  process.exit(1)
}
