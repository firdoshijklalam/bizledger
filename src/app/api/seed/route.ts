import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { createHash } from 'crypto'

function hashPin(pin: string): string {
  return createHash('sha256').update(pin + (process.env.NEXTAUTH_SECRET || 'bizledger-salt')).digest('hex')
}

export async function POST(req: NextRequest) {
  // §SECURITY: Block this endpoint in production — it can wipe ALL data.
  // Only allowed in development for testing/seeding demo data.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This endpoint is disabled in production' }, { status: 403 })
  }
  try {
    const force = new URL(req.url).searchParams.get('force') === 'true'
    const existing = await db.business.findFirst({ where: { name: 'Sharma Trading Co.' } })
    
    if (existing && !force) {
      return NextResponse.json({ ok: true, message: 'Already seeded', businessId: existing.id })
    }
    
    if (existing && force) {
      await db.transaction.deleteMany({})
      await db.invoiceItem.deleteMany({})
      await db.invoice.deleteMany({})
      await db.product.deleteMany({})
      await db.party.deleteMany({})
      await db.appSettings.deleteMany({})
      await db.business.deleteMany({})
    }

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
        storeSlug: 'sharma-trading',
        deliveryRadiusKm: 5,
        latitude: 22.5958,
        longitude: 88.2636,
      },
    })

    await db.appSettings.create({
      data: {
        businessId: business.id,
        pinEnabled: true,
        pinHash: hashPin('1234'),
        biometricEnabled: true,
      },
    })

    // Parties (sequential)
    const partyData = [
      { name: 'Amit Trading', phone: '+91 90000 11111', type: 'customer', balance: 12500, grade: 'A', limit: 50000 },
      { name: 'Sourav Stores', phone: '+91 90000 22222', type: 'customer', balance: 8200, grade: 'B', limit: 30000 },
      { name: 'Maa Lakshmi Bhandar', phone: '+91 90000 33333', type: 'customer', balance: 45000, grade: 'D', limit: 40000 },
      { name: 'Rahul Enterprise', phone: '+91 90000 44444', type: 'customer', balance: 0, grade: 'B', limit: 25000 },
      { name: 'Kolkata Wholesale', phone: '+91 90000 55555', type: 'supplier', balance: -22000, grade: 'B' },
      { name: 'Das & Sons', phone: '+91 90000 66666', type: 'supplier', balance: -6500, grade: 'A' },
      { name: 'Verma Electronics', phone: '+91 90000 77777', type: 'both', balance: 3200, grade: 'C', limit: 20000 },
      { name: 'Defaulted Customer', phone: '+91 90000 99999', type: 'customer', balance: 68000, grade: 'E', limit: 50000 },
    ]
    
    for (const p of partyData) {
      await db.party.create({
        data: {
          businessId: business.id,
          name: p.name,
          phone: p.phone,
          type: p.type as any,
          balance: p.balance,
          qualityGrade: p.grade as any,
          creditLimit: p.limit ?? null,
        },
      })
    }

    // Products (sequential)
    const productData = [
      { name: 'LED Bulb 9W', sku: 'LED-9W', category: 'Electronics', unit: 'pcs', purchase: 45, sale: 80, mrp: 95, stock: 240, threshold: 50 },
      { name: 'Miniket Rice 25kg', sku: 'RICE-25', category: 'Grocery', unit: 'bag', purchase: 1150, sale: 1320, mrp: 1400, stock: 18, threshold: 20, wholesale: 1280 },
      { name: 'Mustard Oil 1L', sku: 'OIL-1L', category: 'Grocery', unit: 'pcs', purchase: 165, sale: 195, mrp: 210, stock: 85, threshold: 30 },
      { name: 'Cement Bag 50kg', sku: 'CEM-50', category: 'Construction', unit: 'bag', purchase: 380, sale: 420, mrp: 440, stock: 11, threshold: 15, wholesale: 405 },
      { name: 'A4 Paper Bundle', sku: 'A4-500', category: 'Stationery', unit: 'pcs', purchase: 200, sale: 240, mrp: 260, stock: 45, threshold: 20 },
      { name: 'Washing Powder 1kg', sku: 'WASH-1', category: 'Household', unit: 'pcs', purchase: 95, sale: 115, mrp: 125, stock: 120, threshold: 30 },
      { name: 'Steel Glass', sku: 'GLS-ST', category: 'Kitchen', unit: 'pcs', purchase: 55, sale: 70, mrp: 80, stock: 8, threshold: 15 },
      { name: 'Plastic Chair', sku: 'CHR-01', category: 'Furniture', unit: 'pcs', purchase: 380, sale: 450, mrp: 500, stock: 60, threshold: 10 },
    ]
    
    for (const p of productData) {
      await db.product.create({
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
          gstRate: 0,
          stock: p.stock,
          lowStockThreshold: p.threshold,
        },
      })
    }

    return NextResponse.json({ ok: true, message: 'Seeded successfully', businessId: business.id })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e.message || e) })
  }
}
