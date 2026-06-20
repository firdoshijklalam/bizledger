import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/app-settings
export async function GET() {
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json(null)
  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  if (!settings) {
    const created = await db.appSettings.create({ data: { businessId: business.id } })
    return NextResponse.json(created)
  }
  return NextResponse.json(settings)
}

// PUT /api/app-settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await db.business.findFirst()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const updated = await db.appSettings.upsert({
      where: { businessId: business.id },
      update: {
        notificationsEnabled: body.notificationsEnabled,
        autoBackupEnabled: body.autoBackupEnabled,
        language: body.language,
        dateFormat: body.dateFormat,
        invoicePrefix: body.invoicePrefix,
        pinEnabled: body.pinEnabled,
      },
      create: {
        businessId: business.id,
        notificationsEnabled: body.notificationsEnabled ?? true,
        autoBackupEnabled: body.autoBackupEnabled ?? false,
        language: body.language ?? 'en',
        dateFormat: body.dateFormat ?? 'DD/MM/YYYY',
        invoicePrefix: body.invoicePrefix ?? 'INV',
        pinEnabled: body.pinEnabled ?? false,
      },
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
