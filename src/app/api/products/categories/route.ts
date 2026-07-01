import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/products/categories?q=search — distinct category list for autocomplete typeahead
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.toLowerCase()
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])

  const products = await db.product.findMany({
    where: { businessId: business.id },
    select: { category: true },
  })
  const categories = Array.from(
    new Set(products.map((p) => p.category).filter(Boolean) as string[])
  )
  const filtered = q ? categories.filter((c) => c.toLowerCase().includes(q)) : categories
  return NextResponse.json(filtered.sort())
}
