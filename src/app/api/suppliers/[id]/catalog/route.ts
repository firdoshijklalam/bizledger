import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { resolveCatalogPrice } from '@/lib/price-resolver'

// GET /api/suppliers/[id]/catalog
// §DYNAMIC-PRICING: resolves custom prices for the AUTHENTICATED BUYER.
// The current business is the buyer. The supplier is the Party whose catalog
// this is. CustomPrice rows where catalogItemId matches + buyerId = current
// business's Party record (as a buyer of this supplier) override the default
// basePrice. Resolution: Specific Buyer > Group > Default basePrice.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const items = await db.supplierCatalogItem.findMany({ where: { supplierId: id, isActive: true }, orderBy: { productName: 'asc' } })
  const supplier = await db.party.findUnique({ where: { id }, select: { name: true, phone: true } })

  // §DYNAMIC-PRICING: identify the current buyer.
  // The current business is the buyer. Find the buyer's Party record that
  // belongs to this supplier's business (i.e. a Party in the supplier's
  // business that represents the current buyer). If found, use its id +
  // buyerGroup to resolve custom prices.
  const buyerBusiness = await getCurrentBusiness()
  let buyerId: string | null = null
  let buyerGroup: string | null = null
  if (buyerBusiness) {
    // The supplier's catalog items carry the supplier's businessId. Find the
    // Party (in that supplier business) whose name matches the buyer business
    // name, OR any party that has custom prices set. Simplest: look for a
    // Party in the supplier's business matching the buyer business name.
    const supplierItem = items[0]
    if (supplierItem) {
      const supplierBusinessId = supplierItem.businessId
      const buyerParty = await db.party.findFirst({
        where: { businessId: supplierBusinessId, name: buyerBusiness.name },
        select: { id: true, buyerGroup: true },
      })
      buyerId = buyerParty?.id || null
      buyerGroup = buyerParty?.buyerGroup || null
    }
  }

  // Resolve prices for each catalog item
  const resolved = await Promise.all(
    items.map(async (it) => {
      const resolved = await resolveCatalogPrice(it.id, buyerId, buyerGroup, it.basePrice.toNumber())
      const effectiveBase = resolved.price
      const landed = effectiveBase + it.transportFare.toNumber() + it.coolieCharge.toNumber()
      return {
        ...it,
        supplierName: supplier?.name,
        supplierPhone: supplier?.phone,
        basePrice: effectiveBase,            // §OVERRIDE: default base replaced by resolved price
        defaultBasePrice: it.basePrice,      // original kept for reference
        priceSource: resolved.source,        // 'buyer' | 'group' | 'default'
        perUnitLandedCost: landed,
        originalLandedCost: it.basePrice.toNumber() + it.transportFare.toNumber() + it.coolieCharge.toNumber(),
      }
    })
  )
  return NextResponse.json(resolved)
}
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const body = await req.json()
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  const item = await db.supplierCatalogItem.create({ data: { businessId: business.id, supplierId: id, productName: body.productName, category: body.category || null, basePrice: Number(body.basePrice) || 0, transportFare: Number(body.transportFare) || 0, coolieCharge: Number(body.coolieCharge) || 0, unit: body.unit || 'pcs', minOrderQty: Number(body.minOrderQty) || 1, notes: body.notes || null, matchedProductId: body.matchedProductId || null } })
  return NextResponse.json(item)
}
