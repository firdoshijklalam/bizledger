import { NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/backup/list — list all backup logs (Telegram + Drive)
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

  const logs = await db.backupLog.findMany({
    where: { businessId: business.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  })

  return NextResponse.json(logs.map((l) => ({
    id: l.id,
    channel: l.channel,
    status: l.status,
    fileSize: l.fileSize,
    fileUrl: l.fileUrl,
    date: l.createdAt,
  })))
}
