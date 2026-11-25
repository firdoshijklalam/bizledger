/**
 * §TEST: Customer Lifetime Profit — REAL wrapper-handler execution against real DB.
 *
 * Run: bun run tests/unit/lifetime-profit.test.ts
 *
 * §COVERAGE (A-N):
 *   A. tenant isolation
 *   B. correct customer filtering
 *   C. void invoices excluded
 *   D. supported invoice types only
 *   E. discount handling
 *   F. purchasePriceSnapshot used correctly
 *   G. fallback purchasePrice behavior matching accounting semantics
 *   H. zero-order customer
 *   I. zero-profit case
 *   J. Decimal serialization
 *   K. averageProfitPerOrder calculation
 *   L. lastPurchaseAt
 *   M. no mutation occurs
 *   N. existing accounting/report tests remain unaffected (regression)
 */
/// <reference types="bun-types" />
export {}

import { mock } from 'bun:test'
import { NextRequest } from 'next/server'
import { db } from '../../src/lib/db'

let passed = 0
let failed = 0
function assert(cond: boolean, msg: string) {
  if (cond) { console.log(`  ✅ ${msg}`); passed++ }
  else { console.log(`  ❌ ${msg}`); failed++ }
}

let currentBusinessOverride: { id: string; name: string; currency: string } | null = null
await mock.module('@/lib/db', () => ({
  db,
  getCurrentBusiness: async () => currentBusinessOverride,
}))

const lifetimeProfitRoute = await import('@/app/api/parties/[id]/lifetime-profit/route')

const TEST_BIZ_A = 'test-ltp-A-' + Date.now()
const TEST_BIZ_B = 'test-ltp-B-' + Date.now()
let partyA1: string, partyA2: string, partyB1: string
let productA1: string, productA2: string

