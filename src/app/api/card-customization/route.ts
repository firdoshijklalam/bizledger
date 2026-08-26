import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §ATOMIC-CARD-SAVE: POST /api/card-customization
//
// Saves ALL card customization fields (logo, cover, preferences) in ONE
// Prisma $transaction. If any part fails, everything rolls back — no
// partial-save state.
//
// §RBAC: Only OWNER/ADMIN can modify card customization.
// §TENANT-ISOLATION: businessId derived from session, never from client.
//
// Body:
//   {
//     logoUrl?: string | null,      // base64 data URL or null to remove
//     coverUrl?: string | null,     // base64 data URL, CSS gradient, or null
//     cardPreferences?: string      // JSON string: {showOwner,showAddress,showPhone,showGstin,greetingText,coverBlur,coverOverlay}
//   }
//
// All fields are optional — only provided fields are updated.
// cardPreferences is validated server-side via validateCardPreferences.

export const maxDuration = 15

// §VALIDATE-CARD-PREFERENCES: Defensive parse + allow-list.
// Mirrors the validation in app-settings route for consistency.
function validateCardPreferences(input: unknown): string | null {
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

  const clean: Record<string, unknown> = {}
  const BOOL_KEYS = ['showOwner', 'showAddress', 'showPhone', 'showGstin'] as const
  for (const key of BOOL_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }
  if ('greetingText' in prefs && typeof prefs.greetingText === 'string') {
    clean.greetingText = prefs.greetingText.trim().slice(0, 30)
  }
  if ('coverBlur' in prefs && typeof prefs.coverBlur === 'number' && !isNaN(prefs.coverBlur)) {
    clean.coverBlur = Math.max(0, Math.min(20, Math.round(prefs.coverBlur)))
  }
  if ('coverOverlay' in prefs && typeof prefs.coverOverlay === 'number' && !isNaN(prefs.coverOverlay)) {
    clean.coverOverlay = Math.max(0, Math.min(0.9, Math.round(prefs.coverOverlay * 100) / 100))
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Only OWNER/ADMIN can modify card customization
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business' }, { status: 400 })
    }

    const body = await req.json()

    // §INPUT-VALIDATION: Validate logoUrl and coverUrl before transaction.
    // Accept: null (remove), data:image/* (uploaded image),
    // linear-gradient(...) (suggested CSS cover), or undefined (no change).
    // Reject: arbitrary strings, oversized payloads.
    const MAX_IMAGE_SIZE = 500 * 1024 // 500KB base64 string limit
    function validateImageUrl(val: unknown, fieldName: string): void {
      if (val === null) return
      if (typeof val !== 'string') {
        throw new Error(`Invalid ${fieldName}: must be string or null`)
      }
      if (val.length > MAX_IMAGE_SIZE) {
        throw new Error(`${fieldName} too large (max 500KB)`)
      }
      // Accept data: URLs (uploaded images) and linear-gradient (CSS presets)
      if (!val.startsWith('data:image/') && !val.startsWith('linear-gradient(')) {
        throw new Error(`Invalid ${fieldName} format`)
      }
    }

    if (body.logoUrl !== undefined) {
      validateImageUrl(body.logoUrl, 'logoUrl')
    }
    if (body.coverUrl !== undefined) {
      validateImageUrl(body.coverUrl, 'coverUrl')
    }

    // §ATOMIC-TRANSACTION: Update Business + AppSettings inside ONE Prisma
    // $transaction. If any part fails, everything rolls back.
    const result = await db.$transaction(async (tx) => {
      // 1. Update Business fields (logoUrl, coverUrl) if provided
      const businessData: Record<string, unknown> = {}
      if (body.logoUrl !== undefined) {
        // null = remove, string = set new value
        businessData.logoUrl = body.logoUrl
      }
      if (body.coverUrl !== undefined) {
        businessData.coverUrl = body.coverUrl
      }

      let updatedBusiness: any = null
      if (Object.keys(businessData).length > 0) {
        updatedBusiness = await tx.business.update({
          where: { id: business.id },
          data: businessData,
        })
      }

      // 2. Update AppSettings.cardPreferences if provided
      let updatedSettings: any = null
      if (body.cardPreferences !== undefined) {
        const validated = validateCardPreferences(body.cardPreferences)
        updatedSettings = await tx.appSettings.upsert({
          where: { businessId: business.id },
          update: {
            cardPreferences: validated,
          },
          create: {
            businessId: business.id,
            cardPreferences: validated,
          },
        })
      }

      return { business: updatedBusiness, settings: updatedSettings }
    })

    // §RESPONSE: Return both updated entities (serialized for Decimal fields)
    return NextResponse.json({
      ok: true,
      business: result.business ? serializeDecimals(result.business) : null,
      settings: result.settings ? serializeDecimals(result.settings) : null,
    })
  } catch (e) {
    return apiError(e, 'Card customization save failed')
  }
}
