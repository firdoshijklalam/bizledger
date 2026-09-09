import { db } from '@/lib/db'

// §COMPLAINT-CONSTANTS: shared enums for the Complaint model.
// Exported so the UI + tests can import the same validation lists.

export const COMPLAINT_STATUSES = ['NEW', 'IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'] as const
export type ComplaintStatus = typeof COMPLAINT_STATUSES[number]

export const COMPLAINT_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const
export type ComplaintPriority = typeof COMPLAINT_PRIORITIES[number]

export const COMPLAINT_SOURCE_TYPES = ['MESSAGE', 'CALL', 'FEEDBACK', 'MANUAL', 'OTHER'] as const
export type ComplaintSourceType = typeof COMPLAINT_SOURCE_TYPES[number]

export const COMPLAINT_EVENT_TYPES = [
  'CREATED', 'STATUS_CHANGE', 'PRIORITY_CHANGE', 'ASSIGN', 'COMMENT', 'RESOLVE', 'CLOSE',
] as const
export type ComplaintEventType = typeof COMPLAINT_EVENT_TYPES[number]

// §STATUS-TRANSITIONS: allowed status transitions. Prevents invalid jumps
// like NEW → CLOSED (must go through RESOLVED first) or RESOLVED → IN_PROGRESS
// (reopening should go to IN_PROGRESS, not WAITING).
// Format: { from: [allowed next statuses] }
export const STATUS_TRANSITIONS: Record<string, string[]> = {
  NEW: ['IN_PROGRESS', 'WAITING', 'RESOLVED', 'CLOSED'],
  IN_PROGRESS: ['WAITING', 'RESOLVED', 'CLOSED'],
  WAITING: ['IN_PROGRESS', 'RESOLVED', 'CLOSED'],
  RESOLVED: ['IN_PROGRESS', 'CLOSED'], // reopened → IN_PROGRESS; closed → CLOSED
  CLOSED: ['IN_PROGRESS'], // reopened → IN_PROGRESS
}

export function isValidStatusTransition(from: string, to: string): boolean {
  if (from === to) return true // no-op is allowed
  const allowed = STATUS_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

// §COMPLAINT-NUMBER-GENERATION: Concurrency-safe, per-business sequence.
// Uses a dedicated ComplaintSequence table with upsert + { increment: 1 }
// inside a $transaction — identical pattern to InvoiceSequence.
//
// Format: CMP-0001, CMP-0002, ... (zero-padded to 4 digits, expands to 5+ for 10000+)
//
// §GUARANTEE: Two concurrent POST /api/complaints in the same business will
// NEVER get the same number. The upsert + increment is a single atomic SQL
// statement (INSERT ... ON CONFLICT UPDATE nextNumber = nextNumber + 1).
export async function generateComplaintNumber(businessId: string): Promise<string> {
  const seq = await db.$transaction(async (tx) => {
    const result = await tx.complaintSequence.upsert({
      where: { businessId },
      update: { nextNumber: { increment: 1 } },
      create: { businessId, nextNumber: 1 },
    })
    return result
  })
  // seq.nextNumber was just incremented — use the value BEFORE increment
  // (upsert returns the AFTER-increment value, so subtract 1).
  const number = seq.nextNumber - 1
  // Zero-pad to 4 digits (CMP-0001). For businesses with 10000+ complaints,
  // the number naturally expands to 5+ digits (CMP-10000).
  return `CMP-${String(number).padStart(4, '0')}`
}
