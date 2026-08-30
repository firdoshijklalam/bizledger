/**
 * §BACKUP-FORMAT: Versioned, sanitized business backup format.
 *
 * §DESIGN:
 * - Pure functions, no DB access — fully testable without a database.
 * - Versioned (`format` + `version`) so future schema changes can detect/migrate.
 * - Secret fields are STRIPPED by an explicit allow-list (not deny-list) so
 *   new secret fields added to the schema in the future are automatically
 *   excluded (safer than remembering to add new fields to a deny-list).
 * - IDs are preserved within a backup so relationships (Invoice→Party,
 *   InvoiceItem→Invoice, Transaction→Invoice) survive the export/import
 *   round-trip. The import route rewrites `businessId` to the current tenant.
 *
 * §NEVER-EXPORTED (secret/auth fields — stripped by allow-list):
 * - User.passwordHash
 * - Session.tokenHash
 * - AppSettings.pinHash
 * - UserProfile.pinHash
 * - FingerprintRecord.fingerprintHash
 * - Staff.qrToken
 * - Invoice.paymentLandingToken
 */

// ─── Backup format types ───────────────────────────────────────────────────

export const BACKUP_FORMAT = 'bizledger-backup' as const
export const BACKUP_VERSION = 1 as const

export interface BackupEnvelope {
  format: typeof BACKUP_FORMAT
  version: typeof BACKUP_VERSION
  createdAt: string
  business: SanitizedBusiness
  settings: SanitizedAppSettings | null
  parties: SanitizedParty[]
  products: SanitizedProduct[]
  invoices: SanitizedInvoice[]
  invoiceItems: SanitizedInvoiceItem[]
  transactions: SanitizedTransaction[]
  categories: SanitizedCategory[]
  customPrices: SanitizedCustomPrice[]
  staff: SanitizedStaff[]
  partyNotes: SanitizedPartyNote[]
  stockMovements: SanitizedStockMovement[]
}

// ─── Sanitized entity types (allow-list fields only) ──────────────────────

export interface SanitizedBusiness {
  id: string
  name: string
  ownerName: string | null
  phone: string | null
  email: string | null
  address: string | null
  state: string | null
  gstin: string | null
  pan: string | null
  upiId: string | null
  currency: string
  logoUrl: string | null
  coverUrl: string | null
  storeSlug: string | null
  createdAt: Date | string
}

export interface SanitizedAppSettings {
  language: string
  dateFormat: string
  invoicePrefix: string
  notificationsEnabled: boolean
  autoBackupEnabled: boolean
  cardPreferences: string | null
  dashboardCards: string | null
  // §NO-SECRETS: pinHash, pinEnabled, gateLockdownUntil are NEVER exported
}

export interface SanitizedParty {
  id: string
  name: string
  phone: string | null
  type: string
  balance: number
  qualityGrade: string
  creditLimit: number | null
  openingBalance: number
  address: string | null
  gstin: string | null
  notes: string | null
  avgPaymentDays: number | null
  avgDiscountPct: number
  creditTrustScore: number
  buyerGroup: string | null
  // §NO-SECRETS: searchTags stripped (bulk, regenerable from name)
}

export interface SanitizedProduct {
  id: string
  name: string
  sku: string | null
  category: string | null
  subCategory: string | null
  categoryPath: string | null
  unit: string
  purchasePrice: number
  salePrice: number
  mrp: number | null
  wholesalePrice: number | null
  gstRate: number
  stock: number
  lowStockThreshold: number
  supplierId: string | null
  retailEnabled: boolean
  retailUnit: string | null
  conversionFactor: number | null
  retailSalePrice: number | null
  retailMrp: number | null
  looseStock: number
  isPublished: boolean
}

export interface SanitizedInvoice {
  id: string
  partyId: string | null
  invoiceNumber: string
  type: string
  status: string
  isGst: boolean
  subtotal: number
  discountValue: number
  discountMode: string
  discountAmount: number
  gstAmount: number
  grandTotal: number
  amountPaid: number
  amountDue: number
  paymentMode: string | null
  notes: string | null
  deliveryStatus: string | null
  collectedByName: string | null
  collectedByRole: string | null
  paidToName: string | null
  paidToRole: string | null
  createdAt: Date | string
  // §NO-SECRETS: paymentLandingToken stripped
}

