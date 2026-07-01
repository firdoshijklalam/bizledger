import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { createHash, randomBytes } from 'crypto'

// Fingerprint management (PRD Part 32 §2 + §4).
// GET    — list fingerprints for a party (?partyId=...).
// POST   — register a fingerprint with role/linkedName/relation/scannerType.
// DELETE — remove a fingerprint by ?id=...

function hashFingerprint(rawHash: string): string {
  return createHash('sha256')
    .update(rawHash + (process.env.NEXTAUTH_SECRET || 'salt'))
    .digest('hex')
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    if (!partyId) {
      return NextResponse.json(
        { error: 'partyId query parameter is required' },
        { status: 400 }
      )
    }
    const records = await db.fingerprintRecord.findMany({
      where: { partyId },
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json({ count: records.length, fingerprints: records })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    if (!body.partyId) {
      return NextResponse.json(
        { error: 'partyId is required' },
        { status: 400 }
      )
    }
    const role = (body.role ?? 'primary') as
      | 'primary'
      | 'family'
      | 'partner'
      | 'agent'
    const linkedName: string | undefined = body.linkedName
    const relation: string | undefined = body.relation

    // non-primary roles need a linkedName + relation for audit clarity.
    if (role !== 'primary' && !linkedName) {
      return NextResponse.json(
        { error: 'linkedName is required for non-primary roles' },
        { status: 400 }
      )
    }

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business' }, { status: 400 })
    }

    // Verify party belongs to business.
    const party = await db.party.findUnique({ where: { id: body.partyId } })
    if (!party || party.businessId !== business.id) {
      return NextResponse.json({ error: 'Party not found' }, { status: 404 })
    }

    // Hash generation — accept supplied hash (from native WebAuthn / external
    // scanner SDK) or generate a simulated one for demo mode.
    const rawHash = body.fingerprintHash || randomBytes(32).toString('hex')
    const fingerprintHash = hashFingerprint(rawHash)

    // Prevent duplicate registration.
    const existing = await db.fingerprintRecord.findUnique({
      where: { fingerprintHash },
    })
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          message: 'Fingerprint already registered',
          existingId: existing.id,
        },
        { status: 409 }
      )
    }

    const record = await db.fingerprintRecord.create({
      data: {
        fingerprintHash,
        partyId: body.partyId,
        businessId: business.id,
        hand: body.hand ?? 'right',
        finger: body.finger ?? 'thumb',
        role,
        linkedName: linkedName ?? null,
        relation: relation ?? null,
        scannerType: body.scannerType ?? 'native',
      },
    })

    // Ensure biometric is enabled in settings.
    await db.appSettings.updateMany({
      where: { businessId: business.id },
      data: { biometricEnabled: true },
    })

    return NextResponse.json({ ok: true, fingerprint: record })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) {
      return NextResponse.json(
        { error: 'id query parameter is required' },
        { status: 400 }
      )
    }
    const existing = await db.fingerprintRecord.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json(
        { error: 'Fingerprint record not found' },
        { status: 404 }
      )
    }
    await db.fingerprintRecord.delete({ where: { id } })
    return NextResponse.json({
      ok: true,
      message: 'Fingerprint removed',
      id,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
