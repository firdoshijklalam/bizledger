import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §CUSTOMER-TIMELINE: READ-ONLY composed timeline from existing domain records.
//
// §NO-NEW-TABLE: This is a read-model/view. It does NOT create a
// CustomerTimelineEvent table. It queries existing authoritative records
// (Invoice, Transaction, Message, Complaint, ComplaintEvent,
// CustomerBehaviourHistory, PartyNote) and merges them into a unified
// chronological feed.
//
// §ACCOUNTING-SAFE: This endpoint is purely read-only. It does NOT mutate
// any Invoice, Transaction, Product, Party balance, or accounting state.
// It does NOT recalculate accounting numbers — it only reads existing
// stored values for display purposes.
//
// §TENANT-ISOLATION: businessId from getCurrentBusiness() — never from body.
// Party must belong to current business (findFirst with businessId).
//
// §PAGINATION: Uses offset-based pagination with a deterministic ordering
// (createdAt DESC, then id DESC as a stable tie-breaker). This prevents
// duplicate/skipped events when multiple events share the same timestamp.
//
// §EVENT-TYPES: Only real domain events are included. No fake/invented events.

interface TimelineEvent {
  id: string
  type: string // invoice | transaction | message | complaint | complaint_event | behaviour_change | note
  occurredAt: string
  title: string
  description: string | null
  partyId: string
  entityId: string
  entityType: string // the source entity type (e.g. 'invoice', 'transaction')
  metadata: Record<string, unknown> | null
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §PAGINATION
    const { searchParams } = new URL(req.url)
    const limit = Math.min(Number(searchParams.get('limit')) || 20, 100)
    const offset = Math.max(Number(searchParams.get('offset')) || 0, 0)

    // §PARALLEL-QUERIES: Fetch from all source tables in parallel.
    // Each query fetches enough to cover the requested page + overlap for merging.
    // We fetch `limit + offset + 1` rows from each source to ensure we have
    // enough after merging + sorting.
    const fetchLimit = limit + offset + 1

