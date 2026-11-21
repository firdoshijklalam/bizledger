import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// /api/staff/[id] — owner/admin: update or delete a staff member.
// §RBAC: Requires OWNER or ADMIN role. STAFF → 403, unauthenticated → 401.
// Role comes from authenticated session, never from client.

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    // §RBAC: Require OWNER or ADMIN
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params
    const body = await req.json()

    // Multi-tenant isolation: verify ownership using authenticated businessId
    const existing = await db.staff.findFirst({
      where: { id, businessId: user.businessId },
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
    // §RBAC: Require OWNER or ADMIN
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const { id } = await params

    // Multi-tenant isolation: verify ownership using authenticated businessId
    const existing = await db.staff.findFirst({
      where: { id, businessId: user.businessId },
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
