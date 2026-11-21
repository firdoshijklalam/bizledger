/**
 * §NUMERIC-SAFETY: Financial numeric normalization utilities.
 *
 * Prisma Decimal fields can arrive as strings, Prisma Decimal objects, or
 * numbers depending on the API route. These utilities ensure consistent
 * numeric type before any arithmetic operation.
 *
 * §RULE: All financial calculations MUST use toNumber() on any value that
 * originates from an API response before using it in arithmetic.
 *
 * §RULE: formatCurrency() must ONLY be called at the final rendering stage,
 * NEVER before arithmetic. If you need to calculate, use toNumber() first.
 */

/**
 * Convert any value to a safe number for financial calculations.
 *
 * Handles:
 * - Prisma Decimal objects (has .toNumber() method)
 * - String numbers ("55", "55.50")
 * - Numbers (55, 55.50)
 * - null / undefined → 0
 * - NaN → 0
 * - Infinity → 0
 *
 * @param value - Any value that should be a number
 * @param defaultValue - Value to return if conversion fails (default: 0)
 * @returns A safe number for arithmetic
 *
 * @example
 * toNumber("55")        // 55
 * toNumber(55)          // 55
 * toNumber(null)        // 0
 * toNumber(undefined)   // 0
 * toNumber(NaN)         // 0
 * toNumber(Infinity)    // 0
 * toNumber(Decimal)     // 55 (calls .toNumber())
 */
export function toNumber(value: unknown, defaultValue = 0): number {
  if (value === null || value === undefined) return defaultValue
  if (typeof value === 'number') {
    if (isNaN(value) || !isFinite(value)) return defaultValue
    return value
  }
  // Prisma Decimal object (has toNumber method)
  if (typeof value === 'object' && typeof (value as any).toNumber === 'function') {
    try {
      const num = (value as any).toNumber()
      return isNaN(num) || !isFinite(num) ? defaultValue : num
    } catch {
      return defaultValue
    }
  }
  // String number
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return defaultValue
    const num = Number(trimmed)
    return isNaN(num) || !isFinite(num) ? defaultValue : num
  }
  // Boolean (shouldn't happen for financial fields, but be safe)
  if (typeof value === 'boolean') return value ? 1 : 0
  return defaultValue
}

/**
 * Safely add two or more financial values.
 * Prevents string concatenation: "55" + "55" = 110 (not "05555")
 *
 * @example
 * safeAdd("55", "55")     // 110
 * safeAdd(100, null, 50)  // 150
 * safeAdd("1250", "1280") // 2530
 */
export function safeAdd(...values: unknown[]): number {
  return values.reduce<number>((sum, v) => sum + toNumber(v), 0)
}

/**
 * Safely multiply two financial values (e.g., quantity × price).
 *
 * @example
 * safeMultiply(10, "55")   // 550
 * safeMultiply(2, "1250")  // 2500
 * safeMultiply("1.5", 55)  // 82.5
 */
export function safeMultiply(a: unknown, b: unknown): number {
  return toNumber(a) * toNumber(b)
}

/**
 * Safely subtract two financial values.
 *
 * @example
 * safeSubtract(1000, 100)  // 900
 * safeSubtract("1000", "100") // 900
 */
export function safeSubtract(a: unknown, b: unknown): number {
  return toNumber(a) - toNumber(b)
}

/**
 * Calculate percentage of a value.
 *
 * @example
 * percentOf(900, 18)  // 162 (18% of 900)
 * percentOf(1500, 5)  // 75 (5% of 1500)
 */
export function percentOf(value: unknown, percentage: unknown): number {
  return (toNumber(value) * toNumber(percentage)) / 100
}

/**
 * Check if a value is a valid number for financial calculations.
 *
 * @example
 * isValidNumber(55)      // true
 * isValidNumber("55")    // true (convertible)
 * isValidNumber(null)    // false
 * isValidNumber(NaN)     // false
 * isValidNumber("abc")   // false
 */
export function isValidNumber(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'number') return !isNaN(value) && isFinite(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return false
    const num = Number(trimmed)
    return !isNaN(num) && isFinite(num)
  }
  if (typeof value === 'object' && typeof (value as any).toNumber === 'function') {
    try {
      const num = (value as any).toNumber()
      return !isNaN(num) && isFinite(num)
    } catch {
      return false
    }
  }
  return false
}
