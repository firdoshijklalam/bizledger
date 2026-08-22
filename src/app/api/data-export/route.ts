import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'
import { requireRole } from '@/lib/auth/session'
import { escapeCsvField } from '@/lib/reports-csv'
import { buildBackupEnvelope, BACKUP_FORMAT, BACKUP_VERSION } from '@/lib/backup-format'

// GET /api/data-export?format=json|csv
//
// §SECURITY:
// - Requires OWNER or ADMIN role (requireRole).
// - Exports ONLY the authenticated user's business data (tenant isolation).
// - §SECRETS-STRIPPED: The JSON format uses an allow-list sanitizer that
//   NEVER includes passwordHash, tokenHash, pinHash, fingerprintHash,
//   qrToken, or paymentLandingToken. New secret fields added to the schema
//   in the future are automatically excluded (allow-list, not deny-list).
//
// §VERSIONED-BACKUP: The JSON format is now a versioned backup envelope:
//   { format: "bizledger-backup", version: 1, createdAt, business, settings,
//     parties, products, invoices, invoiceItems, transactions, categories,
//     customPrices, staff, partyNotes, stockMovements }
// This format can be imported via /api/data-import.
//
// §CSV: The CSV format remains a transactions-only flat file (not a backup).
export async function GET(req: NextRequest) {
  // §AUTH: Require OWNER or ADMIN role
  const user = await requireRole(['OWNER', 'ADMIN'])
  if (user instanceof NextResponse) return user

  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'json'

  // §AUTH: Get business from the authenticated user's businessId
  const business = await db.business.findUnique({ where: { id: user.businessId } })
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  // §PARALLEL-QUERIES: Fetch all business-owned entities in parallel.
  // Each query is scoped by businessId (tenant isolation).
  const [
    settings,
    parties,
    products,
    invoices,
    transactions,
    categories,
    customPrices,
    staff,
    partyNotes,
    stockMovements,
  ] = await Promise.all([
    db.appSettings.findUnique({ where: { businessId: business.id } }),
    db.party.findMany({ where: { businessId: business.id } }),
    db.product.findMany({ where: { businessId: business.id } }),
    db.invoice.findMany({ where: { businessId: business.id }, include: { items: true } }),
    db.transaction.findMany({ where: { businessId: business.id } }),
    db.category.findMany({ where: { businessId: business.id } }),
    db.customPrice.findMany({ where: { businessId: business.id } }),
    db.staff.findMany({ where: { businessId: business.id } }),
    db.partyNote.findMany({ where: { party: { businessId: business.id } } }),
    db.stockMovement.findMany({ where: { businessId: business.id } }),
  ])

  // §FLATTEN-INVOICE-ITEMS: Extract items from invoices (include: { items: true })
  // into a flat array for the backup envelope.
  const invoiceItems = invoices.flatMap((inv) => inv.items || [])

  // §AUDIT-LOG: Log the data export (critical security event)
  await logAudit({
    businessId: business.id,
    action: AUDIT_ACTIONS.DATA_EXPORT,
    entityType: ENTITY_TYPES.EXPORT,
    description: `Data export (${format.toUpperCase()}): ${parties.length} parties, ${products.length} products, ${invoices.length} invoices, ${transactions.length} transactions`,
    metadata: JSON.stringify({
      format,
      partyCount: parties.length,
      productCount: products.length,
      invoiceCount: invoices.length,
      transactionCount: transactions.length,
      invoiceItemCount: invoiceItems.length,
      categoryCount: categories.length,
      staffCount: staff.length,
    }),
  })

  if (format === 'csv') {
    // §CSV-EXPORT: Build a CSV of transactions with proper RFC 4180 escaping
    // and UTF-8 BOM for Excel compatibility (Bengali text renders correctly).
    const rows: string[][] = [['Date', 'Type', 'Party', 'Amount', 'Description']]
    for (const t of transactions) {
      const party = parties.find((p) => p.id === t.partyId)
      rows.push([
        new Date(t.createdAt).toISOString().split('T')[0],
        t.type,
        party?.name || '',
        String((t as any).amount?.toNumber ? (t as any).amount.toNumber() : t.amount),
        t.description || '',
      ])
    }
    const csv = '\uFEFF' + rows.map((r) => r.map(escapeCsvField).join(',')).join('\r\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Transactions_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  }

  // §VERSIONED-BACKUP: Build the sanitized, versioned backup envelope.
  // Secrets are stripped by the allow-list sanitizers in buildBackupEnvelope().
  const envelope = buildBackupEnvelope({
    business,
    settings,
    parties,
    products,
    invoices,
    invoiceItems,
    transactions,
    categories,
    customPrices,
    staff,
    partyNotes,
    stockMovements,
  })

  return new NextResponse(JSON.stringify(envelope, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Backup_v${BACKUP_VERSION}_${new Date().toISOString().split('T')[0]}.json"`,
      // §CACHE-CONTROL: Never cache a backup file (contains business data)
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}
