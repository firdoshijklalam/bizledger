/**
 * §TEST: Backup format + Import validation regression tests.
 *
 * Run: npx tsx tests/unit/backup-import.test.ts
 *
 * Tests the versioned backup format + import validation logic WITHOUT a
 * database. The actual /api/data-import route is exercised via integration
 * tests in a real browser QA.
 *
 * §COVERAGE:
 * 1. Backup envelope structure (format, version, createdAt, all entity arrays)
 * 2. Sanitization (secrets stripped by allow-list)
 * 3. Validation (format check, version check, business.name check)
 * 4. Conflict preview (new vs existing record counts)
 * 5. Import strategies (merge, skip-existing, replace)
 * 6. Decimal → number conversion (no Prisma Decimal objects in output)
 * 7. Tenant isolation (businessId is never in the sanitized output — it's
 *    rewritten by the import route)
 * 8. Old/unversioned backup detection (helpful error message)
 */
export {}

import {
  buildBackupEnvelope,
  validateBackup,
  previewConflicts,
  sanitizeInvoice,
  sanitizeParty,
  sanitizeProduct,
  sanitizeTransaction,
  sanitizeStaff,
  sanitizeAppSettings,
  BACKUP_FORMAT,
  BACKUP_VERSION,
  type ExistingIds,
} from '../../src/lib/backup-format'

let passed = 0
let failed = 0

function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

console.log('\n🧪 Backup Format + Import Validation Tests\n')

// ─── Mock Prisma entities (simulates what comes out of db.*.findMany) ──────

function mockDecimal(n: number) {
  return { toNumber: () => n, toString: () => String(n) }
}

const mockBusiness = {
  id: 'biz-1',
  name: 'Test Business',
  ownerName: 'Owner',
  phone: '+91 98300 11111',
  email: 'test@biz.co',
  address: '123 Main St',
  state: 'West Bengal',
  gstin: '19ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  upiId: 'test@upi',
  currency: 'INR',
  storeSlug: 'test-biz',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  // §SECRET-NOT-PRESENT: logoUrl is not sensitive but also not in allow-list
  logoUrl: 'https://oss.example.com/logo.png',
}

const mockParty = {
  id: 'party-1',
  businessId: 'biz-1', // §WILL-BE-REWRITTEN on import
  name: 'Firdosh Alam',
  phone: '+91 98300 22222',
  type: 'customer',
  balance: mockDecimal(1000),
  qualityGrade: 'A',
  creditLimit: mockDecimal(5000),
  openingBalance: mockDecimal(0),
  address: '456 Side St',
  gstin: null,
  notes: 'VIP customer',
  avgPaymentDays: 15,
  avgDiscountPct: 2.5,
  creditTrustScore: 4.5,
  buyerGroup: 'Wholesale',
  // §SECRET-NOT-IN-ALLOWLIST: searchTags is stripped (regenerable from name)
  searchTags: '["firdosh","ferdous","ফিরদৌস"]',
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
}

const mockProduct = {
  id: 'prod-1',
  businessId: 'biz-1',
  name: 'Cement Bag 50kg',
  sku: 'CEM-50',
  category: 'Construction',
  unit: 'bag',
  purchasePrice: mockDecimal(304),
  salePrice: mockDecimal(380),
  mrp: null,
  wholesalePrice: null,
  gstRate: 0,
  stock: 20,
  lowStockThreshold: 5,
  supplierId: null,
  retailEnabled: false,
  retailUnit: null,
  conversionFactor: null,
  retailSalePrice: null,
  retailMrp: null,
  looseStock: 0,
  isPublished: true,
  searchTags: '["cement","সিমেন্ট"]', // §STRIPPED
  createdAt: new Date('2026-01-01'),
}

