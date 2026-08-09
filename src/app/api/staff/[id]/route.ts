import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'

// /api/staff/[id] — owner: update or delete a staff member.
// Security: verifies the staff belongs to the current business.

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()

    // Multi-tenant isolation: verify ownership
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const existing = await db.staff.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Staff not found in your business' }, { status: 404 })
    }

    // Whitelist allowed fields (prevent businessId tampering)
    const allowedFields = ['name', 'phone', 'role', 'isActive', 'permBilling', 'permInventory', 'permKhata', 'permReports', 'permSourcing', 'permSettings', 'permExport', 'permDelete']
    const updateData: Record<string, any> = {}
    for (const key of allowedFields) {
      if (body[key] !== undefined) updateData[key] = body[key]
    }

    const staff = await db.staff.update({ where: { id }, data: updateData })
    return NextResponse.json(staff)
  } catch (e) {
    return apiError(e, "Request failed")
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params

    // Multi-tenant isolation: verify ownership
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business found' }, { status: 400 })
    }

    const existing = await db.staff.findFirst({
      where: { id, businessId: business.id },
    })
    if (!existing) {
      return NextResponse.json({ error: 'Staff not found in your business' }, { status: 404 })
    }

    await db.staff.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
