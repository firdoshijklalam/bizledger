import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/app-settings
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json(null)
  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  if (!settings) {
    const created = await db.appSettings.create({ data: { businessId: business.id } })
    // §DECIMAL-FIX-D: gateDiscountLimit is Decimal
    return NextResponse.json(serializeDecimals(created))
  }
  // §DECIMAL-FIX-D: gateDiscountLimit is Decimal
  return NextResponse.json(serializeDecimals(settings))
}

// PUT /api/app-settings
// §RBAC: Modifying app settings (PIN, biometric gates, invoice prefix,
// external scanner, defaulter registry) is an OWNER/ADMIN action. STAFF
// must not be able to flip these toggles or change the invoice prefix
// (which is used to generate sequential invoice numbers).
export async function PUT(req: NextRequest) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §REWARD-THRESHOLD-VALIDATION: Validate the configurable profit threshold
    // for reward-cycle unlock. Must be a finite positive number within sensible
    // bounds. Default is ₹400 (schema @default(400)). Lower bound ₹1 (a positive
    // amount; 0 would unlock immediately on any profit), upper bound ₹10,00,000
    // (₹10 lakh — prevents abusive/absurd values while allowing any realistic
    // merchant threshold). businessId is derived from the authenticated session
    // via getCurrentBusiness() — NEVER from the client body (tenant isolation).
    // §SNAPSHOT-INVARIANT: Changing this global setting does NOT mutate existing
    // CustomerRewardCycle.threshold (a snapshot taken at cycle creation). The
    // new value only affects NEW cycles created after the change.
    const REWARD_THRESHOLD_MIN = 1
    const REWARD_THRESHOLD_MAX = 1_000_000
    let rewardThreshold: number | undefined
    if (body.rewardThreshold !== undefined) {
      const n = Number(body.rewardThreshold)
      if (!Number.isFinite(n) || n < REWARD_THRESHOLD_MIN || n > REWARD_THRESHOLD_MAX) {
        return NextResponse.json(
          { error: `Reward threshold must be a finite positive number between ₹${REWARD_THRESHOLD_MIN} and ₹${REWARD_THRESHOLD_MAX}` },
          { status: 400 }
        )
      }
      // Round to 2 decimal places (Prisma Decimal(18,2)) — safe for INR (paise).
      rewardThreshold = Math.round(n * 100) / 100
    }

    const updated = await db.appSettings.upsert({
      where: { businessId: business.id },
      update: {
        notificationsEnabled: body.notificationsEnabled,
        // §NOTIFICATION-CHANNELS: Per-channel notification preferences (JSON string).
        // Synced from the client Zustand store. The server reads this to
        // decide whether to generate specific notification types.
        notificationChannels: body.notificationChannels !== undefined
          ? validateNotificationChannels(body.notificationChannels)
          : undefined,
        autoBackupEnabled: body.autoBackupEnabled,
        language: body.language,
        dateFormat: body.dateFormat,
        invoicePrefix: body.invoicePrefix,
        pinEnabled: body.pinEnabled,
        userRole: body.userRole,
        biometricEnabled: body.biometricEnabled,
        // PRD Part 32 §1: Biometric action gates config
        gateOwnerSwitch: body.gateOwnerSwitch,
        gateHighValueDiscount: body.gateHighValueDiscount,
        gateDiscountLimit: body.gateDiscountLimit,
        // §REWARD-THRESHOLD: configurable profit threshold for reward cycle.
        // Only included when the client sent it (undefined → Prisma leaves the
        // existing value untouched, preserving unrelated fields).
        rewardThreshold,
        gateDataExport: body.gateDataExport,
        gateInventoryPrice: body.gateInventoryPrice,
        gateDangerZone: body.gateDangerZone,
        // PRD Part 32 §2: External scanner
        externalScannerEnabled: body.externalScannerEnabled,
        // PRD Part 32 §3: Defaulter registry
        defaulterRegistryEnabled: body.defaulterRegistryEnabled,
        // §CARD-PREFERENCES: JSON string with show/hide toggles. Defensive parse:
        // only accept if it's a valid JSON string containing known boolean keys.
        cardPreferences: body.cardPreferences !== undefined
          ? validateCardPreferences(body.cardPreferences)
          : undefined,
      },
      create: {
        businessId: business.id,
        notificationsEnabled: body.notificationsEnabled ?? true,
        notificationChannels: body.notificationChannels !== undefined
          ? validateNotificationChannels(body.notificationChannels)
          : null,
        autoBackupEnabled: body.autoBackupEnabled ?? false,
        language: body.language ?? 'en',
        dateFormat: body.dateFormat ?? 'DD/MM/YYYY',
        invoicePrefix: body.invoicePrefix ?? 'INV',
        pinEnabled: body.pinEnabled ?? false,
        userRole: body.userRole ?? 'owner',
        biometricEnabled: body.biometricEnabled ?? false,
        gateOwnerSwitch: body.gateOwnerSwitch ?? true,
        gateHighValueDiscount: body.gateHighValueDiscount ?? true,
        gateDiscountLimit: body.gateDiscountLimit ?? 5000,
        rewardThreshold: rewardThreshold ?? 400,
        gateDataExport: body.gateDataExport ?? true,
        gateInventoryPrice: body.gateInventoryPrice ?? true,
        gateDangerZone: body.gateDangerZone ?? true,
        externalScannerEnabled: body.externalScannerEnabled ?? false,
        defaulterRegistryEnabled: body.defaulterRegistryEnabled ?? true,
        cardPreferences: body.cardPreferences !== undefined
          ? validateCardPreferences(body.cardPreferences)
          : null,
      },
    })
    // §DECIMAL-FIX-D: gateDiscountLimit is Decimal
    return NextResponse.json(serializeDecimals(updated))
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// §CARD-PREFERENCES-VALIDATION: Defensive parse + allow-list.
// Accepts a JSON string or object. Only known keys with correct types are persisted.
// Malformed JSON, invalid types, or unknown keys are silently dropped.
// Returns a JSON string safe for Prisma storage, or null if empty.
function validateCardPreferences(input: unknown): string | null {
  let prefs: Record<string, unknown> = {}
  if (typeof input === 'string') {
    try {
      prefs = JSON.parse(input)
    } catch {
      return null // malformed JSON → fall back to null (defaults)
    }
  } else if (typeof input === 'object' && input !== null) {
    prefs = input as Record<string, unknown>
  } else {
    return null
  }

  const clean: Record<string, unknown> = {}

  // §VISIBILITY-TOGGLES: boolean only
  const BOOL_KEYS = ['showOwner', 'showAddress', 'showPhone', 'showGstin'] as const
  for (const key of BOOL_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }

  // §GREETING-TEXT: string, trimmed, max 30 chars
  if ('greetingText' in prefs && typeof prefs.greetingText === 'string') {
    const trimmed = prefs.greetingText.trim().slice(0, 30)
    clean.greetingText = trimmed
  }

  // §COVER-BLUR: number 0–20, default 8
  if ('coverBlur' in prefs && typeof prefs.coverBlur === 'number' && !isNaN(prefs.coverBlur)) {
    clean.coverBlur = Math.max(0, Math.min(20, Math.round(prefs.coverBlur)))
  }

  // §COVER-OVERLAY: number 0–0.9, default 0.35
  if ('coverOverlay' in prefs && typeof prefs.coverOverlay === 'number' && !isNaN(prefs.coverOverlay)) {
    clean.coverOverlay = Math.max(0, Math.min(0.9, Math.round(prefs.coverOverlay * 100) / 100))
  }

  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}

// §NOTIFICATION-CHANNELS-VALIDATION: Validates the notificationChannels JSON.
// Accepts a JSON string or object. Only known boolean keys are persisted.
// Returns a JSON string safe for Prisma storage, or null if empty.
function validateNotificationChannels(input: unknown): string | null {
  let prefs: Record<string, unknown> = {}
  if (typeof input === 'string') {
    try {
      prefs = JSON.parse(input)
    } catch {
      return null
    }
  } else if (typeof input === 'object' && input !== null) {
    prefs = input as Record<string, unknown>
  } else {
    return null
  }

  const clean: Record<string, boolean> = {}
  const VALID_KEYS = ['sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups'] as const
  for (const key of VALID_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }

  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}