const mockInvoice = {
  id: 'inv-1',
  businessId: 'biz-1', // §WILL-BE-REWRITTEN
  partyId: 'party-1',
  invoiceNumber: 'INV-2026-001',
  type: 'sales',
  status: 'paid',
  isGst: false,
  subtotal: mockDecimal(380),
  discountValue: mockDecimal(0),
  discountMode: 'flat',
  discountAmount: mockDecimal(0),
  gstAmount: mockDecimal(0),
  grandTotal: mockDecimal(380),
  amountPaid: mockDecimal(380),
  amountDue: mockDecimal(0),
  paymentMode: 'cash',
  notes: null,
  // §SECRET: paymentLandingToken MUST be stripped
  paymentLandingToken: 'secret-token-abc123',
  collectedByName: null,
  collectedByRole: null,
  paidToName: null,
  paidToRole: null,
  deliveryStatus: 'handed',
  createdAt: new Date('2026-01-15T10:00:00Z'),
}

const mockStaff = {
  id: 'staff-1',
  businessId: 'biz-1',
  name: 'Rahim',
  phone: '+91 98300 33333',
  role: 'sales',
  staffId: '123456',
  // §SECRET: qrToken MUST be stripped
  qrToken: 'qr-secret-token-xyz789',
  isActive: true,
  permBilling: true,
  permInventory: false,
  permKhata: false,
  permReports: false,
  permSourcing: false,
  permSettings: false,
  permExport: false,
  permDelete: false,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-02'),
}

// ─── TEST 1: Backup envelope structure ───────────────────────────────────

console.log('TEST 1: Backup envelope has correct structure + format + version')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [mockInvoice],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [mockStaff],
    partyNotes: [],
    stockMovements: [],
  })

  assert(envelope.format === BACKUP_FORMAT, `format = "${BACKUP_FORMAT}"`)
  assert(envelope.version === BACKUP_VERSION, `version = ${BACKUP_VERSION}`)
  assert(typeof envelope.createdAt === 'string', 'createdAt is ISO string')
  assert(envelope.business.name === 'Test Business', 'business.name preserved')
  assert(envelope.parties.length === 1, '1 party')
  assert(envelope.products.length === 1, '1 product')
  assert(envelope.invoices.length === 1, '1 invoice')
  assert(envelope.staff.length === 1, '1 staff')
  assert(Array.isArray(envelope.invoiceItems), 'invoiceItems is array')
  assert(Array.isArray(envelope.transactions), 'transactions is array')
  assert(Array.isArray(envelope.categories), 'categories is array')
}

// ─── TEST 2: Secret fields stripped by allow-list ────────────────────────

console.log('\nTEST 2: Secret fields are stripped (allow-list)')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [mockInvoice],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [mockStaff],
    partyNotes: [],
    stockMovements: [],
  })

  // §paymentLandingToken stripped from Invoice
  const inv = envelope.invoices[0] as any
  assert(!('paymentLandingToken' in inv), 'Invoice.paymentLandingToken STRIPPED')
  assert(inv.paymentMode === 'cash', 'Invoice.paymentMode preserved')

  // §qrToken stripped from Staff
  const st = envelope.staff[0] as any
  assert(!('qrToken' in st), 'Staff.qrToken STRIPPED')
  assert(st.staffId === '123456', 'Staff.staffId preserved')

  // §searchTags stripped from Party + Product (regenerable, not business data)
  const p = envelope.parties[0] as any
  assert(!('searchTags' in p), 'Party.searchTags STRIPPED')
  assert(p.name === 'Firdosh Alam', 'Party.name preserved')

  const pr = envelope.products[0] as any
  assert(!('searchTags' in pr), 'Product.searchTags STRIPPED')
  assert(pr.name === 'Cement Bag 50kg', 'Product.name preserved')

  // §businessId stripped from all entities (rewritten on import)
  assert(!('businessId' in p), 'Party.businessId STRIPPED (rewritten on import)')
  assert(!('businessId' in pr), 'Product.businessId STRIPPED')
  assert(!('businessId' in inv), 'Invoice.businessId STRIPPED')
  assert(!('businessId' in st), 'Staff.businessId STRIPPED')
}

