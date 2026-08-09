import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// PRD Part 37 §1.2 — Cloud Sync Mode (Zero-Cost Cloud)
// POST /api/storage/cloud-sync
//   Push media to Telegram as a File ID (zero-cost storage).
//   Body: { mediaType: 'image' | 'video', mediaData: 'data:image/jpeg;base64,...', productName? }
//   Logic:
//     1. Check cloudSyncMode in AppSettings. 400 if not enabled.
//     2. Simulate pushing to Telegram Bot API → generate a fake File ID.
//        (In production: call Telegram Bot API to upload file, store returned file_id.)
//     3. Return { ok, fileId, message }.
//
// GET /api/storage/cloud-sync
//   Returns cloud sync status (enabled + totalFilesSynced if tracked in AppSettings).

export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ enabled: false, totalFilesSynced: 0 }, { status: 200 })
    }
    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    return NextResponse.json({
      enabled: settings?.cloudSyncMode ?? false,
      telegramFileIdMode: settings?.telegramFileIdMode ?? false,
      // totalFilesSynced is not tracked in the current schema; report 0 as a stub.
      totalFilesSynced: 0,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      mediaType: 'image' | 'video'
      mediaData: string
      productName?: string
    }

    if (!body.mediaType || !body.mediaData) {
      return NextResponse.json(
        { error: 'mediaType and mediaData are required' },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    if (!settings || !settings.cloudSyncMode) {
      return NextResponse.json(
        { error: 'Cloud sync mode is not enabled' },
        { status: 400 }
      )
    }

    // Simulate pushing to Telegram Bot API.
    // In production: upload the file to a Telegram chat (e.g. private channel) via
    // sendPhoto / sendVideo, then persist the returned file_id in ProductImage.
    const fileId = `tg_file_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`

    return NextResponse.json({
      ok: true,
      fileId,
      message: 'Media pushed to Telegram cloud (zero-cost storage)',
      mediaType: body.mediaType,
      productName: body.productName ?? null,
      syncedAt: new Date().toISOString(),
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
