import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'
import { requireRole } from '@/lib/auth/session'
import { generateSearchTags } from '@/lib/transliteration'
import {
  IMPORTABLE_FIELDS,
  normalizeValue,
  detectPartyDuplicate,
  detectProductDuplicate,
  validateRow,
  type ImportEntityType,
} from '@/lib/external-import'

// §VERCEL-LIMIT: External import may take longer for large files.
export const maxDuration = 60

// §MAX-ROWS: 10,000 rows max per external import (prevents abuse + memory issues)
const MAX_ROWS = 10000

// POST /api/external-import
//
// §BODY: JSON with one of:
//   { step: 'preview', entityType, rows, mapping }   → returns validation + duplicate preview
//   { step: 'import', entityType, rows, mapping, strategy, duplicateResolutions }  → performs import
//
// §SECURITY:
// - Requires OWNER role (external import can modify business data significantly).
// - §TENANT-ISOLATION: ALL imported records are created with the current business's id.
// - §ATOMIC: The 'import' step runs inside a Prisma $transaction. Rollback on failure.
// - §NO-REPLACE: External import does NOT support 'replace' strategy (too dangerous).
//   Only 'add-new' (skip existing) and 'merge' (update safe fields) are supported.
//
// §DUPLICATE-HANDLING:
// - EXACT_MATCH: skipped by default (add-new) or updated (merge strategy)
// - POSSIBLE_MATCH: requires user resolution via duplicateResolutions map
// - NEW: always imported
export async function POST(req: NextRequest) {
  const user = await requireRole(['OWNER'])
  if (user instanceof NextResponse) return user

  const business = await db.business.findUnique({ where: { id: user.businessId } })
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON in request body' }, { status: 400 })
  }

  const { step, entityType, rows, mapping, strategy, duplicateResolutions } = body as {
    step: string
    entityType: ImportEntityType
    rows: Record<string, any>[]
    mapping: Record<string, string>
    strategy?: 'add-new' | 'merge'
    duplicateResolutions?: Record<string, 'merge' | 'new' | 'skip'>
  }

  // §VALIDATE-INPUT
  if (!step || !['preview', 'import'].includes(step)) {
    return NextResponse.json({ error: "Missing or invalid 'step' (must be 'preview' or 'import')" }, { status: 400 })
  }
  if (!entityType || !IMPORTABLE_FIELDS[entityType]) {
    return NextResponse.json({ error: 'Invalid entityType' }, { status: 400 })
  }
  if (!Array.isArray(rows)) {
    return NextResponse.json({ error: 'Missing or invalid rows array' }, { status: 400 })
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (${rows.length}). Maximum is ${MAX_ROWS}.` }, { status: 413 })
  }
  if (!mapping || typeof mapping !== 'object') {
    return NextResponse.json({ error: 'Missing mapping object' }, { status: 400 })
  }

  // §GATHER-EXISTING: Fetch existing records for duplicate detection
  const existingParties = entityType === 'customers' || entityType === 'suppliers' || entityType === 'opening-balances'
    ? await db.party.findMany({
        where: { businessId: business.id, ...(entityType === 'customers' ? { type: { not: 'supplier' } } : entityType === 'suppliers' ? { type: { not: 'customer' } } : {}) },
        select: { id: true, name: true, phone: true, gstin: true, balance: true, openingBalance: true },
      })
    : []
  const existingProducts = entityType === 'products'
    ? await db.product.findMany({
        where: { businessId: business.id },
        select: { id: true, name: true, sku: true, unit: true },
      })
    : []

  // §VALIDATE-ROWS: Apply mapping + normalization + validation + duplicate detection
  const validatedRows = rows.map((row, idx) => {
    const duplicate = entityType === 'products'
      ? detectProductDuplicate(
          { name: normalizeValue(row[Object.keys(mapping).find(k => mapping[k] === 'name') || ''] || '', 'string'), sku: mapping[Object.keys(mapping).find(k => mapping[k] === 'sku') || ''] ? normalizeValue(row[Object.keys(mapping).find(k => mapping[k] === 'sku') || ''] || '', 'string') : null, unit: 'pcs' },
          existingProducts as any
        )
      : detectPartyDuplicate(
          { name: normalizeValue(row[Object.keys(mapping).find(k => mapping[k] === 'name') || ''] || '', 'string'), phone: normalizeValue(row[Object.keys(mapping).find(k => mapping[k] === 'phone') || ''] || '', 'phone'), gstin: normalizeValue(row[Object.keys(mapping).find(k => mapping[k] === 'gstin') || ''] || '', 'gstin') },
          existingParties as any
        )

    return validateRow(row, mapping, entityType, idx + 1, duplicate)
  })

  // §COUNTS
  const counts = {
    total: validatedRows.length,
    valid: validatedRows.filter((r) => r.status === 'VALID').length,
    warnings: validatedRows.filter((r) => r.status === 'WARNING').length,
    errors: validatedRows.filter((r) => r.status === 'ERROR').length,
    new: validatedRows.filter((r) => r.duplicate.status === 'NEW').length,
    exactMatches: validatedRows.filter((r) => r.duplicate.status === 'EXACT_MATCH').length,
    possibleMatches: validatedRows.filter((r) => r.duplicate.status === 'POSSIBLE_MATCH').length,
  }

  if (step === 'preview') {
    // §PREVIEW: Return counts + sample rows (first 20) with status
    return NextResponse.json({
      ok: true,
      counts,
      sampleRows: validatedRows.slice(0, 20).map((r) => ({
        rowNumber: r.rowNumber,
        name: r.mappedData.name || r.sourceData[Object.keys(r.sourceData)[0]],
        phone: r.mappedData.phone || '',
        gstin: r.mappedData.gstin || '',
        status: r.status,
        duplicate: r.duplicate.status,
        duplicateMatch: r.duplicate.matchedRecordName,
        errors: r.errors,
        warnings: r.warnings,
      })),
    })
  }

  // ─── STEP: IMPORT ────────────────────────────────────────────────────
  const importStrategy = strategy || 'add-new'
  const resolutions = duplicateResolutions || {}

  // §IMPORT-HISTORY: Create a history record when the import starts (status=RUNNING).
  // Updated to COMPLETED or FAILED after the transaction.
  const sourceFileName = body.sourceFileName || 'unknown'
  const sourceFormat = body.sourceFormat || 'csv'
  const historyRecord = await db.importHistory.create({
    data: {
      businessId: business.id,
      userId: user.id,
      importType: entityType,
      sourceFileName,
      sourceFormat,
      rowCount: validatedRows.length,
      status: 'RUNNING',
    },
  })

  try {
    const result = await performExternalImport(
      validatedRows,
      entityType,
      business.id,
      importStrategy,
      resolutions
    )

    // §IMPORT-HISTORY: Update to COMPLETED with counts + error report
    await db.importHistory.update({
      where: { id: historyRecord.id },
      data: {
        importedCount: result.imported,
        skippedCount: result.skipped,
        failedCount: result.errors.length,
        status: 'COMPLETED',
        completedAt: new Date(),
        errorReportJson: result.errors.length > 0 ? JSON.stringify(result.errors) : null,
      },
    })

    // §AUDIT-LOG
    await logAudit({
      businessId: business.id,
      action: AUDIT_ACTIONS.DATA_EXPORT,
      entityType: ENTITY_TYPES.EXPORT,
      description: `External import (${entityType}): ${result.imported} imported, ${result.skipped} skipped, ${result.errors.length} errors`,
      metadata: JSON.stringify({
        action: 'EXTERNAL_IMPORT',
        entityType,
        strategy: importStrategy,
        imported: result.imported,
        skipped: result.skipped,
        errorCount: result.errors.length,
      }),
    })

    return NextResponse.json({ ok: true, result })
  } catch (e: any) {
    // §IMPORT-HISTORY: Update to FAILED (rolled back)
    await db.importHistory.update({
      where: { id: historyRecord.id },
      data: {
        status: 'ROLLED_BACK',
        completedAt: new Date(),
      },
    }).catch(() => {}) // best-effort — don't mask the original error

    return NextResponse.json(
      { ok: false, error: `Import failed and was rolled back: ${e.message}` },
      { status: 500 }
    )
  }
}

// ─── Helper: perform the atomic import ────────────────────────────────────

interface ExternalImportResult {
  imported: number
  skipped: number
  errors: Array<{ row: number; name: string; field?: string; problem: string; suggestedFix?: string }>
}

async function performExternalImport(
  validatedRows: ReturnType<typeof validateRow>[],
  entityType: ImportEntityType,
  businessId: string,
  strategy: 'add-new' | 'merge',
  resolutions: Record<string, 'merge' | 'new' | 'skip'>
): Promise<ExternalImportResult> {
  const result: ExternalImportResult = { imported: 0, skipped: 0, errors: [] }

  await db.$transaction(async (tx) => {
    for (const row of validatedRows) {
      // §SKIP-ERRORS: Rows with validation errors are never imported
      if (row.status === 'ERROR') {
        result.errors.push({
          row: row.rowNumber,
          name: row.mappedData.name || '(no name)',
          field: row.errors[0]?.includes('Party Name') ? 'name' : row.errors[0]?.includes('Phone') ? 'phone' : row.errors[0]?.includes('GSTIN') ? 'gstin' : '',
          problem: row.errors.join('; '),
          suggestedFix: row.errors[0]?.includes('Missing required field') ? 'Provide a value for this field' : 'Check the data format',
        })
        continue
      }

      // §DUPLICATE-RESOLUTION: Check user's resolution for possible matches
      if (row.duplicate.status === 'POSSIBLE_MATCH' && row.duplicate.matchedRecordId) {
        const resolution = resolutions[row.duplicate.matchedRecordId]
        if (resolution === 'skip') {
          result.skipped++
          continue
        }
        if (resolution === 'merge' && row.duplicate.matchedRecordId) {
          // Update existing record
          if (entityType === 'products') {
            await updateProduct(tx, row.duplicate.matchedRecordId, row.mappedData, businessId, strategy)
            result.imported++
          } else {
            await updateParty(tx, row.duplicate.matchedRecordId, row.mappedData, entityType, businessId, strategy)
            result.imported++
          }
          continue
        }
        // 'new' → fall through to create new record
      }

      // §EXACT-MATCH: Skip (add-new) or update (merge)
      if (row.duplicate.status === 'EXACT_MATCH' && row.duplicate.matchedRecordId) {
        if (strategy === 'merge') {
          if (entityType === 'products') {
            await updateProduct(tx, row.duplicate.matchedRecordId, row.mappedData, businessId, strategy)
            result.imported++
          } else {
            await updateParty(tx, row.duplicate.matchedRecordId, row.mappedData, entityType, businessId, strategy)
            result.imported++
          }
        } else {
          result.skipped++
        }
        continue
      }

      // §NEW-RECORD: Create new party/product.
      // §ATOMIC: DB-level failures here MUST propagate to the $transaction
      // so the entire import rolls back. We do NOT catch DB errors here —
      // a unique constraint violation, type mismatch, or any other DB error
      // means the data is inconsistent and the transaction must abort.
      // (Row-level validation errors — missing required fields — are already
      // caught above and correctly skipped without rollback.)
      if (entityType === 'products') {
        await createProduct(tx, row.mappedData, businessId)
      } else {
        await createParty(tx, row.mappedData, entityType, businessId)
      }
      result.imported++
    }
  })

  return result
}

// ─── Create / Update helpers ─────────────────────────────────────────────

async function createParty(
  tx: any,
  data: Record<string, any>,
  entityType: ImportEntityType,
  businessId: string
) {
  const partyType = entityType === 'suppliers' ? 'supplier' : 'customer'
  // §OPENING-BALANCE: For opening-balances import, the openingBalance field
  // represents the receivable (+) or payable (-). Party.balance is set to match.
  const openingBalance = Number(data.openingBalance) || 0
  const balance = entityType === 'opening-balances' ? openingBalance : openingBalance
  const isSupplier = entityType === 'suppliers' || (entityType === 'opening-balances' && openingBalance < 0)
  const finalType = entityType === 'opening-balances' ? (openingBalance >= 0 ? 'customer' : 'supplier') : partyType

  const name = String(data.name || '')
  const searchTags = JSON.stringify(generateSearchTags(name))

  await tx.party.create({
    data: {
      businessId,
      name,
      phone: data.phone || null,
      type: finalType,
      balance,
      openingBalance,
      creditLimit: data.creditLimit ? Number(data.creditLimit) : null,
      address: data.address || null,
      gstin: data.gstin || null,
      notes: data.notes || null,
      searchTags,
    },
  })
}

async function updateParty(
  tx: any,
  id: string,
  data: Record<string, any>,
  entityType: ImportEntityType,
  businessId: string,
  strategy: 'add-new' | 'merge'
) {
  // §MERGE-SAFE: Only update fields that are non-empty in the import data.
  // Never overwrite existing data with empty values.
  const updateData: any = {}
  if (data.phone) updateData.phone = data.phone
  if (data.gstin) updateData.gstin = data.gstin
  if (data.address) updateData.address = data.address
  if (data.notes) updateData.notes = data.notes
  if (data.creditLimit) updateData.creditLimit = Number(data.creditLimit)

  if (Object.keys(updateData).length > 0) {
    await tx.party.update({ where: { id }, data: updateData })
  }
}

async function createProduct(
  tx: any,
  data: Record<string, any>,
  businessId: string
) {
  const name = String(data.name || '')
  const searchTags = JSON.stringify(generateSearchTags(name))

  await tx.product.create({
    data: {
      businessId,
      name,
      sku: data.sku || null,
      category: data.category || null,
      unit: data.unit || 'pcs',
      purchasePrice: Number(data.purchasePrice) || 0,
      salePrice: Number(data.salePrice) || 0,
      mrp: data.mrp ? Number(data.mrp) : null,
      wholesalePrice: data.wholesalePrice ? Number(data.wholesalePrice) : null,
      gstRate: Number(data.gstRate) || 0,
      stock: Number(data.stock) || 0,
      lowStockThreshold: Number(data.lowStockThreshold) || 5,
      description: data.description || null,
      searchTags,
    },
  })
}

async function updateProduct(
  tx: any,
  id: string,
  data: Record<string, any>,
  businessId: string,
  strategy: 'add-new' | 'merge'
) {
  // §MERGE-SAFE: Only update non-empty fields
  const updateData: any = {}
  if (data.sku) updateData.sku = data.sku
  if (data.category) updateData.category = data.category
  if (data.purchasePrice) updateData.purchasePrice = Number(data.purchasePrice)
  if (data.salePrice) updateData.salePrice = Number(data.salePrice)
  if (data.mrp) updateData.mrp = Number(data.mrp)
  if (data.wholesalePrice) updateData.wholesalePrice = Number(data.wholesalePrice)
  if (data.gstRate !== undefined) updateData.gstRate = Number(data.gstRate)
  if (data.description) updateData.description = data.description

  if (Object.keys(updateData).length > 0) {
    await tx.product.update({ where: { id }, data: updateData })
  }
}
