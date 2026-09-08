import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §NOTIFICATION-PREFERENCES: Dedicated endpoint for notification channel
// preferences using NORMALIZED per-channel rows.
//
// §CONCURRENCY-MODEL:
// Each channel is a separate row in NotificationChannelPreference.
// Updates use Prisma's `upsert` which is a single SQL statement
// (INSERT ... ON CONFLICT UPDATE) — no read-modify-write, no race.
// Two concurrent updates to DIFFERENT keys touch different rows and
// cannot overwrite each other.
// Two concurrent updates to the SAME key: last-write-wins (the
// INSERT ... ON CONFLICT UPDATE atomically sets the value).
//
// §TENANT-ISOLATION: businessId is derived from getCurrentBusiness().
//
// §SCOPE: Preferences are BUSINESS-scoped. Any authenticated user of the
// business can modify them — this is a UI preference, not security-sensitive.

const VALID_KEYS = ['sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups'] as const
type ChannelKey = typeof VALID_KEYS[number]

const DEFAULT_CHANNELS: Record<string, boolean> = {
  sales: true, lowStock: true, overduePayments: true,
  gradeChanges: true, backups: true,
}

// PUT /api/notification-preferences
// Body: { key: 'sales', value: false }
// Returns: { ok: true, channels: {...} } (full effective channel map after update)
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

    // §ATOMIC-UPSERT: Single SQL statement — INSERT ... ON CONFLICT UPDATE.
    // No read-modify-write. No race condition. The `enabled` column is set
    // atomically for this specific (businessId, key) row.
    await db.notificationChannelPreference.upsert({
      where: {
        businessId_key: { businessId: business.id, key: key as string },
      },
      update: { enabled: value },
      create: {
        businessId: business.id,
        key: key as string,
        enabled: value,
      },
    })

    // §RETURN-SINGLE-KEY: Return only the updated key+value, NOT the full
    // channel map. This prevents a stale-response race where a concurrent
    // update to a different key could be overwritten in the client.
    // The client merges only the mutated key into its local state.
    return NextResponse.json({ ok: true, key, value })
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

    const prefs = await db.notificationChannelPreference.findMany({
      where: { businessId: business.id },
      select: { key: true, enabled: true },
    })

    // §DEFAULTS: Missing rows mean the channel is enabled by default.
    const channels: Record<string, boolean> = { ...DEFAULT_CHANNELS }
    for (const pref of prefs) {
      channels[pref.key] = pref.enabled
    }

    return NextResponse.json({ channels })
  } catch (e) {
    return apiError(e, 'Failed to fetch notification preferences')
  }
}
