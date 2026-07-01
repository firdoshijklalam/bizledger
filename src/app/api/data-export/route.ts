import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/data-export?format=json|csv
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const format = searchParams.get('format') || 'json'
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const [parties, products, invoices, transactions] = await Promise.all([
    db.party.findMany({ where: { businessId: business.id } }),
    db.product.findMany({ where: { businessId: business.id } }),
    db.invoice.findMany({ where: { businessId: business.id }, include: { items: true } }),
    db.transaction.findMany({ where: { businessId: business.id } }),
  ])

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
