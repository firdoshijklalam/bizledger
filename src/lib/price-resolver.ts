import { db } from '@/lib/db'

/**
 * §DYNAMIC-PRICING: Price resolution hierarchy.
 *   1. Specific Buyer Price  (CustomPrice with buyerId = the buyer)
 *   2. Group Price            (CustomPrice with buyerGroupName = buyer's group)
 *   3. Default Wholesale Price (Product.wholesalePrice or SupplierCatalogItem.basePrice)
 *
 * Returns { price, source } where source ∈ 'buyer' | 'group' | 'default'.
 */

export interface ResolvedPrice {
  price: number
  source: 'buyer' | 'group' | 'default'
  customPriceId?: string
}

/**
 * Resolve the price for a PRODUCT (inventory + POS context).
 * @param productId  the supplier's product
 * @param buyerId    the buyer's Party id (nullable for walk-in)
 * @param buyerGroup the buyer's tier label (nullable)
 * @param fallback   default wholesale price if no custom price matches
 */
export async function resolveProductPrice(
  productId: string,
  buyerId: string | null | undefined,
  buyerGroup: string | null | undefined,
  fallback: number,
): Promise<ResolvedPrice> {
  // 1. Specific buyer price
  if (buyerId) {
    const cp = await db.customPrice.findFirst({
      where: { productId, buyerId },
    })
    if (cp) return { price: cp.customPrice, source: 'buyer', customPriceId: cp.id }
  }
  // 2. Group price
  if (buyerGroup) {
    const cp = await db.customPrice.findFirst({
      where: { productId, buyerGroupName: buyerGroup, buyerId: null },
    })
    if (cp) return { price: cp.customPrice, source: 'group', customPriceId: cp.id }
  }
  // 3. Default
  return { price: fallback, source: 'default' }
}

/**
 * Resolve the price for a CATALOG ITEM (B2B sourcing context).
 * @param catalogItemId the SupplierCatalogItem id
 * @param buyerId       the buyer's Party id
 * @param buyerGroup    the buyer's tier label
 * @param fallback      default basePrice if no custom price matches
 */
export async function resolveCatalogPrice(
  catalogItemId: string,
  buyerId: string | null | undefined,
  buyerGroup: string | null | undefined,
  fallback: number,
): Promise<ResolvedPrice> {
  if (buyerId) {
    const cp = await db.customPrice.findFirst({
      where: { catalogItemId, buyerId },
    })
    if (cp) return { price: cp.customPrice, source: 'buyer', customPriceId: cp.id }
  }
  if (buyerGroup) {
    const cp = await db.customPrice.findFirst({
      where: { catalogItemId, buyerGroupName: buyerGroup, buyerId: null },
    })
    if (cp) return { price: cp.customPrice, source: 'group', customPriceId: cp.id }
  }
  return { price: fallback, source: 'default' }
}

/**
 * Batch-resolve prices for multiple products (used by POS when a customer
 * is selected — fetches resolved prices for all cart items at once).
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
      result.set(productId, { price: bp.customPrice, source: 'buyer', customPriceId: bp.id })
      continue
    }
    const gp = groupMap.get(productId)
    if (gp) {
      result.set(productId, { price: gp.customPrice, source: 'group', customPriceId: gp.id })
      continue
    }
    result.set(productId, { price: fallback, source: 'default' })
  }
  return result
}
