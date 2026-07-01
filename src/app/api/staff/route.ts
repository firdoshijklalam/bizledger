import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { randomBytes } from 'crypto'

export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json([])
  const staff = await db.staff.findMany({ where: { businessId: business.id }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json(staff)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })
  
  // Generate 6-digit unique staff ID and QR token
  const staffId = String(Math.floor(100000 + Math.random() * 900000))
  const qrToken = randomBytes(16).toString('hex')
  
  const staff = await db.staff.create({
    data: {
      businessId: business.id,
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
