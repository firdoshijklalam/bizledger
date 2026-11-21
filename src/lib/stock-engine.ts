// PRD Part 11 §3-4: Fractional Deduction Engine
// Auto bulk-to-loose conversion + edge-case overflow validation

interface ProductStock {
  stock: number // bulk stock (bags)
  looseStock: number // loose stock (kg)
  conversionFactor: number | null // 1 bag = 25 kg
  retailUnit: string | null
}

interface StockResult {
  bulkStock: number
  looseStock: number
  bagsCut: number // how many bags were cut open
}

/**
 * Process a loose/retail sale — auto-converts bulk to loose if needed.
 * PRD Part 11 §3.1: If loose stock is 0, automatically cut 1 bag from bulk.
 * PRD Part 11 §3.2: Sequential subtraction — only cut when loose runs out.
 */
export function processLooseSale(product: ProductStock, qtyRequested: number): StockResult {
  const factor = product.conversionFactor || 1
  let bulkStock = product.stock
  let looseStock = product.looseStock
  let bagsCut = 0

  let remaining = qtyRequested

  // First, use loose stock
  if (looseStock >= remaining) {
    looseStock -= remaining
    remaining = 0
  } else {
    remaining -= looseStock
    looseStock = 0
  }

  // If still need more, cut bags from bulk (PRD Part 11 §3.1)
  while (remaining > 0 && bulkStock > 0) {
    // Cut 1 bag
    bulkStock -= 1
    bagsCut += 1
    looseStock += factor

    // Now use from loose
    if (looseStock >= remaining) {
      looseStock -= remaining
      remaining = 0
    } else {
      remaining -= looseStock
      looseStock = 0
    }
  }

  return { bulkStock, looseStock, bagsCut }
}

/**
 * PRD Part 11 §4.1: Loose Overflow Rule
 * If loose stock >= conversion factor, auto-convert back to bulk.
 * E.g., 26 kg with factor 25 → 1 bag + 1 kg loose
 */
export function normalizeStock(product: ProductStock): StockResult {
  const factor = product.conversionFactor || 1
  let bulkStock = product.stock
  let looseStock = product.looseStock

  // While loose stock >= factor, convert to bulk
  while (looseStock >= factor && factor > 0) {
    looseStock -= factor
    bulkStock += 1
  }

  return { bulkStock, looseStock, bagsCut: 0 }
}

/**
 * Get total stock in sub-units (for display)
 * E.g., 14 bags × 25 kg + 23 kg = 373 kg total
 */
export function getTotalInSubUnits(product: ProductStock): number {
  const factor = product.conversionFactor || 1
  return product.stock * factor + product.looseStock
}

/**
 * Check if enough stock for a loose sale
 */
export function hasEnoughLooseStock(product: ProductStock, qty: number): boolean {
  const total = getTotalInSubUnits(product)
  return total >= qty
}
