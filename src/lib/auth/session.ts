import { db } from '@/lib/db'
import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'crypto'
import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

/**
 * §AUTH: Core authentication utilities.
 *
 * Architecture:
 *   Session cookie (httpOnly) → tokenHash → Session → User → businessId
 *
 * Security:
 * - Passwords hashed with scrypt (Node.js built-in, no external deps)
 * - Session tokens are random 32-byte values, stored as SHA-256 hash in DB
 * - Cookies are httpOnly + Secure (production) + SameSite=Lax
 * - Session expiration: 7 days
 * - Timing-safe comparison for password and token verification
 */

const SESSION_COOKIE = 'bizledger_session'
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

// ─── Password Hashing ─────────────────────────────────────────────────────

/**
 * Hash a password using Node.js built-in scrypt (memory-hard KDF).
 * Format: "scrypt:salt:hash" (both hex-encoded).
 * scrypt is designed specifically for password hashing — it's CPU + memory
 * hard, making brute-force attacks computationally expensive.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptHash(password, salt)
  return `scrypt:${salt}:${hash}`
}

/**
 * Verify a password against a stored hash.
 * Uses timing-safe comparison to prevent timing attacks.
 */
export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const salt = parts[1]
  const hash = parts[2]
  const computedHash = scryptHash(password, salt)
  const a = Buffer.from(hash, 'hex')
  const b = Buffer.from(computedHash, 'hex')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/**
 * §SCRYPT: Uses Node.js crypto.scryptSync — a proper password-hardening
 * KDF (Key Derivation Function). Unlike SHA-256 (which is fast and
 * designed for hashing, NOT passwords), scrypt is:
 * - Memory-hard (requires significant RAM, prevents GPU/ASIC brute-force)
 * - CPU-hard (configurable iteration cost)
 * - Designed specifically for password storage
 *
 * Parameters: N=16384 (CPU/memory cost), r=8 (block size), p=1 (parallelism)
 * These are the recommended defaults for interactive login (OWASP).
 */
function scryptHash(password: string, salt: string): string {
  return scryptSync(password, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 128 * 1024 * 1024, // 128MB — needed for N=16384
  }).toString('hex')
}

// ─── Session Management ───────────────────────────────────────────────────

/**
 * Create a new session for a user. Returns the raw token (to set in cookie).
 * The DB stores only the hash of the token — never the raw token.
 */
export async function createSession(userId: string): Promise<string> {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS)

  await db.session.create({
    data: { tokenHash, userId, expiresAt },
  })

  return rawToken
}

/**
 * Validate a session token. Returns the user + business if valid, null if not.
 * Also cleans up expired sessions.
 */
export async function validateSession(rawToken: string): Promise<{
  user: { id: string; email: string; name: string | null; role: string; businessId: string }
} | null> {
  if (!rawToken) return null

  const tokenHash = createHash('sha256').update(rawToken).digest('hex')

  const session = await db.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        select: { id: true, email: true, name: true, role: true, businessId: true },
      },
    },
  })

  if (!session) return null

  // Check expiration
  if (session.expiresAt < new Date()) {
    // Clean up expired session
    await db.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }

  return { user: session.user }
}

/**
 * Delete a session (logout). Takes the raw token from the cookie.
 */
export async function deleteSession(rawToken: string): Promise<void> {
  if (!rawToken) return
  const tokenHash = createHash('sha256').update(rawToken).digest('hex')
  await db.session.deleteMany({ where: { tokenHash } }).catch(() => {})
}

// ─── Cookie Helpers ───────────────────────────────────────────────────────

/**
 * Set the session cookie on the response.
 */
export function setSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DURATION_MS / 1000, // seconds
  })
}

/**
 * Clear the session cookie.
 */
export function clearSessionCookie(response: NextResponse) {
  response.cookies.delete(SESSION_COOKIE)
}

/**
 * Get the session token from the current request's cookies.
 * §NEXTJS16: In Next.js 16, cookies() returns a Promise<ReadonlyRequestCookies>.
 */
export async function getSessionToken(): Promise<string | undefined> {
  const cookieStore = await cookies()
  return cookieStore.get(SESSION_COOKIE)?.value
}

// ─── Auth Guards ──────────────────────────────────────────────────────────

/**
 * Get the current authenticated user from the session cookie.
 * Returns null if not authenticated or session expired.
 */
export async function getCurrentUser(): Promise<{
  id: string; email: string; name: string | null; role: string; businessId: string
} | null> {
  const token = await getSessionToken()
  if (!token) return null
  const result = await validateSession(token)
  return result?.user || null
}

/**
 * Require authentication. Returns the user or throws a 401 response.
 * Usage in API routes:
 *   const user = await requireAuth()
 *   if (user instanceof NextResponse) return user
 *   // user is now guaranteed to be authenticated
 */
export async function requireAuth(): Promise<{
  id: string; email: string; name: string | null; role: string; businessId: string
} | NextResponse> {
  const user = await getCurrentUser()
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
  }
  return user
}

/**
 * Require a specific role. Returns the user or throws a 403 response.
 * Usage:
 *   const user = await requireRole(['OWNER', 'ADMIN'])
 *   if (user instanceof NextResponse) return user
 */
export async function requireRole(allowedRoles: string[]): Promise<{
  id: string; email: string; name: string | null; role: string; businessId: string
} | NextResponse> {
  const user = await requireAuth()
  if (user instanceof NextResponse) return user
  if (!allowedRoles.includes(user.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
  }
  return user
}