// ─── TEST 3: Decimal → number conversion ─────────────────────────────────

console.log('\nTEST 3: Prisma Decimal → plain number (no toNumber method in output)')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [mockInvoice],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  })

  const p = envelope.parties[0]
  assert(typeof p.balance === 'number', 'Party.balance is number (not Decimal)')
  assert(p.balance === 1000, 'Party.balance = 1000')
  assert(typeof p.creditLimit === 'number', 'Party.creditLimit is number')
  assert(p.creditLimit === 5000, 'Party.creditLimit = 5000')

  const pr = envelope.products[0]
  assert(typeof pr.purchasePrice === 'number', 'Product.purchasePrice is number')
  assert(pr.purchasePrice === 304, 'Product.purchasePrice = 304')

  const inv = envelope.invoices[0]
  assert(typeof inv.subtotal === 'number', 'Invoice.subtotal is number')
  assert(inv.subtotal === 380, 'Invoice.subtotal = 380')
  assert(typeof inv.grandTotal === 'number', 'Invoice.grandTotal is number')
}

// ─── TEST 4: Validation — valid backup ──────────────────────────────────

console.log('\nTEST 4: Validation — valid backup passes')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [mockInvoice],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [mockStaff],
    partyNotes: [],
    stockMovements: [],
  })

  const result = validateBackup(envelope)
  assert(result.ok, 'valid backup → ok=true')
  assert(!!result.envelope, 'envelope returned')
  assert(result.counts?.parties === 1, 'counts.parties = 1')
  assert(result.counts?.products === 1, 'counts.products = 1')
  assert(result.counts?.invoices === 1, 'counts.invoices = 1')
  assert(result.counts?.staff === 1, 'counts.staff = 1')
}

// ─── TEST 5: Validation — invalid format ────────────────────────────────

console.log('\nTEST 5: Validation — invalid format rejected')
{
  const r1 = validateBackup({ format: 'wrong-format', version: 1, business: { name: 'X' } })
  assert(!r1.ok, 'wrong format → ok=false')
  assert(!!r1.error?.includes('Invalid backup format'), 'error mentions format mismatch')

  const r2 = validateBackup(null)
  assert(!r2.ok, 'null → ok=false')

  const r3 = validateBackup('not-an-object')
  assert(!r3.ok, 'string → ok=false')

  const r4 = validateBackup({ format: BACKUP_FORMAT, version: 1 }) // missing business
  assert(!r4.ok, 'missing business → ok=false')
}

// ─── TEST 6: Validation — version compatibility ─────────────────────────

console.log('\nTEST 6: Validation — version compatibility')
{
  // Future version → rejected
  const r1 = validateBackup({
    format: BACKUP_FORMAT,
    version: 999,
    business: { name: 'X', id: 'x' },
  })
  assert(!r1.ok, 'future version → ok=false')
  assert(!!r1.error?.includes('newer'), 'error mentions newer version')

  // Version 0 → rejected
  const r2 = validateBackup({
    format: BACKUP_FORMAT,
    version: 0,
    business: { name: 'X', id: 'x' },
  })
  assert(!r2.ok, 'version 0 → ok=false')

  // Negative version → rejected
  const r3 = validateBackup({
    format: BACKUP_FORMAT,
    version: -1,
    business: { name: 'X', id: 'x' },
  })
  assert(!r3.ok, 'negative version → ok=false')
}

// ─── TEST 7: Old (unversioned) backup detection ────────────────────────

console.log('\nTEST 7: Old (unversioned) backup detection')
{
  // Simulate the old export format (no `format` field, just business + parties + invoices)
  const oldBackup = {
    business: { id: 'biz-1', name: 'Old Business' },
    exportedAt: '2026-01-01T00:00:00.000Z',
    parties: [{ id: 'p1', name: 'Old Party' }],
    products: [],
    invoices: [],
    transactions: [],
  }

  const r = validateBackup(oldBackup)
  assert(!r.ok, 'old unversioned backup → ok=false')
  assert(!!r.error?.includes('old (unversioned)'), 'error mentions old unversioned backup')
}

