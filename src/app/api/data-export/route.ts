import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'
import { requireRole } from '@/lib/auth/session'

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
    // Build a simple CSV of transactions
    const rows = [['Date', 'Type', 'Party', 'Amount', 'Description']]
    for (const t of transactions) {
      const party = parties.find((p) => p.id === t.partyId)
      rows.push([
        new Date(t.createdAt).toISOString().split('T')[0],
        t.type,
        party?.name || '',
        String(t.amount),
        (t.description || '').replace(/,/g, ';'),
      ])
    }
    const csv = rows.map((r) => r.join(',')).join('\n')
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Data_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    })
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${business.name.replace(/\s+/g, '_')}_Backup_${new Date().toISOString().split('T')[0]}.json"`,
    },
  })
}
