import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §NOTIFICATION-PREFERENCES: Dedicated endpoint for notification channel
// preferences. Solves the fire-and-forget race condition:
// - The old approach (toggleChannel → fire-and-forget PUT /api/app-settings)
//   could lose writes or complete out of order.
// - This endpoint is SYNCHRONOUS: the caller awaits the response before
//   proceeding. This guarantees last-user-intent-wins on the server.
//
// §TENANT-ISOLATION: businessId is derived from getCurrentBusiness() —
// the client never sends it.
//
// §ARCHITECTURE: This is a MINIMAL endpoint that only touches the
// notificationChannels column of AppSettings. It does NOT require a full
// app-settings update (which would need OWNER/ADMIN RBAC and update many
// other fields). Any authenticated user can toggle their notification
// preferences — this is a UI preference, not a security-sensitive setting.

// PUT /api/notification-preferences
// Body: { channels: { sales: bool, lowStock: bool, ... } }
// Returns: { ok: true, channels: {...} }
export async function PUT(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()
    const channels = body.channels

    if (!channels || typeof channels !== 'object') {
      return NextResponse.json({ error: 'channels object required' }, { status: 400 })
    }

    // §VALIDATE: Only known boolean keys are accepted. Unknown keys are dropped.
    const VALID_KEYS = ['sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups'] as const
    const clean: Record<string, boolean> = {}
    for (const key of VALID_KEYS) {
      if (key in channels && typeof channels[key] === 'boolean') {
        clean[key] = channels[key]
      }
    }

    if (Object.keys(clean).length === 0) {
      return NextResponse.json({ error: 'No valid channel keys provided' }, { status: 400 })
    }

    // §MERGE: Read the current channels and merge with the new ones.
    // This ensures partial updates (e.g., only toggling 'sales') don't
    // wipe out other channel preferences.
    const existing = await db.appSettings.findUnique({
      where: { businessId: business.id },
      select: { notificationChannels: true },
    })

    let merged: Record<string, boolean>
    if (existing?.notificationChannels) {
      try {
        const parsed = typeof existing.notificationChannels === 'string'
          ? JSON.parse(existing.notificationChannels)
          : existing.notificationChannels
        merged = { ...parsed, ...clean }
      } catch {
        merged = { ...clean }
      }
    } else {
      merged = {
        sales: true, lowStock: true, overduePayments: true,
        gradeChanges: true, backups: true,
        ...clean,
      }
    }

    const channelsJson = JSON.stringify(merged)

    await db.appSettings.upsert({
      where: { businessId: business.id },
      update: { notificationChannels: channelsJson },
      create: {
        businessId: business.id,
        notificationChannels: channelsJson,
      },
    })

    return NextResponse.json({ ok: true, channels: merged })
  } catch (e) {
    return apiError(e, 'Failed to update notification preferences')
  }
}

// GET /api/notification-preferences
// Returns: { channels: { sales: bool, lowStock: bool, ... } }
export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const settings = await db.appSettings.findUnique({
      where: { businessId: business.id },
      select: { notificationChannels: true },
    })

    const defaultChannels = {
      sales: true, lowStock: true, overduePayments: true,
      gradeChanges: true, backups: true,
    }

    if (!settings?.notificationChannels) {
      return NextResponse.json({ channels: defaultChannels })
    }

    try {
      const parsed = typeof settings.notificationChannels === 'string'
        ? JSON.parse(settings.notificationChannels)
        : settings.notificationChannels
      return NextResponse.json({
        channels: { ...defaultChannels, ...parsed },
      })
    } catch {
      return NextResponse.json({ channels: defaultChannels })
    }
  } catch (e) {
    return apiError(e, 'Failed to fetch notification preferences')
  }
}