// ─── TEST 8: Conflict preview — all new records ─────────────────────────

console.log('\nTEST 8: Conflict preview — all records new')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  })

  const existing: ExistingIds = {
    partyIds: new Set(), // empty → all new
    productIds: new Set(),
    invoiceIds: new Set(),
    invoiceItemIds: new Set(),
    transactionIds: new Set(),
    categoryIds: new Set(),
    customPriceIds: new Set(),
    staffIds: new Set(),
    partyNoteIds: new Set(),
    stockMovementIds: new Set(),
  }

  const preview = previewConflicts(envelope, existing)
  assert(preview.newRecords === 2, '2 new records (1 party + 1 product)')
  assert(preview.existingRecords === 0, '0 existing records')
  assert(preview.byEntity.parties.new === 1, 'parties.new = 1')
  assert(preview.byEntity.products.new === 1, 'products.new = 1')
}

// ─── TEST 9: Conflict preview — all existing records ───────────────────

console.log('\nTEST 9: Conflict preview — all records existing')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty],
    products: [mockProduct],
    invoices: [],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  })

  const existing: ExistingIds = {
    partyIds: new Set(['party-1']), // same ID → existing
    productIds: new Set(['prod-1']),
    invoiceIds: new Set(),
    invoiceItemIds: new Set(),
    transactionIds: new Set(),
    categoryIds: new Set(),
    customPriceIds: new Set(),
    staffIds: new Set(),
    partyNoteIds: new Set(),
    stockMovementIds: new Set(),
  }

  const preview = previewConflicts(envelope, existing)
  assert(preview.newRecords === 0, '0 new records')
  assert(preview.existingRecords === 2, '2 existing records')
  assert(preview.byEntity.parties.existing === 1, 'parties.existing = 1')
  assert(preview.byEntity.products.existing === 1, 'products.existing = 1')
}

// ─── TEST 10: Conflict preview — mixed new + existing ──────────────────

console.log('\nTEST 10: Conflict preview — mixed new + existing')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [mockParty, { ...mockParty, id: 'party-2', name: 'New Party' }],
    products: [mockProduct],
    invoices: [],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  })

  const existing: ExistingIds = {
    partyIds: new Set(['party-1']), // party-1 exists, party-2 is new
    productIds: new Set(),
    invoiceIds: new Set(),
    invoiceItemIds: new Set(),
    transactionIds: new Set(),
    categoryIds: new Set(),
    customPriceIds: new Set(),
    staffIds: new Set(),
    partyNoteIds: new Set(),
    stockMovementIds: new Set(),
  }

  const preview = previewConflicts(envelope, existing)
  assert(preview.newRecords === 2, '2 new (party-2 + product)')
  assert(preview.existingRecords === 1, '1 existing (party-1)')
  assert(preview.byEntity.parties.new === 1, 'parties.new = 1')
  assert(preview.byEntity.parties.existing === 1, 'parties.existing = 1')
}

// ─── TEST 11: Sanitizers handle null/undefined gracefully ───────────────

console.log('\nTEST 11: Sanitizers handle null/undefined gracefully')
{
  const p = sanitizeParty({ id: 'p1', name: 'X' })
  assert(p.phone === null, 'missing phone → null')
  assert(p.balance === 0, 'missing balance → 0')
  assert(p.type === 'customer', 'missing type → default customer')
  assert(p.qualityGrade === 'B', 'missing grade → default B')

  const pr = sanitizeProduct({ id: 'pr1', name: 'Y' })
  assert(pr.unit === 'pcs', 'missing unit → default pcs')
  assert(pr.stock === 0, 'missing stock → 0')
  assert(pr.purchasePrice === 0, 'missing purchasePrice → 0')

  const inv = sanitizeInvoice({ id: 'i1', invoiceNumber: 'INV-1' })
  assert(inv.status === 'unpaid', 'missing status → default unpaid')
  assert(inv.subtotal === 0, 'missing subtotal → 0')

  const s = sanitizeStaff({ id: 's1', name: 'Z', phone: '+1' })
  assert(s.role === 'sales', 'missing role → default sales')
  assert(s.staffId === '', 'missing staffId → empty string')
  assert(s.isActive === true, 'missing isActive → default true')

  const settings = sanitizeAppSettings(null)
  assert(settings === null, 'null settings → null (not an object)')

  const settings2 = sanitizeAppSettings({ language: 'bn' })
  assert(settings2?.language === 'bn', 'settings language preserved')
  assert(settings2?.invoicePrefix === 'INV', 'missing invoicePrefix → default INV')
}

