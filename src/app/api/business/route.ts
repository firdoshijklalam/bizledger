import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// GET /api/business — get the current user's business (session-authenticated).
// Security: uses getCurrentBusiness() which reads the session cookie → User →
// businessId. Returns 401 if not authenticated. NO hardcoded fallback.
export async function GET() {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    return NextResponse.json(business)
  } catch (e: any) {
    return apiError(e, "Database error")
  }
}

// PUT /api/business — update business profile (session-authenticated).
// §RBAC: Updating the business profile (name, GSTIN, PAN, UPI ID, store slug,
// delivery radius, lat/lng) is an OWNER/ADMIN action. STAFF must not be able
// to redirect payments to a different UPI ID or change the store slug.
export async function PUT(req: NextRequest) {
  try {
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = await req.json()
    // Only update non-null fields (partial update)
    const data: Record<string, any> = {}
    const fields = ['name', 'ownerName', 'phone', 'email', 'address', 'state', 'gstin', 'pan', 'upiId', 'currency', 'logoUrl', 'coverUrl', 'storeSlug', 'deliveryRadiusKm', 'latitude', 'longitude']
    for (const f of fields) {
      if (body[f] !== undefined) data[f] = body[f]
    }
    const updated = await db.business.update({
      where: { id: business.id },
      data,
    })
    return NextResponse.json(updated)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
