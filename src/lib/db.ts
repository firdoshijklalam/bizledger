import { PrismaClient } from '@prisma/client'
import { PrismaNeon } from '@prisma/adapter-neon'
import { neon } from '@neondatabase/serverless'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL || ''

  // If using Neon (postgresql connection string)
  if (databaseUrl.startsWith('postgresql://') || databaseUrl.startsWith('postgres://')) {
    try {
      const sql = neon(databaseUrl)
      const adapter = new PrismaNeon(sql)
      return new PrismaClient({ adapter } as any)
    } catch (e) {
      console.error('Neon adapter failed, falling back:', e)
    }
  }

  // Fallback: standard PrismaClient (for local SQLite or regular PG)
  return new PrismaClient({
    log: process.env.NODE_ENV !== 'production' ? ['error'] : ['error'],
  })
}

export const db = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

/**
 * Multi-tenant isolation helper (PRD Part 34 Audit §4).
 * Returns the CURRENT business — always prefers "Sharma Trading Co."
 * (the owner's business) over demo shops (Maa Lakshmi Grocers, Style Bazaar).
 *
 * This prevents data leakage when multiple businesses exist in the DB
 * (e.g. for the "More Shops" marketplace feature).
 *
 * Usage: `const business = await getCurrentBusiness()`
 * Returns null if no business exists.
 */
export async function getCurrentBusiness() {
  // Prefer the owner's business (Sharma Trading Co.) if it exists
  let business = await db.business.findFirst({
    where: { name: 'Sharma Trading Co.' },
  })
  // Fallback: if no Sharma business, return the first business by creation order
  if (!business) {
    business = await db.business.findFirst({
      orderBy: { createdAt: 'asc' },
    })
  }
  return business
}
