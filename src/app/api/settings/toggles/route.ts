import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// PRD Part 37 §1.1 — Merchant Control Toggles
// GET  /api/settings/toggles
//   Returns current toggle states for the current business.
//   { onlineSalesEnabled, offlineOnlyMode, cloudSyncMode, telegramFileIdMode, appMode }
//
// PUT  /api/settings/toggles
//   Body: { onlineSalesEnabled?, offlineOnlyMode?, cloudSyncMode?, telegramFileIdMode? }
//   Cross-coupling rules:
//     • If offlineOnlyMode = true  → force onlineSalesEnabled = false (no online sales).
//     • If onlineSalesEnabled = true → force offlineOnlyMode = false.
//   Returns the updated toggle states.

async function getOrCreateSettings(businessId: string) {
  const existing = await db.appSettings.findUnique({ where: { businessId } })
  if (existing) return existing
  return db.appSettings.create({ data: { businessId } })
}

export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }
    const settings = await getOrCreateSettings(business.id)
    return NextResponse.json({
      onlineSalesEnabled: settings.onlineSalesEnabled,
      offlineOnlyMode: settings.offlineOnlyMode,
      cloudSyncMode: settings.cloudSyncMode,
      telegramFileIdMode: settings.telegramFileIdMode,
      appMode: settings.appMode,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function PUT(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const body = await req.json() as {
      onlineSalesEnabled?: boolean
      offlineOnlyMode?: boolean
      cloudSyncMode?: boolean
      telegramFileIdMode?: boolean
    }

    // Resolve cross-coupled toggles.
    let onlineSalesEnabled = body.onlineSalesEnabled
    let offlineOnlyMode = body.offlineOnlyMode

    if (offlineOnlyMode === true) {
      // Offline-only mode implies no online sales.
      onlineSalesEnabled = false
    } else if (onlineSalesEnabled === true) {
      // Enabling online sales turns off offline-only mode.
      offlineOnlyMode = false
    }

    const updated = await db.appSettings.upsert({
      where: { businessId: business.id },
      update: {
        ...(onlineSalesEnabled !== undefined ? { onlineSalesEnabled } : {}),
        ...(offlineOnlyMode !== undefined ? { offlineOnlyMode } : {}),
        ...(body.cloudSyncMode !== undefined ? { cloudSyncMode: body.cloudSyncMode } : {}),
        ...(body.telegramFileIdMode !== undefined
          ? { telegramFileIdMode: body.telegramFileIdMode }
          : {}),
      },
      create: {
        businessId: business.id,
        onlineSalesEnabled: onlineSalesEnabled ?? true,
        offlineOnlyMode: offlineOnlyMode ?? false,
        cloudSyncMode: body.cloudSyncMode ?? false,
        telegramFileIdMode: body.telegramFileIdMode ?? false,
      },
    })

    return NextResponse.json({
      onlineSalesEnabled: updated.onlineSalesEnabled,
      offlineOnlyMode: updated.offlineOnlyMode,
      cloudSyncMode: updated.cloudSyncMode,
      telegramFileIdMode: updated.telegramFileIdMode,
      appMode: updated.appMode,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
