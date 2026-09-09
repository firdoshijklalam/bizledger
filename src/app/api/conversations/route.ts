import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { isValidChannel } from '@/lib/messaging'

// §CONVERSATIONS-API: CRUD for conversations.
//
// §TENANT-ISOLATION: businessId from getCurrentBusiness() — never from body/URL.
// Every query scoped by businessId. Cross-tenant → 404.

// GET /api/conversations?partyId=X&channel=Y
export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const partyId = searchParams.get('partyId')
    const channel = searchParams.get('channel')

    const where: any = { businessId: business.id }
    if (partyId) where.partyId = partyId
    if (channel && isValidChannel(channel)) where.channel = channel

    const conversations = await db.conversation.findMany({
      where,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1, select: { body: true, direction: true, createdAt: true } },
      },
    })

    return NextResponse.json({ items: serializeDecimals(conversations) })
  } catch (e) {
    return apiError(e, 'Failed to fetch conversations')
  }
}

// POST /api/conversations — create a new conversation
// Body: { partyId, channel, externalId? }
export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()

    // §VALIDATE-PARTY (required)
    if (!body.partyId || typeof body.partyId !== 'string') {
      return NextResponse.json({ error: 'partyId is required' }, { status: 400 })
    }
    const party = await db.party.findFirst({
      where: { id: body.partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) return NextResponse.json({ error: 'Party not found in your business' }, { status: 404 })

    // §VALIDATE-CHANNEL (required)
    if (!body.channel || typeof body.channel !== 'string' || !isValidChannel(body.channel)) {
      return NextResponse.json({ error: 'Invalid channel' }, { status: 400 })
    }

    // §VALIDATE-EXTERNAL-ID (optional)
    let externalId: string | null = null
    if (body.externalId !== undefined && body.externalId !== null) {
      if (typeof body.externalId !== 'string') {
        return NextResponse.json({ error: 'externalId must be a string' }, { status: 400 })
      }
      externalId = body.externalId.trim().slice(0, 200) || null
    }

    // §DEDUP: for in_app, check if conversation already exists (one per party+channel)
    // For external, check if the external thread already exists
    const existing = await db.conversation.findFirst({
      where: externalId
        ? { businessId: business.id, channel: body.channel, externalId }
        : { businessId: business.id, partyId: body.partyId, channel: body.channel },
    })
    if (existing) {
      return NextResponse.json({ conversation: serializeDecimals(existing) })
    }

    const conversation = await db.conversation.create({
      data: {
        businessId: business.id,
        partyId: body.partyId,
        channel: body.channel,
        externalId,
      },
    })

    return NextResponse.json({ conversation: serializeDecimals(conversation) }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create conversation')
  }
}
