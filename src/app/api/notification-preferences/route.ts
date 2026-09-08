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

// §EXTRACTED-CORE: The core logic of the PUT handler, extracted into a
// testable function that takes businessId as a parameter. This is the same
// pattern used by /api/data-import (performImport takes targetBusinessId).
// The PUT route handler is a thin wrapper that calls this function.
//
// §TESTABILITY: Tests can call this function directly with a test businessId,
// bypassing getCurrentBusiness() (which requires cookies/next-headers).
// The route handler calls getCurrentBusiness() and passes the result.
export async function updateChannelPreference(
  businessId: string,
  key: string,
  value: boolean,
): Promise<{ ok: boolean; key?: string; value?: boolean; error?: string; status: number }> {
  // §VALIDATE: key must be a known channel, value must be boolean
  if (!key || !VALID_KEYS.includes(key as ChannelKey)) {
    return { ok: false, error: `Invalid key. Must be one of: ${VALID_KEYS.join(', ')}`, status: 400 }
  }
  if (typeof value !== 'boolean') {
    return { ok: false, error: 'value must be a boolean', status: 400 }
  }

  // §ATOMIC-UPSERT: Single SQL statement — INSERT ... ON CONFLICT UPDATE.
  await db.notificationChannelPreference.upsert({
    where: {
      businessId_key: { businessId, key },
    },
    update: { enabled: value },
    create: {
      businessId,
      key,
      enabled: value,
    },
  })

  return { ok: true, key, value, status: 200 }
}

// §EXTRACTED-CORE: The core logic of the GET handler.
export async function getChannelPreferences(
  businessId: string,
): Promise<{ channels: Record<string, boolean> }> {
  const prefs = await db.notificationChannelPreference.findMany({
    where: { businessId },
    select: { key: true, enabled: true },
  })

  const channels: Record<string, boolean> = { ...DEFAULT_CHANNELS }
  for (const pref of prefs) {
    channels[pref.key] = pref.enabled
  }

  return { channels }
}

// PUT /api/notification-preferences
// Body: { key: 'sales', value: false }
// Returns: { ok: true, key, value }
export async function PUT(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()
    const { key, value } = body

    const result = await updateChannelPreference(business.id, key, value)

    if (result.ok) {
      return NextResponse.json({ ok: true, key: result.key, value: result.value })
    } else {
      return NextResponse.json({ error: result.error }, { status: result.status })
    }
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

    const { channels } = await getChannelPreferences(business.id)

    return NextResponse.json({ channels })
  } catch (e) {
    return apiError(e, 'Failed to fetch notification preferences')
  }
}
