/**
 * §SEED-SEARCH-DATA: Seed test data for the search acceptance tests.
 * Creates: business + owner user + parties (with searchTags) + products +
 * invoices + transactions, covering all 9 acceptance test scenarios.
 *
 * Usage: npx tsx scripts/seed-search-data.ts
 */
import { db } from '../src/lib/db'
import { hashPassword } from '../src/lib/auth/session'
import { generateSearchTags } from '../src/lib/transliteration'

async function main() {
  console.log('🌱 Seeding search test data...')

  // ── Business ────────────────────────────────────────────────────────────
  let business = await db.business.findFirst({ where: { name: 'Sharma Trading Co.' } })
  if (!business) {
    business = await db.business.create({
      data: {
        name: 'Sharma Trading Co.',
        ownerName: 'Sharma Ji',
        phone: '+91 98300 11111',
        email: 'sharma@trading.co',
        address: '12 Bidhan Sarani, Kolkata 700006',
        state: 'West Bengal',
        currency: 'INR',
      },
    })
    console.log('  ✓ Business created:', business.id)
  } else {
    console.log('  ✓ Business exists:', business.id)
  }

  // ── Owner user ──────────────────────────────────────────────────────────
  let user = await db.user.findUnique({ where: { email: 'owner@bizledger.app' } })
  if (!user) {
    user = await db.user.create({
      data: {
        email: 'owner@bizledger.app',
        passwordHash: hashPassword('admin123'),
        name: 'Owner',
        role: 'OWNER',
        businessId: business.id,
      },
    })
    console.log('  ✓ Owner user created')
  } else {
    console.log('  ✓ Owner user exists')
  }

  // ── Parties (with searchTags) ───────────────────────────────────────────
  const partyDefs = [
    { name: 'Firdosh Alam', phone: '+91 98300 22221', type: 'customer', grade: 'A' },
    { name: 'Alam', phone: '+91 98300 22222', type: 'customer', grade: 'B' },
    { name: 'আব্দুল্লাহ', phone: '+91 98300 22223', type: 'customer', grade: 'A' },
    { name: 'Das & Sons', phone: '+91 98300 22224', type: 'supplier', grade: 'B' },
    { name: 'Maa Lakshmi Bhandar', phone: '+91 98300 22225', type: 'supplier', grade: 'C' },
    { name: 'Amit Trading', phone: '+91 98300 22226', type: 'customer', grade: 'B' },
    { name: 'Verma Electronics', phone: '+91 98300 22227', type: 'customer', grade: 'C' },
    { name: 'Rehmat', phone: '+91 98300 22228', type: 'customer', grade: 'B' },
  ]

  const partyMap: Record<string, string> = {}
  for (const p of partyDefs) {
    let party = await db.party.findFirst({ where: { businessId: business.id, name: p.name } })
    if (!party) {
      party = await db.party.create({
        data: {
          businessId: business.id,
          name: p.name,
          phone: p.phone,
          type: p.type as any,
          balance: 1000,
          openingBalance: 0,
          qualityGrade: p.grade as any,
          searchTags: JSON.stringify(generateSearchTags(p.name)),
        },
      })
      console.log(`  ✓ Party: ${p.name} (${party.id})`)
    } else {
      console.log(`  ✓ Party exists: ${p.name}`)
    }
    partyMap[p.name] = party.id
  }

  // ── Products (with searchTags) ──────────────────────────────────────────
  const productDefs = [
    { name: 'Cement Bag 50kg', sku: 'CEM-50', category: 'Construction', unit: 'bag', stock: 20, salePrice: 380 },
    { name: 'Miniket Rice', sku: 'RIC-MIN', category: 'Groceries', subCategory: 'Miniket', unit: 'kg', stock: 100, salePrice: 55 },
    { name: 'Mustard Oil', sku: 'OIL-MUS', category: 'Groceries', subCategory: 'Mustard', unit: 'ltr', stock: 30, salePrice: 180 },
  ]
  for (const p of productDefs) {
    let prod = await db.product.findFirst({ where: { businessId: business.id, name: p.name } })
    if (!prod) {
      prod = await db.product.create({
        data: {
          businessId: business.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          subCategory: (p as any).subCategory || null,
          unit: p.unit,
          stock: p.stock,
          purchasePrice: p.salePrice * 0.8,
          salePrice: p.salePrice,
          searchTags: JSON.stringify(generateSearchTags(p.name)),
        },
      })
      console.log(`  ✓ Product: ${p.name}`)
    } else {
      console.log(`  ✓ Product exists: ${p.name}`)
    }
  }

  // ── Invoices ───────────────────────────────────────────────────────────
  const invoiceDefs = [
    { partyName: 'Firdosh Alam', number: 'INV-2026-0044', total: 1062 },
    { partyName: 'Firdosh Alam', number: 'INV-2026-0045', total: 2400 },
    { partyName: 'আব্দুল্লাহ', number: 'INV-2026-0050', total: 880 },
    { partyName: 'আব্দুল্লাহ', number: 'INV-2026-0051', total: 1500 },
    { partyName: 'Amit Trading', number: 'INV-2026-0060', total: 3300 },
  ]
  for (const i of invoiceDefs) {
    const partyId = partyMap[i.partyName]
    if (!partyId) continue
    let inv = await db.invoice.findFirst({ where: { businessId: business.id, invoiceNumber: i.number } })
    if (!inv) {
      inv = await db.invoice.create({
        data: {
          businessId: business.id,
          partyId,
          invoiceNumber: i.number,
          type: 'sales',
          status: 'unpaid',
          isGst: false,
          subtotal: i.total,
          discountValue: 0,
          discountMode: 'flat',
          discountAmount: 0,
          gstAmount: 0,
          grandTotal: i.total,
          amountPaid: 0,
          amountDue: i.total,
        },
      })
      console.log(`  ✓ Invoice: ${i.number} (${i.partyName})`)
    }
  }

  // ── Transactions ───────────────────────────────────────────────────────
  const txnDefs = [
    { partyName: 'Firdosh Alam', type: 'credit', amount: 4810, description: 'Sale (full) — split payment', category: 'sale' },
    { partyName: 'Firdosh Alam', type: 'debit', amount: 1000, description: 'Cash received', category: 'payment' },
    { partyName: 'আব্দুল্লাহ', type: 'credit', amount: 500, description: 'Sale (partial)', category: 'sale' },
    { partyName: 'Amit Trading', type: 'credit', amount: 2200, description: 'Sale (full)', category: 'sale' },
  ]
  for (const t of txnDefs) {
    const partyId = partyMap[t.partyName]
    if (!partyId) continue
    await db.transaction.create({
      data: {
        businessId: business.id,
        partyId,
        type: t.type as any,
        amount: t.amount,
        description: t.description,
        category: t.category,
      },
    })
    console.log(`  ✓ Transaction: ${t.description} (${t.partyName})`)
  }

  console.log('\n✅ Seed complete.')
  console.log('   Email: owner@bizledger.app')
  console.log('   Password: admin123')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
}).finally(() => db.$disconnect())
