import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// PRD Part 37 §3.2 — Switch between customer and merchant mode
// POST /api/profile/mode
//   Body: { phone, targetMode: 'customer' | 'merchant', pin? }
//   Logic:
//     • Find UserProfile by phone. 404 if not found.
//     • targetMode = 'merchant':
//         - If pinEnabled is true but no pin provided → 400 "PIN required".
//         - Verify pin (hash compare). 401 on mismatch.
//         - Set AppSettings.appMode = 'merchant'.
//     • targetMode = 'customer':
//         - No PIN required.
//         - Set AppSettings.appMode = 'customer'.
//     • Return { ok: true, mode: targetMode }
//
// GET /api/profile/mode
//   Returns the current appMode from AppSettings for the current business.

function hashPin(pin: string): string {
  return createHash('sha256')
    .update(pin + (process.env.NEXTAUTH_SECRET || 'bizledger-salt'))
    .digest('hex')
}

export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ appMode: 'merchant' }, { status: 200 })
    }
    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    if (!settings) {
      return NextResponse.json({ appMode: 'merchant' }, { status: 200 })
    }
    return NextResponse.json({ appMode: settings.appMode })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      phone: string
      targetMode: 'customer' | 'merchant'
      pin?: string
    }

    if (!body.phone || !body.targetMode) {
      return NextResponse.json(
        { error: 'phone and targetMode are required' },
        { status: 400 }
      )
    }

    if (body.targetMode !== 'customer' && body.targetMode !== 'merchant') {
      return NextResponse.json(
        { error: "targetMode must be 'customer' or 'merchant'" },
        { status: 400 }
      )
    }

    const profile = await db.userProfile.findUnique({ where: { phone: body.phone } })
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    if (body.targetMode === 'merchant') {
      // PIN gate: required if pinEnabled is true.
      if (profile.pinEnabled) {
        if (!body.pin) {
          return NextResponse.json(
            { error: 'PIN required' },
            { status: 400 }
          )
        }
        const providedHash = hashPin(body.pin)
        if (providedHash !== profile.pinHash) {
          return NextResponse.json(
            { error: 'Invalid PIN' },
            { status: 401 }
          )
        }
      }
    }

    // Switch AppSettings.appMode for the current business.
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    await db.appSettings.upsert({
      where: { businessId: business.id },
      update: { appMode: body.targetMode },
      create: { businessId: business.id, appMode: body.targetMode },
    })

    return NextResponse.json({ ok: true, mode: body.targetMode })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