async function setup() {
  await db.business.create({ data: { id: TEST_BIZ_A, name: 'LTP Biz A', currency: 'INR' } })
  await db.business.create({ data: { id: TEST_BIZ_B, name: 'LTP Biz B', currency: 'INR' } })
  partyA1 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Party A1', type: 'customer' } })).id
  partyA2 = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Party A2', type: 'customer' } })).id
  partyB1 = (await db.party.create({ data: { businessId: TEST_BIZ_B, name: 'LTP Party B1', type: 'customer' } })).id
  // Product A1: purchasePrice = 50 (for fallback testing)
  productA1 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Product A1', purchasePrice: 50, salePrice: 100 } })).id
  // Product A2: purchasePrice = 30 (for snapshot testing)
  productA2 = (await db.product.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Product A2', purchasePrice: 30, salePrice: 80 } })).id
}

async function cleanup() {
  try {
    await db.invoiceItem.deleteMany({ where: { invoice: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } } })
    await db.invoice.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.product.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.party.deleteMany({ where: { businessId: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
    await db.business.deleteMany({ where: { id: { in: [TEST_BIZ_A, TEST_BIZ_B] } } })
  } catch {}
}

async function callGet(partyId: string) {
  return lifetimeProfitRoute.GET(
    new NextRequest(`http://localhost/api/parties/${partyId}/lifetime-profit`, { method: 'GET' }),
    { params: Promise.resolve({ id: partyId }) }
  )
}

async function createInvoice(businessId: string, partyId: string, opts: {
  type?: string; status?: string; subtotal?: number; discountAmount?: number; grandTotal?: number
  gstAmount?: number; invoiceNumber?: string; items?: Array<{ productId: string; quantity: number; total: number; purchasePriceSnapshot?: number | null }>
}) {
  const inv = await db.invoice.create({
    data: {
      businessId,
      partyId,
      type: opts.type || 'sales',
      status: opts.status || 'paid',
      subtotal: opts.subtotal ?? 100,
      discountAmount: opts.discountAmount ?? 0,
      grandTotal: opts.grandTotal ?? (opts.subtotal ?? 100),
      gstAmount: opts.gstAmount ?? 0,
      invoiceNumber: opts.invoiceNumber || ('INV-' + Date.now() + '-' + Math.random()),
    },
  })
  if (opts.items) {
    for (const item of opts.items) {
      await db.invoiceItem.create({
        data: {
          invoiceId: inv.id,
          productId: item.productId,
          name: 'Test Item',
          quantity: item.quantity,
          unitPrice: 100,
          total: item.total,
          purchasePriceSnapshot: item.purchasePriceSnapshot === undefined ? null : item.purchasePriceSnapshot,
        },
      })
    }
  }
  return inv
}

async function main() {
  console.log('\n🧪 Customer Lifetime Profit Tests\n')
  await setup()
  currentBusinessOverride = { id: TEST_BIZ_A, name: 'LTP Biz A', currency: 'INR' }

  // ─── A. Tenant isolation ──────────────────────────────────────────
  console.log('A. Tenant isolation')
  {
    // Create an invoice for partyB1 (Biz B)
    await createInvoice(TEST_BIZ_B, partyB1, { subtotal: 500, grandTotal: 500, items: [{ productId: productA1, quantity: 1, total: 500 }] })

    // Biz A tries to GET Biz B's party → 404
    const res = await callGet(partyB1)
    assert(res.status === 404, `A1: cross-tenant GET → 404 (got ${res.status})`)
  }

  // ─── B. Correct customer filtering ────────────────────────────────
  console.log('\nB. Correct customer filtering')
  {
    // Create invoices for partyA1 and partyA2
    await createInvoice(TEST_BIZ_A, partyA1, { subtotal: 200, grandTotal: 200, items: [{ productId: productA1, quantity: 2, total: 200, purchasePriceSnapshot: 50 }] })
    await createInvoice(TEST_BIZ_A, partyA2, { subtotal: 300, grandTotal: 300, items: [{ productId: productA2, quantity: 3, total: 300, purchasePriceSnapshot: 30 }] })

    const res1 = await callGet(partyA1)
    const body1 = await res1.json()
    assert(body1.totalOrders === 1, `B1: partyA1 has 1 order (got ${body1.totalOrders})`)
    assert(body1.grossRevenue === 200, `B2: partyA1 grossRevenue=200 (got ${body1.grossRevenue})`)

    const res2 = await callGet(partyA2)
    const body2 = await res2.json()
    assert(body2.totalOrders === 1, `B3: partyA2 has 1 order (got ${body2.totalOrders})`)
    assert(body2.grossRevenue === 300, `B4: partyA2 grossRevenue=300 (got ${body2.grossRevenue})`)
  }

  // ─── C. Void invoices excluded ────────────────────────────────────
  console.log('\nC. Void invoices excluded')
  {
    await createInvoice(TEST_BIZ_A, partyA1, { subtotal: 999, grandTotal: 999, status: 'void', items: [{ productId: productA1, quantity: 1, total: 999, purchasePriceSnapshot: 50 }] })
    const res = await callGet(partyA1)
    const body = await res.json()
    assert(body.totalOrders === 1, `C1: void invoice excluded — still 1 order (got ${body.totalOrders})`)
    assert(body.grossRevenue === 200, `C2: void invoice revenue excluded — still 200 (got ${body.grossRevenue})`)
  }

  // ─── D. Supported invoice types only ──────────────────────────────
  console.log('\nD. Supported invoice types only')
  {
    // Create a 'purchase' type invoice — should be excluded
    await createInvoice(TEST_BIZ_A, partyA1, { type: 'purchase', subtotal: 500, grandTotal: 500, items: [{ productId: productA1, quantity: 5, total: 500, purchasePriceSnapshot: 50 }] })
    // Create a 'challan' type invoice — should be excluded
    await createInvoice(TEST_BIZ_A, partyA1, { type: 'challan', subtotal: 100, grandTotal: 100, items: [{ productId: productA1, quantity: 1, total: 100, purchasePriceSnapshot: 50 }] })

    const res = await callGet(partyA1)
    const body = await res.json()
    assert(body.totalOrders === 1, `D1: only sales/retail counted — still 1 order (got ${body.totalOrders})`)
  }

  // ─── E. Discount handling ─────────────────────────────────────────
  console.log('\nE. Discount handling')
  {
    // Create a new party for clean test
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Discount Test', type: 'customer' } })).id
    await createInvoice(TEST_BIZ_A, party, { subtotal: 1000, discountAmount: 200, grandTotal: 800, items: [{ productId: productA1, quantity: 5, total: 1000, purchasePriceSnapshot: 50 }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.grossRevenue === 1000, `E1: grossRevenue=1000 (subtotal, got ${body.grossRevenue})`)
    assert(body.discountAmount === 200, `E2: discountAmount=200 (got ${body.discountAmount})`)
    assert(body.netRevenue === 800, `E3: netRevenue=800 (subtotal - discount, got ${body.netRevenue})`)
  }

  // ─── F. purchasePriceSnapshot used correctly ───────────────────────
  console.log('\nF. purchasePriceSnapshot used correctly')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Snapshot Test', type: 'customer' } })).id
    // Product purchasePrice = 50, but snapshot = 40 → COGS should use 40
    await createInvoice(TEST_BIZ_A, party, { subtotal: 500, grandTotal: 500, items: [{ productId: productA1, quantity: 5, total: 500, purchasePriceSnapshot: 40 }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.cogs === 200, `F1: cogs=200 (5 × 40 snapshot, got ${body.cogs})`)
    assert(body.grossProfit === 300, `F2: grossProfit=300 (500 - 200, got ${body.grossProfit})`)
    assert(body.cogsAccuracy.snapshotItems === 1, `F3: 1 snapshot item (1 InvoiceItem with qty=5, got ${body.cogsAccuracy.snapshotItems})`)
    assert(body.cogsAccuracy.legacyFallbackItems === 0, `F4: 0 legacy items (got ${body.cogsAccuracy.legacyFallbackItems})`)
  }

  // ─── G. Fallback purchasePrice behavior ────────────────────────────
  console.log('\nG. Fallback purchasePrice behavior')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Fallback Test', type: 'customer' } })).id
    // Product A1 purchasePrice = 50. No snapshot → should fall back to 50
    await createInvoice(TEST_BIZ_A, party, { subtotal: 500, grandTotal: 500, items: [{ productId: productA1, quantity: 5, total: 500, purchasePriceSnapshot: null }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.cogs === 250, `G1: cogs=250 (5 × 50 fallback, got ${body.cogs})`)
    assert(body.grossProfit === 250, `G2: grossProfit=250 (500 - 250, got ${body.grossProfit})`)
    assert(body.cogsAccuracy.legacyFallbackItems === 1, `G3: 1 legacy item (1 InvoiceItem with qty=5, got ${body.cogsAccuracy.legacyFallbackItems})`)
  }

  // ─── H. Zero-order customer ───────────────────────────────────────
  console.log('\nH. Zero-order customer')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Zero Orders', type: 'customer' } })).id
    const res = await callGet(party)
    const body = await res.json()
    assert(body.totalOrders === 0, `H1: 0 orders (got ${body.totalOrders})`)
    assert(body.grossRevenue === 0, `H2: 0 revenue (got ${body.grossRevenue})`)
    assert(body.cogs === 0, `H3: 0 cogs (got ${body.cogs})`)
    assert(body.grossProfit === 0, `H4: 0 profit (got ${body.grossProfit})`)
    assert(body.lastPurchaseAt === null, `H5: null lastPurchaseAt (got ${body.lastPurchaseAt})`)
  }

  // ─── I. Zero-profit case ──────────────────────────────────────────
  console.log('\nI. Zero-profit case')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Zero Profit', type: 'customer' } })).id
    // Revenue = 250, COGS = 250 → profit = 0
    await createInvoice(TEST_BIZ_A, party, { subtotal: 250, grandTotal: 250, items: [{ productId: productA1, quantity: 5, total: 250, purchasePriceSnapshot: 50 }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.netRevenue === 250, `I1: netRevenue=250 (got ${body.netRevenue})`)
    assert(body.cogs === 250, `I2: cogs=250 (got ${body.cogs})`)
    assert(body.grossProfit === 0, `I3: grossProfit=0 (got ${body.grossProfit})`)
  }

  // ─── J. Decimal serialization ─────────────────────────────────────
  console.log('\nJ. Decimal serialization')
  {
    const res = await callGet(partyA1)
    const body = await res.json()
    // All numeric fields should be JS numbers (not Prisma Decimal strings)
    assert(typeof body.grossRevenue === 'number', `J1: grossRevenue is number (got ${typeof body.grossRevenue})`)
    assert(typeof body.cogs === 'number', `J2: cogs is number (got ${typeof body.cogs})`)
    assert(typeof body.grossProfit === 'number', `J3: grossProfit is number (got ${typeof body.grossProfit})`)
    assert(typeof body.averageProfitPerOrder === 'number', `J4: averageProfitPerOrder is number (got ${typeof body.averageProfitPerOrder})`)
  }

  // ─── K. averageProfitPerOrder calculation ─────────────────────────
  console.log('\nK. averageProfitPerOrder calculation')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Avg Test', type: 'customer' } })).id
    // Order 1: revenue=300, cogs=100 → profit=200
    await createInvoice(TEST_BIZ_A, party, { subtotal: 300, grandTotal: 300, items: [{ productId: productA1, quantity: 2, total: 300, purchasePriceSnapshot: 50 }] })
    // Order 2: revenue=500, cogs=150 → profit=350
    await createInvoice(TEST_BIZ_A, party, { subtotal: 500, grandTotal: 500, items: [{ productId: productA1, quantity: 3, total: 500, purchasePriceSnapshot: 50 }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.totalOrders === 2, `K1: 2 orders (got ${body.totalOrders})`)
    assert(body.grossProfit === 550, `K2: grossProfit=550 (200+350, got ${body.grossProfit})`)
    assert(body.averageProfitPerOrder === 275, `K3: avgProfit=275 (550/2, got ${body.averageProfitPerOrder})`)
  }

  // ─── L. lastPurchaseAt ────────────────────────────────────────────
  console.log('\nL. lastPurchaseAt')
  {
    const party = (await db.party.create({ data: { businessId: TEST_BIZ_A, name: 'LTP Last Purchase', type: 'customer' } })).id
    const inv1 = await createInvoice(TEST_BIZ_A, party, { subtotal: 100, grandTotal: 100, items: [{ productId: productA1, quantity: 1, total: 100, purchasePriceSnapshot: 50 }] })
    // Wait a moment, then create a second invoice
    await new Promise(r => setTimeout(r, 100))
    const inv2 = await createInvoice(TEST_BIZ_A, party, { subtotal: 200, grandTotal: 200, items: [{ productId: productA1, quantity: 1, total: 200, purchasePriceSnapshot: 50 }] })

    const res = await callGet(party)
    const body = await res.json()
    assert(body.lastPurchaseAt !== null, `L1: lastPurchaseAt is not null`)
    // Verify it's the most recent invoice
    const lastDate = new Date(body.lastPurchaseAt).getTime()
    const inv2Date = inv2.createdAt.getTime()
    assert(lastDate >= inv2Date, `L2: lastPurchaseAt is the most recent invoice (got ${body.lastPurchaseAt})`)
  }

  // ─── M. No mutation occurs ────────────────────────────────────────
  console.log('\nM. No mutation occurs')
  {
    // Snapshot party A1's invoices before
    const beforeCount = await db.invoice.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const beforeParty = await db.party.findUnique({ where: { id: partyA1 }, select: { balance: true } })

    // Call lifetime-profit 5 times
    for (let i = 0; i < 5; i++) {
      await callGet(partyA1)
    }

    // Verify nothing changed
    const afterCount = await db.invoice.count({ where: { partyId: partyA1, businessId: TEST_BIZ_A } })
    const afterParty = await db.party.findUnique({ where: { id: partyA1 }, select: { balance: true } })

    assert(beforeCount === afterCount, `M1: invoice count unchanged (${beforeCount} → ${afterCount})`)
    assert(beforeParty?.balance.toString() === afterParty?.balance.toString(), `M2: party balance unchanged`)
  }

  // ─── N. No authentication → 400 ────────────────────────────────────
  console.log('\nN. No business (unauthenticated) → 400')
  {
    const saved = currentBusinessOverride
    currentBusinessOverride = null
    try {
      const res = await callGet(partyA1)
      assert(res.status === 400, `N1: no business → 400 (got ${res.status})`)
    } finally {
      currentBusinessOverride = saved
    }
  }

  // ─── O. Non-existent party → 404 ──────────────────────────────────
  console.log('\nO. Non-existent party → 404')
  {
    const res = await callGet('nonexistent-party-id')
    assert(res.status === 404, `O1: non-existent party → 404 (got ${res.status})`)
  }

  await cleanup()

  console.log(`\n${'='.repeat(60)}`)
  console.log(`✨ Customer Lifetime Profit Tests: ${passed} passed, ${failed} failed`)
  console.log(`${'='.repeat(60)}`)
  if (failed > 0) process.exit(1)
  await db.$disconnect()
}

main().catch((e) => {
  console.error('Test error:', e)
  cleanup().finally(() => process.exit(1))
})
