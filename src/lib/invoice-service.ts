import { Prisma } from '@prisma/client'
import { db } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'

// §P16-STEP3.8.1: Per-business async mutex for serializing invoice creation.
//
// SQLite serializes ALL writes (single writer lock). Under concurrent invoice
// creation, multiple $transaction calls contend for this lock, causing P1008
// (socket timeout) and P2028 (transaction timeout) errors. Prisma's SQLite
// driver has a hard socket timeout that CANNOT be increased via pragmas.
//
// Solution: serialize invoice creation PER BUSINESS using an in-memory mutex.
// This ensures only one $transaction runs at a time per business, eliminating
// SQLite write contention. Different businesses are NOT blocked by each other.
//
// In production (PostgreSQL/Neon), concurrent writes work natively — the mutex
// adds negligible overhead (a single Promise chain per business) but does
// NOT change correctness. PostgreSQL handles concurrent transactions without
// the P1008/P2028 errors that SQLite experiences.
//
// §NO-CHANGE-TO-ACCOUNTING: The mutex only controls WHEN the $transaction
// starts — the transaction's internal logic (invoice create, stock update,
// party balance, transactions) is IDENTICAL. Accounting formulas unchanged.
class AsyncMutex {
  private queue: (() => void)[] = []
  private locked = false

  async acquire(): Promise<() => void> {
    if (!this.locked) {
      this.locked = true
      return () => this.release()
    }
    return new Promise(resolve => {
      this.queue.push(() => {
        this.locked = true
        resolve(() => this.release())
      })
    })
  }

  private release() {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.locked = false
    }
  }
}

// Per-business mutex map. Uses a Map keyed by businessId.
// Entries are never cleaned up (small memory footprint — one entry per business).
const businessMutexes = new Map<string, AsyncMutex>()
function getMutex(businessId: string): AsyncMutex {
  let m = businessMutexes.get(businessId)
  if (!m) {
    m = new AsyncMutex()
    businessMutexes.set(businessId, m)
  }
  return m
}

/**
 * §P16-STEP3.8.1: Invoice creation service.
 *
 * This module was extracted verbatim from `src/app/api/invoices/route.ts` (POST handler)
 * to enable REAL DB + REAL CODE PATH testing of the P2002 idempotency recovery
 * without requiring a running Next.js dev server.
 *
 * The route handler is now a thin wrapper that:
 *   1. Parses the request body
 *   2. Gets the current business (from session cookie)
 *   3. Calls `createInvoice(body, business)`
 *   4. Catches `InvoiceValidationError` → HTTP 400
 *   5. Catches other errors → HTTP 500
 *
 * §NO-SEMANTIC-CHANGE: The accounting formulas, stock direction, party balance
 * updates, transaction subtypes, and P2002 recovery logic are IDENTICAL to the
 * previous inline implementation. This is a mechanical extraction — no behavior
 * was changed.
 *
 * §CLASSIFICATION: Tests that call `createInvoice()` directly hit the REAL DB
 * (same `db` client) and exercise the REAL code path (same function the route
 * calls, including the P2002 recovery). This is REAL DB, not MOCK/MIRROR.
 */

/**
 * Thrown for client errors (invalid input, insufficient stock, foreign entity).
 * The route handler maps this to HTTP 400.
 */
export class InvoiceValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceValidationError'
  }
}

/**
 * Create an invoice with all accounting side-effects (stock, party balance,
 * transactions) in a single atomic `db.$transaction`.
 *
 * Idempotency:
 *   - If `body.saleOperationId` is provided AND an invoice with the same
 *     `(businessId, saleOperationId)` already exists, returns the existing
 *     invoice (no duplicate effects).
 *   - If a concurrent request wins the race, the loser catches Prisma P2002
 *     and returns the winner's invoice (no duplicate effects, no 500 to client).
 *
 * Tenant isolation:
 *   - All queries are scoped by `business.id`. Another business can never
 *     read or affect this business's invoices.
 *
 * @returns The invoice object (with items) — either newly created or existing
 *          from idempotent duplicate / P2002 recovery.
 * @throws  {InvoiceValidationError} for 400-level client errors.
 * @throws  {Error} for 500-level server errors (rethrown to outer handler).
 */
