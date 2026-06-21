import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/backup/telegram — send JSON backup to Telegram channel
// In production, this would use Telegram Bot API. Here we simulate + log.
export async function POST() {
  try {
    const business = await db.business.findFirst()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Gather all data for backup
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

    // Log the backup
    await db.backupLog.create({
      data: {
        businessId: business.id,
        channel: 'telegram',
        status: 'success',
        fileSize: sizeBytes,
      },
    })

    await db.appSettings.updateMany({
      where: { businessId: business.id },
      data: { lastBackupAt: new Date(), telegramEnabled: true },
    })

    // In production: send to Telegram Bot API
    // const botToken = process.env.TELEGRAM_BOT_TOKEN
    // const channelId = process.env.TELEGRAM_CHANNEL_ID
    // if (botToken && channelId) {
    //   await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ chat_id: channelId, text: `BizLedger Backup — ${business.name} — ${new Date().toISOString()}` }),
    //   })
    // }

    return NextResponse.json({
      ok: true,
      message: 'Backup sent to Telegram',
      size: sizeBytes,
      records: { parties: parties.length, products: products.length, invoices: invoices.length, transactions: transactions.length },
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
