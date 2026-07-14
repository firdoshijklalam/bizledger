import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { generateSearchTags } from '@/lib/transliteration'

/**
 * §3: Backfill searchTags for existing parties and products.
 * Call: POST /api/backfill-search-tags  (only null tags)
 * Call: POST /api/backfill-search-tags?force=true  (regenerate ALL tags)
 */
export async function POST(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    // Backfill parties — force=true regenerates ALL tags even if already set
    const force = new URL(req.url).searchParams.get('force') === 'true'
    const partyWhere: any = { businessId: business.id }
    if (!force) partyWhere.searchTags = null
    const parties = await db.party.findMany({
      where: partyWhere,
      select: { id: true, name: true },
    })
    let partyCount = 0
    for (const p of parties) {
      const tags = JSON.stringify(generateSearchTags(p.name || ''))
      await db.party.update({ where: { id: p.id }, data: { searchTags: tags } })
      partyCount++
    }

    // Backfill products
    const productWhere: any = { businessId: business.id }
    if (!force) productWhere.searchTags = null
    const products = await db.product.findMany({
      where: productWhere,
      select: { id: true, name: true },
    })
    let productCount = 0
    for (const p of products) {
      const tags = JSON.stringify(generateSearchTags(p.name || ''))
      await db.product.update({ where: { id: p.id }, data: { searchTags: tags } })
      productCount++
    }

    return NextResponse.json({
      success: true,
      partiesUpdated: partyCount,
      productsUpdated: productCount,
      totalUpdated: partyCount + productCount,
    })
  } catch (e: any) {
    return NextResponse.json({ error: 'DB error', detail: String(e?.message || e) }, { status: 500 })
  }
}
