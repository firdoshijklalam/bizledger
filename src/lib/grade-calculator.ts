// BizLedger — Customer Quality Grade Calculator (PRD v2 §15.2)
//
// Signals & Weights:
//   Payment Speed      35%  <7d=A · 7–15=B · 15–30=C · 30–60=D · >60=E
//   Outstanding Ratio  30%  <5%=A · 5–15%=B · 15–30%=C · 30–50%=D · >50%=E
//   Avg Discount       20%  <2%=A · 2–5%=B · 5–10%=C · 10–20%=D · >20%=E
//   Transaction Count  15%  <3 = "New" (no grade change)

import { db } from '@/lib/db'
import type { QualityGrade } from '@/lib/types'

interface GradeInput {
  avgPaymentDays: number | null
  outstandingRatio: number // 0..1
  avgDiscountPct: number
  transactionCount: number
}

interface GradeResult {
  grade: QualityGrade
  avgPaymentDays: number
  outstandingRatio: number
  avgDiscountPct: number
  transactionCount: number
  isNew: boolean
}

function scoreToGrade(paymentDays: number | null, outRatio: number, discountPct: number, txCount: number): GradeResult {
  // "New" badge if fewer than 3 transactions
  const isNew = txCount < 3
  if (isNew) {
    return {
      grade: 'B',
      avgPaymentDays: paymentDays ?? 0,
      outstandingRatio: outRatio,
      avgDiscountPct: discountPct,
      transactionCount: txCount,
      isNew: true,
    }
  }

  // Score each signal 0..5 (5 = best = A, 0 = worst = E)
  const speedScore = (() => {
    if (paymentDays == null) return 3
    if (paymentDays < 7) return 5
    if (paymentDays <= 15) return 4
    if (paymentDays <= 30) return 3
    if (paymentDays <= 60) return 2
    return 1
  })()

  const ratioScore = (() => {
    const pct = outRatio * 100
    if (pct < 5) return 5
    if (pct < 15) return 4
    if (pct < 30) return 3
    if (pct <= 50) return 2
    return 1
  })()

  const discountScore = (() => {
    if (discountPct < 2) return 5
    if (discountPct < 5) return 4
    if (discountPct < 10) return 3
    if (discountPct <= 20) return 2
    return 1
  })()

  // Weighted average (speed 35, ratio 30, discount 20, count 15)
  // Count score: more transactions = more reliable = slightly better
  const countScore = Math.min(5, Math.ceil(txCount / 10))

  const weighted =
    speedScore * 0.35 + ratioScore * 0.3 + discountScore * 0.2 + countScore * 0.15

  let grade: QualityGrade = 'C'
  if (weighted >= 4.3) grade = 'A'
  else if (weighted >= 3.5) grade = 'B'
  else if (weighted >= 2.5) grade = 'C'
  else if (weighted >= 1.5) grade = 'D'
  else grade = 'E'

  return {
    grade,
    avgPaymentDays: paymentDays ?? 0,
    outstandingRatio: outRatio,
    avgDiscountPct: discountPct,
    transactionCount: txCount,
    isNew: false,
  }
}

/**
 * Recalculate the quality grade for a party based on their invoice + transaction history.
 * Persists the result to the Party record (unless an override reason is set).
 */
export async function recalculatePartyGrade(partyId: string): Promise<GradeResult | null> {
  const party = await db.party.findUnique({
    where: { id: partyId },
    include: {
      invoices: { select: { createdAt: true, amountPaid: true, grandTotal: true, status: true, discountAmount: true, subtotal: true, paymentMode: true } },
      transactions: { select: { id: true, amount: true, type: true, createdAt: true } },
    },
  })
  if (!party) return null

  // Skip auto-calc if there's a manual override
  if (party.gradeOverrideReason) {
    return {
      grade: party.qualityGrade as QualityGrade,
      avgPaymentDays: party.avgPaymentDays ?? 0,
      outstandingRatio: party.balance.toNumber() / Math.max(1, party.balance.toNumber() + 1),
      avgDiscountPct: party.avgDiscountPct,
      transactionCount: party.transactions.length,
      isNew: false,
    }
  }

  const txCount = party.transactions.length

  // Payment speed: average days between invoice creation and full payment (only paid invoices)
  const paidInvoices = party.invoices.filter((i) => i.status === 'paid' && i.amountPaid >= i.grandTotal)
  const avgPaymentDays = paidInvoices.length > 0
    ? paidInvoices.reduce((s, inv) => {
        const created = new Date(inv.createdAt).getTime()
        // Use updatedAt as proxy for payment date if not available; otherwise treat as paid today
        const paid = Date.now()
        return s + Math.max(0, (paid - created) / 86400000)
      }, 0) / paidInvoices.length
    : null

  // Outstanding ratio: |balance| / lifetime total volume
  const lifetimeTotal = party.invoices.reduce((s, i) => s + i.grandTotal.toNumber(), 0) + Math.abs(party.openingBalance.toNumber())
  const outstandingRatio = lifetimeTotal > 0 ? Math.abs(party.balance.toNumber()) / lifetimeTotal : 0

  // Avg discount % across invoices
  const avgDiscountPct = party.invoices.length > 0
    ? (party.invoices.reduce((s, i) => s + (i.subtotal.toNumber() > 0 ? (i.discountAmount.toNumber() / i.subtotal.toNumber()) * 100 : 0), 0) / party.invoices.length)
    : party.avgDiscountPct

  const result = scoreToGrade(avgPaymentDays, outstandingRatio, avgDiscountPct, txCount)

  // Persist
  await db.party.update({
    where: { id: partyId },
    data: {
      qualityGrade: result.grade,
      avgPaymentDays: result.avgPaymentDays,
      avgDiscountPct: result.avgDiscountPct,
      gradeLastCalculated: new Date(),
    },
  })

  return result
}

/** Pure function for UI display of grade breakdown (no DB writes). */
export function computeGradePreview(input: GradeInput): GradeResult {
  return scoreToGrade(input.avgPaymentDays, input.outstandingRatio, input.avgDiscountPct, input.transactionCount)
}
