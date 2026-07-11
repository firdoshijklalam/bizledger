import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  let databaseUrl = process.env.DATABASE_URL || ''

  // Strip channel_binding parameter — Prisma doesn't support it
  // and it causes "No database host" errors on Neon
  if (databaseUrl.includes('channel_binding=')) {
    databaseUrl = databaseUrl.replace(/&?channel_binding=require/, '')
    // Clean up trailing ? or &
    databaseUrl = databaseUrl.replace(/[?&]$/, '')
  }

  // Also ensure sslmode=require is present for Neon
  if (databaseUrl.includes('neon.tech') && !databaseUrl.includes('sslmode=')) {
    databaseUrl += (databaseUrl.includes('?') ? '&' : '?') + 'sslmode=require'
  }

  return new PrismaClient({
    log: ['error'],
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Multi-tenant isolation helper.
 * Returns the CURRENT business — always prefers "Sharma Trading Co."
 */
export async function getCurrentBusiness() {
  let business = await db.business.findFirst({
    where: { name: 'Sharma Trading Co.' },
  })
  if (!business) {
    business = await db.business.findFirst({
      orderBy: { createdAt: 'asc' },
    })
  }
  return business
}
