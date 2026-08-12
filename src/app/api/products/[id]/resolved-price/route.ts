import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { resolveProductPrice, type PriceMode } from '@/lib/price-resolver'

// GET /api/products/[id]/resolved-price?buyerId=X&mode=sale|mrp|wholesale|retail-sale|retail-mrp
// Resolves the winning price for a specific buyer using the hierarchy:
//   Specific Buyer Price > Group Price > Default Wholesale Price
//
// §MULTI-PRICE: The `mode` query param determines WHICH price field is resolved:
//   - mode=sale         → customSalePrice (fallback to customPrice for legacy records)
//   - mode=mrp          → customMrp
//   - mode=wholesale    → customWholesalePrice (fallback to customPrice for legacy)
//   - mode=retail-sale  → customRetailSalePrice (NO fallback to bulk — retail isolated)
//   - mode=retail-mrp   → customRetailMrp (NO fallback to bulk)
//   - mode=default (or omitted) → customPrice (legacy single-price behavior)
//
// §RETAIL-ISOLATION: retail-sale and retail-mrp modes do NOT fall back to
// bulk customPrice. If no retail-specific custom price is set, the resolved
// price is 'default' and the caller uses the product's retailSalePrice/retailMrp.
//
// Returns:
//   {
//     price: number,
//     source: 'buyer' | 'group' | 'default',
//     customPriceId?: string,
//     customPrices?: { salePrice, mrp, wholesalePrice, legacyPrice, retailSalePrice, retailMrp }
//   }
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const buyerId = searchParams.get('buyerId')
  const modeParam = searchParams.get('mode')
  // Validate mode — default to 'default' (legacy behavior)
  const validModes: PriceMode[] = ['sale', 'mrp', 'wholesale', 'retail-sale', 'retail-mrp']
  const mode: PriceMode | undefined =
    modeParam && validModes.includes(modeParam as PriceMode)
      ? (modeParam as PriceMode)
      : undefined

  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const product = await db.product.findFirst({ where: { id, businessId: business.id } })
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let buyerGroup: string | null = null
  if (buyerId) {
    const buyer = await db.party.findFirst({ where: { id: buyerId, businessId: business.id }, select: { buyerGroup: true } })
    buyerGroup = buyer?.buyerGroup || null
  }

  // §FALLBACK: If mode is specified, use the product's corresponding field as fallback.
  // Otherwise, use wholesalePrice (legacy behavior).
  let fallback: number
  if (mode === 'sale') {
    fallback = product.salePrice?.toNumber() ?? product.wholesalePrice?.toNumber() ?? 0
  } else if (mode === 'mrp') {
    fallback = product.mrp?.toNumber() ?? product.salePrice?.toNumber() ?? 0
  } else if (mode === 'wholesale') {
    fallback = product.wholesalePrice?.toNumber() ?? product.salePrice?.toNumber() ?? 0
  } else if (mode === 'retail-sale') {
    // §RETAIL-ISOLATION: Retail sale fallback is the product's retailSalePrice
    fallback = (product as any).retailSalePrice ?? product.salePrice ?? 0
  } else if (mode === 'retail-mrp') {
    // §RETAIL-ISOLATION: Retail MRP fallback is the product's retailMrp
    fallback = (product as any).retailMrp ?? product.mrp ?? 0
  } else {
    fallback = product.wholesalePrice?.toNumber() ?? product.salePrice?.toNumber() ?? 0
  }

  const resolved = await resolveProductPrice(id, buyerId, buyerGroup, fallback, mode)
  return NextResponse.json(resolved)
}
