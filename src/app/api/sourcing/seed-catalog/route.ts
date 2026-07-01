import { NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
export async function POST() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  const suppliers = await db.party.findMany({ where: { businessId: business.id, type: { in: ['supplier', 'both'] } } })
  const products = ['Cement Bag 50kg', 'TMT Steel Rod 12mm', 'Cement Sheet', 'LED Bulb 9W', 'PVC Pipe 4 inch', 'Miniket Rice', 'Sunflower Oil', 'Wheat Flour']
  let created = 0, skipped = 0
  for (const s of suppliers) {
    const existing = await db.supplierCatalogItem.count({ where: { supplierId: s.id } })
    if (existing > 0) { skipped++; continue }
    for (let i = 0; i < 3; i++) {
      const p = products[(suppliers.indexOf(s) * 3 + i) % products.length]
      const variation = 1 + (suppliers.indexOf(s) * 0.05)
      await db.supplierCatalogItem.create({ data: { businessId: business.id, supplierId: s.id, productName: p, category: 'Construction', basePrice: Math.round(200 * variation), transportFare: Math.round(15 * variation), coolieCharge: Math.round(10 * variation), unit: 'bag', minOrderQty: 5 } })
      created++
    }
  }
  return NextResponse.json({ ok: true, created, skipped, suppliers: suppliers.length })
}