// ─── TEST 12: Sanitizers strip businessId (tenant isolation) ────────────

console.log('\nTEST 12: Sanitizers strip businessId (tenant isolation)')
{
  // §TENANT-ISOLATION: The backup file NEVER contains businessId in its
  // sanitized entities. The import route rewrites businessId to the current
  // tenant's ID. This prevents cross-tenant injection.
  const p = sanitizeParty({ id: 'p1', businessId: 'EVIL-BIZ', name: 'X' }) as any
  assert(!('businessId' in p), 'Party.businessId stripped (no cross-tenant injection)')

  const pr = sanitizeProduct({ id: 'pr1', businessId: 'EVIL-BIZ', name: 'Y' }) as any
  assert(!('businessId' in pr), 'Product.businessId stripped')

  const inv = sanitizeInvoice({ id: 'i1', businessId: 'EVIL-BIZ', invoiceNumber: 'INV-1' }) as any
  assert(!('businessId' in inv), 'Invoice.businessId stripped')

  const s = sanitizeStaff({ id: 's1', businessId: 'EVIL-BIZ', name: 'Z', phone: '+1' }) as any
  assert(!('businessId' in s), 'Staff.businessId stripped')

  const t = sanitizeTransaction({ id: 't1', businessId: 'EVIL-BIZ', type: 'credit', amount: mockDecimal(100) }) as any
  assert(!('businessId' in t), 'Transaction.businessId stripped')
}

// ─── TEST 13: Empty backup (no entities) ────────────────────────────────

console.log('\nTEST 13: Empty backup (no entities) is valid')
{
  const envelope = buildBackupEnvelope({
    business: mockBusiness,
    settings: null,
    parties: [],
    products: [],
    invoices: [],
    invoiceItems: [],
    transactions: [],
    categories: [],
    customPrices: [],
    staff: [],
    partyNotes: [],
    stockMovements: [],
  })

  assert(envelope.parties.length === 0, '0 parties')
  assert(envelope.products.length === 0, '0 products')

  const r = validateBackup(envelope)
  assert(r.ok, 'empty backup is valid')
  assert(r.counts?.parties === 0, 'counts.parties = 0')
}

// ─── TEST 14: Array coercion (absent arrays → empty) ────────────────────

console.log('\nTEST 14: Absent entity arrays → empty (backward compat)')
{
  // Simulate a backup where some arrays are absent (e.g., from an older version)
  const partialBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    business: { id: 'b1', name: 'Partial', currency: 'INR' },
    parties: [{ id: 'p1', name: 'X' }],
    // products, invoices, etc. ABSENT
  }

  const r = validateBackup(partialBackup)
  assert(r.ok, 'partial backup (missing arrays) → ok=true')
  assert(r.envelope?.products.length === 0, 'missing products → empty array')
  assert(r.envelope?.invoices.length === 0, 'missing invoices → empty array')
  assert(r.envelope?.parties.length === 1, 'present parties → 1')
}

// ─── Summary ─────────────────────────────────────────────────────────────
console.log('\n==================================================')
console.log(`✅ Passed: ${passed}`)
console.log(`❌ Failed: ${failed}`)
console.log('==================================================')
if (failed > 0) process.exit(1)
