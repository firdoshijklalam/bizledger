import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { randomBytes } from 'crypto'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'

// §SECURITY: Staff management endpoints — OWNER/ADMIN only.
// Role comes from authenticated session, never from client.

export async function GET() {
  // §RBAC: Require OWNER or ADMIN role
  const user = await requireRole(['OWNER', 'ADMIN'])
  if (user instanceof NextResponse) return user

  const staff = await db.staff.findMany({ where: { businessId: user.businessId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(staff)
}

export async function POST(req: NextRequest) {
  // §RBAC: Require OWNER or ADMIN role
  const user = await requireRole(['OWNER', 'ADMIN'])
  if (user instanceof NextResponse) return user

  const body = await req.json()

  // Generate 6-digit unique staff ID and QR token
  const staffId = String(Math.floor(100000 + Math.random() * 900000))
  const qrToken = randomBytes(16).toString('hex')

  const staff = await db.staff.create({
    data: {
      businessId: user.businessId,
      name: body.name,
      phone: body.phone || null,
      role: body.role || 'sales',
      staffId,
      qrToken,
      permBilling: body.permBilling ?? true,
      permInventory: body.permInventory ?? false,
      permKhata: body.permKhata ?? false,
      permReports: body.permReports ?? false,
      permSourcing: body.permSourcing ?? false,
      permSettings: body.permSettings ?? false,
      permExport: body.permExport ?? false,
      permDelete: body.permDelete ?? false,
    },
  })
  return NextResponse.json(staff)
}