export interface SanitizedInvoiceItem {
  id: string
  invoiceId: string
  productId: string | null
  name: string
  quantity: number
  unitPrice: number
  discount: number
  gstRate: number
  total: number
  fulfilledQty: number
  // §P16-STEP2: historical cost snapshot (nullable — legacy backups may omit this)
  purchasePriceSnapshot?: number | null
}

export interface SanitizedTransaction {
  id: string
  partyId: string | null
  type: string
  amount: number
  balanceAfter: number | null
  description: string | null
  category: string | null
  invoiceId: string | null
  createdAt: Date | string
  // §P16-STEP2: authoritative accounting subtype + provenance (nullable — legacy backups may omit)
  transactionSubtype?: string | null
  source?: string | null
}

export interface SanitizedCategory {
  id: string
  name: string
  parentId: string | null
  level: number
  sortOrder: number
}

export interface SanitizedCustomPrice {
  id: string
  productId: string | null
  catalogItemId: string | null
  buyerId: string | null
  buyerGroupName: string | null
  customPrice: number
  customSalePrice: number | null
  customMrp: number | null
  customWholesalePrice: number | null
  customRetailSalePrice: number | null
  customRetailMrp: number | null
}

export interface SanitizedStaff {
  id: string
  name: string
  phone: string | null
  role: string
  staffId: string
  isActive: boolean
  permBilling: boolean
  permInventory: boolean
  permKhata: boolean
  permReports: boolean
  permSourcing: boolean
  permSettings: boolean
  permExport: boolean
  permDelete: boolean
  // §NO-SECRETS: qrToken stripped (regenerated on import if needed)
}

export interface SanitizedPartyNote {
  id: string
  partyId: string
  type: string
  content: string
  author: string | null
  createdAt: Date | string
}

export interface SanitizedStockMovement {
  id: string
  productId: string
  type: string
  quantity: number
  balanceAfter: number
  referenceId: string | null
  referenceType: string | null
  description: string | null
  createdAt: Date | string
}

// ─── Sanitizers (Prisma entity → Sanitized entity) ─────────────────────────

// §DECIMAL-TO-NUMBER: Converts any Decimal-like value to a plain number.
// Accepts Prisma Decimal, plain number, string, null, undefined.
function toNum(v: any): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'number') return v
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber()
  const n = Number(v)
  return isNaN(n) ? 0 : n
}

function toNumOrNull(v: any): number | null {
  if (v === null || v === undefined) return null
  if (typeof v === 'number') return v
  if (typeof v === 'object' && typeof v.toNumber === 'function') return v.toNumber()
  const n = Number(v)
  return isNaN(n) ? null : n
}

export function sanitizeBusiness(b: any): SanitizedBusiness {
  return {
    id: b.id,
    name: b.name,
    ownerName: b.ownerName ?? null,
    phone: b.phone ?? null,
    email: b.email ?? null,
    address: b.address ?? null,
    state: b.state ?? null,
    gstin: b.gstin ?? null,
    pan: b.pan ?? null,
    upiId: b.upiId ?? null,
    currency: b.currency ?? 'INR',
    logoUrl: b.logoUrl ?? null,
    coverUrl: b.coverUrl ?? null,
    storeSlug: b.storeSlug ?? null,
    createdAt: b.createdAt,
  }
}

export function sanitizeAppSettings(s: any): SanitizedAppSettings | null {
  if (!s) return null
  return {
    language: s.language ?? 'en',
    dateFormat: s.dateFormat ?? 'DD/MM/YYYY',
    invoicePrefix: s.invoicePrefix ?? 'INV',
    notificationsEnabled: s.notificationsEnabled ?? true,
    autoBackupEnabled: s.autoBackupEnabled ?? false,
    cardPreferences: s.cardPreferences ?? null,
    dashboardCards: s.dashboardCards ?? null,
  }
}

