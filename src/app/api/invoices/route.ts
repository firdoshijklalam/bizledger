import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { generateToken, generateInvoiceNumber } from '@/lib/utils'

// GET /api/invoices
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const partyId = searchParams.get('partyId')
  const business = await db.business.findFirst()
  if (!business) return NextResponse.json([])

  const invoices = await db.invoice.findMany({
    where: {
      businessId: business.id,
      ...(partyId ? { partyId } : {}),
    },
    include: { party: true, items: true },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  return NextResponse.json(invoices)
}

// POST /api/invoices
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await db.business.findFirst()
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

    // Update product stock (sale reduces stock)
    for (const item of items) {
      if (item.productId) {
        await db.product.update({
          where: { id: item.productId },
          data: { stock: { decrement: Number(item.quantity) } },
        })
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
    }

    return NextResponse.json(invoice)
  } catch (e) {
    console.error('Invoice create error:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
