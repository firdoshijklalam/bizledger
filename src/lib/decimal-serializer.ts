/**
 * §DECIMAL-SERIALIZER: Converts Prisma Decimal fields to JS numbers in API responses.
 *
 * Prisma's Decimal type serializes as a string in JSON (e.g., "55" instead of 55).
 * This causes string concatenation bugs in frontend arithmetic:
 *   cart.reduce((s, i) => s + i.total, 0)  // 0 + "55" = "055" (BUG!)
 *
 * This utility recursively walks an object and converts any Decimal-like value
 * (objects with a toNumber method, or string values that look like numbers in
 * known Decimal fields) to plain numbers.
 *
 * Usage:
 *   const products = await db.product.findMany(...)
 *   return NextResponse.json(serializeDecimals(products))
 */

type DecimalLike = { toNumber(): number }

function isDecimalLike(v: any): v is DecimalLike {
  return v !== null && v !== undefined && typeof v === 'object' && typeof v.toNumber === 'function'
}

/**
 * Convert a single value: if it's a Prisma Decimal, return .toNumber().
 * If it's a string that represents a valid number AND the field is known to be
 * a Decimal field, convert it. Otherwise return as-is.
 */
function convertValue(v: any, fieldName?: string): any {
  if (v === null || v === undefined) return v

  // Prisma Decimal object → number
  if (isDecimalLike(v)) return v.toNumber()

  // String that might be a serialized Decimal
  if (typeof v === 'string' && fieldName && DECIMAL_FIELDS.has(fieldName)) {
    const num = Number(v)
    if (!isNaN(num)) return num
  }

  return v
}

/**
 * Known Prisma Decimal field names across all models.
 * When a string value appears in one of these fields, it's a serialized Decimal.
 */
export const DECIMAL_FIELDS = new Set([
  // Product
  'purchasePrice', 'salePrice', 'mrp', 'wholesalePrice',
  'retailSalePrice', 'retailMrp',
  // Party
  'balance', 'creditLimit', 'openingBalance', 'maxCreditSuggestion',
  // Invoice + InvoiceItem
  'subtotal', 'discountValue', 'discountAmount', 'gstAmount',
  'grandTotal', 'amountPaid', 'amountDue',
  'unitPrice', 'total', 'gstRate',
  // Transaction
  'amount', 'balanceAfter',
  // CustomPrice
  'customPrice', 'customMrp', 'customSalePrice', 'customWholesalePrice',
  'customRetailMrp', 'customRetailSalePrice', 'legacyPrice',
  // CustomerOrder / OrderSplit / PaymentSplit
  'deliveryCharge', 'commissionAmount', 'merchantAmount',
  'orderAmount', 'refundAmount', 'defaultAmount',
  // PurchaseOrder / PurchaseOrderItem / SupplierCatalogItem
  'totalAmount', 'transportFare', 'coolieCharge', 'totalCost', 'basePrice',
  // AppSettings
  'gateDiscountLimit',
])

/**
 * Recursively walk an object/array and convert all Decimal fields to numbers.
 * Handles nested objects, arrays, and Date objects (left as-is).
 */
export function serializeDecimals<T>(data: T): T {
  if (data === null || data === undefined) return data

  // §DECIMAL-CHECK: Check for Prisma Decimal objects FIRST — they are
  // typeof 'object' but have a toNumber() method. Must check before the
  // generic object branch, otherwise the Decimal is treated as a plain
  // object and its non-enumerable properties are lost.
  if (isDecimalLike(data)) {
    return data.toNumber() as unknown as T
  }

  if (Array.isArray(data)) {
    return data.map((item) => serializeDecimals(item)) as unknown as T
  }

  if (typeof data === 'object') {
    // Don't convert Date objects
    if (data instanceof Date) return data

    const result: any = {}
    for (const key of Object.keys(data)) {
      const value = (data as any)[key]
      if (value !== null && value !== undefined) {
        // §RECURSIVE: First check if the value itself is a Decimal, then
        // check if it's a string in a known Decimal field, then recurse
        if (isDecimalLike(value)) {
          result[key] = value.toNumber()
        } else {
          const converted = convertValue(value, key)
          if (converted !== value) {
            result[key] = converted
          } else {
            result[key] = serializeDecimals(value)
          }
        }
      } else {
        result[key] = value
      }
    }
    return result
  }

  return data
}