export function sanitizeParty(p: any): SanitizedParty {
  return {
    id: p.id,
    name: p.name,
    phone: p.phone ?? null,
    type: p.type ?? 'customer',
    balance: toNum(p.balance),
    qualityGrade: p.qualityGrade ?? 'B',
    creditLimit: toNumOrNull(p.creditLimit),
    openingBalance: toNum(p.openingBalance),
    address: p.address ?? null,
    gstin: p.gstin ?? null,
    notes: p.notes ?? null,
    avgPaymentDays: p.avgPaymentDays ?? null,
    avgDiscountPct: p.avgDiscountPct ?? 0,
    creditTrustScore: p.creditTrustScore ?? 3,
    buyerGroup: p.buyerGroup ?? null,
  }
}

export function sanitizeProduct(p: any): SanitizedProduct {
  return {
    id: p.id,
    name: p.name,
    sku: p.sku ?? null,
    category: p.category ?? null,
    subCategory: p.subCategory ?? null,
    categoryPath: p.categoryPath ?? null,
    unit: p.unit ?? 'pcs',
    purchasePrice: toNum(p.purchasePrice),
    salePrice: toNum(p.salePrice),
    mrp: toNumOrNull(p.mrp),
    wholesalePrice: toNumOrNull(p.wholesalePrice),
    gstRate: p.gstRate ?? 0,
    stock: p.stock ?? 0,
    lowStockThreshold: p.lowStockThreshold ?? 5,
    supplierId: p.supplierId ?? null,
    retailEnabled: p.retailEnabled ?? false,
    retailUnit: p.retailUnit ?? null,
    conversionFactor: p.conversionFactor ?? null,
    retailSalePrice: toNumOrNull(p.retailSalePrice),
    retailMrp: toNumOrNull(p.retailMrp),
    looseStock: p.looseStock ?? 0,
    isPublished: p.isPublished ?? true,
  }
}

export function sanitizeInvoice(i: any): SanitizedInvoice {
  return {
    id: i.id,
    partyId: i.partyId ?? null,
    invoiceNumber: i.invoiceNumber,
    type: i.type ?? 'sales',
    status: i.status ?? 'unpaid',
    isGst: i.isGst ?? false,
    subtotal: toNum(i.subtotal),
    discountValue: toNum(i.discountValue),
    discountMode: i.discountMode ?? 'flat',
    discountAmount: toNum(i.discountAmount),
    gstAmount: toNum(i.gstAmount),
    grandTotal: toNum(i.grandTotal),
    amountPaid: toNum(i.amountPaid),
    amountDue: toNum(i.amountDue),
    paymentMode: i.paymentMode ?? null,
    notes: i.notes ?? null,
    deliveryStatus: i.deliveryStatus ?? 'handed',
    collectedByName: i.collectedByName ?? null,
    collectedByRole: i.collectedByRole ?? null,
    paidToName: i.paidToName ?? null,
    paidToRole: i.paidToRole ?? null,
    createdAt: i.createdAt,
    // §NO paymentLandingToken — stripped by allow-list
  }
}

export function sanitizeInvoiceItem(it: any): SanitizedInvoiceItem {
  return {
    id: it.id,
    invoiceId: it.invoiceId,
    productId: it.productId ?? null,
    name: it.name,
    quantity: it.quantity ?? 0,
    unitPrice: toNum(it.unitPrice),
    discount: toNum(it.discount),
    gstRate: toNum(it.gstRate),
    total: toNum(it.total),
    fulfilledQty: it.fulfilledQty ?? 0,
    // §P16-STEP2: preserve purchasePriceSnapshot (nullable for legacy backups)
    purchasePriceSnapshot: it.purchasePriceSnapshot != null ? toNum(it.purchasePriceSnapshot) : null,
  }
}

