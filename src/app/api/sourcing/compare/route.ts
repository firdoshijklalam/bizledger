import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { productSimilarity, SIMILARITY_THRESHOLD, calcLandedCost } from '@/lib/landed-cost'
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const productId = searchParams.get('productId')
  const name = searchParams.get('name')
  const category = searchParams.get('category')
  const quantity = Number(searchParams.get('quantity') || 1) || 1
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ productName: '', matches: [] })
  let targetName = name || '', targetCategory = category || null
  if (productId) { const p = await db.product.findFirst({ where: { id: productId, businessId: business.id } }); if (!p) return NextResponse.json({ error: 'Not found' }, { status: 404 }); targetName = p.name; targetCategory = p.category || null }
  if (!targetName) return NextResponse.json({ error: 'Either productId or name is required' }, { status: 400 })
  const items = await db.supplierCatalogItem.findMany({ where: { businessId: business.id, isActive: true } })
  const supplierIds = [...new Set(items.map(i => i.supplierId))]
  const suppliers = await db.party.findMany({ where: { id: { in: supplierIds } } })
  const sMap = new Map(suppliers.map(s => [s.id, s]))
  const matches: any[] = []
  for (const it of items) {
    const sim = productSimilarity(targetName, it.productName)
    if (sim < SIMILARITY_THRESHOLD) continue
    const catA = (targetCategory||'').trim().toLowerCase(), catB = (it.category||'').trim().toLowerCase()
    if (catA && catB && catA !== catB) continue
    const s = sMap.get(it.supplierId)
    const landed = calcLandedCost({ basePrice: it.basePrice.toNumber(), transportFare: it.transportFare.toNumber(), coolieCharge: it.coolieCharge.toNumber(), quantity })
    matches.push({ catalogItemId: it.id, supplierId: it.supplierId, supplierName: s?.name || 'Unknown', supplierPhone: s?.phone || null, basePrice: it.basePrice, transportFare: it.transportFare, coolieCharge: it.coolieCharge, perUnitLandedCost: landed.perUnitCost, totalCostForQty: landed.totalCost, isBestChoice: false, similarity: Math.round(sim*100)/100 })
  }
  matches.sort((a, b) => a.perUnitLandedCost - b.perUnitLandedCost)
  if (matches.length > 0) matches[0].isBestChoice = true
  return NextResponse.json({ productName: targetName, category: targetCategory, matches })
}
