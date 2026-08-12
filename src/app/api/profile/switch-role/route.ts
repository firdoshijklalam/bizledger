import { NextRequest, NextResponse } from 'next/server'
import { createHash } from 'crypto'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// PRD Part 37 §3.1 — "Become a Seller" flow
// POST /api/profile/switch-role
//   Body: { phone, customerName?, merchantName?, pin, biometricEnabled? }
//   Logic:
//     1. Find or create a UserProfile by phone.
//     2. Hash PIN with SHA-256 + salt.
//     3. Set role = 'dual'.
//     4. Set isSeller = true, sellerSince = now.
//     5. Set pinHash, pinEnabled = true, biometricEnabled.
//     6. If merchantName provided, set it. If merchantId not set, link to current business.
//     7. Return { ok, profile: { id, phone, role, isSeller, pinEnabled, biometricEnabled } }
//
// GET /api/profile/switch-role?phone=X
//   Returns the user's profile (or 404 if not found).

function hashPin(pin: string): string {
  return createHash('sha256')
    .update(pin + (process.env.NEXTAUTH_SECRET || 'bizledger-salt'))
    .digest('hex')
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const phone = searchParams.get('phone')?.trim()
    if (!phone) {
      return NextResponse.json({ error: 'phone query param required' }, { status: 400 })
    }
    const profile = await db.userProfile.findUnique({ where: { phone } })
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }
    return NextResponse.json({
      id: profile.id,
      phone: profile.phone,
      role: profile.role,
      merchantId: profile.merchantId,
      customerName: profile.customerName,
      merchantName: profile.merchantName,
      pinEnabled: profile.pinEnabled,
      biometricEnabled: profile.biometricEnabled,
      isSeller: profile.isSeller,
      sellerSince: profile.sellerSince,
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

    const body = await req.json() as {
      phone: string
      customerName?: string
      merchantName?: string
      pin: string
      biometricEnabled?: boolean
    }

    if (!body.phone || !body.pin) {
      return NextResponse.json(
        { error: 'phone and pin are required' },
        { status: 400 }
      )
    }
    const pinHash = hashPin(body.pin)
    const biometricEnabled = body.biometricEnabled ?? false
    const now = new Date()

    // Find existing profile to preserve merchantId if already linked.
    const existing = await db.userProfile.findUnique({ where: { phone: body.phone } })

    // If no merchantId is set yet, link to current business (Sharma Trading Co.).
    const merchantId = existing?.merchantId ?? business?.id ?? null

    const profile = await db.userProfile.upsert({
      where: { phone: body.phone },
      update: {
        role: 'dual',
        isSeller: true,
        sellerSince: now,
        pinHash,
        pinEnabled: true,
        biometricEnabled,
        ...(body.customerName ? { customerName: body.customerName } : {}),
        ...(body.merchantName ? { merchantName: body.merchantName } : {}),
        ...(merchantId ? { merchantId } : {}),
      },
      create: {
        phone: body.phone,
        role: 'dual',
        customerName: body.customerName ?? null,
        merchantName: body.merchantName ?? null,
        merchantId,
        pinHash,
        pinEnabled: true,
        biometricEnabled,
        isSeller: true,
        sellerSince: now,
      },
    })

    return NextResponse.json({
      ok: true,
      profile: {
        id: profile.id,
        phone: profile.phone,
        role: profile.role,
        isSeller: profile.isSeller,
        pinEnabled: profile.pinEnabled,
        biometricEnabled: profile.biometricEnabled,
      },
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
