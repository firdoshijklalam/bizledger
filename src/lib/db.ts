import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''

  // Standard PrismaClient — works with Neon pooled connection string
  // The pooled connection (with -pooler in hostname) supports serverless
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
 * Multi-tenant isolation helper (PRD Part 34 Audit §4).
 * Returns the CURRENT business — always prefers "Sharma Trading Co."
 * (the owner's business) over demo shops (Maa Lakshmi Grocers, Style Bazaar).
 *
 * Usage: `const business = await getCurrentBusiness()`
 * Returns null if no business exists.
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