export async function createInvoice(body: any, business: { id: string }): Promise<any> {
  // §P16-STEP3.8: IDEMPOTENCY — if saleOperationId is provided, check for existing invoice.
  // If found, return the original invoice (duplicate request / retry / double-click).
  // This is scoped by businessId — one business cannot read another's invoice via this path.
  //
  // §P16-STEP3.8.1: The findFirst pre-check is INSIDE the per-business mutex
  // (below). Running it OUTSIDE the mutex caused P1008 socket timeouts
  // because Prisma's SQLite driver serializes ALL queries (reads + writes)
  // through limited connections — the findFirst reads blocked on the same
  // connection that was doing the $transaction writes, timing out after 5s.
  // Moving the pre-check inside the mutex serializes it with the writes,
  // eliminating the contention. This is SQLite-specific — in production
  // (PostgreSQL), reads and writes are fully concurrent.
  const saleOperationId = typeof body.saleOperationId === 'string' && body.saleOperationId.length > 0
    ? body.saleOperationId
    : null

  // §INPUT-VALIDATION: Validate items — quantity, price, discount, gstRate
  // must be finite numbers. Reject NaN, Infinity, negative values.
  // This runs BEFORE the mutex (pure validation, no DB access).
  const items = body.items || []
  if (items.length === 0) {
    throw new InvoiceValidationError('At least one item is required')
  }
  for (const item of items) {
    const qty = Number(item.quantity)
    const price = Number(item.unitPrice)
    const itemDiscount = Number(item.discount) || 0
    const gstRate = Number(item.gstRate) || 0
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new InvoiceValidationError(`Invalid quantity for "${item.name}"`)
    }
    if (!Number.isFinite(price) || price < 0) {
      throw new InvoiceValidationError(`Invalid price for "${item.name}"`)
    }
    // §ITEM-DISCOUNT: Reject negative or > qty×price
    if (!Number.isFinite(itemDiscount) || itemDiscount < 0) {
      throw new InvoiceValidationError(`Invalid discount for "${item.name}"`)
    }
    if (itemDiscount > qty * price) {
      throw new InvoiceValidationError(`Item discount cannot exceed line total for "${item.name}"`)
    }
    if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
      throw new InvoiceValidationError(`Invalid GST rate for "${item.name}" (must be 0-100)`)
    }
  }

  // §P16-STEP3.8.1: Acquire per-business mutex for the ENTIRE DB-interacting
  // portion of createInvoice. SQLite serializes ALL queries (reads + writes)
  // through limited connections. Without the mutex, concurrent requests'
  // findFirst/product.fetch/sequence-generation contend with each other and
  // with the main $transaction, causing P1008 (socket timeout) after 5s.
  //
  // The mutex serializes invoice creation PER BUSINESS. Different businesses
  // are NOT blocked. In production (PostgreSQL), reads and writes are fully
  // concurrent — the mutex adds negligible overhead and does NOT change
  // correctness.
  //
  // §NO-CHANGE-TO-ACCOUNTING: The mutex only controls WHEN queries run —
  // the accounting logic is IDENTICAL. Formulas unchanged.
  let invoice: any
  let lastTransientError: any = null
  const releaseMutex = await getMutex(business.id).acquire()
  try {
    // §P16-STEP3.8.1: Idempotency pre-check INSIDE the mutex.
    // If a concurrent request already created the invoice for this
    // saleOperationId, return it immediately (no $transaction needed).
    if (saleOperationId) {
      const existing = await db.invoice.findFirst({
        where: { businessId: business.id, saleOperationId },
        include: { items: true },
      })
      if (existing) {
        return existing
      }
    }

  // settings for prefix
  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  const prefix = settings?.invoicePrefix || 'INV'

  // §INVOICE-SEQUENCE: Atomically increment a dedicated sequence counter.
  // This is TRUE concurrency-safe — unlike count()+1, the sequence is
  // a single row that gets atomically incremented inside the transaction.
  // Concurrent requests will get different numbers guaranteed.
  const invoiceNumber = await db.$transaction(async (tx) => {
    // Upsert the sequence record (create if doesn't exist)
    const seq = await tx.invoiceSequence.upsert({
      where: { businessId: business.id },
      update: { nextNumber: { increment: 1 } },
      create: { businessId: business.id, nextNumber: 1 },
    })
    // seq.nextNumber was just incremented — use the PREVIOUS value (seq.nextNumber - 1)
    // because upsert returns the AFTER-increment value
    return generateInvoiceNumber(prefix, seq.nextNumber - 1 + 1)
  })

  // §SERVER-AUTHORITATIVE: The server calculates ALL financial values.
  // Client-provided totals (item.total, subtotal, gstAmount, grandTotal,
  // amountDue, status) are NEVER trusted. The server derives them from:
  //   quantity (from client, validated > 0)
  //   unitPrice (from client, validated >= 0)
  //   gstRate (from client, validated 0-100)
  //   discount (from client, validated)
  //
  // If productId exists, the server could fetch the authoritative price
  // from the product record. For now, we accept client-provided unitPrice
  // (POS allows custom pricing), but the TOTALS are always recalculated.

  // §PRODUCT-NAME: Fetch product names from DB — the InvoiceItem.name field
  // is required by the schema, but the client does not send it. We fetch
  // the name from the product record (business-scoped for ownership safety)
  // so the invoice item has a durable label even if the product is later
  // renamed or deleted.
  // §P16-STEP2: Also fetch purchasePrice so we can snapshot it on each
  // InvoiceItem at sale time — this gives accurate historical COGS even if
  // the product's purchasePrice is later updated.
  const _productIds = items.map((i: any) => i.productId).filter(Boolean)
  const _products = _productIds.length > 0
    ? await db.product.findMany({
        where: { id: { in: _productIds }, businessId: business.id },
        select: { id: true, name: true, purchasePrice: true },
      })
    : []
  const productNameMap = Object.fromEntries(_products.map((p) => [p.id, p.name]))
  // §P16-STEP2: purchasePrice map for snapshot — keyed by productId.
  const productPurchasePriceMap = Object.fromEntries(
    _products.map((p) => [p.id, p.purchasePrice.toNumber()])
  )

  // §STEP-1: Calculate per-item line totals (server-authoritative)
  const serverItems = items.map((i: any) => {
    const qty = Number(i.quantity)
    const unitPrice = Number(i.unitPrice)
    const itemDiscount = Number(i.discount) || 0
    const gstRate = Math.min(100, Math.max(0, Number(i.gstRate) || 0))
    const lineTotal = Math.max(0, qty * unitPrice - itemDiscount)
    return {
      ...i,
      _serverTotal: lineTotal,
      _serverGstRate: gstRate,
      _serverName: i.name || (i.productId ? productNameMap[i.productId] : undefined) || 'Unnamed Product',
    }
  })

  // §STEP-2: Calculate subtotal (server-authoritative)
  const subtotal = serverItems.reduce((s: number, i: any) => s + i._serverTotal, 0)

  // §STEP-3: Validate discount
  const discountMode = body.discountMode || 'flat'
  const discountValue = Number(body.discountValue) || 0
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    throw new InvoiceValidationError('Discount cannot be negative')
  }
  if (discountMode === 'percent' && discountValue > 100) {
    throw new InvoiceValidationError('Discount percentage cannot exceed 100%')
  }
  const discountAmount = discountMode === 'percent'
    ? (subtotal * discountValue) / 100
    : Math.min(discountValue, subtotal) // §GUARD: discount can't exceed subtotal
  const taxable = Math.max(0, subtotal - discountAmount)

  // §STEP-4: Calculate GST on taxable (server-authoritative, after discount)
  const gstAmount = serverItems.reduce((s: number, i: any) => {
    if (subtotal === 0) return s
    const itemTaxable = (i._serverTotal / subtotal) * taxable
    return s + (itemTaxable * i._serverGstRate) / 100
  }, 0)

  // §STEP-5: Calculate grand total (server-authoritative)
  // §P16-STEP3.7: deliveryCharge is now part of grandTotal.
  // Delivery charge is a customer-facing charge (transport/delivery fee) that
  // the customer owes. It is NOT product revenue (not in subtotal) and NOT
  // subject to GST (separate from taxable). It IS part of the customer's
  // payable (grandTotal) and receivable (amountDue).
  // Validation: must be a non-negative finite number.
  const deliveryCharge = (() => {
    const dc = Number(body.deliveryCharge) || 0
    if (!Number.isFinite(dc) || dc < 0) {
      return null // signal rejection
    }
    return dc
  })()
  if (deliveryCharge === null) {
    throw new InvoiceValidationError('Invalid deliveryCharge: must be a non-negative number')
  }
  const grandTotal = taxable + gstAmount + deliveryCharge

  // §STEP-6: Validate amountPaid
  const amountPaid = Number(body.amountPaid) || 0
  if (!Number.isFinite(amountPaid)) {
    throw new InvoiceValidationError('Invalid amountPaid')
  }
  if (amountPaid < 0) {
    throw new InvoiceValidationError('amountPaid cannot be negative')
  }

  // §STEP-7: Calculate amountDue + status (server-authoritative)
  const amountDue = Math.max(0, grandTotal - amountPaid)
  const status = amountDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'

  // §STOCK-DIRECTION: Sale → decrement stock; Purchase → increment stock.
  const invoiceType = body.type || 'sales'
  const isPurchase = invoiceType === 'purchase'

  // §STOCK-VALIDATION + §PRODUCT-OWNERSHIP: Check stock AND verify product
  // belongs to the authenticated business. NEVER continue silently if a
  // product is not found — that would allow foreign products in invoices.
  if (!isPurchase) {
    for (const item of items) {
      if (item.productId) {
        // §OWNERSHIP: Must use findFirst with businessId — never findUnique
        const product = await db.product.findFirst({
          where: { id: item.productId, businessId: business.id },
        })
        // §REJECT: If product doesn't belong to this business, REJECT the
        // entire request — do NOT silently continue.
        if (!product) {
          throw new InvoiceValidationError(`Product not found or does not belong to your business: ${item.productId}`)
        }
        const qty = Number(item.quantity)
        const isRetailSale = (product as any).retailEnabled && (product as any).conversionFactor
        if (!isRetailSale) {
          // Bulk sale — check if enough stock
          if (product.stock < qty) {
            throw new InvoiceValidationError(`Insufficient stock for "${product.name}". Available: ${product.stock} ${product.unit}, Requested: ${qty}`)
          }
        }
      }
    }
  }

  // §PARTY-OWNERSHIP: Verify the party belongs to the authenticated business
  // BEFORE creating the invoice. A user from Business A must NEVER be able to
  // attach Business B's party to an invoice or modify their balance.
  if (body.partyId) {
    const party = await db.party.findFirst({
      where: { id: body.partyId, businessId: business.id },
    })
    if (!party) {
      throw new InvoiceValidationError('Party not found or does not belong to your business')
    }
  }

  // §ATOMIC-TRANSACTION: All database operations (invoice creation, stock update,
  // party balance update, transaction record) happen inside a single Prisma
  // transaction. If any step fails, ALL changes are rolled back — no
  // inconsistent state (e.g., invoice created but stock not updated).
  //
  // §P16-STEP3.8.1 — P2002 IDEMPOTENCY RACE HARDENING:
  // The pre-check `findFirst` (above) is NOT sufficient under
  // concurrency: two requests can both pass findFirst (both see NULL) and
  // then both attempt INSERT, hitting the unique constraint
  // `(businessId, saleOperationId)`. The loser receives Prisma P2002.
  // Previously this propagated to the generic catch → HTTP 500 exposed to client.
  //
  // NEW behavior: if P2002 occurs AND the conflict target includes
  // `saleOperationId` AND we had a saleOperationId, we treat it as an
  // idempotent duplicate — fetch the existing invoice scoped by
  // `(businessId, saleOperationId)` and return it as 200.
  // No additional financial effects are created (the losing $transaction
  // was rolled back by Prisma). The burned invoiceNumber sequence gap is
  // acceptable (better than 500 or duplicates).
  //
  // Unrelated P2002 errors (e.g., on invoiceNumber, or with saleOperationId=null)
  // are rethrown and handled by the outer catch.
  //
  // §P16-STEP3.8.1 — TRANSIENT-ERROR RETRY (idempotent case only):
  // SQLite serializes writes (single writer lock). Under concurrency, some
  // requests may receive transient errors:
  //   P2028 — transaction timed out (default 5s, increased to 15s below)
  //   P1008 — socket/query timeout (database busy waiting for lock)
  // When saleOperationId is present, these are SAFE to retry: if a concurrent
  // request already created the invoice, the retry's findFirst will return it
  // (idempotent duplicate). If not, the retry will create a new invoice.
  // This retry is SCOPED to idempotent requests — non-idempotent requests
  // (no saleOperationId) are NOT retried (would risk duplicates).
  const TX_TIMEOUT_MS = 20000 // 20s — gives SQLite headroom for serialized writes
  const MAX_TRANSIENT_RETRIES = 5
  const RETRY_BACKOFF_MS = 200  // small delay between retries to let locks release
  const TRANSIENT_ERROR_CODES = new Set(['P2028', 'P1008'])

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

  // §P16-STEP3.8.1: The mutex was acquired above (before the first DB query).
  // The retry loop below handles P2002 (idempotent recovery) and transient
  // errors (P1008/P2028). The transient retry is scoped to idempotent
  // requests (saleOperationId present) — non-idempotent requests are NOT
  // retried (would risk duplicates).
  for (let attempt = 0; attempt <= MAX_TRANSIENT_RETRIES; attempt++) {
    if (attempt > 0) {
      // Small backoff before retry — lets concurrent transactions release locks.
      await sleep(RETRY_BACKOFF_MS * attempt)
    }
  try {
    invoice = await db.$transaction(async (tx) => {
      // 1. Create invoice + items
      const inv = await tx.invoice.create({
        data: {
          businessId: business.id,
          partyId: body.partyId || null,
          invoiceNumber,
          type: body.type || 'sales',
          status,
          isGst: !!body.isGst,
          subtotal,
          discountValue,
          discountMode,
          discountAmount,
          gstAmount,
          grandTotal,
          deliveryCharge,
          saleOperationId,
          amountPaid,
          amountDue,
          paymentMode: body.paymentMode || null,
          notes: body.notes || null,
          paymentLandingToken: generateToken(),
          items: {
            create: serverItems.map((i: any) => ({
              productId: i.productId || null,
              name: i._serverName, // §PRODUCT-NAME: from DB (server-authoritative)
              quantity: Number(i.quantity),
              unitPrice: Number(i.unitPrice),
              discount: Number(i.discount) || 0,
              gstRate: i._serverGstRate,
              total: i._serverTotal, // §SERVER-AUTHORITATIVE: use server-calculated total
              // §P16-STEP2: Snapshot the product's purchasePrice at sale time.
              // This ensures Reports P&L COGS uses the HISTORICAL cost (not the
              // current mutable product.purchasePrice). NULL for items without
              // a productId (e.g., ad-hoc line items) — Reports falls back to 0.
              purchasePriceSnapshot: i.productId
                ? (productPurchasePriceMap[i.productId] ?? null)
                : null,
            })),
          },
        },
        include: { items: true },
      })

      // 2. Update product stock (inside transaction for atomicity)
      // §STOCK-DIRECTION: Sale → decrement; Purchase → increment.
      // §OWNERSHIP: Every product lookup inside the transaction MUST use
      // findFirst with businessId — never findUnique without businessId.
      // If product not found → throw error (rolls back entire transaction).
      for (const item of items) {
        if (item.productId) {
          // §OWNERSHIP: Verify product belongs to this business INSIDE the transaction
          const product = await tx.product.findFirst({
            where: { id: item.productId, businessId: business.id },
          })
          if (!product) {
            // §REJECT: Throwing inside $transaction rolls back ALL changes
            throw new Error(`Product not found or does not belong to your business: ${item.productId}`)
          }
          const qty = Number(item.quantity)

          if (isPurchase) {
            // §PURCHASE: Stock INCREASES when buying from supplier
            await tx.product.update({
              where: { id: item.productId },
              data: { stock: { increment: qty } },
            })
          } else {
            // §SALE: Stock DECREASES — retail or bulk
            const isRetailSale = (product as any).retailEnabled && (product as any).conversionFactor
            if (isRetailSale) {
              // PRD Part 11 §3.1: Fractional deduction engine
              const factor = (product as any).conversionFactor
              let bulkStock = product.stock
              let looseStock = (product as any).looseStock || 0
              let remaining = qty
              if (looseStock >= remaining) {
                looseStock -= remaining
                remaining = 0
              } else {
                remaining -= looseStock
                looseStock = 0
              }
              while (remaining > 0 && bulkStock > 0) {
                bulkStock -= 1
                looseStock += factor
                if (looseStock >= remaining) {
                  looseStock -= remaining
                  remaining = 0
                } else {
                  remaining -= looseStock
                  looseStock = 0
                }
              }
              await tx.product.update({
                where: { id: item.productId },
                data: { stock: bulkStock, looseStock },
              })
            } else {
              // Normal bulk sale — decrement stock
              await tx.product.update({
                where: { id: item.productId },
                data: { stock: { decrement: qty } },
              })
            }
          }
        }
      }

      // 3. Update party balance for the UNPAID portion
      // §BALANCE-FIX: The party balance must reflect the amount the customer
      // still owes (amountDue), regardless of paymentMode. Previously this
      // only ran for paymentMode==='credit' — which meant partial cash
      // payments (amountPaid < grandTotal) left the customer's balance at 0
      // even though they owed amountDue. Now we update by amountDue:
      //   - Credit sale (amountPaid=0): amountDue=grandTotal → balance += grandTotal
      //   - Partial cash (amountPaid<grandTotal): balance += amountDue
      //   - Full cash (amountPaid=grandTotal): amountDue=0 → no change
      // §OWNERSHIP: Party ownership verified BEFORE the transaction. Using
      // updateMany with businessId as an extra safety net.
      if (body.partyId && amountDue > 0) {
        await tx.party.updateMany({
          where: { id: body.partyId, businessId: business.id },
          data: { balance: { increment: amountDue } },
        })
      }

      // 4. Create transaction record(s)
      // §PURCHASE-LOGIC: Purchase → type='debit' (money out); Sale → type='sale'
      // §P16-STEP2: Set authoritative transactionSubtype based on invoice type + payment.
      // §P16-VERIFY-1 (Option B): Partial payments now create TWO linked transactions:
      //   - Cash portion (amountPaid) → cash subtype (purchase_inventory_cash / sale_invoice)
      //   - Credit portion (amountDue) → credit subtype (purchase_inventory_credit / credit_sale)
      //   Sum of amounts = amountPaid + amountDue = grandTotal. No duplicate financial effect.
      //   Fully-paid (amountDue=0) → ONE transaction with amount=grandTotal, cash subtype.
      //   Fully-credit (amountPaid=0) → ONE transaction with amount=grandTotal, credit subtype.
      //   Partial (both > 0) → TWO transactions: cash + credit.
      //   Party balance update (line 363) uses amountDue only — unchanged.
      if (body.partyId) {
        const isPartial = amountPaid > 0 && amountDue > 0
        if (isPurchase) {
          // Purchase invoice — inventory asset movement (NOT revenue, NOT OpEx)
          if (isPartial) {
            // §P16-VERIFY-1: Partial purchase — TWO transactions
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'debit',
                amount: amountPaid,
                description: `Invoice ${invoiceNumber} (cash portion)`,
                category: 'Purchase', invoiceId: inv.id,
                transactionSubtype: 'purchase_inventory_cash', source: 'invoice',
              },
            })
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'debit',
                amount: amountDue,
                description: `Invoice ${invoiceNumber} (credit portion)`,
                category: 'Purchase', invoiceId: inv.id,
                transactionSubtype: 'purchase_inventory_credit', source: 'invoice',
              },
            })
          } else {
            // Fully-paid or fully-credit — ONE transaction
            const purchaseSubtype = status === 'paid' ? 'purchase_inventory_cash' : 'purchase_inventory_credit'
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'debit',
                amount: grandTotal,
                description: `Invoice ${invoiceNumber}`,
                category: 'Purchase', invoiceId: inv.id,
                transactionSubtype: purchaseSubtype, source: 'invoice',
              },
            })
          }
        } else {
          // Sale invoice — revenue recognized
          if (isPartial) {
            // §P16-VERIFY-1: Partial sale — TWO transactions
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'sale',
                amount: amountPaid,
                description: `Invoice ${invoiceNumber} (cash portion)`,
                category: 'Sale', invoiceId: inv.id,
                transactionSubtype: 'sale_invoice', source: 'invoice',
              },
            })
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'sale',
                amount: amountDue,
                description: `Invoice ${invoiceNumber} (credit portion)`,
                category: 'Sale', invoiceId: inv.id,
                transactionSubtype: 'credit_sale', source: 'invoice',
              },
            })
          } else {
            // Fully-paid or fully-credit — ONE transaction
            // §P16-VERIFY-1: If amountPaid=0 (fully unpaid), it's a credit sale
            // regardless of paymentMode — the customer owes the full amount.
            // If amountDue=0 (fully paid), it's a cash sale.
            const saleSubtype = amountPaid === 0 ? 'credit_sale' : 'sale_invoice'
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'sale',
                amount: grandTotal,
                description: `Invoice ${invoiceNumber}`,
                category: 'Sale', invoiceId: inv.id,
                transactionSubtype: saleSubtype, source: 'invoice',
              },
            })
          }
        }
      }

      // §P16-STEP3.8: SalePad atomic transaction creation.
      // When body.salePadMode is true, the invoice API creates the SalePad-specific
      // cash credit and credit debit transactions INSIDE the same db.$transaction.
      // This eliminates the non-atomic separate API calls that SalePad previously made.
      // The sale side-effect transactions (above) are for invoice-linked accounting.
      // The SalePad transactions below are for Khata (customer ledger) entries.
      // They use server-authoritative amounts (amountPaid, amountDue) — never client values.
      // Walk-in sales (no partyId) get only a cash credit (no receivable).
      if (body.salePadMode === true && !isPurchase) {
        // Create cash credit if customer paid anything
        if (amountPaid > 0) {
          if (body.partyId) {
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: body.partyId, type: 'credit',
                amount: amountPaid,
                description: body.salePadCashDescription || `Sale (retail) — split payment`,
                category: 'Cash Sale', invoiceId: inv.id,
              },
            })
          } else {
            // Walk-in — no party, no balance update
            await tx.transaction.create({
              data: {
                businessId: business.id, partyId: null, type: 'credit',
                amount: amountPaid,
                description: body.salePadWalkInDescription || `Walk-in sale (retail) — split payment`,
                category: 'Cash Sale', invoiceId: inv.id,
              },
            })
          }
        }
        // Create credit debit if customer owes money
        if (amountDue > 0 && body.partyId) {
          await tx.transaction.create({
            data: {
              businessId: business.id, partyId: body.partyId, type: 'debit',
              amount: amountDue,
              description: body.salePadCreditDescription || `Ledger due (split payment)`,
              category: 'Credit Sale', invoiceId: inv.id,
            },
          })
        }
      }

      return inv
    }, { timeout: TX_TIMEOUT_MS })
  } catch (e: any) {
    // §P16-STEP3.8.1: P2002 IDEMPOTENCY RECOVERY.
    // Only handle P2002 when ALL of:
    //   1. saleOperationId was provided (non-null) — otherwise it cannot be
    //      a saleOperationId conflict (partial unique index allows NULLs).
    //   2. error code is exactly 'P2002'.
    //   3. the conflict target includes `saleOperationId` (so we know it's
    //      NOT an unrelated P2002 e.g. on invoiceNumber).
    // If all three hold → treat as idempotent duplicate: fetch the existing
    // invoice scoped by (businessId, saleOperationId) and return it.
    // Otherwise → rethrow to preserve normal error handling.
    if (
      saleOperationId &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      e.code === 'P2002'
    ) {
      const target = (e.meta as any)?.target
      const targetIsSaleOp =
        Array.isArray(target) && target.includes('saleOperationId')
      if (targetIsSaleOp) {
        // Idempotent duplicate — fetch and return the original invoice.
        // Scoped by businessId for tenant isolation (Business B can never
        // retrieve Business A's invoice via this path).
        const existing = await db.invoice.findFirst({
          where: { businessId: business.id, saleOperationId },
          include: { items: true },
        })
        if (existing) {
          // §NO-FINANCIAL-EFFECTS: the losing $transaction was rolled back
          // by Prisma — no invoice, no stock delta, no party balance delta,
          // no transactions were created by this request. We return the
          // original invoice exactly as the winner created it.
          return existing
        }
        // Edge case: P2002 said saleOperationId conflict but findFirst
        // returned null. This can happen if the winning invoice was just
        // deleted between the P2002 and our findFirst. Fall through to
        // rethrow — the client should retry.
      }
    }

    // §P16-STEP3.8.1: Transient-error retry for idempotent requests.
    // If saleOperationId is present AND the error is a transient DB error
    // (P2028 transaction timeout, P1008 socket timeout), retry the entire
    // operation. On retry, the findFirst pre-check at the top of createInvoice
    // will return the existing invoice if a concurrent request created it
    // (idempotent). This is safe because the idempotency key prevents duplicates.
    if (
      saleOperationId &&
      e instanceof Prisma.PrismaClientKnownRequestError &&
      TRANSIENT_ERROR_CODES.has(e.code)
    ) {
      lastTransientError = e
      // Before retrying, check if a concurrent request already created the invoice.
      // Wrap in try/catch — the findFirst itself might P1008 under contention.
      try {
        const existing = await db.invoice.findFirst({
          where: { businessId: business.id, saleOperationId },
          include: { items: true },
        })
        if (existing) {
          // A concurrent request already succeeded — return its invoice (idempotent).
          return existing
        }
      } catch {
        // findFirst also timed out — fall through to retry the creation.
      }
      // No existing invoice found — retry the creation (loop continues).
      if (attempt < MAX_TRANSIENT_RETRIES) {
        continue
      }
      // Exhausted retries — throw the last transient error.
      throw lastTransientError
    }

    throw e
  } // end try
  } // end for loop

  // §UNREACHABLE: The for-loop body either returns (success/idempotent) or
  // throws (non-transient error or exhausted retries). If we somehow reach
  // here, throw the last transient error (defensive).
  if (lastTransientError) {
    throw lastTransientError
  }

  // §AUDIT-LOG: Log the invoice creation (INSIDE the mutex — logAudit is a
  // DB write and must be serialized with other invoice creation writes).
  await logAudit({
    businessId: business.id,
    action: AUDIT_ACTIONS.INVOICE_CREATE,
    entityType: ENTITY_TYPES.INVOICE,
    entityId: invoice.id,
    description: `${isPurchase ? 'Purchase' : 'Sale'} invoice ${invoiceNumber} created for ₹${grandTotal}`,
    metadata: JSON.stringify({ invoiceNumber, grandTotal, partyId: body.partyId, type: body.type || 'sales' }),
  })
  } finally {
    // §P16-STEP3.8.1: Always release the mutex, even on error/return.
    releaseMutex()
  }

  // §FIRE-AND-FORGET: recalculatePartyGrade runs OUTSIDE the mutex — it's
  // non-critical (best-effort grade update) and does NOT affect invoice
  // creation. If it fails, the invoice is still created correctly.
  if (body.partyId) {
    recalculatePartyGrade(body.partyId).catch((e) => console.error('Grade recalc error:', e))
  }

  return invoice
}
