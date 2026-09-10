import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §LIFETIME-PROFIT: READ-ONLY customer-level profit derivation.
//
// §AUTHORITATIVE-FORMULA: This calculation reuses the EXACT same formula
// as the Reports P&L (src/app/api/reports/route.ts), partitioned by partyId:
//
//   netRevenue = SUM(subtotal) - SUM(discountAmount)
//   cogs = SUM(item.quantity × (item.purchasePriceSnapshot ?? Product.purchasePrice))
//   grossProfit = netRevenue - cogs
//
// §VOID-EXCLUSION: status != 'void' (same as Reports)
// §INVOICE-TYPES: type IN ('sales', 'retail') (same as Reports)
// §SNAPSHOT-FALLBACK: prefer purchasePriceSnapshot (historical cost at sale time);
//   fall back to current Product.purchasePrice for legacy items (pre-Step-2).
//   This is an approximation disclosed via `cogsAccuracy.legacyFallbackItems`.
//
// §RETURNS-LIMITATION: ReturnRequest is linked to OrderSplit (online orders),
// NOT to Invoice. Returns do NOT touch Invoice/InvoiceItem/Transaction tables.
// Therefore this lifetime-profit calculation does NOT deduct refunds.
// This is a known accounting gap — documented here, not fixed in this step.
// If reward cycles need refund deduction, they must query ReturnRequest separately.
//
// §NO-MUTATION: This endpoint is purely read-only. It does NOT modify any
// Invoice, Transaction, Product, Party balance, or accounting state.
//
// §TENANT-ISOLATION: businessId from getCurrentBusiness() — never from body.
// Party must belong to current business (findFirst with businessId).

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: partyId } = await params
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §OWNERSHIP-CHECK: verify the party belongs to this business
    const party = await db.party.findFirst({
      where: { id: partyId, businessId: business.id },
      select: { id: true, name: true },
    })
    if (!party) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    // §QUERY-1: Aggregate sales invoice totals for this customer
    // Same filter as Reports: status != 'void', type IN ('sales', 'retail')
    const salesAgg = await db.invoice.aggregate({
      where: {
        businessId: business.id,
        partyId,
        status: { not: 'void' },
        type: { in: ['sales', 'retail'] },
      },
      _sum: {
        subtotal: true,
        discountAmount: true,
        grandTotal: true,
        gstAmount: true,
      },
      _count: true,
    })

    const totalOrders = salesAgg._count
    const grossRevenue = salesAgg._sum.subtotal?.toNumber() ?? 0
    const discountAmount = salesAgg._sum.discountAmount?.toNumber() ?? 0
    const netRevenue = grossRevenue - discountAmount

    // §QUERY-2: Invoice items for COGS calculation
    // Same filter + same select as Reports
    const cogsItems = await db.invoiceItem.findMany({
      where: {
        invoice: {
          businessId: business.id,
          partyId,
          status: { not: 'void' },
          type: { in: ['sales', 'retail'] },
        },
      },
      select: {
        productId: true,
        quantity: true,
        purchasePriceSnapshot: true,
      },
    })

    // §QUERY-3: Products for legacy fallback (same as Reports)
    const productIds = [...new Set(cogsItems.map((it) => it.productId).filter(Boolean))] as string[]
    const products = await db.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, purchasePrice: true },
    })
    const productCostMap = new Map(products.map((p) => [p.id, p.purchasePrice.toNumber()]))

    // §COGS-CALC: identical logic to Reports P&L
    let legacyCogsCount = 0
    let snapshotCogsCount = 0
    const cogs = cogsItems.reduce((s, it) => {
      const snapshot = it.purchasePriceSnapshot?.toNumber()
      let costPerUnit: number
      if (snapshot != null && !Number.isNaN(snapshot)) {
        costPerUnit = snapshot
        snapshotCogsCount++
      } else if (it.productId) {
        costPerUnit = productCostMap.get(it.productId) ?? 0
        legacyCogsCount++
      } else {
        costPerUnit = 0
      }
      return s + (it.quantity * costPerUnit)
    }, 0)

    const grossProfit = netRevenue - cogs
    const averageProfitPerOrder = totalOrders > 0 ? grossProfit / totalOrders : 0

    // §LAST-PURCHASE: most recent non-void sales/retail invoice for this customer
    const lastInvoice = await db.invoice.findFirst({
      where: {
        businessId: business.id,
        partyId,
        status: { not: 'void' },
        type: { in: ['sales', 'retail'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })

    const result = {
      partyId,
      partyName: party.name,
      totalOrders,
      grossRevenue,
      discountAmount,
      netRevenue,
      cogs,
      grossProfit,
      averageProfitPerOrder,
      lastPurchaseAt: lastInvoice?.createdAt ?? null,
      cogsAccuracy: {
        snapshotItems: snapshotCogsCount,
        legacyFallbackItems: legacyCogsCount,
      },
      // §RETURNS-LIMITATION: explicitly documented
      returnsNotDeducted: true,
      returnsNote: 'ReturnRequest is linked to OrderSplit, not Invoice. Refunds are NOT deducted from this calculation.',
    }

    return NextResponse.json(serializeDecimals(result))
  } catch (e) {
    return apiError(e, 'Failed to fetch lifetime profit')
  }
}
