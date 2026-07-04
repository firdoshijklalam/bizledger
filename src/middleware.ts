import { NextRequest, NextResponse } from 'next/server'
import {
  isIPBlocked,
  getClientIP,
  isLockedOut,
} from '@/lib/security-edge'

/**
 * PRD Part 34 — Threat Matrix Middleware
 *
 * Threat 2: IP blocking (tamper detection → auto-block)
 * Threat 3: HSTS / Strict HTTPS Transport Security headers
 * Threat 4: Brute-force lockout check on auth routes
 *
 * Note: HMAC signature verification is done in individual route handlers
 * (not middleware) because Next.js Edge middleware can't read request bodies.
 *
 * This middleware:
 * 1. Checks if the client IP is blocked (tamper detection)
 * 2. Checks brute-force lockout on auth routes (/api/pin, /api/biometric/gate)
 * 3. Adds security headers (HSTS, X-Content-Type-Options, X-Frame-Options, etc.)
 */

// Check if a path matches any pattern in a list
function matchesRoute(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname.startsWith(route))
}

export function middleware(req: NextRequest) {
  const pathname = req.nextUrl.pathname
  const clientIP = getClientIP(req)

  // In development mode: skip IP blocking and brute-force checks
  // (avoids false positives from dev tools and sandbox environment)
  if (process.env.NODE_ENV === 'production') {
    // Threat 2: IP blocking — check if IP is banned
    const blockStatus = isIPBlocked(clientIP)
    if (blockStatus.blocked) {
      return NextResponse.json(
        {
          error: 'Access denied',
          reason: blockStatus.reason,
          message: 'Your IP has been blocked due to suspicious activity. Contact support.',
          expiresAt: blockStatus.expiresAt,
        },
        { status: 403 }
      )
    }

    // Threat 4: Check brute-force lockout on auth routes
    if (pathname === '/api/pin' || pathname === '/api/biometric/gate') {
      const lockStatus = isLockedOut(clientIP)
      if (lockStatus.locked) {
        return NextResponse.json(
          {
            error: 'Account temporarily locked',
            reason: 'Too many failed attempts',
            locked: true,
            lockedUntil: lockStatus.lockedUntil,
            lockoutLevel: lockStatus.lockoutLevel,
            remainingMs: lockStatus.remainingMs,
          },
          { status: 429 }
        )
      }
    }
  }

  // Threat 3 + 5: Add security headers to all responses.
  // IMPORTANT: Use SAMEORIGIN (not DENY) for X-Frame-Options so the preview
  // panel iframe can embed the app. CSP frame-ancestors allows the preview
  // host. In production these would be tightened to the real merchant domain.
  const response = NextResponse.next()

  // HSTS (Threat 3: Strict HTTPS Transport Security)
  response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('X-Frame-Options', 'SAMEORIGIN')
  response.headers.set(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://*.space-z.ai http://*.space-z.ai https://preview-chat-*.space-z.ai http://preview-chat-*.space-z.ai"
  )
  response.headers.set('X-XSS-Protection', '1; mode=block')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.headers.set('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()')

  return response
}

export const config = {
  matcher: ['/api/:path*'],
}
