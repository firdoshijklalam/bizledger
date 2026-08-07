import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { resolveProductPricesBatch } from '@/lib/price-resolver'

/**
 * POST /api/products/resolve-prices-batch
 *
 * §BATCH-OPTIMIZED: Resolves custom prices for MULTIPLE products in a SINGLE
 * request — used by the Quick Sale (sale-pad) page when a customer is selected.
 *
 * Instead of making N parallel requests (one per product), the frontend sends
 * ONE POST request with all product IDs. The server uses
 * `resolveProductPricesBatch` which runs only 2 DB queries total (buyer-specific
 * + group-specific), regardless of how many products are in the cart.
 *
 * Request body:
 *   {
 *     productIds: string[],   // list of product IDs to resolve
 *     buyerId: string,        // the selected customer's party ID
 *     buyerGroup?: string     // the customer's group/tier label (optional)
 *   }
 *
 * Response:
 *   {
 *     "<productId>": {
 *       price: number,
 *       source: 'buyer' | 'group' | 'default',
 *       customPriceId?: string,
 *       customPrices?: { salePrice, mrp, wholesalePrice, legacyPrice }
 *     },
 *     ...
 *   }
 *
 * This is ~10-50x faster than N individual requests for a typical product grid.
 */
export async function POST(req: NextRequest) {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const body = await req.json()
    const productIds: string[] = body.productIds || []
    const buyerId: string | null = body.buyerId || null
    const buyerGroup: string | null = body.buyerGroup || null

    if (productIds.length === 0) {
      return NextResponse.json({})
    }

    // §VERIFY: Ensure all products belong to this business (security check)
    const products = await db.product.findMany({
      where: { id: { in: productIds }, businessId: business.id },
      select: { id: true, salePrice: true, mrp: true, wholesalePrice: true },
    })

    // Build the fallback map (product → default wholesale price)
    const productIdsWithFallback = products.map((p) => ({
      productId: p.id,
      fallback: p.wholesalePrice ?? p.salePrice ?? 0,
    }))

    // §BATCH-RESOLVE: Single call — 2 DB queries total (buyer + group)
    const resolvedMap = await resolveProductPricesBatch(
      productIdsWithFallback,
      buyerId,
      buyerGroup,
    )

    // §SERIALIZE: Convert the Map to a plain object for JSON response
    const result: Record<string, any> = {}
    for (const [productId, resolved] of resolvedMap.entries()) {
      result[productId] = resolved
    }

    return NextResponse.json(result)
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 })
  }
}
