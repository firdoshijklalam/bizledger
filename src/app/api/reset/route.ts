import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateToken } from '@/lib/utils'

// POST /api/reset — delete all data and re-seed fresh demo data
export async function POST() {
  try {
    const business = await db.business.findFirst()
    if (!business) {
      // Nothing to reset; seed fresh
      await seed()
      return NextResponse.json({ ok: true, message: 'Seeded fresh' })
    }

    // Delete everything in order (respect FK constraints)
    await db.transaction.deleteMany({ where: { businessId: business.id } })
    await db.invoiceItem.deleteMany({})
    await db.invoice.deleteMany({ where: { businessId: business.id } })
    await db.productImage.deleteMany({})
    await db.product.deleteMany({ where: { businessId: business.id } })
    await db.partyNote.deleteMany({})
    await db.party.deleteMany({ where: { businessId: business.id } })
    await db.appSettings.deleteMany({ where: { businessId: business.id } })
    await db.business.delete({ where: { id: business.id } })

    // Re-seed
    await seed()

    return NextResponse.json({ ok: true, message: 'Reset and re-seeded successfully' })
  } catch (e) {
    console.error('Reset error:', e)
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 })
  }
}

async function seed() {
  const business = await db.business.create({
    data: {
      name: 'Sharma Trading Co.',
      ownerName: 'Rajesh Sharma',
      phone: '+91 98300 12345',
      email: 'rajesh@sharmatrading.in',
      address: '12 Station Road, Howrah, West Bengal 711101',
      state: 'West Bengal',
      gstin: '19ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      upiId: 'sharmatrading@upi',
      currency: 'INR',
    },
  })
  await db.appSettings.create({ data: { businessId: business.id } })

  const parties = await Promise.all(
    [
      { name: 'Amit Trading', phone: '+91 90000 11111', type: 'customer', balance: 12500, grade: 'A', limit: 50000 },
      { name: 'Sourav Stores', phone: '+91 90000 22222', type: 'customer', balance: 8200, grade: 'B', limit: 30000 },
      { name: 'Maa Lakshmi Bhandar', phone: '+91 90000 33333', type: 'customer', balance: 45000, grade: 'D', limit: 40000 },
      { name: 'Rahul Enterprise', phone: '+91 90000 44444', type: 'customer', balance: 0, grade: 'B', limit: 25000 },
      { name: 'Kolkata Wholesale', phone: '+91 90000 55555', type: 'supplier', balance: -22000, grade: 'B' },
      { name: 'Das & Sons', phone: '+91 90000 66666', type: 'supplier', balance: -6500, grade: 'A' },
      { name: 'Verma Electronics', phone: '+91 90000 77777', type: 'both', balance: 3200, grade: 'C', limit: 20000 },
      { name: 'Defaulted Customer', phone: '+91 90000 99999', type: 'customer', balance: 68000, grade: 'E', limit: 50000 },
    ].map((p) =>
      db.party.create({
        data: {
          businessId: business.id,
          name: p.name,
          phone: p.phone,
          type: p.type,
          balance: p.balance,
          qualityGrade: p.grade,
          creditLimit: p.limit ?? null,
          avgDiscountPct: p.grade === 'A' ? 1.5 : p.grade === 'B' ? 4 : p.grade === 'C' ? 8 : p.grade === 'D' ? 14 : 22,
          avgPaymentDays: p.grade === 'A' ? 5 : p.grade === 'B' ? 12 : p.grade === 'C' ? 22 : p.grade === 'D' ? 45 : 75,
        },
      })
    )
  )

  const products = await Promise.all(
    [
      { name: 'LED Bulb 9W', sku: 'LED-9W', category: 'Electronics', unit: 'pcs', purchase: 45, sale: 80, mrp: 95, stock: 240, threshold: 50 },
      { name: 'Miniket Rice 25kg', sku: 'RICE-25', category: 'Grocery', unit: 'bag', purchase: 1150, sale: 1320, mrp: 1400, stock: 18, threshold: 20, wholesale: 1280 },
      { name: 'Mustard Oil 1L', sku: 'OIL-1L', category: 'Grocery', unit: 'pcs', purchase: 165, sale: 195, mrp: 210, stock: 85, threshold: 30 },
      { name: 'Cement Bag 50kg', sku: 'CEM-50', category: 'Construction', unit: 'bag', purchase: 380, sale: 420, mrp: 440, stock: 12, threshold: 25, wholesale: 405 },
      { name: 'Plastic Chair', sku: 'CHR-01', category: 'Furniture', unit: 'pcs', purchase: 280, sale: 450, mrp: 500, stock: 60, threshold: 15 },
      { name: 'Steel Glass', sku: 'GLS-ST', category: 'Kitchen', unit: 'pcs', purchase: 35, sale: 70, mrp: 80, stock: 8, threshold: 20 },
      { name: 'A4 Paper Bundle', sku: 'A4-500', category: 'Stationery', unit: 'pcs', purchase: 180, sale: 240, mrp: 260, stock: 45, threshold: 10 },
      { name: 'Washing Powder 1kg', sku: 'WASH-1', category: 'Household', unit: 'pcs', purchase: 78, sale: 115, mrp: 125, stock: 120, threshold: 30 },
    ].map((p) =>
      db.product.create({
        data: {
          businessId: business.id,
          name: p.name,
          sku: p.sku,
          category: p.category,
          unit: p.unit,
          purchasePrice: p.purchase,
          salePrice: p.sale,
          mrp: p.mrp,
          wholesalePrice: p.wholesale ?? null,
          gstRate: p.category === 'Grocery' ? 5 : 18,
          stock: p.stock,
          lowStockThreshold: p.threshold,
        },
      })
    )
  )

  const now = new Date()
  const txns: Array<{ partyIdx: number; type: string; amount: number; daysAgo: number; desc: string }> = [
    { partyIdx: 0, type: 'credit', amount: 5000, daysAgo: 1, desc: 'Payment received' },
    { partyIdx: 1, type: 'credit', amount: 3000, daysAgo: 2, desc: 'Partial payment' },
    { partyIdx: 2, type: 'debit', amount: 45000, daysAgo: 5, desc: 'Credit sale' },
    { partyIdx: 4, type: 'debit', amount: 22000, daysAgo: 6, desc: 'Purchase from supplier' },
    { partyIdx: 0, type: 'credit', amount: 7500, daysAgo: 8, desc: 'Sale payment' },
    { partyIdx: 3, type: 'credit', amount: 2000, daysAgo: 10, desc: 'Advance received' },
    { partyIdx: 5, type: 'debit', amount: 6500, daysAgo: 12, desc: 'Goods purchase' },
    { partyIdx: 6, type: 'credit', amount: 1800, daysAgo: 14, desc: 'Sale' },
    { partyIdx: 1, type: 'debit', amount: 5200, daysAgo: 16, desc: 'Credit sale' },
    { partyIdx: 0, type: 'credit', amount: 12000, daysAgo: 20, desc: 'Bulk order payment' },
    { partyIdx: 4, type: 'debit', amount: 15000, daysAgo: 22, desc: 'Stock purchase' },
    { partyIdx: 7, type: 'debit', amount: 68000, daysAgo: 28, desc: 'Overdue credit sale' },
  ]
  for (const t of txns) {
    const date = new Date(now)
    date.setDate(date.getDate() - t.daysAgo)
    await db.transaction.create({
      data: {
        businessId: business.id,
        partyId: parties[t.partyIdx].id,
        type: t.type,
        amount: t.amount,
        description: t.desc,
        category: t.type === 'credit' ? 'Payment In' : 'Purchase',
        createdAt: date,
      },
    })
  }

  await db.invoice.create({
    data: {
      businessId: business.id,
      partyId: parties[0].id,
      invoiceNumber: 'INV-2026-0001',
      type: 'sales', status: 'paid', isGst: true,
      subtotal: 4240, discountValue: 240, discountMode: 'flat', discountAmount: 240,
      gstAmount: 720, grandTotal: 4720, amountPaid: 4720, amountDue: 0,
      paymentMode: 'upi', paymentLandingToken: generateToken(),
      createdAt: new Date(now.getTime() - 8 * 86400000),
      items: {
        create: [
          { name: 'LED Bulb 9W', quantity: 30, unitPrice: 80, discount: 0, gstRate: 18, total: 2400, productId: products[0].id },
          { name: 'Steel Glass', quantity: 24, unitPrice: 70, discount: 0, gstRate: 18, total: 1680, productId: products[5].id },
        ],
      },
    },
  })

  await db.invoice.create({
    data: {
      businessId: business.id,
      partyId: parties[2].id,
      invoiceNumber: 'INV-2026-0002',
      type: 'sales', status: 'unpaid', isGst: true,
      subtotal: 41600, discountValue: 1600, discountMode: 'flat', discountAmount: 1600,
      gstAmount: 7200, grandTotal: 47200, amountPaid: 0, amountDue: 47200,
      paymentMode: 'credit', paymentLandingToken: generateToken(),
      createdAt: new Date(now.getTime() - 5 * 86400000),
      items: {
        create: [
          { name: 'Cement Bag 50kg', quantity: 80, unitPrice: 420, discount: 0, gstRate: 18, total: 33600, productId: products[3].id },
          { name: 'Plastic Chair', quantity: 20, unitPrice: 450, discount: 0, gstRate: 18, total: 9000, productId: products[4].id },
        ],
      },
    },
  })

  await db.invoice.create({
    data: {
      businessId: business.id,
      partyId: parties[1].id,
      invoiceNumber: 'INV-2026-0003',
      type: 'retail', status: 'paid', isGst: false,
      subtotal: 2340, discountValue: 5, discountMode: 'percent', discountAmount: 117,
      gstAmount: 0, grandTotal: 2223, amountPaid: 2223, amountDue: 0,
      paymentMode: 'cash', paymentLandingToken: generateToken(),
      createdAt: new Date(),
      items: {
        create: [
          { name: 'Mustard Oil 1L', quantity: 8, unitPrice: 195, discount: 0, gstRate: 0, total: 1560, productId: products[2].id },
          { name: 'Washing Powder 1kg', quantity: 6, unitPrice: 115, discount: 0, gstRate: 0, total: 690, productId: products[7].id },
        ],
      },
    },
  })
}
