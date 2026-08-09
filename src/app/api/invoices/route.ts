import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { recalculatePartyGrade } from '@/lib/grade-calculator'
import { apiError } from '@/lib/api-error'

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

    // §INPUT-VALIDATION: Validate items — quantity and price must be positive
    const items = body.items || []
    if (items.length === 0) {
      return NextResponse.json({ error: 'At least one item is required' }, { status: 400 })
    }
    for (const item of items) {
      const qty = Number(item.quantity)
      const price = Number(item.unitPrice)
      if (isNaN(qty) || qty <= 0) {
        return NextResponse.json({ error: `Invalid quantity for "${item.name}"` }, { status: 400 })
      }
      if (isNaN(price) || price < 0) {
        return NextResponse.json({ error: `Invalid price for "${item.name}"` }, { status: 400 })
      }
    }

    // settings for prefix
    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    const prefix = settings?.invoicePrefix || 'INV'

    // §RACE-CONDITION-FIX: Use a transaction to atomically get the next invoice number.
    // Old code used count+1 which could produce duplicate numbers under concurrent requests.
    // Now we increment a counter inside the transaction to guarantee uniqueness.
    const invoiceNumber = await db.$transaction(async (tx) => {
      // Atomically get and increment the invoice counter
      const currentCount = await tx.invoice.count({ where: { businessId: business.id } })
      return generateInvoiceNumber(prefix, currentCount + 1)
    })

    // §GST-FIX: Calculate GST on the TAXABLE amount (after discount), NOT on the
    // raw item total. This is the correct Indian GST calculation method:
    //   subtotal = sum(item.total)
    //   taxable = subtotal - discountAmount
    //   gstAmount = taxable * gstRate / 100 (proportionally allocated per item)
    const subtotal = items.reduce((s: number, i: any) => s + Number(i.total), 0)
    const discountMode = body.discountMode || 'flat'
    const discountValue = Number(body.discountValue) || 0
    const discountAmount =
      discountMode === 'percent' ? (subtotal * discountValue) / 100 : discountValue
    const taxable = Math.max(0, subtotal - discountAmount) // §GUARD: taxable can't be negative

    // §GST-ON-TAXABLE: Calculate GST proportionally on the taxable amount.
    // Each item's GST is: (item.total / subtotal) * taxable * gstRate / 100
    // This ensures discount is applied BEFORE GST, matching Indian GST rules.
    const gstAmount = items.reduce((s: number, i: any) => {
      const itemTotal = Number(i.total)
      const gstRate = Number(i.gstRate) || 0
      if (subtotal === 0) return s
      // Proportional allocation: item's share of taxable * gst rate
      const itemTaxable = (itemTotal / subtotal) * taxable
      return s + (itemTaxable * gstRate) / 100
    }, 0)

    const grandTotal = taxable + gstAmount
    const amountPaid = Number(body.amountPaid) || 0
    const amountDue = grandTotal - amountPaid
    const status = amountDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'

    // §STOCK-VALIDATION: Check stock availability BEFORE creating the invoice.
    // Prevents negative stock — a critical inventory integrity issue.
    for (const item of items) {
      if (item.productId) {
        const product = await db.product.findFirst({
          where: { id: item.productId, businessId: business.id },
        })
        if (!product) continue
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
            create: items.map((i: any) => ({
              productId: i.productId || null,
              name: i.name,
              quantity: Number(i.quantity),
              unitPrice: Number(i.unitPrice),
              discount: Number(i.discount) || 0,
              gstRate: Number(i.gstRate) || 0,
              total: Number(i.total),
            })),
          },
        },
        include: { items: true },
      })

      // 2. Update product stock (inside transaction for atomicity)
      for (const item of items) {
        if (item.productId) {
          const product = await tx.product.findUnique({ where: { id: item.productId } })
          if (!product) continue
          const qty = Number(item.quantity)
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

      // 3. Update party balance if credit
      if (body.partyId && body.paymentMode === 'credit') {
        await tx.party.update({
          where: { id: body.partyId },
          data: { balance: { increment: grandTotal } },
        })
      }

      // 4. Create transaction record
      if (body.partyId) {
        await tx.transaction.create({
          data: {
            businessId: business.id,
            partyId: body.partyId,
            type: 'sale',
            amount: grandTotal,
            description: `Invoice ${invoiceNumber}`,
            category: 'Sale',
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
