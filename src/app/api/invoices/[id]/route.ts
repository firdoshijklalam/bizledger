import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/invoices/[id]
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const invoice = await db.invoice.findUnique({
    where: { id },
    include: { party: true, items: { include: { product: true } } },
  })
  if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(invoice)
}
