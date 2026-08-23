import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'
import { requireRole } from '@/lib/auth/session'
import {
  validateBackup,
  previewConflicts,
  type BackupEnvelope,
  type ExistingIds,
  type ImportOptions,
  DEFAULT_IMPORT_OPTIONS,
} from '@/lib/backup-format'

// §VERCEL-LIMIT: Import may take longer than 10s for large backups.
export const maxDuration = 60

// §MAX-BODY-SIZE: 50MB — large enough for businesses with thousands of
// invoices, but prevents abuse via oversized files.
const MAX_BODY_SIZE = 50 * 1024 * 1024

// POST /api/data-import
//
// §BODY: JSON with one of:
//   { step: 'validate', data: <parsed-backup-json> }   → returns validation result
//   { step: 'preview', data: <parsed-backup-json> }    → returns conflict preview
//   { step: 'import', data: <parsed-backup-json>, options: ImportOptions }  → performs import
//
// §SECURITY:
// - Requires OWNER role (stricter than export — only owners can import data).
// - §TENANT-ISOLATION: ALL imported records are rewritten with the current
//   business's id. The `businessId` field in the backup file is NEVER trusted.
// - §SECRETS-STRIPPED: The sanitizers in validateBackup() strip passwordHash,
//   tokenHash, pinHash, fingerprintHash, qrToken, paymentLandingToken from
//   the imported data via an allow-list. Even if the backup file contains
//   these fields, they are discarded.
// - §ATOMIC: The 'import' step runs inside a Prisma $transaction. If any
//   record fails to insert, the entire import is rolled back — no half-imported
//   state.
// - §ID-PRESERVATION: Internal IDs (partyId, invoiceId, productId) are
//   preserved from the backup so relationships survive the round-trip.
//   This is safe because all IDs are cuid() (globally unique).
//
// §VALIDATION: The 'validate' step checks:
//   - format === 'bizledger-backup'
//   - version is supported
//   - business.name exists
//   - all entity arrays are arrays (or absent → empty)
//
// §PREVIEW: The 'preview' step returns counts of new vs existing records
// so the UI can show "New: X, Existing: Y" before the user confirms.
//
// §IMPORT-STRATEGIES:
//   - 'merge' (default): insert new records, skip existing (updateExisting=false)
//   - 'skip-existing': same as merge
//   - 'replace': DESTRUCTIVE — deletes all existing business data then imports.
//     Requires explicit confirmation in the UI + biometric gate.
export async function POST(req: NextRequest) {
  // §AUTH: Require OWNER role (stricter than export — only owners can import)
  const user = await requireRole(['OWNER'])
  if (user instanceof NextResponse) return user

  const business = await db.business.findUnique({ where: { id: user.businessId } })
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  // §SIZE-CHECK: Reject oversized payloads early (before parsing)
  const contentLength = parseInt(req.headers.get('content-length') || '0', 10)
  if (contentLength > MAX_BODY_SIZE) {
    return NextResponse.json(
      { error: `Backup file too large (${contentLength} bytes). Maximum is ${MAX_BODY_SIZE / 1024 / 1024}MB.` },
      { status: 413 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
  }

  const { step, data, options } = body as { step: string; data: any; options?: ImportOptions }

  if (!step || !['validate', 'preview', 'import'].includes(step)) {
    return NextResponse.json({ error: "Missing or invalid 'step' (must be 'validate', 'preview', or 'import')" }, { status: 400 })
  }

  if (!data) {
    return NextResponse.json({ error: "Missing 'data' field (the backup JSON)" }, { status: 400 })
  }

  // ─── STEP 1: VALIDATE ──────────────────────────────────────────────────
  const validation = validateBackup(data)
  if (!validation.ok || !validation.envelope) {
    return NextResponse.json({ ok: false, error: validation.error }, { status: 400 })
  }

  if (step === 'validate') {
    return NextResponse.json({
      ok: true,
      counts: validation.counts,
      business: { name: validation.envelope.business.name, id: validation.envelope.business.id },
      createdAt: validation.envelope.createdAt,
      version: validation.envelope.version,
    })
  }

  // ─── STEP 2: PREVIEW (conflict detection) ──────────────────────────────
  const existingIds = await gatherExistingIds(business.id)

  if (step === 'preview') {
    const conflictPreview = previewConflicts(validation.envelope, existingIds)
    return NextResponse.json({
      ok: true,
      counts: validation.counts,
      conflicts: conflictPreview,
      business: { name: validation.envelope.business.name, id: validation.envelope.business.id },
    })
  }

  // ─── STEP 3: IMPORT (atomic transaction) ────────────────────────────────
  const opts: ImportOptions = {
    strategy: options?.strategy ?? DEFAULT_IMPORT_OPTIONS.strategy,
    updateExisting: options?.updateExisting ?? DEFAULT_IMPORT_OPTIONS.updateExisting,
  }

  try {
    const result = await performImport(validation.envelope, business.id, existingIds, opts)

    // §AUDIT-LOG: Log the import (critical security event)
    await logAudit({
      businessId: business.id,
      action: AUDIT_ACTIONS.DATA_EXPORT, // reuse EXPORT action type (import is the inverse)
      entityType: ENTITY_TYPES.EXPORT,
      description: `Data import: ${result.imported.parties} parties, ${result.imported.products} products, ${result.imported.invoices} invoices, ${result.imported.transactions} transactions`,
      metadata: JSON.stringify({
        action: 'IMPORT',
        strategy: opts.strategy,
        imported: result.imported,
        skipped: result.skipped,
        failed: result.failed,
      }),
    })

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    // §ROLLBACK: If the $transaction throws, Prisma rolls back automatically.
    // We catch here to return a friendly error instead of a 500.
    return NextResponse.json(
      { ok: false, error: `Import failed and was rolled back: ${e.message}` },
      { status: 500 }
    )
  }
}

// ─── Helper: gather all existing IDs for the current business ─────────────

async function gatherExistingIds(businessId: string): Promise<ExistingIds> {
  const [
    parties, products, invoices, invoiceItems, transactions,
    categories, customPrices, staff, partyNotes, stockMovements,
  ] = await Promise.all([
    db.party.findMany({ where: { businessId }, select: { id: true } }),
    db.product.findMany({ where: { businessId }, select: { id: true } }),
    db.invoice.findMany({ where: { businessId }, select: { id: true } }),
    db.invoiceItem.findMany({ where: { invoice: { businessId } }, select: { id: true } }),
    db.transaction.findMany({ where: { businessId }, select: { id: true } }),
    db.category.findMany({ where: { businessId }, select: { id: true } }),
    db.customPrice.findMany({ where: { businessId }, select: { id: true } }),
    db.staff.findMany({ where: { businessId }, select: { id: true } }),
    db.partyNote.findMany({ where: { party: { businessId } }, select: { id: true } }),
    db.stockMovement.findMany({ where: { businessId }, select: { id: true } }),
  ])

  const toSet = (arr: Array<{ id: string }>) => new Set(arr.map((x) => x.id))

  return {
    partyIds: toSet(parties),
    productIds: toSet(products),
    invoiceIds: toSet(invoices),
    invoiceItemIds: toSet(invoiceItems),
    transactionIds: toSet(transactions),
    categoryIds: toSet(categories),
    customPriceIds: toSet(customPrices),
    staffIds: toSet(staff),
    partyNoteIds: toSet(partyNotes),
    stockMovementIds: toSet(stockMovements),
  }
}

// ─── Helper: perform the atomic import ────────────────────────────────────

interface ImportResult {
  imported: {
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
  skipped: {
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
  failed: { errors: string[] }
}

/**
 * §ATOMIC-IMPORT: Runs inside a Prisma $transaction. If any record fails to
 * insert, the entire transaction is rolled back — no half-imported state.
 *
 * §TENANT-ISOLATION: Every record is rewritten with `businessId = currentBusinessId`.
 * The `businessId` from the backup file is NEVER trusted.
 *
 * §ID-PRESERVATION: Internal IDs (partyId, invoiceId, productId) are preserved
 * from the backup so relationships survive. This is safe because cuid() IDs
 * are globally unique — collision across businesses is astronomically unlikely.
 *
 * §ORDER: Records are inserted in dependency order:
 *   1. Categories (no deps)
 *   2. Parties (no deps)
 *   3. Products (may reference Party via supplierId)
 *   4. Staff (no deps)
 *   5. PartyNotes (depends on Party)
 *   6. Invoices (depends on Party)
 *   7. InvoiceItems (depends on Invoice + Product)
 *   8. Transactions (depends on Party + Invoice)
 *   9. StockMovements (depends on Product)
 *   10. CustomPrices (depends on Product + Party)
 */
async function performImport(
  envelope: BackupEnvelope,
  businessId: string,
  existing: ExistingIds,
  opts: ImportOptions
): Promise<ImportResult> {
  const result: ImportResult = {
    imported: { parties: 0, products: 0, invoices: 0, invoiceItems: 0, transactions: 0, categories: 0, customPrices: 0, staff: 0, partyNotes: 0, stockMovements: 0 },
    skipped: { parties: 0, products: 0, invoices: 0, invoiceItems: 0, transactions: 0, categories: 0, customPrices: 0, staff: 0, partyNotes: 0, stockMovements: 0 },
    failed: { errors: [] },
  }

  await db.$transaction(async (tx) => {
    // §REPLACE-STRATEGY: If strategy='replace', delete all existing business
    // data first (except the Business + User + AppSettings records themselves).
    if (opts.strategy === 'replace') {
      await Promise.all([
        tx.stockMovement.deleteMany({ where: { businessId } }),
        tx.partyNote.deleteMany({ where: { party: { businessId } } }),
        tx.customPrice.deleteMany({ where: { businessId } }),
        tx.transaction.deleteMany({ where: { businessId } }),
        tx.invoiceItem.deleteMany({ where: { invoice: { businessId } } }),
        tx.invoice.deleteMany({ where: { businessId } }),
        tx.staff.deleteMany({ where: { businessId } }),
        tx.product.deleteMany({ where: { businessId } }),
        tx.category.deleteMany({ where: { businessId } }),
        tx.party.deleteMany({ where: { businessId } }),
      ])
      // Clear existing IDs so all imported records are treated as new
      existing.partyIds.clear()
      existing.productIds.clear()
      existing.invoiceIds.clear()
      existing.invoiceItemIds.clear()
      existing.transactionIds.clear()
      existing.categoryIds.clear()
      existing.customPriceIds.clear()
      existing.staffIds.clear()
      existing.partyNoteIds.clear()
      existing.stockMovementIds.clear()
    }

    // §ID-MAPPING: When importing into a different business, the backup's IDs
    // may already exist globally (in Business A). We generate new IDs and
    // maintain a mapping so relationships (partyId, invoiceId, productId) are
    // preserved. For 'merge' strategy with existing records in the SAME business,
    // the original IDs are preserved (upsert).
    //
    // §REPEAT-IMPORT: When the SAME backup is imported twice (e.g., re-running
    // a merge), the _imp suffixed IDs from the first import already exist.
    // We must check BOTH the original ID AND the _imp variant against existing
    // records. If either exists, we skip (merge) or update (updateExisting).
    const idMap = new Map<string, string>() // oldId → newId

    // Helper: check if an ID (or its _imp variant) already exists in current business
    const hasId = (id: string, existingSet: Set<string>): boolean => {
      return existingSet.has(id) || existingSet.has(`${id}_imp`)
    }
    const resolveId = (id: string, existingSet: Set<string>): string => {
      if (existingSet.has(id)) return id
      if (existingSet.has(`${id}_imp`)) return `${id}_imp`
      return `${id}_imp` // generate new _imp ID
    }

    // §ORDER-1: Categories (no deps)
    for (const c of envelope.categories) {
      if (hasId(c.id, existing.categoryIds)) {
        const existingId = resolveId(c.id, existing.categoryIds)
        if (opts.updateExisting) {
          await tx.category.upsert({
            where: { id: existingId },
            update: { name: c.name, parentId: c.parentId ? (idMap.get(c.parentId) || c.parentId) : null, level: c.level, sortOrder: c.sortOrder, businessId },
            create: { id: c.id, name: c.name, parentId: c.parentId ? (idMap.get(c.parentId) || c.parentId) : null, level: c.level, sortOrder: c.sortOrder, businessId },
          })
          idMap.set(c.id, existingId)
          result.imported.categories++
        } else {
          idMap.set(c.id, existingId)
          result.skipped.categories++
        }
      } else {
        // §NEW-ID: Generate a new ID to avoid global cuid collision
        const newId = `${c.id}_imp`
        idMap.set(c.id, newId)
        await tx.category.create({
          data: { id: newId, name: c.name, parentId: c.parentId ? (idMap.get(c.parentId) || c.parentId) : null, level: c.level, sortOrder: c.sortOrder, businessId },
        })
        result.imported.categories++
      }
    }

    // §ORDER-2: Parties (no deps)
    for (const p of envelope.parties) {
      if (hasId(p.id, existing.partyIds)) {
        const existingId = resolveId(p.id, existing.partyIds)
        if (opts.updateExisting) {
          await tx.party.upsert({
            where: { id: existingId },
            update: {
              name: p.name, phone: p.phone, type: p.type, balance: p.balance,
              qualityGrade: p.qualityGrade, creditLimit: p.creditLimit,
              openingBalance: p.openingBalance, address: p.address, gstin: p.gstin,
              notes: p.notes, avgPaymentDays: p.avgPaymentDays, avgDiscountPct: p.avgDiscountPct,
              creditTrustScore: p.creditTrustScore, buyerGroup: p.buyerGroup, businessId,
            },
            create: {
              id: p.id, name: p.name, phone: p.phone, type: p.type, balance: p.balance,
              qualityGrade: p.qualityGrade, creditLimit: p.creditLimit,
              openingBalance: p.openingBalance, address: p.address, gstin: p.gstin,
              notes: p.notes, avgPaymentDays: p.avgPaymentDays, avgDiscountPct: p.avgDiscountPct,
              creditTrustScore: p.creditTrustScore, buyerGroup: p.buyerGroup, businessId,
            },
          })
          idMap.set(p.id, existingId)
          result.imported.parties++
        } else {
          idMap.set(p.id, existingId)
          result.skipped.parties++
        }
      } else {
        const newId = `${p.id}_imp`
        idMap.set(p.id, newId)
        await tx.party.create({
          data: {
            id: newId, name: p.name, phone: p.phone, type: p.type, balance: p.balance,
            qualityGrade: p.qualityGrade, creditLimit: p.creditLimit,
            openingBalance: p.openingBalance, address: p.address, gstin: p.gstin,
            notes: p.notes, avgPaymentDays: p.avgPaymentDays, avgDiscountPct: p.avgDiscountPct,
            creditTrustScore: p.creditTrustScore, buyerGroup: p.buyerGroup, businessId,
          },
        })
        result.imported.parties++
      }
    }

    // §ORDER-3: Products (may reference Party via supplierId)
    for (const p of envelope.products) {
      if (hasId(p.id, existing.productIds)) {
        const existingId = resolveId(p.id, existing.productIds)
        if (opts.updateExisting) {
          await tx.product.upsert({
            where: { id: existingId },
            update: {
              name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
              categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
              salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
              gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
              supplierId: p.supplierId ? (idMap.get(p.supplierId) || p.supplierId) : null, retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
              conversionFactor: p.conversionFactor, retailSalePrice: p.retailSalePrice,
              retailMrp: p.retailMrp, looseStock: p.looseStock, isPublished: p.isPublished,
              businessId,
            },
            create: {
              id: p.id, name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
              categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
              salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
              gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
              supplierId: p.supplierId ? (idMap.get(p.supplierId) || p.supplierId) : null, retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
              conversionFactor: p.conversionFactor, retailSalePrice: p.retailSalePrice,
              retailMrp: p.retailMrp, looseStock: p.looseStock, isPublished: p.isPublished,
              businessId,
            },
          })
          result.imported.products++
        } else {
          result.skipped.products++
        }
      } else {
        const newId = `${p.id}_imp`
        idMap.set(p.id, newId)
        await tx.product.create({
          data: {
            id: newId, name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
            categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
            salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
            gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
            supplierId: p.supplierId ? (idMap.get(p.supplierId) || p.supplierId) : null,
            retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
            conversionFactor: p.conversionFactor, retailSalePrice: p.retailSalePrice,
            retailMrp: p.retailMrp, looseStock: p.looseStock, isPublished: p.isPublished,
            businessId,
          },
        })
        result.imported.products++
      }
    }

    // §ORDER-4: Staff (needs staffId + qrToken — qrToken is regenerated as a new cuid)
    for (const s of envelope.staff) {
      // §QR-TOKEN-REGEN: qrToken is a secret that was stripped from the backup.
      // Generate a new one on import (the staff member will re-link via their phone).
      const newQrToken = `${s.id}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
      // §STAFF-ID-FALLBACK: If staffId is empty (stripped or missing), generate one
      const staffIdVal = s.staffId || Math.random().toString().slice(2, 8)
      if (hasId(s.id, existing.staffIds)) {
        const existingId = resolveId(s.id, existing.staffIds)
        if (opts.updateExisting) {
          await tx.staff.upsert({
            where: { id: existingId },
            update: {
              name: s.name, phone: s.phone, role: s.role, staffId: staffIdVal, isActive: s.isActive,
              permBilling: s.permBilling, permInventory: s.permInventory, permKhata: s.permKhata,
              permReports: s.permReports, permSourcing: s.permSourcing, permSettings: s.permSettings,
              permExport: s.permExport, permDelete: s.permDelete, businessId,
            },
            create: {
              id: s.id, name: s.name, phone: s.phone, role: s.role, staffId: staffIdVal, qrToken: newQrToken,
              isActive: s.isActive,
              permBilling: s.permBilling, permInventory: s.permInventory, permKhata: s.permKhata,
              permReports: s.permReports, permSourcing: s.permSourcing, permSettings: s.permSettings,
              permExport: s.permExport, permDelete: s.permDelete, businessId,
            },
          })
          result.imported.staff++
        } else {
          result.skipped.staff++
        }
      } else {
        const newId = `${s.id}_imp`
        idMap.set(s.id, newId)
        await tx.staff.create({
          data: {
            id: newId, name: s.name, phone: s.phone, role: s.role, staffId: staffIdVal, qrToken: newQrToken,
            isActive: s.isActive,
            permBilling: s.permBilling, permInventory: s.permInventory, permKhata: s.permKhata,
            permReports: s.permReports, permSourcing: s.permSourcing, permSettings: s.permSettings,
            permExport: s.permExport, permDelete: s.permDelete, businessId,
          },
        })
        result.imported.staff++
      }
    }

    // §ORDER-5: PartyNotes (depends on Party; no businessId field)
    for (const pn of envelope.partyNotes) {
      if (hasId(pn.id, existing.partyNoteIds)) {
        const existingId = resolveId(pn.id, existing.partyNoteIds)
        if (opts.updateExisting) {
          await tx.partyNote.upsert({
            where: { id: existingId },
            update: { partyId: idMap.get(pn.partyId) || pn.partyId, type: pn.type, content: pn.content, author: pn.author },
            create: { id: pn.id, partyId: idMap.get(pn.partyId) || pn.partyId, type: pn.type, content: pn.content, author: pn.author },
          })
          result.imported.partyNotes++
        } else {
          result.skipped.partyNotes++
        }
      } else {
        const newId = `${pn.id}_imp`
        idMap.set(pn.id, newId)
        await tx.partyNote.create({
          data: { id: newId, partyId: idMap.get(pn.partyId) || pn.partyId, type: pn.type, content: pn.content, author: pn.author },
        })
        result.imported.partyNotes++
      }
    }

    // §ORDER-6: Invoices (depends on Party — partyId may be null for walk-in)
    for (const inv of envelope.invoices) {
      if (hasId(inv.id, existing.invoiceIds)) {
        const existingId = resolveId(inv.id, existing.invoiceIds)
        if (opts.updateExisting) {
          await tx.invoice.upsert({
            where: { id: existingId },
            update: {
              partyId: inv.partyId ? (idMap.get(inv.partyId) || inv.partyId) : null, invoiceNumber: inv.invoiceNumber, type: inv.type,
              status: inv.status, isGst: inv.isGst, subtotal: inv.subtotal,
              discountValue: inv.discountValue, discountMode: inv.discountMode,
              discountAmount: inv.discountAmount, gstAmount: inv.gstAmount,
              grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, amountDue: inv.amountDue,
              paymentMode: inv.paymentMode, notes: inv.notes, deliveryStatus: inv.deliveryStatus,
              collectedByName: inv.collectedByName, collectedByRole: inv.collectedByRole,
              paidToName: inv.paidToName, paidToRole: inv.paidToRole, businessId,
            },
            create: {
              id: inv.id, partyId: inv.partyId ? (idMap.get(inv.partyId) || inv.partyId) : null, invoiceNumber: inv.invoiceNumber, type: inv.type,
              status: inv.status, isGst: inv.isGst, subtotal: inv.subtotal,
              discountValue: inv.discountValue, discountMode: inv.discountMode,
              discountAmount: inv.discountAmount, gstAmount: inv.gstAmount,
              grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, amountDue: inv.amountDue,
              paymentMode: inv.paymentMode, notes: inv.notes, deliveryStatus: inv.deliveryStatus,
              collectedByName: inv.collectedByName, collectedByRole: inv.collectedByRole,
              paidToName: inv.paidToName, paidToRole: inv.paidToRole, businessId,
            },
          })
          result.imported.invoices++
        } else {
          result.skipped.invoices++
        }
      } else {
        const newId = `${inv.id}_imp`
        idMap.set(inv.id, newId)
        await tx.invoice.create({
          data: {
            id: newId, partyId: inv.partyId ? (idMap.get(inv.partyId) || inv.partyId) : null, invoiceNumber: inv.invoiceNumber, type: inv.type,
            status: inv.status, isGst: inv.isGst, subtotal: inv.subtotal,
            discountValue: inv.discountValue, discountMode: inv.discountMode,
            discountAmount: inv.discountAmount, gstAmount: inv.gstAmount,
            grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, amountDue: inv.amountDue,
            paymentMode: inv.paymentMode, notes: inv.notes, deliveryStatus: inv.deliveryStatus,
            collectedByName: inv.collectedByName, collectedByRole: inv.collectedByRole,
            paidToName: inv.paidToName, paidToRole: inv.paidToRole, businessId,
          },
        })
        result.imported.invoices++
      }
    }

    // §ORDER-7: InvoiceItems (depends on Invoice + Product — both may be null)
    for (const it of envelope.invoiceItems) {
      if (hasId(it.id, existing.invoiceItemIds)) {
        const existingId = resolveId(it.id, existing.invoiceItemIds)
        if (opts.updateExisting) {
          await tx.invoiceItem.upsert({
            where: { id: existingId },
            update: {
              invoiceId: idMap.get(it.invoiceId) || it.invoiceId, productId: it.productId ? (idMap.get(it.productId) || it.productId) : null, name: it.name,
              quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
              gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
            },
            create: {
              id: it.id, invoiceId: idMap.get(it.invoiceId) || it.invoiceId, productId: it.productId ? (idMap.get(it.productId) || it.productId) : null, name: it.name,
              quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
              gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
            },
          })
          result.imported.invoiceItems++
        } else {
          result.skipped.invoiceItems++
        }
      } else {
        const newId = `${it.id}_imp`
        idMap.set(it.id, newId)
        await tx.invoiceItem.create({
          data: {
            id: newId, invoiceId: idMap.get(it.invoiceId) || it.invoiceId, productId: it.productId ? (idMap.get(it.productId) || it.productId) : null, name: it.name,
            quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
            gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
          },
        })
        result.imported.invoiceItems++
      }
    }

    // §ORDER-8: Transactions (depends on Party + Invoice — both may be null)
    for (const t of envelope.transactions) {
      if (hasId(t.id, existing.transactionIds)) {
        const existingId = resolveId(t.id, existing.transactionIds)
        if (opts.updateExisting) {
          await tx.transaction.upsert({
            where: { id: existingId },
            update: {
              partyId: t.partyId ? (idMap.get(t.partyId) || t.partyId) : null, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
              description: t.description, category: t.category, invoiceId: t.invoiceId ? (idMap.get(t.invoiceId) || t.invoiceId) : null, businessId,
            },
            create: {
              id: t.id, partyId: t.partyId ? (idMap.get(t.partyId) || t.partyId) : null, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
              description: t.description, category: t.category, invoiceId: t.invoiceId ? (idMap.get(t.invoiceId) || t.invoiceId) : null, businessId,
            },
          })
          result.imported.transactions++
        } else {
          result.skipped.transactions++
        }
      } else {
        const newId = `${t.id}_imp`
        idMap.set(t.id, newId)
        await tx.transaction.create({
          data: {
            id: newId, partyId: t.partyId ? (idMap.get(t.partyId) || t.partyId) : null, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
            description: t.description, category: t.category, invoiceId: t.invoiceId ? (idMap.get(t.invoiceId) || t.invoiceId) : null, businessId,
          },
        })
        result.imported.transactions++
      }
    }

    // §ORDER-9: StockMovements (depends on Product; uses description not note)
    for (const sm of envelope.stockMovements) {
      if (hasId(sm.id, existing.stockMovementIds)) {
        const existingId = resolveId(sm.id, existing.stockMovementIds)
        if (opts.updateExisting) {
          await tx.stockMovement.upsert({
            where: { id: existingId },
            update: {
              productId: idMap.get(sm.productId) || sm.productId, type: sm.type, quantity: sm.quantity,
              balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
              referenceType: sm.referenceType, description: sm.description, businessId,
            },
            create: {
              id: sm.id, productId: idMap.get(sm.productId) || sm.productId, type: sm.type, quantity: sm.quantity,
              balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
              referenceType: sm.referenceType, description: sm.description, businessId,
            },
          })
          result.imported.stockMovements++
        } else {
          result.skipped.stockMovements++
        }
      } else {
        const newId = `${sm.id}_imp`
        idMap.set(sm.id, newId)
        await tx.stockMovement.create({
          data: {
            id: newId, productId: idMap.get(sm.productId) || sm.productId, type: sm.type, quantity: sm.quantity,
            balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
            referenceType: sm.referenceType, description: sm.description, businessId,
          },
        })
        result.imported.stockMovements++
      }
    }

    // §ORDER-10: CustomPrices (depends on Product + Party — both may be null)
    for (const cp of envelope.customPrices) {
      if (hasId(cp.id, existing.customPriceIds)) {
        const existingId = resolveId(cp.id, existing.customPriceIds)
        if (opts.updateExisting) {
          await tx.customPrice.upsert({
            where: { id: existingId },
            update: {
              productId: cp.productId ? (idMap.get(cp.productId) || cp.productId) : null, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId ? (idMap.get(cp.buyerId) || cp.buyerId) : null,
              buyerGroupName: cp.buyerGroupName, customPrice: cp.customPrice,
              customSalePrice: cp.customSalePrice, customMrp: cp.customMrp,
              customWholesalePrice: cp.customWholesalePrice,
              customRetailSalePrice: cp.customRetailSalePrice, customRetailMrp: cp.customRetailMrp,
              businessId,
            },
            create: {
              id: cp.id, productId: cp.productId ? (idMap.get(cp.productId) || cp.productId) : null, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId ? (idMap.get(cp.buyerId) || cp.buyerId) : null,
              buyerGroupName: cp.buyerGroupName, customPrice: cp.customPrice,
              customSalePrice: cp.customSalePrice, customMrp: cp.customMrp,
              customWholesalePrice: cp.customWholesalePrice,
              customRetailSalePrice: cp.customRetailSalePrice, customRetailMrp: cp.customRetailMrp,
              businessId,
            },
          })
          result.imported.customPrices++
        } else {
          result.skipped.customPrices++
        }
      } else {
        const newId = `${cp.id}_imp`
        idMap.set(cp.id, newId)
        await tx.customPrice.create({
          data: {
            id: newId, productId: cp.productId ? (idMap.get(cp.productId) || cp.productId) : null, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId ? (idMap.get(cp.buyerId) || cp.buyerId) : null,
            buyerGroupName: cp.buyerGroupName, customPrice: cp.customPrice,
            customSalePrice: cp.customSalePrice, customMrp: cp.customMrp,
            customWholesalePrice: cp.customWholesalePrice,
            customRetailSalePrice: cp.customRetailSalePrice, customRetailMrp: cp.customRetailMrp,
            businessId,
          },
        })
        result.imported.customPrices++
      }
    }
  })

  return result
}
