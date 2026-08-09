import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// GET /api/favorite-shops?customerPhone=X
//   Returns the customer's favorite shops.
//
// POST /api/favorite-shops
//   Body: { customerPhone, businessId, businessName, storeSlug }
//   Adds a favorite shop (auto-called on first order from merchant's link).
//   Uses upsert to avoid duplicates (unique [customerPhone, businessId]).
//
// DELETE /api/favorite-shops?customerPhone=X&businessId=Y
//   Removes a favorite shop.

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerPhone = searchParams.get('customerPhone')?.trim()

    if (!customerPhone) {
      return NextResponse.json(
        { error: 'customerPhone is required' },
        { status: 400 }
      )
    }

    const favorites = await db.favoriteShop.findMany({
      where: { customerPhone },
      orderBy: { addedAt: 'desc' },
    })

    return NextResponse.json({ favorites })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const customerPhone = String(body.customerPhone || '').trim()
    const businessId = String(body.businessId || '').trim()
    const businessName = String(body.businessName || '').trim()
    const storeSlug = String(body.storeSlug || '').trim()

    if (!customerPhone || !businessId || !businessName || !storeSlug) {
      return NextResponse.json(
        { error: 'customerPhone, businessId, businessName, storeSlug are required' },
        { status: 400 }
      )
    }

    // Upsert by unique [customerPhone, businessId]
    const favorite = await db.favoriteShop.upsert({
      where: {
        customerPhone_businessId: { customerPhone, businessId },
      },
      update: {
        // Refresh name/slug in case the shop rebranded.
        businessName,
        storeSlug,
      },
      create: {
        customerPhone,
        businessId,
        businessName,
        storeSlug,
      },
    })

    return NextResponse.json({ ok: true, favorite })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const customerPhone = searchParams.get('customerPhone')?.trim()
    const businessId = searchParams.get('businessId')?.trim()

    if (!customerPhone || !businessId) {
      return NextResponse.json(
        { error: 'customerPhone and businessId are required' },
        { status: 400 }
      )
    }

    await db.favoriteShop.deleteMany({
      where: { customerPhone, businessId },
    })

    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