    const [invoices, transactions, messages, complaints, complaintEvents, behaviourHistory, partyNotes] = await Promise.all([
      // 1. Invoices (sales/retail, non-void)
      db.invoice.findMany({
        where: { businessId: business.id, partyId, status: { not: 'void' }, type: { in: ['sales', 'retail'] } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, invoiceNumber: true, grandTotal: true, status: true, type: true, createdAt: true },
      }),
      // 2. Transactions
      db.transaction.findMany({
        where: { businessId: business.id, partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, type: true, amount: true, description: true, createdAt: true },
      }),
      // 3. Messages
      db.message.findMany({
        where: { businessId: business.id, partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, conversationId: true, channel: true, direction: true, body: true, senderType: true, createdAt: true },
      }),
      // 4. Complaints
      db.complaint.findMany({
        where: { businessId: business.id, partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, complaintNumber: true, title: true, status: true, priority: true, sourceType: true, createdAt: true },
      }),
      // 5. Complaint Events (via complaint → partyId linkage)
      db.complaintEvent.findMany({
        where: {
          businessId: business.id,
          complaint: { partyId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, complaintId: true, eventType: true, fromValue: true, toValue: true, note: true, actor: true, createdAt: true },
      }),
      // 6. Behaviour History
      db.customerBehaviourHistory.findMany({
        where: { businessId: business.id, partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, rating: true, tags: true, notes: true, ratedBy: true, createdAt: true },
      }),
      // 7. Party Notes
      db.partyNote.findMany({
        where: { partyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: fetchLimit,
        select: { id: true, type: true, content: true, author: true, createdAt: true },
      }),
    ])

    // §MAP-TO-UNIFIED-EVENTS
    const allEvents: TimelineEvent[] = []

    // Invoices
    for (const inv of invoices) {
      allEvents.push({
        id: `invoice:${inv.id}`,
        type: 'invoice',
        occurredAt: inv.createdAt.toISOString(),
        title: `Sale ${inv.invoiceNumber}`,
        description: inv.status === 'paid' ? 'Payment completed' : inv.status === 'partial' ? 'Partially paid' : 'Unpaid',
        partyId,
        entityId: inv.id,
        entityType: 'invoice',
        metadata: { invoiceNumber: inv.invoiceNumber, grandTotal: inv.grandTotal.toNumber(), status: inv.status, invoiceType: inv.type },
      })
    }

    // Transactions
    for (const tx of transactions) {
      const isCredit = tx.type === 'credit'
      allEvents.push({
        id: `transaction:${tx.id}`,
        type: 'transaction',
        occurredAt: tx.createdAt.toISOString(),
        title: isCredit ? 'Payment received' : tx.type === 'debit' ? 'Payment given' : tx.type,
        description: tx.description || null,
        partyId,
        entityId: tx.id,
        entityType: 'transaction',
        metadata: { type: tx.type, amount: tx.amount.toNumber() },
      })
    }

    // Messages
    for (const msg of messages) {
      const directionLabel = msg.direction === 'inbound' ? 'Customer message' : msg.direction === 'outbound' ? 'Staff reply' : 'Internal note'
      allEvents.push({
        id: `message:${msg.id}`,
        type: 'message',
        occurredAt: msg.createdAt.toISOString(),
        title: `${directionLabel} (${msg.channel})`,
        description: msg.body ? (msg.body.length > 100 ? msg.body.slice(0, 100) + '…' : msg.body) : null,
        partyId,
        entityId: msg.id,
        entityType: 'message',
        metadata: { channel: msg.channel, direction: msg.direction, senderType: msg.senderType, conversationId: msg.conversationId },
      })
    }

    // Complaints
    for (const c of complaints) {
      allEvents.push({
        id: `complaint:${c.id}`,
        type: 'complaint',
        occurredAt: c.createdAt.toISOString(),
        title: `Complaint ${c.complaintNumber}`,
        description: c.title,
        partyId,
        entityId: c.id,
        entityType: 'complaint',
        metadata: { complaintNumber: c.complaintNumber, status: c.status, priority: c.priority, sourceType: c.sourceType },
      })
    }

    // Complaint Events
    for (const ce of complaintEvents) {
      allEvents.push({
        id: `complaint_event:${ce.id}`,
        type: 'complaint_event',
        occurredAt: ce.createdAt.toISOString(),
        title: `Complaint ${ce.eventType.replace(/_/g, ' ').toLowerCase()}`,
        description: ce.note || null,
        partyId,
        entityId: ce.id,
        entityType: 'complaint_event',
        metadata: { complaintId: ce.complaintId, eventType: ce.eventType, fromValue: ce.fromValue, toValue: ce.toValue, actor: ce.actor },
      })
    }

    // Behaviour History
    for (const bh of behaviourHistory) {
      allEvents.push({
        id: `behaviour_change:${bh.id}`,
        type: 'behaviour_change',
        occurredAt: bh.createdAt.toISOString(),
        title: `Behaviour rated: ${bh.rating}`,
        description: bh.notes || null,
        partyId,
        entityId: bh.id,
        entityType: 'behaviour_history',
        metadata: { rating: bh.rating, tags: bh.tags, ratedBy: bh.ratedBy },
      })
    }

    // Party Notes
    for (const note of partyNotes) {
      allEvents.push({
        id: `note:${note.id}`,
        type: 'note',
        occurredAt: note.createdAt.toISOString(),
        title: `Note (${note.type})`,
        description: note.content ? (note.content.length > 100 ? note.content.slice(0, 100) + '…' : note.content) : null,
        partyId,
        entityId: note.id,
        entityType: 'party_note',
        metadata: { noteType: note.type, author: note.author },
      })
    }

    // §SORT: deterministic ordering — createdAt DESC, then id DESC (stable tie-breaker)
    allEvents.sort((a, b) => {
      const timeDiff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime()
      if (timeDiff !== 0) return timeDiff
      return b.id.localeCompare(a.id)
    })

    // §PAGINATE: slice the merged + sorted events
    const paginatedEvents = allEvents.slice(offset, offset + limit)
    const hasMore = offset + limit < allEvents.length

    return NextResponse.json(serializeDecimals({
      items: paginatedEvents,
      total: allEvents.length,
      hasMore,
      offset,
      limit,
    }))
  } catch (e) {
    return apiError(e, 'Failed to fetch timeline')
  }
}
