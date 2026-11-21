import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

// §SECURITY: All endpoints blocked in production — database setup should
// happen via deployment scripts, not public API endpoints.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This endpoint is disabled in production' }, { status: 403 })
  }
  try {
    let dbUrl = process.env.DATABASE_URL || ''
    if (dbUrl.includes('channel_binding')) {
      dbUrl = dbUrl.replace(/&?channel_binding=require/, '')
    }
    
    const db = new PrismaClient({
      datasources: { db: { url: dbUrl } }
    })
    
    await db.$connect()
    
    // Use Prisma's $executeRawUnsafe to push schema via SQL
    // First, let's use db push approach via raw SQL
    const tables = await db.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`
    
    await db.$disconnect()
    
    return NextResponse.json({ 
      ok: true, 
      message: 'Database connected!',
      tableCount: Array.isArray(tables) ? tables.length : 0,
      tables: Array.isArray(tables) ? tables.map((t: any) => t.tablename).slice(0, 10) : []
    })
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: e.message
    })
  }
}

// POST: Run prisma db push via SQL
export async function POST() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This endpoint is disabled in production' }, { status: 403 })
  }
  try {
    let dbUrl = process.env.DATABASE_URL || ''
    if (dbUrl.includes('channel_binding')) {
      dbUrl = dbUrl.replace(/&?channel_binding=require/, '')
    }
    
    const db = new PrismaClient({
      datasources: { db: { url: dbUrl } }
    })
    
    await db.$connect()
    
    // Create Business table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Business" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "ownerName" TEXT,
      "phone" TEXT,
      "email" TEXT,
      "address" TEXT,
      "state" TEXT,
      "gstin" TEXT,
      "pan" TEXT,
      "upiId" TEXT,
      "logoUrl" TEXT,
      "currency" TEXT NOT NULL DEFAULT 'INR',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "storeSlug" TEXT,
      "deliveryRadiusKm" DOUBLE PRECISION,
      "latitude" DOUBLE PRECISION,
      "longitude" DOUBLE PRECISION,
      "serviceableAreas" TEXT,
      "subscriptionPlan" TEXT,
      "trialEndsAt" TIMESTAMPTZ,
      "subscriptionEndsAt" TIMESTAMPTZ,
      "isSponsored" BOOLEAN NOT NULL DEFAULT false,
      "sponsoredUntil" TIMESTAMPTZ,
      "sponsoredArea" TEXT,
      CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create Product table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Product" (
      "id" TEXT NOT NULL,
      "businessId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "sku" TEXT,
      "category" TEXT,
      "unit" TEXT NOT NULL DEFAULT 'pcs',
      "purchasePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "salePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "mrp" DOUBLE PRECISION,
      "wholesalePrice" DOUBLE PRECISION,
      "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 5,
      "supplierId" TEXT,
      "retailEnabled" BOOLEAN NOT NULL DEFAULT false,
      "retailUnit" TEXT,
      "conversionFactor" DOUBLE PRECISION,
      "retailSalePrice" DOUBLE PRECISION,
      "retailMrp" DOUBLE PRECISION,
      "looseStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "subCategory" TEXT,
      "description" TEXT,
      "isPublished" BOOLEAN NOT NULL DEFAULT true,
      "categoryPath" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create Party table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Party" (
      "id" TEXT NOT NULL,
      "businessId" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "phone" TEXT,
      "type" TEXT NOT NULL DEFAULT 'customer',
      "balance" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "qualityGrade" TEXT,
      "creditLimit" DOUBLE PRECISION,
      "openingBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "address" TEXT,
      "gstin" TEXT,
      "notes" TEXT,
      "avgPaymentDays" INTEGER,
      "avgDiscountPct" DOUBLE PRECISION,
      "gradeLastCalculated" TIMESTAMPTZ,
      "gradeOverrideReason" TEXT,
      "creditTrustScore" DOUBLE PRECISION,
      "maxCreditSuggestion" DOUBLE PRECISION,
      "trustScoreUpdatedAt" TIMESTAMPTZ,
      "trustScoreReason" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create Transaction table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Transaction" (
      "id" TEXT NOT NULL,
      "businessId" TEXT NOT NULL,
      "partyId" TEXT,
      "type" TEXT NOT NULL,
      "amount" DOUBLE PRECISION NOT NULL,
      "balanceAfter" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "description" TEXT,
      "category" TEXT,
      "invoiceId" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create Invoice table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "Invoice" (
      "id" TEXT NOT NULL,
      "businessId" TEXT NOT NULL,
      "partyId" TEXT,
      "invoiceNumber" TEXT NOT NULL,
      "type" TEXT NOT NULL DEFAULT 'sale',
      "status" TEXT NOT NULL DEFAULT 'paid',
      "isGst" BOOLEAN NOT NULL DEFAULT false,
      "subtotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "discountValue" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "discountMode" TEXT NOT NULL DEFAULT 'flat',
      "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "gstAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "grandTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "amountPaid" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "amountDue" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "paymentMode" TEXT,
      "notes" TEXT,
      "paymentLandingToken" TEXT,
      "collectedByName" TEXT,
      "collectedByRole" TEXT,
      "paidToName" TEXT,
      "paidToRole" TEXT,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create InvoiceItem table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "InvoiceItem" (
      "id" TEXT NOT NULL,
      "invoiceId" TEXT NOT NULL,
      "productId" TEXT,
      "name" TEXT NOT NULL,
      "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "unitPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
      CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
    )`)
    
    // Create AppSettings table
    await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "AppSettings" (
      "id" TEXT NOT NULL,
      "businessId" TEXT NOT NULL,
      "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
      "autoBackupEnabled" BOOLEAN NOT NULL DEFAULT false,
      "language" TEXT NOT NULL DEFAULT 'bn',
      "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
      "invoicePrefix" TEXT,
      "pinEnabled" BOOLEAN NOT NULL DEFAULT false,
      "pinHash" TEXT,
      "lastBackupAt" TIMESTAMPTZ,
      "userRole" TEXT NOT NULL DEFAULT 'owner',
      "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
      "driveEnabled" BOOLEAN NOT NULL DEFAULT false,
      "biometricEnabled" BOOLEAN NOT NULL DEFAULT false,
      "gateOwnerSwitch" BOOLEAN NOT NULL DEFAULT false,
      "gateHighValueDiscount" BOOLEAN NOT NULL DEFAULT false,
      "gateDiscountLimit" DOUBLE PRECISION NOT NULL DEFAULT 5000,
      "gateDataExport" BOOLEAN NOT NULL DEFAULT false,
      "gateInventoryPrice" BOOLEAN NOT NULL DEFAULT true,
      "gateDangerZone" BOOLEAN NOT NULL DEFAULT false,
      "externalScannerEnabled" BOOLEAN NOT NULL DEFAULT false,
      "defaulterRegistryEnabled" BOOLEAN NOT NULL DEFAULT false,
      "gateLockdownUntil" TIMESTAMPTZ,
      "onlineSalesEnabled" BOOLEAN NOT NULL DEFAULT true,
      "offlineOnlyMode" BOOLEAN NOT NULL DEFAULT false,
      "cloudSyncMode" BOOLEAN NOT NULL DEFAULT false,
      "telegramFileIdMode" BOOLEAN NOT NULL DEFAULT false,
      "appMode" TEXT NOT NULL DEFAULT 'merchant',
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now(),
      CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
    )`)
    
    await db.$disconnect()
    
    return NextResponse.json({ 
      ok: true, 
      message: 'All tables created successfully! Now call POST /api/seed to add data.'
    })
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: e.message
    })
  }
}