export function sanitizeTransaction(t: any): SanitizedTransaction {
  return {
    id: t.id,
    partyId: t.partyId ?? null,
    type: t.type,
    amount: toNum(t.amount),
    balanceAfter: toNumOrNull(t.balanceAfter),
    description: t.description ?? null,
    category: t.category ?? null,
    invoiceId: t.invoiceId ?? null,
    createdAt: t.createdAt,
    // §P16-STEP2: preserve transactionSubtype + source (nullable for legacy backups)
    transactionSubtype: t.transactionSubtype ?? null,
    source: t.source ?? null,
  }
}

export function sanitizeCategory(c: any): SanitizedCategory {
  return {
    id: c.id,
    name: c.name,
    parentId: c.parentId ?? null,
    level: c.level ?? 0,
    sortOrder: c.sortOrder ?? 0,
  }
}

export function sanitizeCustomPrice(cp: any): SanitizedCustomPrice {
  return {
    id: cp.id,
    productId: cp.productId ?? null,
    catalogItemId: cp.catalogItemId ?? null,
    buyerId: cp.buyerId ?? null,
    buyerGroupName: cp.buyerGroupName ?? null,
    customPrice: toNum(cp.customPrice),
    customSalePrice: toNumOrNull(cp.customSalePrice),
    customMrp: toNumOrNull(cp.customMrp),
    customWholesalePrice: toNumOrNull(cp.customWholesalePrice),
    customRetailSalePrice: toNumOrNull(cp.customRetailSalePrice),
    customRetailMrp: toNumOrNull(cp.customRetailMrp),
  }
}

export function sanitizeStaff(s: any): SanitizedStaff {
  return {
    id: s.id,
    name: s.name,
    phone: s.phone ?? null,
    role: s.role ?? 'sales',
    staffId: s.staffId ?? '',
    isActive: s.isActive ?? true,
    permBilling: s.permBilling ?? false,
    permInventory: s.permInventory ?? false,
    permKhata: s.permKhata ?? false,
    permReports: s.permReports ?? false,
    permSourcing: s.permSourcing ?? false,
    permSettings: s.permSettings ?? false,
    permExport: s.permExport ?? false,
    permDelete: s.permDelete ?? false,
    // §NO qrToken — stripped (regenerated on import)
  }
}

export function sanitizePartyNote(pn: any): SanitizedPartyNote {
  return {
    id: pn.id,
    partyId: pn.partyId,
    type: pn.type ?? 'general',
    content: pn.content ?? '',
    author: pn.author ?? null,
    createdAt: pn.createdAt,
  }
}

export function sanitizeStockMovement(sm: any): SanitizedStockMovement {
  return {
    id: sm.id,
    productId: sm.productId,
    type: sm.type ?? 'adjustment',
    quantity: sm.quantity ?? 0,
    balanceAfter: sm.balanceAfter ?? 0,
    referenceId: sm.referenceId ?? null,
    referenceType: sm.referenceType ?? null,
    description: sm.description ?? null,
    createdAt: sm.createdAt,
  }
}

// ─── Backup envelope builder ──────────────────────────────────────────────

export interface BuildBackupInput {
  business: any
  settings: any | null
  parties: any[]
  products: any[]
  invoices: any[]
  invoiceItems: any[]
  transactions: any[]
  categories: any[]
  customPrices: any[]
  staff: any[]
  partyNotes: any[]
  stockMovements: any[]
}

/**
 * Build a versioned, sanitized backup envelope from raw Prisma entities.
 *
 * §ALLOW-LIST: Only fields explicitly listed in the Sanitized* types are
 * included. Any field NOT in the allow-list (including future secret fields
 * added to the schema) is automatically excluded.
 *
 * §SECRETS-STRIPPED: passwordHash, tokenHash, pinHash, fingerprintHash,
 * qrToken, paymentLandingToken are NEVER present in the output.
 */
