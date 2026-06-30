import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/seed-demo-shops — seed 2 demo nearby shops for the "More Shops" view
export async function POST() {
  try {
    const existing = await db.business.count()
    if (existing >= 3) {
      return NextResponse.json({ ok: true, message: 'Demo shops already seeded', count: existing })
    }

    // Demo Shop 2: A grocery store in Gariahat
    const shop2 = await db.business.create({
      data: {
        name: 'Maa Lakshmi Grocers',
        ownerName: 'Sujit Das',
        phone: '+91 98311 22334',
        address: '23 Gariahat Road, Kolkata 700019',
        state: 'West Bengal',
        upiId: 'maalakshmi@upi',
        currency: 'INR',
        storeSlug: 'maa-lakshmi-grocers',
        deliveryRadiusKm: 4,
        latitude: 22.5490,
        longitude: 88.3630,
        subscriptionPlan: 'active',
        subscriptionEndsAt: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000),
        isSponsored: true,
        sponsoredUntil: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000),
        sponsoredArea: 'Gariahat',
      },
    })

    // Add some products for shop2
    await db.product.createMany({
      data: [
        { businessId: shop2.id, name: 'Basmati Rice 1kg', category: 'Grocery', unit: 'kg', purchasePrice: 70, salePrice: 85, mrp: 95, stock: 50, lowStockThreshold: 10, gstRate: 5 },
        { businessId: shop2.id, name: 'Sunflower Oil 1L', category: 'Grocery', unit: 'ltr', purchasePrice: 120, salePrice: 145, mrp: 160, stock: 30, lowStockThreshold: 5, gstRate: 5 },
        { businessId: shop2.id, name: 'Toor Dal 1kg', category: 'Grocery', unit: 'kg', purchasePrice: 110, salePrice: 130, mrp: 140, stock: 40, lowStockThreshold: 8, gstRate: 0 },
      ],
    })

    // Demo Shop 3: A clothing store in Park Street
    const shop3 = await db.business.create({
      data: {
        name: 'Style Bazaar',
        ownerName: 'Imran Khan',
        phone: '+91 98300 55566',
        address: '45 Park Street, Kolkata 700016',
        state: 'West Bengal',
        upiId: 'stylebazaar@upi',
        currency: 'INR',
        storeSlug: 'style-bazaar',
        deliveryRadiusKm: 7,
        latitude: 22.5530,
        longitude: 88.3520,
        subscriptionPlan: 'active',
        subscriptionEndsAt: new Date(Date.now() + 25 * 24 * 60 * 60 * 1000),
      },
    })

    await db.product.createMany({
      data: [
        { businessId: shop3.id, name: 'Cotton Shirt (M)', category: 'Clothing', unit: 'pcs', purchasePrice: 250, salePrice: 499, mrp: 699, stock: 20, lowStockThreshold: 5, gstRate: 5 },
        { businessId: shop3.id, name: 'Denim Jeans (32)', category: 'Clothing', unit: 'pcs', purchasePrice: 600, salePrice: 999, mrp: 1299, stock: 15, lowStockThreshold: 3, gstRate: 5 },
      ],
    })

    return NextResponse.json({
      ok: true,
      message: 'Demo shops seeded',
      shops: [
        { id: shop2.id, name: shop2.name, slug: shop2.storeSlug },
        { id: shop3.id, name: shop3.name, slug: shop3.storeSlug },
      ],
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
