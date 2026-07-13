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

  // CRITICAL: Disable prepared statements for Neon/PostgreSQL.
  // Prevents "cached plan must not change result type" errors (Postgres 0A000)
  // when the DB schema is altered (e.g. by prisma db push). Without this,
  // cached prepared statements become invalid after schema changes and ALL
  // queries fail with HTTP 500.
  if (databaseUrl.includes('neon.tech') && !databaseUrl.includes('prepared_statements=')) {
    databaseUrl += (databaseUrl.includes('?') ? '&' : '?') + 'pgbouncer=true&prepared_statements=false'
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
