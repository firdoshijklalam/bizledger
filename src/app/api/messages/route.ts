import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'
import { isValidChannel, isValidDirection, isValidSenderType } from '@/lib/messaging'

// §MESSAGES-API: CRUD for messages.
//
// §TENANT-ISOLATION: businessId from getCurrentBusiness(). All queries scoped.
// conversationId + partyId verified to belong to current business.
//
// §IDEMPOTENCY: externalMessageId unique per business. Replaying the same webhook
// event is idempotent (upsert or findFirst + skip).

// GET /api/messages?conversationId=X&limit=50
export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const { searchParams } = new URL(req.url)
    const conversationId = searchParams.get('conversationId')
    if (!conversationId) {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }

    // §OWNERSHIP: verify conversation belongs to current business
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, businessId: business.id },
      select: { id: true },
    })
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
    const messages = await db.message.findMany({
      where: { conversationId, businessId: business.id },
      orderBy: { createdAt: 'asc' },
      take: limit,
    })

    return NextResponse.json({ items: serializeDecimals(messages) })
  } catch (e) {
    return apiError(e, 'Failed to fetch messages')
  }
}

// POST /api/messages — create a message (inbound, outbound, or internal_note)
// Body: { conversationId, direction, senderType, body?, senderId?, externalMessageId?, attachments? }
export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const body = await req.json()

    // §VALIDATE-CONVERSATION (required)
    if (!body.conversationId || typeof body.conversationId !== 'string') {
      return NextResponse.json({ error: 'conversationId is required' }, { status: 400 })
    }
    const conversation = await db.conversation.findFirst({
      where: { id: body.conversationId, businessId: business.id },
      select: { id: true, partyId: true, channel: true },
    })
    if (!conversation) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

    // §VALIDATE-DIRECTION (required)
    if (!body.direction || typeof body.direction !== 'string' || !isValidDirection(body.direction)) {
      return NextResponse.json({ error: 'Invalid direction' }, { status: 400 })
    }

    // §VALIDATE-SENDER-TYPE (required)
    if (!body.senderType || typeof body.senderType !== 'string' || !isValidSenderType(body.senderType)) {
      return NextResponse.json({ error: 'Invalid senderType' }, { status: 400 })
    }

    // §VALIDATE-BODY (optional but recommended)
    let messageBody: string | null = null
    if (body.body !== undefined && body.body !== null) {
      if (typeof body.body !== 'string') return NextResponse.json({ error: 'body must be a string' }, { status: 400 })
      messageBody = body.body.trim().slice(0, 10000) || null
    }
    if (!messageBody && !body.attachments) {
      return NextResponse.json({ error: 'body or attachments is required' }, { status: 400 })
    }

    // §VALIDATE-SENDER-ID (optional)
    let senderId: string | null = null
    if (body.senderId !== undefined && body.senderId !== null) {
      if (typeof body.senderId !== 'string') return NextResponse.json({ error: 'senderId must be a string' }, { status: 400 })
      senderId = body.senderId.trim().slice(0, 200) || null
    }

    // §VALIDATE-EXTERNAL-MESSAGE-ID (optional — for webhook replay idempotency)
    let externalMessageId: string | null = null
    if (body.externalMessageId !== undefined && body.externalMessageId !== null) {
      if (typeof body.externalMessageId !== 'string') return NextResponse.json({ error: 'externalMessageId must be a string' }, { status: 400 })
      externalMessageId = body.externalMessageId.trim().slice(0, 200) || null
    }

    // §IDEMPOTENCY-CHECK: if externalMessageId provided, check for existing
    if (externalMessageId) {
      const existing = await db.message.findFirst({
        where: { businessId: business.id, externalMessageId },
      })
      if (existing) {
        // Idempotent — return existing message, don't create duplicate
        return NextResponse.json({ message: serializeDecimals(existing) })
      }
    }

    // §ATTACHMENTS (optional JSON string)
    let attachments: string | null = null
    if (body.attachments !== undefined && body.attachments !== null) {
      if (typeof body.attachments !== 'string') return NextResponse.json({ error: 'attachments must be a JSON string' }, { status: 400 })
      attachments = body.attachments.slice(0, 100000) || null
    }

    // §ATOMIC-CREATE: create message + update conversation's lastMessageAt + unreadCount
    const isInbound = body.direction === 'inbound'
    const result = await db.$transaction(async (tx) => {
      const message = await tx.message.create({
        data: {
          businessId: business.id,
          conversationId: conversation.id,
          partyId: conversation.partyId,
          channel: conversation.channel,
          direction: body.direction,
          senderType: body.senderType,
          senderId,
          body: messageBody,
          attachments,
          externalMessageId,
          isRead: !isInbound, // outbound/internal_note are auto-read; inbound is unread
        },
      })

      // §UPDATE-CONVERSATION: update lastMessageAt + lastMessagePreview + unreadCount
      await tx.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: messageBody ? messageBody.slice(0, 100) : null,
          unreadCount: isInbound ? { increment: 1 } : undefined,
        },
      })

      return message
    })

    return NextResponse.json({ message: serializeDecimals(result) }, { status: 201 })
  } catch (e) {
    return apiError(e, 'Failed to create message')
  }
}
