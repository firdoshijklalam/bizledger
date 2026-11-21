/**
 * §TEST-DATA: Creates a "Pick Up Later" invoice for testing the Fulfillment Dashboard.
 * Creates 2 invoices with deliveryStatus='pickup' for different customers.
 */
import { db } from '../src/lib/db'

const now = Date.now()
const DAY = 24 * 60 * 60 * 1000

async function main() {
  const business = await db.business.findFirst()
  if (!business) { console.error('No business'); process.exit(1) }
  console.log(`Business: ${business.name} (${business.id})`)

  const products = await db.product.findMany({ take: 3 })
  const parties = await db.party.findMany({ where: { type: { in: ['customer', 'both'] } }, take: 3 })

  if (products.length < 1 || parties.length < 1) {
    console.error('Need at least 1 product and 1 party')
    process.exit(1)
  }

  // Invoice 1: Amit Trading — 20 bags of Miniket Rice, Pick Up Later
  const p1 = products[0] // Miniket Rice
  const party1 = parties.find(p => p.name.includes('Amit')) || parties[0]
  const qty1 = 20
  const price1 = 1320
  const total1 = qty1 * price1

  const inv1 = await db.invoice.create({
    data: {
      businessId: business.id,
      partyId: party1.id,
      invoiceNumber: 'FULFILL-001',
      type: 'sales',
      status: 'unpaid',
      isGst: false,
      subtotal: total1,
      discountValue: 0,
      discountMode: 'flat',
      discountAmount: 0,
      gstAmount: 0,
      grandTotal: total1,
      amountPaid: 0,
      amountDue: total1,
      paymentMode: 'credit',
      deliveryStatus: 'pickup', // §PICK-UP-LATER
      createdAt: new Date(now - 2 * DAY),
      items: {
        create: [{
          productId: p1.id,
          name: p1.name,
          quantity: qty1,
          unitPrice: price1,
          discount: 0,
          gstRate: 0,
          total: total1,
          fulfilledQty: 0,
        }],
      },
    },
  })
  console.log(`✓ Created invoice ${inv1.invoiceNumber} for ${party1.name} (${qty1} ${p1.unit} of ${p1.name})`)

  // Invoice 2: Sourav Stores — mixed items, Pick Up Later, partial fulfillment
  if (products.length >= 2 && parties.length >= 2) {
    const p2 = products[1] // Plastic Chair
    const party2 = parties.find(p => p.name.includes('Sourav')) || parties[1]
    const qty2a = 10 // 10 bags rice
    const qty2b = 5  // 5 chairs
    const total2 = qty2a * price1 + qty2b * 450

    const inv2 = await db.invoice.create({
      data: {
        businessId: business.id,
        partyId: party2.id,
        invoiceNumber: 'FULFILL-002',
        type: 'sales',
        status: 'partial',
        isGst: false,
        subtotal: total2,
        discountValue: 0,
        discountMode: 'flat',
        discountAmount: 0,
        gstAmount: 0,
        grandTotal: total2,
        amountPaid: 5000,
        amountDue: total2 - 5000,
        paymentMode: 'credit',
        deliveryStatus: 'ready', // §READY-FOR-PICKUP
        createdAt: new Date(now - 1 * DAY),
        items: {
          create: [
            {
              productId: p1.id,
              name: p1.name,
              quantity: qty2a,
              unitPrice: price1,
              discount: 0,
              gstRate: 0,
              total: qty2a * price1,
              fulfilledQty: 3, // §PARTIAL: 3 of 10 already handed over
            },
            {
              productId: p2.id,
              name: p2.name,
              quantity: qty2b,
              unitPrice: 450,
              discount: 0,
              gstRate: 0,
              total: qty2b * 450,
              fulfilledQty: 0, // none handed over yet
            },
          ],
        },
      },
    })
    console.log(`✓ Created invoice ${inv2.invoiceNumber} for ${party2.name} (partial: 3/${qty2a} + 0/${qty2b})`)
  }

  console.log('\n✅ Test data created! Check the Fulfillment Dashboard:')
  console.log('  - FULFILL-001: Pending (pickup) — 20 bags, 0 fulfilled')
  console.log('  - FULFILL-002: Ready — 10 bags (3 fulfilled) + 5 chairs (0 fulfilled)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
