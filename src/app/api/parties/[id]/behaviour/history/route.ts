import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// §CUSTOMER-BEHAVIOUR-HISTORY: Append-only audit trail of every behaviour
// state for a party.
//
// §TENANT-ISOLATION (same pattern):
//   1. businessId from getCurrentBusiness() — never from body/URL.
//   2. findFirst({ where: { id: partyId, businessId } }) — verifies
//      existence AND ownership. 404 if not found.
//   3. History query is scoped by BOTH businessId AND partyId (defence in
//      depth — even if the party check was bypassed, the businessId filter
//      would prevent cross-tenant leakage).
//
// §APPEND-ONLY: The API surface only exposes GET for history. No POST/PUT/
// DELETE — history rows are written exclusively by the behaviour PUT handler.

// GET /api/parties/[id]/behaviour/history?limit=50
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §PAGINATION: optional ?limit (default 50, max 200). Newest first.
    const { searchParams } = new URL(req.url)
    const limitParam = searchParams.get('limit')
    let limit = 50
    if (limitParam !== null) {
      const parsed = Number(limitParam)
      if (Number.isNaN(parsed) || parsed < 1) {
        return NextResponse.json({ error: 'limit must be a positive integer' }, { status: 400 })
      }
      limit = Math.min(parsed, 200)
    }

    // §DOUBLE-FILTER: businessId AND partyId. The party ownership check
    // already guarantees the party belongs to this business, but filtering
    // history by businessId too is defence-in-depth (in case a history row
    // somehow had a mismatched businessId, it would not leak).
    const history = await db.customerBehaviourHistory.findMany({
      where: { businessId: business.id, partyId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return NextResponse.json({ history })
  } catch (e) {
    return apiError(e, 'Failed to fetch behaviour history')
  }
}
