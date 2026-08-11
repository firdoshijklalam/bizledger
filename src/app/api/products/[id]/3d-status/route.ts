// PRD Part 34 §1 — 3D reconstruction status polling endpoint.
// GET: return the current/latest (or specific ?assetId=X) media asset
// including status, progress, and all score fields.

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const assetId = req.nextUrl.searchParams.get('assetId')

    let asset
    if (assetId) {
      asset = await db.productMediaAsset.findFirst({
        where: { id: assetId, productId: id },
      })
      if (!asset) {
        return NextResponse.json({ error: 'Asset not found' }, { status: 404 })
      }
    } else {
      asset = await db.productMediaAsset.findFirst({
        where: { productId: id },
        orderBy: { createdAt: 'desc' },
      })
    }

    return NextResponse.json({ asset })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
