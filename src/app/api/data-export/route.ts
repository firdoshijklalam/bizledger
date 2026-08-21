import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'
import { requireRole } from '@/lib/auth/session'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { escapeCsvField } from '@/lib/reports-csv'

// GET /api/data-export?format=json|csv
// §SECURITY: Exports ALL business data (customers, products, invoices, transactions).
// This endpoint requires OWNER or ADMIN role — no one else should be able to
// export the entire business database.
export async function GET(req: NextRequest) {
  // §AUTH: Require OWNER or ADMIN role
  const user = await requireRole(['OWNER', 'ADMIN'])
  if (user instanceof NextResponse) return user

  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'json'

  // §AUTH: Get business from the authenticated user's businessId
  const business = await db.business.findUnique({ where: { id: user.businessId } })
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const [parties, products, invoices, transactions] = await Promise.all([
    db.party.findMany({ where: { businessId: business.id } }),
    db.product.findMany({ where: { businessId: business.id } }),
    db.invoice.findMany({ where: { businessId: business.id }, include: { items: true } }),
    db.transaction.findMany({ where: { businessId: business.id } }),
  ])

  // §AUDIT-LOG: Log the data export (critical security event)
  await logAudit({
    businessId: business.id,
    action: AUDIT_ACTIONS.DATA_EXPORT,
    entityType: ENTITY_TYPES.EXPORT,
    description: `Data export (${format.toUpperCase()}): ${parties.length} parties, ${products.length} products, ${invoices.length} invoices, ${transactions.length} transactions`,
    metadata: JSON.stringify({ format, partyCount: parties.length, productCount: products.length, invoiceCount: invoices.length, transactionCount: transactions.length }),
  })

  const data = {
    business,
    exportedAt: new Date().toISOString(),
    parties,
    products,
    invoices,
    transactions,
  }

  if (format === 'csv') {
    // §CSV-EXPORT: Build a CSV of transactions with proper RFC 4180 escaping
    // and UTF-8 BOM for Excel compatibility (Bengali text renders correctly).
    //
    // §BUGFIX: Previously this route joined values with commas without escaping,
    // broke on party names containing commas/quotes/newlines, and lacked a BOM
    // (so Bengali text mis-rendered in Excel). Now uses the shared escapeCsvField
    // helper from reports-csv.ts and prepends the UTF-8 BOM.
    const rows: string[][] = [['Date', 'Type', 'Party', 'Amount', 'Description']]
    for (const t of transactions) {
      const party = parties.find((p) => p.id === t.partyId)
      rows.push([
        new Date(t.createdAt).toISOString().split('T')[0],
        t.type,
        party?.name || '',
        // §DECIMAL-SAFE: t.amount is a Prisma Decimal — toNumber() before stringification
        // to avoid Decimal object stringification quirks.
        String((t as any).amount?.toNumber ? (t as any).amount.toNumber() : t.amount),
        t.description || '',
      ])
    }
    // §RFC4180: Escape each field per RFC 4180 (commas, quotes, newlines).
    // §BOM: Prepend UTF-8 BOM (0xFEFF) so Excel decodes Bengali correctly.
    const csv = '\uFEFF' + rows.map((r) => r.map(escapeCsvField).join(',')).join('\r\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Data_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  }

  // §DECIMAL-FIX-D: parties (balance, creditLimit, openingBalance), products (salePrice, etc.),
  // invoices + items (grandTotal, amountDue, unitPrice, total, etc.), transactions (amount, balanceAfter)
  // are all Prisma Decimal fields. serializeDecimals converts them to numbers before JSON.stringify.
  return new NextResponse(JSON.stringify(serializeDecimals(data), null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Backup_${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}
