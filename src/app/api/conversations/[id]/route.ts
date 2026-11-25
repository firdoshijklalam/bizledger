import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// GET /api/conversations/[id] — single conversation with messages
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const conversation = await db.conversation.findFirst({
      where: { id, businessId: business.id },
      include: {
        party: { select: { id: true, name: true, phone: true } },
        messages: { orderBy: { createdAt: 'asc' }, take: 100 },
      },
    })
    if (!conversation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ conversation: serializeDecimals(conversation) })
  } catch (e) {
    return apiError(e, 'Failed to fetch conversation')
  }
}
