import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/invoices/[id]
// Security: verifies the invoice belongs to the current business.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

  try {
    const invoice = await db.invoice.findFirst({
      where: { id, businessId: business.id },
      include: { party: true, items: { include: { product: true } } },
    })
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(invoice)
  } catch (e: any) {
    // Fallback: try without product relation on items (may not exist in Neon yet)
    try {
      const invoice = await db.invoice.findFirst({
        where: { id, businessId: business.id },
        include: { party: true, items: true },
      })
      if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(invoice)
    } catch (e2: any) {
      // Last resort: invoice without relations
      try {
        const invoice = await db.invoice.findFirst({ where: { id, businessId: business.id } })
        if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
        return NextResponse.json({ ...invoice, party: null, items: [] })
      } catch (e3: any) {
        return NextResponse.json({ error: 'DB error', detail: String(e3?.message || e3) }, { status: 500 })
      }
    }
  }
}
