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
 * Returns the CURRENT business.
 *
 * §AUTH-UPDATE: Now uses session-based authentication as the PRIMARY method.
 * If a valid session exists → Session → User → User.businessId → Business.
 *
 * §FALLBACK: If no session (not logged in), falls back to the old hardcoded
 * "Sharma Trading Co." lookup. This fallback maintains backward compatibility
 * for the existing single-tenant demo deployment. In production with auth
 * enforced, the fallback should never be reached.
 *
 * §FUTURE: Once the login UI is deployed and all users have accounts,
 * remove the fallback and return null (401) when no session exists.
 */
export async function getCurrentBusiness() {
  // §AUTH-PRIMARY: Try session-based authentication first
  try {
    const { getCurrentUser } = await import('@/lib/auth/session')
    const user = await getCurrentUser()
    if (user) {
      const business = await db.business.findUnique({
        where: { id: user.businessId },
      })
      if (business) return business
    }
  } catch {
    // Session module might not be available in some contexts — fall through
  }

  // §FALLBACK: Old hardcoded lookup (backward compatibility)
  let business = await db.business.findFirst({
    where: { name: 'Sharma Trading Co.' },
  })
  if (!business) {
    business = await db.business.findFirst({
      orderBy: { createdAt: 'asc' },
    })
    if (business && process.env.NODE_ENV === 'production') {
      console.warn(
        '⚠️ SECURITY WARNING: getCurrentBusiness() fell back to first business (' +
        business.name +
        '). No authenticated session found. Implement proper authentication to resolve this.'
      )
    }
  }
  return business
}
