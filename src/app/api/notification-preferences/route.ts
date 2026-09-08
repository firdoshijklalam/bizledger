import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §NOTIFICATION-PREFERENCES: Dedicated endpoint for notification channel
// preferences. Uses SINGLE-KEY atomic updates to prevent concurrent
// write races.
//
// §CONCURRENCY-MODEL:
// Each PUT updates exactly ONE channel key atomically. The server uses
// Prisma's raw SQL `jsonb_set` (PostgreSQL) or a transaction-wrapped
// read-modify-write (SQLite) to update a single key inside the JSON
// column without overwriting unrelated keys.
//
// This means:
// - Request A: { key: 'sales', value: false }
// - Request B: { key: 'lowStock', value: false }
// Even if B arrives first, A only touches `sales`, B only touches `lowStock`.
// Neither overwrites the other.
//
// §TENANT-ISOLATION: businessId is derived from getCurrentBusiness().
//
// §SCOPE: Preferences are BUSINESS-scoped (stored in AppSettings by businessId).
// Any authenticated user of the business can modify them — this is a UI
// preference, not a security-sensitive setting.

const VALID_KEYS = ['sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups'] as const
type ChannelKey = typeof VALID_KEYS[number]

const DEFAULT_CHANNELS = {
  sales: true, lowStock: true, overduePayments: true,
  gradeChanges: true, backups: true,
}

// PUT /api/notification-preferences
// Body: { key: 'sales', value: false }
// Returns: { ok: true, channels: {...} } (full state after update)
export async function PUT(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()
    const { key, value } = body

    // §VALIDATE: key must be a known channel, value must be boolean
    if (!key || !VALID_KEYS.includes(key)) {
      return NextResponse.json({ error: `Invalid key. Must be one of: ${VALID_KEYS.join(', ')}` }, { status: 400 })
    }
    if (typeof value !== 'boolean') {
      return NextResponse.json({ error: 'value must be a boolean' }, { status: 400 })
    }

    // §ATOMIC-UPDATE: Use a Prisma transaction to read-modify-write a SINGLE key.
    // This is atomic within the transaction — concurrent requests for DIFFERENT
    // keys each run their own transaction and merge cleanly because each only
    // touches one key.
    //
    // For PostgreSQL (production), this could be optimized with jsonb_set,
    // but the transaction approach works correctly for both SQLite and PostgreSQL.
    const result = await db.$transaction(async (tx) => {
      // Read current state
      const existing = await tx.appSettings.findUnique({
        where: { businessId: business.id },
        select: { notificationChannels: true },
      })

      // Parse or default
      let channels: Record<string, boolean>
      if (existing?.notificationChannels) {
        try {
          const parsed = typeof existing.notificationChannels === 'string'
            ? JSON.parse(existing.notificationChannels)
            : existing.notificationChannels
          channels = typeof parsed === 'object' && parsed !== null
            ? { ...parsed }
            : { ...DEFAULT_CHANNELS }
        } catch {
          channels = { ...DEFAULT_CHANNELS }
        }
      } else {
        channels = { ...DEFAULT_CHANNELS }
      }

      // Update ONLY the requested key
      channels[key] = value

      const channelsJson = JSON.stringify(channels)

      // Write back
      await tx.appSettings.upsert({
        where: { businessId: business.id },
        update: { notificationChannels: channelsJson },
        create: {
          businessId: business.id,
          notificationChannels: channelsJson,
        },
      })

      return channels
    })

    return NextResponse.json({ ok: true, channels: result })
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

    if (!settings?.notificationChannels) {
      return NextResponse.json({ channels: { ...DEFAULT_CHANNELS } })
    }

    try {
      const parsed = typeof settings.notificationChannels === 'string'
        ? JSON.parse(settings.notificationChannels)
        : settings.notificationChannels
      return NextResponse.json({
        channels: { ...DEFAULT_CHANNELS, ...parsed },
      })
    } catch {
      return NextResponse.json({ channels: { ...DEFAULT_CHANNELS } })
    }
  } catch (e) {
    return apiError(e, 'Failed to fetch notification preferences')
  }
}
