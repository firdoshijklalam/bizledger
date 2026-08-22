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

    // §ORDER-1: Categories (no deps)
    for (const c of envelope.categories) {
      if (existing.categoryIds.has(c.id)) {
        if (opts.updateExisting) {
          await tx.category.upsert({
            where: { id: c.id },
            update: { name: c.name, parentId: c.parentId, level: c.level, sortOrder: c.sortOrder, businessId },
            create: { id: c.id, name: c.name, parentId: c.parentId, level: c.level, sortOrder: c.sortOrder, businessId },
          })
          result.imported.categories++
        } else {
          result.skipped.categories++
        }
      } else {
        await tx.category.create({
          data: { id: c.id, name: c.name, parentId: c.parentId, level: c.level, sortOrder: c.sortOrder, businessId },
        })
        result.imported.categories++
      }
    }

    // §ORDER-2: Parties (no deps)
    for (const p of envelope.parties) {
      if (existing.partyIds.has(p.id)) {
        if (opts.updateExisting) {
          await tx.party.upsert({
            where: { id: p.id },
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
          result.imported.parties++
        } else {
          result.skipped.parties++
        }
      } else {
        await tx.party.create({
          data: {
            id: p.id, name: p.name, phone: p.phone, type: p.type, balance: p.balance,
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
      if (existing.productIds.has(p.id)) {
        if (opts.updateExisting) {
          await tx.product.upsert({
            where: { id: p.id },
            update: {
              name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
              categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
              salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
              gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
              supplierId: p.supplierId, retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
              conversionFactor: p.conversionFactor, retailSalePrice: p.retailSalePrice,
              retailMrp: p.retailMrp, looseStock: p.looseStock, isPublished: p.isPublished,
              businessId,
            },
            create: {
              id: p.id, name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
              categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
              salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
              gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
              supplierId: p.supplierId, retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
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
        await tx.product.create({
          data: {
            id: p.id, name: p.name, sku: p.sku, category: p.category, subCategory: p.subCategory,
            categoryPath: p.categoryPath, unit: p.unit, purchasePrice: p.purchasePrice,
            salePrice: p.salePrice, mrp: p.mrp, wholesalePrice: p.wholesalePrice,
            gstRate: p.gstRate, stock: p.stock, lowStockThreshold: p.lowStockThreshold,
            supplierId: p.supplierId, retailEnabled: p.retailEnabled, retailUnit: p.retailUnit,
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
      if (existing.staffIds.has(s.id)) {
        if (opts.updateExisting) {
          await tx.staff.upsert({
            where: { id: s.id },
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
        await tx.staff.create({
          data: {
            id: s.id, name: s.name, phone: s.phone, role: s.role, staffId: staffIdVal, qrToken: newQrToken,
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
      if (existing.partyNoteIds.has(pn.id)) {
        if (opts.updateExisting) {
          await tx.partyNote.upsert({
            where: { id: pn.id },
            update: { partyId: pn.partyId, type: pn.type, content: pn.content, author: pn.author },
            create: { id: pn.id, partyId: pn.partyId, type: pn.type, content: pn.content, author: pn.author },
          })
          result.imported.partyNotes++
        } else {
          result.skipped.partyNotes++
        }
      } else {
        await tx.partyNote.create({
          data: { id: pn.id, partyId: pn.partyId, type: pn.type, content: pn.content, author: pn.author },
        })
        result.imported.partyNotes++
      }
    }

    // §ORDER-6: Invoices (depends on Party — partyId may be null for walk-in)
    for (const inv of envelope.invoices) {
      if (existing.invoiceIds.has(inv.id)) {
        if (opts.updateExisting) {
          await tx.invoice.upsert({
            where: { id: inv.id },
            update: {
              partyId: inv.partyId, invoiceNumber: inv.invoiceNumber, type: inv.type,
              status: inv.status, isGst: inv.isGst, subtotal: inv.subtotal,
              discountValue: inv.discountValue, discountMode: inv.discountMode,
              discountAmount: inv.discountAmount, gstAmount: inv.gstAmount,
              grandTotal: inv.grandTotal, amountPaid: inv.amountPaid, amountDue: inv.amountDue,
              paymentMode: inv.paymentMode, notes: inv.notes, deliveryStatus: inv.deliveryStatus,
              collectedByName: inv.collectedByName, collectedByRole: inv.collectedByRole,
              paidToName: inv.paidToName, paidToRole: inv.paidToRole, businessId,
            },
            create: {
              id: inv.id, partyId: inv.partyId, invoiceNumber: inv.invoiceNumber, type: inv.type,
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
        await tx.invoice.create({
          data: {
            id: inv.id, partyId: inv.partyId, invoiceNumber: inv.invoiceNumber, type: inv.type,
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
      if (existing.invoiceItemIds.has(it.id)) {
        if (opts.updateExisting) {
          await tx.invoiceItem.upsert({
            where: { id: it.id },
            update: {
              invoiceId: it.invoiceId, productId: it.productId, name: it.name,
              quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
              gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
            },
            create: {
              id: it.id, invoiceId: it.invoiceId, productId: it.productId, name: it.name,
              quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
              gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
            },
          })
          result.imported.invoiceItems++
        } else {
          result.skipped.invoiceItems++
        }
      } else {
        await tx.invoiceItem.create({
          data: {
            id: it.id, invoiceId: it.invoiceId, productId: it.productId, name: it.name,
            quantity: it.quantity, unitPrice: it.unitPrice, discount: it.discount,
            gstRate: it.gstRate, total: it.total, fulfilledQty: it.fulfilledQty,
          },
        })
        result.imported.invoiceItems++
      }
    }

    // §ORDER-8: Transactions (depends on Party + Invoice — both may be null)
    for (const t of envelope.transactions) {
      if (existing.transactionIds.has(t.id)) {
        if (opts.updateExisting) {
          await tx.transaction.upsert({
            where: { id: t.id },
            update: {
              partyId: t.partyId, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
              description: t.description, category: t.category, invoiceId: t.invoiceId, businessId,
            },
            create: {
              id: t.id, partyId: t.partyId, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
              description: t.description, category: t.category, invoiceId: t.invoiceId, businessId,
            },
          })
          result.imported.transactions++
        } else {
          result.skipped.transactions++
        }
      } else {
        await tx.transaction.create({
          data: {
            id: t.id, partyId: t.partyId, type: t.type, amount: t.amount, balanceAfter: t.balanceAfter,
            description: t.description, category: t.category, invoiceId: t.invoiceId, businessId,
          },
        })
        result.imported.transactions++
      }
    }

    // §ORDER-9: StockMovements (depends on Product; uses description not note)
    for (const sm of envelope.stockMovements) {
      if (existing.stockMovementIds.has(sm.id)) {
        if (opts.updateExisting) {
          await tx.stockMovement.upsert({
            where: { id: sm.id },
            update: {
              productId: sm.productId, type: sm.type, quantity: sm.quantity,
              balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
              referenceType: sm.referenceType, description: sm.description, businessId,
            },
            create: {
              id: sm.id, productId: sm.productId, type: sm.type, quantity: sm.quantity,
              balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
              referenceType: sm.referenceType, description: sm.description, businessId,
            },
          })
          result.imported.stockMovements++
        } else {
          result.skipped.stockMovements++
        }
      } else {
        await tx.stockMovement.create({
          data: {
            id: sm.id, productId: sm.productId, type: sm.type, quantity: sm.quantity,
            balanceAfter: sm.balanceAfter, referenceId: sm.referenceId,
            referenceType: sm.referenceType, description: sm.description, businessId,
          },
        })
        result.imported.stockMovements++
      }
    }

    // §ORDER-10: CustomPrices (depends on Product + Party — both may be null)
    for (const cp of envelope.customPrices) {
      if (existing.customPriceIds.has(cp.id)) {
        if (opts.updateExisting) {
          await tx.customPrice.upsert({
            where: { id: cp.id },
            update: {
              productId: cp.productId, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId,
              buyerGroupName: cp.buyerGroupName, customPrice: cp.customPrice,
              customSalePrice: cp.customSalePrice, customMrp: cp.customMrp,
              customWholesalePrice: cp.customWholesalePrice,
              customRetailSalePrice: cp.customRetailSalePrice, customRetailMrp: cp.customRetailMrp,
              businessId,
            },
            create: {
              id: cp.id, productId: cp.productId, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId,
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
        await tx.customPrice.create({
          data: {
            id: cp.id, productId: cp.productId, catalogItemId: cp.catalogItemId, buyerId: cp.buyerId,
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
