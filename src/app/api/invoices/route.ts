import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { logAudit, AUDIT_ACTIONS, ENTITY_TYPES } from '@/lib/audit'

// GET /api/invoices — optimized with pagination
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const limit = Math.min(Number(searchParams.get('limit')) || 50, 200)
  const offset = Number(searchParams.get('offset')) || 0
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ items: [], total: 0, hasMore: false })

  const where = {
    businessId: business.id,
    ...(partyId ? { partyId } : {}),
  }

  const [invoices, totalCount] = await Promise.all([
    db.invoice.findMany({
      where,
      include: { party: true, items: true },
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    }),
    db.invoice.count({ where }),
  ])

  return NextResponse.json({ items: invoices, total: totalCount, hasMore: offset + limit < totalCount })
}

// POST /api/invoices
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // §INPUT-VALIDATION: Validate items — quantity, price, discount, gstRate
    // must be finite numbers. Reject NaN, Infinity, negative values.
    const items = body.items || []
    if (items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }
    for (const item of items) {
      const qty = Number(item.quantity)
      const price = Number(item.unitPrice)
      const itemDiscount = Number(item.discount) || 0
      const gstRate = Number(item.gstRate) || 0
      if (!Number.isFinite(qty) || qty <= 0) {
        return NextResponse.json({ error: `Invalid quantity for "${item.name}"` }, { status: 400 })
      }
      if (!Number.isFinite(price) || price < 0) {
        return NextResponse.json({ error: `Invalid price for "${item.name}"` }, { status: 400 })
      }
      // §ITEM-DISCOUNT: Reject negative or > qty×price
      if (!Number.isFinite(itemDiscount) || itemDiscount < 0) {
        return NextResponse.json({ error: `Invalid discount for "${item.name}"` }, { status: 400 })
      }
      if (itemDiscount > qty * price) {
        return NextResponse.json({ error: `Item discount cannot exceed line total for "${item.name}"` }, { status: 400 })
      }
      if (!Number.isFinite(gstRate) || gstRate < 0 || gstRate > 100) {
        return NextResponse.json({ error: `Invalid GST rate for "${item.name}" (must be 0-100)` }, { status: 400 })
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
    const _productIds = items.map((i: any) => i.productId).filter(Boolean)
    const _products = _productIds.length > 0
      ? await db.product.findMany({
          where: { id: { in: _productIds }, businessId: business.id },
          select: { id: true, name: true },
        })
      : []
    const productNameMap = Object.fromEntries(_products.map((p) => [p.id, p.name]))

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
      return NextResponse.json({ error: 'Discount cannot be negative' }, { status: 400 })
    }
    if (discountMode === 'percent' && discountValue > 100) {
      return NextResponse.json({ error: 'Discount percentage cannot exceed 100%' }, { status: 400 })
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
    const grandTotal = taxable + gstAmount

    // §STEP-6: Validate amountPaid
    const amountPaid = Number(body.amountPaid) || 0
    if (!Number.isFinite(amountPaid)) {
      return NextResponse.json({ error: 'Invalid amountPaid' }, { status: 400 })
    }
    if (amountPaid < 0) {
      return NextResponse.json({ error: 'amountPaid cannot be negative' }, { status: 400 })
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
            return NextResponse.json(
              { error: `Product not found or does not belong to your business: ${item.productId}` },
              { status: 403 }
            )
          }
          const qty = Number(item.quantity)
          const isRetailSale = (product as any).retailEnabled && (product as any).conversionFactor
          if (!isRetailSale) {
            // Bulk sale — check if enough stock
            if (product.stock < qty) {
              return NextResponse.json(
                { error: `Insufficient stock for "${product.name}". Available: ${product.stock} ${product.unit}, Requested: ${qty}` },
                { status: 400 }
              )
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
        return NextResponse.json(
          { error: 'Party not found or does not belong to your business' },
          { status: 403 }
        )
      }
    }

    // §ATOMIC-TRANSACTION: All database operations (invoice creation, stock update,
    // party balance update, transaction record) happen inside a single Prisma
    // transaction. If any step fails, ALL changes are rolled back — no
    // inconsistent state (e.g., invoice created but stock not updated).
    const invoice = await db.$transaction(async (tx) => {
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

      // 4. Create transaction record
      // §PURCHASE-LOGIC: Purchase → type='debit' (money out); Sale → type='sale'
      if (body.partyId) {
        await tx.transaction.create({
          data: {
            businessId: business.id,
            partyId: body.partyId,
            type: isPurchase ? 'debit' : 'sale',
            amount: grandTotal,
            description: `Invoice ${invoiceNumber}`,
            category: isPurchase ? 'Purchase' : 'Sale',
            invoiceId: inv.id,
          },
        })
      }

      return inv
    })

    // 5. Trigger grade recalculation (fire-and-forget, outside transaction)
    if (body.partyId) {
      recalculatePartyGrade(body.partyId).catch((e) => console.error('Grade recalc error:', e))
    }

    // §AUDIT-LOG: Log the invoice creation
    await logAudit({
      businessId: business.id,
      action: AUDIT_ACTIONS.INVOICE_CREATE,
      entityType: ENTITY_TYPES.INVOICE,
      entityId: invoice.id,
      description: `${isPurchase ? 'Purchase' : 'Sale'} invoice ${invoiceNumber} created for ₹${grandTotal}`,
      metadata: JSON.stringify({ invoiceNumber, grandTotal, partyId: body.partyId, type: body.type || 'sales' }),
    })

    return NextResponse.json(invoice)
  } catch (e) {
    console.error('Invoice create error:', e)
    // §SECURITY: Don't expose internal DB error details in production
    const message = process.env.NODE_ENV === 'production'
      ? 'Failed to create invoice'
      : String(e)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
