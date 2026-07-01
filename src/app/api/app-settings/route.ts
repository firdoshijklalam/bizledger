import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'

// GET /api/app-settings
export async function GET() {
  const business = await getCurrentBusiness()
  if (!business) return NextResponse.json(null)
  const settings = await db.appSettings.findUnique({ where: { businessId: business.id } })
  if (!settings) {
    const created = await db.appSettings.create({ data: { businessId: business.id } })
    return NextResponse.json(created)
  }
  return NextResponse.json(settings)
}

// PUT /api/app-settings
export async function PUT(req: NextRequest) {
  try {
    const body = await req.json()
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const updated = await db.appSettings.upsert({
      where: { businessId: business.id },
      update: {
        notificationsEnabled: body.notificationsEnabled,
        autoBackupEnabled: body.autoBackupEnabled,
        language: body.language,
        dateFormat: body.dateFormat,
        invoicePrefix: body.invoicePrefix,
        pinEnabled: body.pinEnabled,
        userRole: body.userRole,
        biometricEnabled: body.biometricEnabled,
        // PRD Part 32 §1: Biometric action gates config
        gateOwnerSwitch: body.gateOwnerSwitch,
        gateHighValueDiscount: body.gateHighValueDiscount,
        gateDiscountLimit: body.gateDiscountLimit,
        gateDataExport: body.gateDataExport,
        gateInventoryPrice: body.gateInventoryPrice,
        gateDangerZone: body.gateDangerZone,
        // PRD Part 32 §2: External scanner
        externalScannerEnabled: body.externalScannerEnabled,
        // PRD Part 32 §3: Defaulter registry
        defaulterRegistryEnabled: body.defaulterRegistryEnabled,
      },
      create: {
        businessId: business.id,
        notificationsEnabled: body.notificationsEnabled ?? true,
        autoBackupEnabled: body.autoBackupEnabled ?? false,
        language: body.language ?? 'en',
        dateFormat: body.dateFormat ?? 'DD/MM/YYYY',
        invoicePrefix: body.invoicePrefix ?? 'INV',
        pinEnabled: body.pinEnabled ?? false,
        userRole: body.userRole ?? 'owner',
        biometricEnabled: body.biometricEnabled ?? false,
        gateOwnerSwitch: body.gateOwnerSwitch ?? true,
        gateHighValueDiscount: body.gateHighValueDiscount ?? true,
        gateDiscountLimit: body.gateDiscountLimit ?? 5000,
        gateDataExport: body.gateDataExport ?? true,
        gateInventoryPrice: body.gateInventoryPrice ?? true,
        gateDangerZone: body.gateDangerZone ?? true,
        externalScannerEnabled: body.externalScannerEnabled ?? false,
        defaulterRegistryEnabled: body.defaulterRegistryEnabled ?? true,
      },
    })
    return NextResponse.json(updated)
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
