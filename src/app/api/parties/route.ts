import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { phoneticSearch } from '@/lib/phonetic'
import { generateSearchTags, phoneticMatch } from '@/lib/transliteration'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/parties — optimized with pagination + field selection
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type')
  const q = searchParams.get('q') || ''
  const usePhonetic = searchParams.get('phonetic') === 'true'
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  // §PAGINATION: ?page (1-based) is an alias for ?offset (offset = (page-1) × limit).
  // If both are provided, ?page wins.
  const pageParam = searchParams.get('page')
  const offset = pageParam
    ? Math.max(0, (Math.max(1, Number(pageParam)) - 1) * limit)
    : Number(searchParams.get('offset')) || 0
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  const where: any = {
    businessId: business.id,
    ...(type ? { type } : {}),
  }
  if (q && !usePhonetic) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q, mode: 'insensitive' } },
      // §3: Also search the phonetic searchTags JSON field
      { searchTags: { contains: q.toLowerCase(), mode: 'insensitive' } },
    ]
  }

  const [parties, totalCount] = await Promise.all([
    db.party.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.party.count({ where }),
  ])

  let result = parties

  // Phonetic search (PRD v2 §12.2) — Bengali ↔ English sound matching
  if (q && usePhonetic) {
    const ranked = phoneticSearch(parties, q)
    return NextResponse.json(serializeDecimals({ items: ranked.map((r) => r.item), total: totalCount, hasMore: offset + limit < totalCount }))
  }

  // §1: Fallback — if contains search returned 0 results, try phoneticMatch
  // This catches cross-lingual matches like "ফেরদৌস" → "Firdosh Alam"
  if (q && result.length === 0 && !usePhonetic) {
    const allParties = await db.party.findMany({
      where: { businessId: business.id, ...(type ? { type } : {}) },
      take: 200,
    })
    const phoneticMatches = allParties.filter((p) => phoneticMatch(q, p.name))
    if (phoneticMatches.length > 0) {
      return NextResponse.json(serializeDecimals({ items: phoneticMatches, total: phoneticMatches.length, hasMore: false }))
    }
  }

  return NextResponse.json(serializeDecimals({ items: result, total: totalCount, hasMore: offset + limit < totalCount }))
}

// POST /api/parties — create party
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §INPUT-VALIDATION: Validate required fields
    if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'Party name is required' }, { status: 400 })
    }
    const openingBalance = Number(body.openingBalance) || 0
    // §GUARD: Reject negative opening balance
    if (openingBalance < 0) return NextResponse.json({ error: 'Opening balance cannot be negative' }, { status: 400 })

    // §3: Auto-generate phonetic search tags from the party name
    const searchTags = JSON.stringify(generateSearchTags(body.name || ''))

    const party = await db.party.create({
      data: {
        businessId: business.id,
        name: body.name.trim(),
        phone: body.phone || null,
        type: body.type || 'customer',
        balance: openingBalance,
        openingBalance,
        qualityGrade: body.qualityGrade || 'B',
        creditLimit: body.creditLimit ? Number(body.creditLimit) : null,
        address: body.address || null,
        gstin: body.gstin || null,
        notes: body.notes || null,
        searchTags,
      },
    })
    return NextResponse.json(serializeDecimals(party))
  } catch (e) {
    return apiError(e, "Failed to create party")
  }
}