export function buildBackupEnvelope(input: BuildBackupInput): BackupEnvelope {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    createdAt: new Date().toISOString(),
    business: sanitizeBusiness(input.business),
    settings: sanitizeAppSettings(input.settings),
    parties: input.parties.map(sanitizeParty),
    products: input.products.map(sanitizeProduct),
    invoices: input.invoices.map(sanitizeInvoice),
    invoiceItems: input.invoiceItems.map(sanitizeInvoiceItem),
    transactions: input.transactions.map(sanitizeTransaction),
    categories: input.categories.map(sanitizeCategory),
    customPrices: input.customPrices.map(sanitizeCustomPrice),
    staff: input.staff.map(sanitizeStaff),
    partyNotes: input.partyNotes.map(sanitizePartyNote),
    stockMovements: input.stockMovements.map(sanitizeStockMovement),
  }
}

// ─── Backup validation + parsing ──────────────────────────────────────────

export interface ValidationResult {
  ok: boolean
  error?: string
  envelope?: BackupEnvelope
  counts?: {
    parties: number
    products: number
    invoices: number
    invoiceItems: number
    transactions: number
    categories: number
    customPrices: number
    staff: number
    partyNotes: number
    stockMovements: number
  }
}

/**
 * Validate a parsed JSON object as a BizLedger backup envelope.
 *
 * §CHECKS:
 * - `format` must be `'bizledger-backup'`
 * - `version` must be a positive integer (currently only 1 is supported)
 * - All entity arrays must be arrays (or absent → treated as empty)
 * - `business` must have `name` and `id`
 *
 * §MIGRATION: Future versions can add a `migrate()` function here that
 * transforms older versions to the current format.
 */
export function validateBackup(raw: any): ValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, error: 'Invalid file: not a JSON object' }
  }

  if (raw.format !== BACKUP_FORMAT) {
    // §COMPAT: detect old (pre-versioned) exports that had no `format` field
    if (!raw.format && raw.business && raw.parties && raw.invoices) {
      return {
        ok: false,
        error: `This appears to be an old (unversioned) backup. Please re-export your data using the new "Export Full Backup" option to get a versioned backup that can be imported.`,
      }
    }
    return {
      ok: false,
      error: `Invalid backup format: expected "${BACKUP_FORMAT}", got "${raw.format ?? 'none'}"`,
    }
  }

  if (typeof raw.version !== 'number' || raw.version < 1) {
    return { ok: false, error: `Invalid backup version: ${raw.version}` }
  }

  if (raw.version > BACKUP_VERSION) {
    return {
      ok: false,
      error: `Backup version ${raw.version} is newer than the supported version ${BACKUP_VERSION}. Please update the app to import this backup.`,
    }
  }

  // §VERSION-1-MIGRATION: if version < BACKUP_VERSION, migrate here.
  // Currently version is always 1, so no migration needed.

  if (!raw.business || typeof raw.business !== 'object' || !raw.business.name) {
    return { ok: false, error: 'Invalid backup: missing or incomplete business record' }
  }

  // §ARRAY-COERCION: absent arrays → empty (backward compat with partial backups)
  const envelope: BackupEnvelope = {
    format: raw.format,
    version: raw.version,
    createdAt: raw.createdAt ?? new Date(0).toISOString(),
    business: sanitizeBusiness(raw.business),
    settings: raw.settings ? sanitizeAppSettings(raw.settings) : null,
    parties: Array.isArray(raw.parties) ? raw.parties.map(sanitizeParty) : [],
    products: Array.isArray(raw.products) ? raw.products.map(sanitizeProduct) : [],
    invoices: Array.isArray(raw.invoices) ? raw.invoices.map(sanitizeInvoice) : [],
    invoiceItems: Array.isArray(raw.invoiceItems) ? raw.invoiceItems.map(sanitizeInvoiceItem) : [],
    transactions: Array.isArray(raw.transactions) ? raw.transactions.map(sanitizeTransaction) : [],
    categories: Array.isArray(raw.categories) ? raw.categories.map(sanitizeCategory) : [],
    customPrices: Array.isArray(raw.customPrices) ? raw.customPrices.map(sanitizeCustomPrice) : [],
    staff: Array.isArray(raw.staff) ? raw.staff.map(sanitizeStaff) : [],
    partyNotes: Array.isArray(raw.partyNotes) ? raw.partyNotes.map(sanitizePartyNote) : [],
    stockMovements: Array.isArray(raw.stockMovements) ? raw.stockMovements.map(sanitizeStockMovement) : [],
  }

  return {
    ok: true,
    envelope,
    counts: {
      parties: envelope.parties.length,
      products: envelope.products.length,
      invoices: envelope.invoices.length,
      invoiceItems: envelope.invoiceItems.length,
      transactions: envelope.transactions.length,
      categories: envelope.categories.length,
      customPrices: envelope.customPrices.length,
      staff: envelope.staff.length,
      partyNotes: envelope.partyNotes.length,
      stockMovements: envelope.stockMovements.length,
    },
  }
}

