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
 * Returns the CURRENT business from the authenticated session.
 *
 * §AUTH: Uses session-based authentication. The businessId comes from:
 *   Session → User → User.businessId → Business
 *
 * §NO-FALLBACK: If no session exists, returns null. The caller should
 * return 401 Unauthorized. The old hardcoded "Sharma Trading Co." fallback
 * has been REMOVED — it was a security hole that allowed unauthenticated
 * access to business data.
 *
 * §DEV-FALLBACK: In development only (NODE_ENV !== 'production'), falls back
 * to the first business so the app works without login during development.
 * In production, no fallback — must be authenticated.
 */
export async function getCurrentBusiness() {
  // §AUTH-PRIMARY: Get business from authenticated session
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

  // §DEV-FALLBACK: In development only, allow access without login.
  // This makes local development easier — no need to login every time.
  // In PRODUCTION: returns null → caller returns 401.
  if (process.env.NODE_ENV !== 'production') {
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

  // §PRODUCTION: No session → no business → 401
  return null
}
