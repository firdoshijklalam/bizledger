import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createHash } from 'crypto'

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + (process.env.NEXTAUTH_SECRET || 'bizledger-salt')).digest('hex')
}

// POST /api/pin — set or verify PIN
// Body: { action: 'set' | 'verify' | 'disable', pin }
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await db.business.findFirst()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    if (!settings) return NextResponse.json({ error: 'Settings not found' }, { status: 404 })

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
      const verified = hashPin(body.pin) === settings.pinHash
      return NextResponse.json({ ok: true, verified })
    }

    if (body.action === 'disable') {
      await db.appSettings.update({
        where: { businessId: business.id },
        data: { pinEnabled: false, pinHash: null },
      })
      return NextResponse.json({ ok: true, message: 'PIN disabled' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET /api/pin — check if PIN is enabled
export async function GET() {
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json({ enabled: false })

  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  return NextResponse.json({ enabled: settings?.pinEnabled ?? false })
}