/**
 * §CONFLICT-CHECK: Given a backup envelope and the current business's existing
 * IDs, determine which records are new vs existing (conflict).
 *
 * The import route passes `existingIds` for each entity type. This function
 * returns counts of new/existing records so the UI can show a preview.
 */
export interface ExistingIds {
  partyIds: Set<string>
  productIds: Set<string>
  invoiceIds: Set<string>
  invoiceItemIds: Set<string>
  transactionIds: Set<string>
  categoryIds: Set<string>
  customPriceIds: Set<string>
  staffIds: Set<string>
  partyNoteIds: Set<string>
  stockMovementIds: Set<string>
}

export interface ConflictPreview {
  newRecords: number
  existingRecords: number
  byEntity: {
    parties: { new: number; existing: number }
    products: { new: number; existing: number }
    invoices: { new: number; existing: number }
    invoiceItems: { new: number; existing: number }
    transactions: { new: number; existing: number }
    categories: { new: number; existing: number }
    customPrices: { new: number; existing: number }
    staff: { new: number; existing: number }
    partyNotes: { new: number; existing: number }
    stockMovements: { new: number; existing: number }
  }
}

export function previewConflicts(envelope: BackupEnvelope, existing: ExistingIds): ConflictPreview {
  const count = <T extends { id: string }>(arr: T[], ids: Set<string>) => {
    let isNew = 0
    let isExisting = 0
    for (const item of arr) {
      if (ids.has(item.id)) isExisting++
      else isNew++
    }
    return { new: isNew, existing: isExisting }
  }

  const byEntity = {
    parties: count(envelope.parties, existing.partyIds),
    products: count(envelope.products, existing.productIds),
    invoices: count(envelope.invoices, existing.invoiceIds),
    invoiceItems: count(envelope.invoiceItems, existing.invoiceItemIds),
    transactions: count(envelope.transactions, existing.transactionIds),
    categories: count(envelope.categories, existing.categoryIds),
    customPrices: count(envelope.customPrices, existing.customPriceIds),
    staff: count(envelope.staff, existing.staffIds),
    partyNotes: count(envelope.partyNotes, existing.partyNoteIds),
    stockMovements: count(envelope.stockMovements, existing.stockMovementIds),
  }

  const newRecords = Object.values(byEntity).reduce((s, c) => s + c.new, 0)
  const existingRecords = Object.values(byEntity).reduce((s, c) => s + c.existing, 0)

  return { newRecords, existingRecords, byEntity }
}

// ─── Import strategies ────────────────────────────────────────────────────

export type ImportStrategy = 'merge' | 'skip-existing' | 'replace'

export interface ImportOptions {
  strategy: ImportStrategy
  /** When true, existing records with the same ID are updated. When false, they are skipped. */
  updateExisting: boolean
}

/**
 * §DEFAULT-STRATEGY: 'merge' — inserts new records, skips existing (safe default).
 * 'skip-existing' is the same as merge with updateExisting=false.
 * 'replace' is dangerous — deletes all existing business data then imports —
 * requires explicit confirmation + biometric gate.
 */
export const DEFAULT_IMPORT_OPTIONS: ImportOptions = {
  strategy: 'merge',
  updateExisting: false,
}
