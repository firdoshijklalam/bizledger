import { db } from '@/lib/db'

/**
 * §DYNAMIC-PRICING: Price resolution hierarchy.
 *   1. Specific Buyer Price  (CustomPrice with buyerId = the buyer)
 *   2. Group Price            (CustomPrice with buyerGroupName = buyer's group)
 *   3. Default Wholesale Price (Product.wholesalePrice or SupplierCatalogItem.basePrice)
 *
 * §MULTI-PRICE: A CustomPrice can now have THREE price fields:
 *   - customSalePrice:      override for retail/bulk sale price
 *   - customMrp:            override for MRP
 *   - customWholesalePrice: override for wholesale price
 *
 * The `mode` parameter determines WHICH field is used:
 *   - 'sale'      → customSalePrice (fallback to customPrice for legacy records)
 *   - 'mrp'       → customMrp
 *   - 'wholesale' → customWholesalePrice (fallback to customPrice for legacy)
 *   - undefined   → customPrice (legacy behavior — single price)
 *
 * Returns { price, source, customPriceId? } where source ∈ 'buyer' | 'group' | 'default'.
 */

export type PriceMode = 'sale' | 'mrp' | 'wholesale' | 'default'

export interface ResolvedPrice {
  price: number
  source: 'buyer' | 'group' | 'default'
  customPriceId?: string
  // §MULTI-PRICE: The full custom price record (if a custom price was found)
  // so the caller can access all 3 price fields if needed.
  customPrices?: {
    salePrice?: number | null
    mrp?: number | null
    wholesalePrice?: number | null
    legacyPrice?: number | null
  }
}

/**
 * §HELPER: Extract the mode-specific price from a CustomPrice record.
 * Falls back to the legacy `customPrice` field if the mode-specific field
 * is null (for records created before the multi-price change).
 */
function getPriceForMode(
  cp: { customPrice: number; customSalePrice: number | null; customMrp: number | null; customWholesalePrice: number | null },
  mode?: PriceMode,
): number | null {
  switch (mode) {
    case 'sale':
      // §LEGACY: If customSalePrice is null, fall back to customPrice (old single-price records)
      return cp.customSalePrice ?? cp.customPrice
    case 'mrp':
      return cp.customMrp
    case 'wholesale':
      // §LEGACY: If customWholesalePrice is null, fall back to customPrice
      return cp.customWholesalePrice ?? cp.customPrice
    case 'default':
    default:
      // Legacy behavior — return the generic customPrice
      return cp.customPrice
  }
}

/**
 * Resolve the price for a PRODUCT (inventory + POS context).
 * @param productId  the supplier's product
 * @param buyerId    the buyer's Party id (nullable for walk-in)
 * @param buyerGroup the buyer's tier label (nullable)
 * @param fallback   default wholesale price if no custom price matches
 * @param mode       §MULTI-PRICE: which price field to resolve ('sale'|'mrp'|'wholesale'|'default')
 */
export async function resolveProductPrice(
  productId: string,
  buyerId: string | null | undefined,
  buyerGroup: string | null | undefined,
  fallback: number,
  mode?: PriceMode,
): Promise<ResolvedPrice> {
  // 1. Specific buyer price
  if (buyerId) {
    const cp = await db.customPrice.findFirst({
      where: { productId, buyerId },
    })
    if (cp) {
      const price = getPriceForMode(cp, mode)
      // If the mode-specific price is null (e.g., MRP not set), fall through to default
      if (price !== null) {
        return {
          price,
          source: 'buyer',
          customPriceId: cp.id,
          customPrices: {
            salePrice: cp.customSalePrice,
            mrp: cp.customMrp,
            wholesalePrice: cp.customWholesalePrice,
            legacyPrice: cp.customPrice,
          },
        }
      }
    }
  }
  // 2. Group price
  if (buyerGroup) {
    const cp = await db.customPrice.findFirst({
      where: { productId, buyerGroupName: buyerGroup, buyerId: null },
    })
    if (cp) {
      const price = getPriceForMode(cp, mode)
      if (price !== null) {
        return {
          price,
          source: 'group',
          customPriceId: cp.id,
          customPrices: {
            salePrice: cp.customSalePrice,
            mrp: cp.customMrp,
            wholesalePrice: cp.customWholesalePrice,
            legacyPrice: cp.customPrice,
          },
        }
      }
    }
  }
  // 3. Default
  return { price: fallback, source: 'default' }
}

