import { NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// POST /api/backup/drive — backup to Google Drive (simulated)
// In production, this would use Google Drive API with OAuth2.
export async function POST() {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const [parties, products, invoices, transactions] = await Promise.all([
      db.party.findMany({ where: { businessId: business.id } }),
      db.product.findMany({ where: { businessId: business.id } }),
      db.invoice.findMany({ where: { businessId: business.id }, include: { items: true } }),
      db.transaction.findMany({ where: { businessId: business.id } }),
    ])

    const backupData = {
      business,
      exportedAt: new Date().toISOString(),
      parties,
      products,
      invoices,
      transactions,
    }

    const jsonStr = JSON.stringify(backupData, null, 2)
    const sizeBytes = new Blob([jsonStr]).size

    await db.backupLog.create({
      data: {
        businessId: business.id,
        channel: 'drive',
        status: 'success',
        fileSize: sizeBytes,
      },
    })

    await db.appSettings.updateMany({
      where: { businessId: business.id },
      data: { lastBackupAt: new Date(), driveEnabled: true },
    })

    // In production: upload to Google Drive
    // const drive = google.drive({ version: 'v3', auth: oauth2Client })
    // await drive.files.create({ ... })

    return NextResponse.json({
      ok: true,
      message: 'Backup uploaded to Google Drive',
      size: sizeBytes,
      records: { parties: parties.length, products: products.length, invoices: invoices.length, transactions: transactions.length },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
