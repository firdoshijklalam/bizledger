/**
 * §TEST-DATA-GENERATOR: Creates historical invoices for "Plastic Chair" product
 * with different purchase patterns to test the Customer Insights feature.
 *
 * Uses direct Prisma DB access to set historical dates (the API always uses
 * `now` as the createdAt).
 *
 * Patterns:
 * - Amit Trading:     Active VIP — bought 5 times, last 8 days ago (top buyer)
 * - Sourav Stores:    Active regular — bought 3 times, last 12 days ago
 * - Rahul Enterprise: Due for refill — avg ~30-day cycle, last bought 28 days ago
 * - Maa Lakshmi:      Churned — bought 4 times 95-175 days ago, nothing since
 * - Defaulted:        Churned — bought 2 times 110-130 days ago
 */

import { db } from '../src/lib/db'

const PRODUCT_ID = 'cmsgqecva000ysmx6iuur0vbs' // Plastic Chair
const PARTIES = {
  amit: 'cmsgqecut0004smx6tcq3fotg',
  sourav: 'cmsgqecuu0006smx6fe05cpba',
  rahul: 'cmsgqecux000asmx6ox6dt7zi',
  maaLakshmi: 'cmsgqecuv0008smx60mibller',
  defaulted: 'cmsgqecv1000ismx6p4e9ya6z',
}

const BUSINESS_ID = 'cmsgqecsv000msmx6mny0n3fn' // will be fetched dynamically

const now = Date.now()
const DAY = 24 * 60 * 60 * 1000

function daysAgo(n: number): Date {
  return new Date(now - n * DAY)
}

interface Purchase {
  partyId: string
  partyName: string
  daysAgo: number
  qty: number
  price: number
}

const purchases: Purchase[] = [
  // Amit Trading — Active VIP (5 purchases, most recent + highest volume)
  { partyId: PARTIES.amit, partyName: 'Amit Trading', daysAgo: 85, qty: 20, price: 440 },
  { partyId: PARTIES.amit, partyName: 'Amit Trading', daysAgo: 65, qty: 15, price: 445 },
  { partyId: PARTIES.amit, partyName: 'Amit Trading', daysAgo: 45, qty: 25, price: 440 },
  { partyId: PARTIES.amit, partyName: 'Amit Trading', daysAgo: 22, qty: 18, price: 450 },
  { partyId: PARTIES.amit, partyName: 'Amit Trading', daysAgo: 8, qty: 30, price: 450 },

  // Sourav Stores — Active regular (3 purchases)
  { partyId: PARTIES.sourav, partyName: 'Sourav Stores', daysAgo: 55, qty: 10, price: 445 },
  { partyId: PARTIES.sourav, partyName: 'Sourav Stores', daysAgo: 30, qty: 12, price: 450 },
  { partyId: PARTIES.sourav, partyName: 'Sourav Stores', daysAgo: 12, qty: 8, price: 450 },

  // Rahul Enterprise — Due for refill (avg ~30d cycle, last 28d ago → due in ~2d)
  { partyId: PARTIES.rahul, partyName: 'Rahul Enterprise', daysAgo: 90, qty: 5, price: 440 },
  { partyId: PARTIES.rahul, partyName: 'Rahul Enterprise', daysAgo: 60, qty: 6, price: 445 },
  { partyId: PARTIES.rahul, partyName: 'Rahul Enterprise', daysAgo: 28, qty: 5, price: 450 },

  // Maa Lakshmi Bhandar — Churned (last bought 95 days ago)
  { partyId: PARTIES.maaLakshmi, partyName: 'Maa Lakshmi Bhandar', daysAgo: 175, qty: 15, price: 430 },
  { partyId: PARTIES.maaLakshmi, partyName: 'Maa Lakshmi Bhandar', daysAgo: 150, qty: 10, price: 435 },
  { partyId: PARTIES.maaLakshmi, partyName: 'Maa Lakshmi Bhandar', daysAgo: 120, qty: 12, price: 440 },
  { partyId: PARTIES.maaLakshmi, partyName: 'Maa Lakshmi Bhandar', daysAgo: 95, qty: 8, price: 440 },

  // Defaulted Customer — Churned (last bought 110 days ago)
  { partyId: PARTIES.defaulted, partyName: 'Defaulted Customer', daysAgo: 130, qty: 7, price: 435 },
  { partyId: PARTIES.defaulted, partyName: 'Defaulted Customer', daysAgo: 110, qty: 5, price: 440 },
]

async function main() {
  console.log('Generating test sales data for Plastic Chair...\n')

  const business = await db.business.findFirst()
  if (!business) {
    console.error('No business found')
    process.exit(1)
  }
  const businessId = business.id
  console.log(`Business: ${business.name} (${businessId})\n`)

  let invoiceCounter = 1000

  for (const p of purchases) {
    const date = daysAgo(p.daysAgo)
    const total = p.qty * p.price
    const invoiceNumber = `TEST-${String(invoiceCounter++).padStart(4, '0')}`

    const invoice = await db.invoice.create({
      data: {
        businessId,
        partyId: p.partyId,
        invoiceNumber,
        type: 'sales',
        status: 'paid',
        isGst: false,
        subtotal: total,
        discountValue: 0,
        discountMode: 'flat',
        discountAmount: 0,
        gstAmount: 0,
        grandTotal: total,
        amountPaid: total,
        amountDue: 0,
        paymentMode: 'cash',
        createdAt: date,
        updatedAt: date,
        items: {
          create: [{
            productId: PRODUCT_ID,
            name: 'Plastic Chair',
            quantity: p.qty,
            unitPrice: p.price,
            discount: 0,
            gstRate: 0,
            total,
          }],
        },
      },
    })

    // Also create a transaction record for this sale
    await db.transaction.create({
      data: {
        businessId,
        partyId: p.partyId,
        type: 'sale',
        amount: total,
        description: `Invoice ${invoiceNumber}`,
        category: 'Sale',
        invoiceId: invoice.id,
        createdAt: date,
      },
    })

    console.log(`  ✓ ${p.partyName}: ${p.qty} pcs @ ₹${p.price} = ₹${total} (${p.daysAgo}d ago)`)
  }

  console.log(`\n✅ Generated ${purchases.length} test invoices!`)
  console.log('\nExpected insights:')
  console.log('  Top Buyers:    Amit Trading (₹46k, 108 pcs), Sourav Stores (₹13k, 30 pcs)')
  console.log('  Refill Due:    Rahul Enterprise (avg 31d cycle, last 28d ago → due in ~3d)')
  console.log('  Churned:       Maa Lakshmi (95d ago), Defaulted (110d ago)')
}

main()
  .catch((e) => { console.error(e); process.exit(1) })
  .finally(() => db.$disconnect())
