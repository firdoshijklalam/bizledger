import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §MARK-READ: Marks a single message as read. Idempotent — if already read,
// returns 200 without mutating anything.
//
// Also decrements the conversation's unreadCount (only if the message was
// actually unread before).

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP: message must belong to current business
    const message = await db.message.findFirst({
      where: { id, businessId: business.id },
      select: { id: true, isRead: true, conversationId: true },
    })
    if (!message) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // §IDEMPOTENT: if already read, return existing
    if (message.isRead) {
      return NextResponse.json({ ok: true, alreadyRead: true })
    }

    // §ATOMIC: mark message read + decrement conversation unreadCount
    await db.$transaction(async (tx) => {
      await tx.message.update({
        where: { id },
        data: { isRead: true, readAt: new Date() },
      })

      // §DECREMENT: only decrement if unreadCount > 0 (prevent negative)
      const conv = await tx.conversation.findUnique({
        where: { id: message.conversationId },
        select: { unreadCount: true },
      })
      if (conv && conv.unreadCount > 0) {
        await tx.conversation.update({
          where: { id: message.conversationId },
          data: { unreadCount: { decrement: 1 } },
        })
      }
    })

    return NextResponse.json({ ok: true, alreadyRead: false })
  } catch (e) {
    return apiError(e, 'Failed to mark message as read')
  }
}
