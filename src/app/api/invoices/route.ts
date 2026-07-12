import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'
import { recalculatePartyGrade } from '@/lib/grade-calculator'

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
      select: {
        id: true,
        invoiceNumber: true,
        partyId: true,
        type: true,
        status: true,
        isGst: true,
        subtotal: true,
        discountAmount: true,
        gstAmount: true,
        grandTotal: true,
        amountPaid: true,
        amountDue: true,
        paymentMode: true,
        collectedByName: true,
        collectedByRole: true,
        createdAt: true,
        party: { select: { id: true, name: true, phone: true, qualityGrade: true } },
        items: { select: { id: true, name: true, quantity: true, unitPrice: true, total: true, gstRate: true } },
      },
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

    // settings for prefix
    const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
    const prefix = settings?.invoicePrefix || 'INV'
    const count = await db.invoice.count({ where: { businessId: business.id } })
    const invoiceNumber = generateInvoiceNumber(prefix, count + 1)

    const items = body.items || []
    const subtotal = items.reduce((s: number, i: any) => s + i.total, 0)
    const discountMode = body.discountMode || 'flat'
    const discountValue = Number(body.discountValue) || 0
    const discountAmount =
      discountMode === 'percent' ? (subtotal * discountValue) / 100 : discountValue
    const taxable = subtotal - discountAmount
    const gstAmount = items.reduce(
      (s: number, i: any) => s + (i.total * (Number(i.gstRate) || 0)) / 100,
      0
    )
    const grandTotal = taxable + gstAmount
    const amountPaid = Number(body.amountPaid) || 0
    const amountDue = grandTotal - amountPaid
    const status = amountDue <= 0 ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid'

    const invoice = await db.invoice.create({
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

    // Update product stock — PRD Part 11 §3: Dual-stock with auto bulk-to-loose conversion
    for (const item of items) {
      if (item.productId) {
        const product = await db.product.findUnique({ where: { id: item.productId } })
        if (!product) continue
        const qty = Number(item.quantity)
        // Check if this is a loose/retail sale (item has retailUnit or product has retailEnabled)
        const isRetailSale = (product as any).retailEnabled && (product as any).conversionFactor
        if (isRetailSale) {
          // PRD Part 11 §3.1: Fractional deduction engine
          const factor = (product as any).conversionFactor
          let bulkStock = product.stock
          let looseStock = (product as any).looseStock || 0
          let remaining = qty
          // First use loose stock
          if (looseStock >= remaining) {
            looseStock -= remaining
            remaining = 0
          } else {
            remaining -= looseStock
            looseStock = 0
          }
          // Cut bags from bulk if needed
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
          await db.product.update({
            where: { id: item.productId },
            data: { stock: bulkStock, looseStock },
          })
        } else {
          // Normal bulk sale — just decrement stock
          await db.product.update({
            where: { id: item.productId },
            data: { stock: { decrement: qty } },
          })
        }
      }
    }

    // Update party balance if credit
    if (body.partyId && body.paymentMode === 'credit') {
      await db.party.update({
        where: { id: body.partyId },
        data: { balance: { increment: grandTotal } },
      })
    }

    // Create transaction record
    if (body.partyId) {
      await db.transaction.create({
        data: {
          businessId: business.id,
          partyId: body.partyId,
          type: 'sale',
          amount: grandTotal,
          description: `Invoice ${invoiceNumber}`,
          category: 'Sale',
          invoiceId: invoice.id,
        },
      })

      // Trigger grade recalculation for this party (fire-and-forget)
      recalculatePartyGrade(body.partyId).catch((e) => console.error('Grade recalc error:', e))
    }

    return NextResponse.json(invoice)
  } catch (e) {
    console.error('Invoice create error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
