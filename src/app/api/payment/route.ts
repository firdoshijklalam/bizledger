import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/payment?token=TOKEN — public endpoint, returns invoice data for payment landing page
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const token = searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const invoice = await db.invoice.findFirst({
    where: { OR: [{ paymentLandingToken: token }, { id: token }] },
    include: { party: true, items: true },
  })
  if (!invoice) return NextResponse.json({ error: 'Invalid token' }, { status: 404 })

  const business = await db.business.findUnique({ where: { id: invoice.businessId } })
  if (!business) return NextResponse.json({ error: 'Business not found' }, { status: 404 })

  return NextResponse.json({
    invoice: {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      grandTotal: invoice.grandTotal,
      amountPaid: invoice.amountPaid,
      amountDue: invoice.amountDue,
      status: invoice.status,
      createdAt: invoice.createdAt,
      items: invoice.items,
    },
    party: invoice.party ? {
      name: invoice.party.name,
      phone: invoice.party.phone,
    } : null,
    business: {
      name: business.name,
      phone: business.phone,
      upiId: business.upiId,
      logoUrl: business.logoUrl,
      address: business.address,
      currency: business.currency,
    },
  })
}
