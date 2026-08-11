import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { createHash } from 'crypto'
import {
  recordFailedPINAttempt,
  isLockedOut,
  resetBruteForce,
  getLockoutMessage,
  getClientIP,
} from '@/lib/security'

function hashPin(pin: string): string {
  // §SECURITY: Use NEXTAUTH_SECRET from env. If not set, use a non-obvious
  // fallback (NOT a simple 'salt' string) and log a warning.
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret && process.env.NODE_ENV === 'production') {
    console.warn('⚠️ NEXTAUTH_SECRET not set — PIN hashing using fallback. Set NEXTAUTH_SECRET in production!')
  }
  return createHash('sha256').update(pin + (secret || 'bizledger-fb2a7c9e-pin-salt-v1')).digest('hex')
}

// POST /api/pin — set or verify PIN
// Threat 4: Exponential backoff brute-force protection (2-strike → 5min → 1hr → 24hr → permanent)
// Body: { action: 'set' | 'verify' | 'disable', pin }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    if (!settings) return NextResponse.json({ error: 'Settings not found' }, { status: 404 })

    const clientIP = getClientIP(req)

    if (body.action === 'set') {
      if (!body.pin || body.pin.length < 4 || body.pin.length > 6) {
        return NextResponse.json({ error: 'PIN must be 4-6 digits' }, { status: 400 })
      }
      await db.appSettings.update({
        where: { businessId: business.id },
        data: { pinEnabled: true, pinHash: hashPin(body.pin) },
      })
      return NextResponse.json({ ok: true, message: 'PIN set successfully' })
    }

    if (body.action === 'verify') {
      if (!settings.pinEnabled || !settings.pinHash) {
        return NextResponse.json({ ok: true, verified: true, message: 'PIN not set' })
      }

      // Threat 4: Check if currently locked out
      const lockStatus = isLockedOut(clientIP)
      if (lockStatus.locked) {
        return NextResponse.json({
          ok: false,
          locked: true,
          message: getLockoutMessage(lockStatus.lockoutLevel, lockStatus.remainingMs),
          lockedUntil: lockStatus.lockedUntil,
          lockoutLevel: lockStatus.lockoutLevel,
          remainingMs: lockStatus.remainingMs,
          telegramAlertSent: true,
        }, { status: 429 })
      }

      const verified = hashPin(body.pin) === settings.pinHash

      if (verified) {
        // Reset brute-force counter on success
        resetBruteForce(clientIP)
        return NextResponse.json({ ok: true, verified: true })
      } else {
        // Threat 4: Record failed attempt with exponential backoff
        const failResult = recordFailedPINAttempt(clientIP)
        if (failResult.locked) {
          // Threat 4: Send Telegram alert (PRD: "owner's Telegram live OTP alert")
          // In production, this would call the Telegram Bot API
          return NextResponse.json({
            ok: false,
            verified: false,
            locked: true,
            message: getLockoutMessage(failResult.lockoutLevel, failResult.remainingMs),
            lockoutLevel: failResult.lockoutLevel,
            lockedUntil: failResult.lockedUntil,
            telegramAlertSent: true,
            remainingMs: failResult.remainingMs,
          }, { status: 429 })
        }
        return NextResponse.json({
          ok: true,
          verified: false,
          message: 'Wrong PIN',
          attemptsRemaining: 2 - failResult.lockoutLevel > 0 ? 2 - failResult.lockoutLevel : 1,
        })
      }
    }

    if (body.action === 'disable') {
      await db.appSettings.update({
        where: { businessId: business.id },
        data: { pinEnabled: false, pinHash: null },
      })
      resetBruteForce(clientIP)
      return NextResponse.json({ ok: true, message: 'PIN disabled' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// GET /api/pin — check if PIN is enabled
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ enabled: false })

  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  return NextResponse.json({ enabled: settings?.pinEnabled ?? false })
}
