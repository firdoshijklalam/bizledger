import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { createHash } from 'crypto'

// Biometric action gate verification (PRD Part 32 §1).
// POST  — verify a PIN or fingerprint attempt against the 5 action gates.
// GET   — return current lockdown status + last 10 gate log entries.

type GateType =
  | 'owner_switch'
  | 'high_value_discount'
  | 'data_export'
  | 'inventory_price'
  | 'danger_zone'

function hashPin(pin: string): string {
  return createHash('sha256')
    .update(pin + (process.env.NEXTAUTH_SECRET || 'salt'))
    .digest('hex')
}

async function logGate(args: {
  businessId: string
  gateType: GateType
  method: string
  result: 'success' | 'failed' | 'locked'
  staffName?: string
  metadata?: any
}) {
  return db.biometricGateLog.create({
    data: {
      businessId: args.businessId,
      gateType: args.gateType,
      method: args.method,
      result: args.result,
      staffName: args.staffName ?? null,
      metadata: args.metadata ? JSON.stringify(args.metadata) : null,
    },
  })
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const gateType = body.gateType as GateType
    const method = body.method as 'biometric' | 'pin'
    const pin: string | undefined = body.pin
    const fingerprintHash: string | undefined = body.fingerprintHash
    const staffName: string | undefined = body.staffName
    const metadata: any = body.metadata

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business' }, { status: 400 })
    }

    const settings = await db.appSettings.findUnique({
      where: { businessId: business.id },
    })
    if (!settings) {
      return NextResponse.json({ error: 'Settings not found' }, { status: 404 })
    }

    // 1. Lockdown check — if still in the future, reject attempt.
    if (
      settings.gateLockdownUntil &&
      settings.gateLockdownUntil.getTime() > Date.now()
    ) {
      const ms = settings.gateLockdownUntil.getTime() - Date.now()
      const seconds = Math.ceil(ms / 1000)
      await logGate({
        businessId: business.id,
        gateType,
        method: 'lockdown',
        result: 'locked',
        staffName,
        metadata: { ...metadata, lockdownUntil: settings.gateLockdownUntil },
      })
      return NextResponse.json({
        ok: false,
        locked: true,
        lockdownUntil: settings.gateLockdownUntil,
        message: `Module locked down. Try again after ${seconds} seconds.`,
      })
    }

    // 2. PIN verification path.
    if (method === 'pin') {
      // §DEFAULT-PIN: If no PIN is set, use '123456' as the default testing PIN.
      // This allows the client to test the wholesale/inventory gate flows without
      // first configuring a PIN in Settings → Security. Once they set a custom PIN,
      // this fallback is no longer used.
      const DEFAULT_TEST_PIN = '123456'
      const effectivePinHash = settings.pinHash || hashPin(DEFAULT_TEST_PIN)
      const isPinEnabled = settings.pinEnabled || !settings.pinHash // enabled if explicitly set OR if no pin set yet (use default)

      if (!isPinEnabled) {
        await logGate({
          businessId: business.id,
          gateType,
          method: 'pin',
          result: 'failed',
          staffName,
          metadata: { reason: 'pin_not_set' },
        })
        return NextResponse.json({
          ok: false,
          verified: false,
          message: 'PIN is not set. Configure it in Settings → Security.',
        })
      }

      if (!pin || hashPin(pin) !== effectivePinHash) {
        // Threat 4: Exponential backoff brute-force protection
        const { recordFailedPINAttempt, getLockoutMessage, getClientIP } = await import('@/lib/security')
        const clientIP = getClientIP(req)
        const failResult = recordFailedPINAttempt(clientIP)

        await logGate({
          businessId: business.id,
          gateType,
          method: 'pin',
          result: failResult.locked ? 'locked' : 'failed',
          staffName,
          metadata: { ...metadata, lockoutLevel: failResult.lockoutLevel },
        })

        if (failResult.locked) {
          // Update AppSettings lockdown timestamp
          await db.appSettings.update({
            where: { businessId: business.id },
            data: { gateLockdownUntil: failResult.lockedUntil ? new Date(failResult.lockedUntil) : null },
          })

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
          ok: false,
          verified: false,
          message: 'Wrong PIN',
        })
      }

      // Success — clear lockdown + reset brute-force counter.
      const { resetBruteForce, getClientIP: getIP } = await import('@/lib/security')
      resetBruteForce(getIP(req))
      await db.appSettings.update({
        where: { businessId: business.id },
        data: { gateLockdownUntil: null },
      })
      await logGate({
        businessId: business.id,
        gateType,
        method: 'pin',
        result: 'success',
        staffName,
        metadata,
      })
      return NextResponse.json({
        ok: true,
        verified: true,
        method: 'pin',
        staffName: staffName ?? 'Owner',
      })
    }

    // 3. Biometric verification path.
    if (method === 'biometric') {
      let record: any = null
      if (fingerprintHash) {
        record = await db.fingerprintRecord.findUnique({
          where: { fingerprintHash },
          include: { party: true },
        })
      } else {
        // Demo fallback: accept any registered "primary" fingerprint so the
        // simulator button on the client can complete a gate flow.
        record = await db.fingerprintRecord.findFirst({
          where: { businessId: business.id, role: 'primary' },
          include: { party: true },
        })
      }

      if (!record) {
        await logGate({
          businessId: business.id,
          gateType,
          method: 'biometric',
          result: 'failed',
          staffName,
          metadata: { fingerprintHash: fingerprintHash ?? null },
        })
        return NextResponse.json({
          ok: false,
          verified: false,
          message: 'Fingerprint not recognized',
        })
      }

      // Success — clear lockdown.
      await db.appSettings.update({
        where: { businessId: business.id },
        data: { gateLockdownUntil: null },
      })
      await logGate({
        businessId: business.id,
        gateType,
        method: 'biometric',
        result: 'success',
        staffName:
          staffName ?? record.linkedName ?? record.party?.name ?? 'Owner',
        metadata: {
          ...metadata,
          fingerprintRecordId: record.id,
          role: record.role,
          linkedName: record.linkedName,
        },
      })
      return NextResponse.json({
        ok: true,
        verified: true,
        method: 'biometric',
        party: record.party
          ? {
              id: record.party.id,
              name: record.party.name,
              phone: record.party.phone,
              balance: record.party.balance,
              qualityGrade: record.party.qualityGrade,
            }
          : null,
        fingerprint: {
          role: record.role,
          linkedName: record.linkedName,
          relation: record.relation,
          scannerType: record.scannerType,
        },
      })
    }

    return NextResponse.json(
      { error: 'Invalid method. Use "biometric" or "pin".' },
      { status: 400 }
    )
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

// GET — current lockdown status + 10 most recent gate log entries.
export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ lockdownActive: false, logs: [] })
    }
    const settings = await db.appSettings.findUnique({
      where: { businessId: business.id },
    })
    const lockdownUntil = settings?.gateLockdownUntil ?? null
    const lockdownActive =
      !!lockdownUntil && lockdownUntil.getTime() > Date.now()

    const logs = await db.biometricGateLog.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    })

    return NextResponse.json({
      lockdownActive,
      lockdownUntil,
      remainingSeconds: lockdownActive
        ? Math.ceil((lockdownUntil!.getTime() - Date.now()) / 1000)
        : 0,
      logs: logs.map((l) => ({
        ...l,
        metadata: l.metadata ? safeParse(l.metadata) : null,
      })),
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}

function safeParse(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}
