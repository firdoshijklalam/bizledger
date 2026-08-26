import { PrismaClient } from '@prisma/client'
import { createHash } from 'crypto'

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

// §SESSION-COOKIE: Must match the cookie name in src/lib/auth/session.ts
const SESSION_COOKIE = 'bizledger_session'

/**
 * Multi-tenant isolation helper.
 * Returns the CURRENT business from the authenticated session ONLY.
 *
 * §NO-FALLBACK: There is NO fallback. No hardcoded business name.
 * No "first business" lookup. No dev fallback. If there is no valid
 * authenticated session, this returns null and the caller MUST return 401.
 *
 * The businessId comes from: Session → User → User.businessId → Business
 *
 * §PERFORMANCE: Uses a SINGLE raw SQL JOIN (Session → User → Business)
 * instead of 2 separate Prisma queries (validateSession + business.findUnique).
 * This saves ~1.5-2s of Neon network round-trip latency per request.
 * The session expiration check is included in the WHERE clause.
 *
 * §NO-IMPORT-CYCLE: Reads the cookie directly from next/headers instead of
 * importing from auth/session (which imports db → would create a cycle).
 */
export async function getCurrentBusiness() {
  try {
    const { cookies } = await import('next/headers')
    const cookieStore = await cookies()
    const token = cookieStore.get(SESSION_COOKIE)?.value
    if (!token) return null

    const tokenHash = createHash('sha256').update(token).digest('hex')

    // §SINGLE-QUERY-AUTH: JOIN Session → User → Business in one raw SQL.
    // Replaces 2 sequential queries (session.findUnique + business.findUnique)
    // with 1 query. Saves ~1.5-2s on Neon (each query ~1.5s due to network RTT).
    // §CROSS-DB-FIX: Pass `now` as a Date PARAMETER instead of using a SQL
    // function (NOW()/CURRENT_TIMESTAMP). Prisma stores DateTime as INTEGER
    // (ms since epoch) in SQLite but as TIMESTAMP in PostgreSQL — comparing
    // a stored column against a SQL function breaks cross-DB compat. A Date
    // parameter is correctly adapted by Prisma's driver for both providers.
    const now = new Date()
    const rows = await db.$queryRaw<Array<any>>`
      SELECT b.* FROM "Session" s
      JOIN "User" u ON s."userId" = u.id
      JOIN "Business" b ON u."businessId" = b.id
      WHERE s."tokenHash" = ${tokenHash} AND s."expiresAt" > ${now}
      LIMIT 1
    `
    return rows[0] || null
  } catch {
    // next/headers not available (e.g. during build, or client-side) — return null
  }
  return null
}
