import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'
import { apiError } from '@/lib/api-error'

// POST /api/biometric — register or recognize a fingerprint
// Body: { action: 'register' | 'recognize', partyId?, hash }
// In production, this would use a real fingerprint scanner SDK.
// Here we simulate with a hash + lookup.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Generate a simulated fingerprint hash (in production, scanner SDK provides this)
    const rawHash = body.hash || randomBytes(32).toString('hex')
    // §SECURITY: Use NEXTAUTH_SECRET from env. If not set, use a non-obvious fallback.
    const secret = process.env.NEXTAUTH_SECRET || 'bizledger-fb2a7c9e-bio-salt-v1'
    const fingerprintHash = createHash('sha256').update(rawHash + secret).digest('hex')

    if (body.action === 'register') {
      if (!body.partyId) return NextResponse.json({ error: 'partyId required for register' }, { status: 400 })

      // Check if already registered
      const existing = await db.fingerprintRecord.findUnique({ where: { fingerprintHash } })
      if (existing) {
        return NextResponse.json({ ok: false, message: 'Fingerprint already registered', partyId: existing.partyId })
      }

      const record = await db.fingerprintRecord.create({
        data: {
          fingerprintHash,
          partyId: body.partyId,
          businessId: business.id,
          hand: body.hand || 'right',
          finger: body.finger || 'thumb',
        },
      })

      // Enable biometric in settings
      await db.appSettings.updateMany({
        where: { businessId: business.id },
        data: { biometricEnabled: true },
      })

      return NextResponse.json({ ok: true, message: 'Fingerprint registered', recordId: record.id })
    }

    if (body.action === 'recognize') {
      const record = await db.fingerprintRecord.findUnique({
        where: { fingerprintHash },
        include: { party: true },
      })

      if (!record) {
        return NextResponse.json({ ok: false, recognized: false, message: 'Fingerprint not recognized' })
      }

      return NextResponse.json({
        ok: true,
        recognized: true,
        party: record.party ? {
          id: record.party.id,
          name: record.party.name,
          phone: record.party.phone,
          balance: record.party.balance,
          qualityGrade: record.party.qualityGrade,
        } : null,
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// GET /api/biometric — check if biometric is enabled
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ enabled: false })

  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  const count = await db.fingerprintRecord.count({ where: { businessId: business.id } })

  return NextResponse.json({
    enabled: settings?.biometricEnabled ?? false,
    registeredFingerprints: count,
  })
}