/**
 * Resolve the price for a CATALOG ITEM (B2B sourcing context).
 */
export async function resolveCatalogPrice(
  catalogItemId: string,
  buyerId: string | null | undefined,
  buyerGroup: string | null | undefined,
  fallback: number,
  mode?: PriceMode,
): Promise<ResolvedPrice> {
  if (buyerId) {
    const cp = await db.customPrice.findFirst({
      where: { catalogItemId, buyerId },
    })
    if (cp) {
      const price = getPriceForMode(cp, mode)
      if (price !== null) return { price, source: 'buyer', customPriceId: cp.id }
    }
  }
  if (buyerGroup) {
    const cp = await db.customPrice.findFirst({
      where: { catalogItemId, buyerGroupName: buyerGroup, buyerId: null },
    })
    if (cp) {
      const price = getPriceForMode(cp, mode)
      if (price !== null) return { price, source: 'group', customPriceId: cp.id }
    }
  }
  return { price: fallback, source: 'default' }
}

/**
 * Batch-resolve prices for multiple products (used by POS when a customer
 * is selected — fetches resolved prices for all cart items at once).
 *
 * §MULTI-PRICE: Returns ALL three price fields for each product so the
 * caller (sale-pad-view) can pick the right one based on the sale mode
 * (retail/wholesale/full) without re-fetching.
 */
export async function resolveProductPricesBatch(
  productIdsWithFallback: Array<{ productId: string; fallback: number }>,
  buyerId: string | null | undefined,
  buyerGroup: string | null | undefined,
): Promise<Map<string, ResolvedPrice>> {
  const result = new Map<string, ResolvedPrice>()
  if (productIdsWithFallback.length === 0) return result

  // Fetch all relevant custom prices in 2 queries (buyer-specific + group)
  const productIds = productIdsWithFallback.map((p) => p.productId)

  const buyerPrices = buyerId
    ? await db.customPrice.findMany({ where: { productId: { in: productIds }, buyerId } })
    : []
  const groupPrices = buyerGroup
    ? await db.customPrice.findMany({ where: { productId: { in: productIds }, buyerGroupName: buyerGroup, buyerId: null } })
    : []

  const buyerMap = new Map(buyerPrices.map((p) => [p.productId!, p]))
  const groupMap = new Map(groupPrices.map((p) => [p.productId!, p]))

  for (const { productId, fallback } of productIdsWithFallback) {
    const bp = buyerMap.get(productId)
    if (bp) {
      result.set(productId, {
        // §MULTI-PRICE: Return the full record so the caller can pick the right field
        price: bp.customSalePrice ?? bp.customWholesalePrice ?? bp.customPrice,
        source: 'buyer',
        customPriceId: bp.id,
        customPrices: {
          salePrice: bp.customSalePrice,
          mrp: bp.customMrp,
          wholesalePrice: bp.customWholesalePrice,
          legacyPrice: bp.customPrice,
        },
      })
      continue
    }
    const gp = groupMap.get(productId)
    if (gp) {
      result.set(productId, {
        price: gp.customSalePrice ?? gp.customWholesalePrice ?? gp.customPrice,
        source: 'group',
        customPriceId: gp.id,
        customPrices: {
          salePrice: gp.customSalePrice,
          mrp: gp.customMrp,
          wholesalePrice: gp.customWholesalePrice,
          legacyPrice: gp.customPrice,
        },
      })
      continue
    }
    result.set(productId, { price: fallback, source: 'default' })
  }
  return result
}
