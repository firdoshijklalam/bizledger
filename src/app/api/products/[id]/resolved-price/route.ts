import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { resolveProductPrice } from '@/lib/price-resolver'

// GET /api/products/[id]/resolved-price?buyerId=X
// Resolves the winning price for a specific buyer using the hierarchy:
//   Specific Buyer Price > Group Price > Default Wholesale Price
// Returns { price, source, customPriceId? }
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const { searchParams } = new URL(req.url)
  const buyerId = searchParams.get('buyerId')

  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  const product = await db.product.findFirst({ where: { id, businessId: business.id } })
  if (!product) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let buyerGroup: string | null = null
  if (buyerId) {
    const buyer = await db.party.findFirst({ where: { id: buyerId, businessId: business.id }, select: { buyerGroup: true } })
    buyerGroup = buyer?.buyerGroup || null
  }

  const fallback = product.wholesalePrice ?? product.salePrice ?? 0
  const resolved = await resolveProductPrice(id, buyerId, buyerGroup, fallback)
  return NextResponse.json(resolved)
}
