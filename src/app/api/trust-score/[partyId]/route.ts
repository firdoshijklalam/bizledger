import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// AI Credit Trust Score (PRD Part 32 §3.2).
// GET/POST — compute a 1.0–5.0★ trust score for a party + max credit suggestion.
// Algorithm:
//   1. Fetch party + invoices (paid/unpaid) + transactions.
//   2. avgPaymentDays (invoice createdAt → matching credit transaction date).
//   3. onTimeRatio (% of invoices paid within 30 days).
//   4. defaultRatio (% of invoices unpaid after 60 days).
//   5. totalVolume (sum of grandTotal for credit invoices).
//   6. Use existing qualityGrade as baseline (A=5, B=4, C=3, D=2, E=1).
//   7. Final = clamp(baseline + onTime/100 − default/100, 1, 5), rounded 1dp.
//   8. maxCreditSuggestion = (score / 5) * monthlyVolumeOrCap.
//   9. Persist + return breakdown.

const GRADE_BASELINE: Record<string, number> = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
}

const DAY_MS = 24 * 60 * 60 * 1000
const DEFAULT_CAP = 50000

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n))
}

async function computeAndPersist(partyId: string) {
  const party = await db.party.findUnique({
    where: { id: partyId },
    include: {
      invoices: true,
      transactions: true,
    },
  })
  if (!party) throw new Error('Party not found')

  const invoices = party.invoices
  const transactions = party.transactions

  // 2. avg payment days — link invoice → matching credit transaction.
  const creditTxns = transactions.filter((t) => t.type === 'credit')
  let paymentDaysSum = 0
  let paidCount = 0
  for (const inv of invoices) {
    const match = creditTxns.find(
      (t) => t.invoiceId === inv.id || (t.amount.toNumber() > 0 && Math.abs(t.amount.toNumber() - inv.grandTotal.toNumber()) < 1)
    )
    if (match && match.createdAt.getTime() >= inv.createdAt.getTime()) {
      const days =
        (match.createdAt.getTime() - inv.createdAt.getTime()) / DAY_MS
      paymentDaysSum += days
      paidCount += 1
    }
  }
  const avgPaymentDays = paidCount > 0 ? paymentDaysSum / paidCount : 0

  // 3. on-time ratio — invoices paid within 30 days.
  const settledInvoices = invoices.filter((i) => i.status === 'paid')
  const onTimeCount = settledInvoices.filter((i) => {
    const match = creditTxns.find((t) => t.invoiceId === i.id)
    if (!match) return false
    const days = (match.createdAt.getTime() - i.createdAt.getTime()) / DAY_MS
    return days <= 30
  }).length
  const onTimeRatio =
    invoices.length > 0 ? (onTimeCount / invoices.length) * 100 : 100

  // 4. default ratio — invoices unpaid after 60 days.
  const now = Date.now()
  const defaultedCount = invoices.filter((i) => {
    const ageDays = (now - i.createdAt.getTime()) / DAY_MS
    return i.status !== 'paid' && ageDays > 60
  }).length
  const defaultRatio =
    invoices.length > 0 ? (defaultedCount / invoices.length) * 100 : 0

  // 5. total credit volume.
  const totalVolume = invoices
    .filter((i) => i.paymentMode === 'credit' || i.status !== 'paid')
    .reduce((s, i) => s + i.grandTotal.toNumber(), 0)

  // 6. grade baseline.
  const baseline = GRADE_BASELINE[party.qualityGrade?.toUpperCase() ?? 'C'] ?? 3

  // 7. final score.
  const raw = baseline + onTimeRatio / 100 - defaultRatio / 100
  const score = Math.round(clamp(raw, 1, 5) * 10) / 10

  // 8. max credit suggestion — score/5 * (monthly volume or default cap).
  const monthlyVolume = totalVolume / 3 // crude avg over ~3 months
  const base = monthlyVolume > 0 ? Math.min(monthlyVolume, DEFAULT_CAP) : DEFAULT_CAP
  const maxCreditSuggestion = Math.round((score / 5) * base)

  // 9. reason string.
  const reason = `On-time ratio ${onTimeRatio.toFixed(0)}%, ${defaultedCount} defaults, grade ${party.qualityGrade} → ${score}★. Suggested max credit: ₹${maxCreditSuggestion.toLocaleString('en-IN')}`

  // 10. persist.
  await db.party.update({
    where: { id: partyId },
    data: {
      creditTrustScore: score,
      maxCreditSuggestion,
      trustScoreUpdatedAt: new Date(),
      trustScoreReason: reason,
    },
  })

  return {
    partyId,
    score,
    maxCreditSuggestion,
    reason,
    breakdown: {
      onTimeRatio: Math.round(onTimeRatio),
      defaultRatio: Math.round(defaultRatio),
      avgPaymentDays: Math.round(avgPaymentDays),
      totalVolume,
      gradeBaseline: baseline,
      invoiceCount: invoices.length,
      paidInvoices: paidCount,
    },
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ partyId: string }> }
) {
  try {
    const { partyId } = await params
    // Multi-tenant isolation: verify party belongs to current business
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
    const party = await db.party.findFirst({ where: { id: partyId, businessId: business.id } })
    if (!party) return NextResponse.json({ error: 'Party not found in your business' }, { status: 404 })

    const result = await computeAndPersist(partyId)
    return NextResponse.json(result)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

// POST — force recompute (same logic as GET).
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ partyId: string }> }
) {
  try {
    const { partyId } = await params
    // Multi-tenant isolation: verify party belongs to current business
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
    const party = await db.party.findFirst({ where: { id: partyId, businessId: business.id } })
    if (!party) return NextResponse.json({ error: 'Party not found in your business' }, { status: 404 })

    const result = await computeAndPersist(partyId)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
