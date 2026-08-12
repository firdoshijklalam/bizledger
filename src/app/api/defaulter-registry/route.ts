import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth/session'
import { apiError } from '@/lib/api-error'

// Shared Defaulter Registry (PRD Part 32 §3).
// GET  — lookup by fingerprintHash / phone / name; ?action=seed seeds 3 demo
//        defaulters if registry is empty. If no params, returns last 20.
//        PUBLIC: read-only lookup is a shared safety feature for all merchants.
// POST — add a defaulter entry. §RBAC: OWNER/ADMIN only — adding someone to a
//        shared defaulter registry is a serious reputation-affecting action
//        and must not be exposed to unprivileged callers.

const SEED_DEFAULTERS = [
  {
    partyName: 'Rahul Verma',
    partyPhone: '9876543210',
    defaultAmount: 12500,
    merchantName: 'Sen Enterprise',
    merchantArea: 'Bhowanipore',
    notes: 'Multiple reminders ignored. Last invoice unpaid 90+ days.',
  },
  {
    partyName: 'Kavita Singh',
    partyPhone: '9811122233',
    defaultAmount: 8200,
    merchantName: 'Sharma Trading Co.',
    merchantArea: 'Gariahat',
    notes: 'Cheque bounced twice. Phone unreachable.',
  },
  {
    partyName: 'Md. Aslam',
    partyPhone: '9900112233',
    defaultAmount: 15000,
    merchantName: 'Maa Lakshmi Stores',
    merchantArea: 'Park Circus',
    notes: 'Closed shop, relocated without clearing dues.',
  },
]

async function seedIfEmpty() {
  const count = await db.defaulterRegistry.count()
  if (count > 0) return count
  await db.defaulterRegistry.createMany({ data: SEED_DEFAULTERS })
  return SEED_DEFAULTERS.length
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const action = searchParams.get('action')
    const fingerprintHash = searchParams.get('fingerprintHash')
    const phone = searchParams.get('phone')
    const name = searchParams.get('name')

    if (action === 'seed') {
      const seeded = await seedIfEmpty()
      return NextResponse.json({ ok: true, seeded, message: 'Defaulter registry seeded with demo data' })
    }

    // Lookup by specific identifiers.
    if (fingerprintHash || phone || name) {
      const where: any = { status: 'active' }
      const orClauses: any[] = []
      if (fingerprintHash) orClauses.push({ fingerprintHash })
      if (phone) orClauses.push({ partyPhone: phone })
      if (name) orClauses.push({ partyName: { contains: name } })
      if (orClauses.length === 1) Object.assign(where, orClauses[0])
      else where.OR = orClauses

      const matches = await db.defaulterRegistry.findMany({
        where,
        orderBy: { reportedAt: 'desc' },
        take: 50,
      })
      return NextResponse.json({ count: matches.length, defaulters: matches })
    }

    // Default: return last 20 defaulters.
    const defaulters = await db.defaulterRegistry.findMany({
      orderBy: { reportedAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ count: defaulters.length, defaulters })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Adding a defaulter to the shared registry requires OWNER/ADMIN.
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const body = await req.json()
    if (!body.partyName || !body.merchantName) {
      return NextResponse.json(
        { error: 'partyName and merchantName are required' },
        { status: 400 }
      )
    }

    const record = await db.defaulterRegistry.create({
      data: {
        fingerprintHash: body.fingerprintHash ?? null,
        partyName: body.partyName,
        partyPhone: body.partyPhone ?? null,
        defaultAmount: Number(body.defaultAmount ?? 0),
        merchantName: body.merchantName,
        merchantArea: body.merchantArea ?? null,
        notes: body.notes ?? null,
        status: body.status ?? 'active',
      },
    })
    return NextResponse.json({ ok: true, defaulter: record })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
