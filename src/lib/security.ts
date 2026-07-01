/**
 * PRD Part 34 — Threat Matrix & Fixes (5 Cyber Attack Defenses)
 * Core security library for GLM 5.2 Architecture.
 *
 * Threat 1: Anti-tamper & root detection (client-side checks)
 * Threat 2: API request signing (HMAC) + JWT session tokens
 * Threat 5: Input sanitization (XSS prevention)
 *
 * Edge-safe functions (IP blocking, brute-force, GPS triangulation)
 * are in src/lib/security-edge.ts and re-exported here.
 */

import { createHash, createHmac, timingSafeEqual } from 'crypto'

// ============================================================
// Threat 2: HMAC Request Signing & JWT Session Tokens
// ============================================================

const HMAC_SECRET = process.env.NEXTAUTH_SECRET || 'bizledger-hmac-secret-2026'

/**
 * Sign a request payload with HMAC-SHA256.
 * The client sends: X-Signature = HMAC(secret, method + path + body + timestamp)
 * The server re-computes and compares with timing-safe equality.
 */
export function signRequest(method: string, path: string, body: string, timestamp: number): string {
  const payload = `${method.toUpperCase()}${path}${body}${timestamp}`
  return createHmac('sha256', HMAC_SECRET).update(payload).digest('hex')
}

/**
 * Verify an HMAC signature on the server side.
 * Returns true if the signature matches AND the timestamp is within the replay window.
 */
export function verifyRequestSignature(
  method: string,
  path: string,
  body: string,
  timestamp: number,
  signature: string
): { valid: boolean; reason?: string } {
  // Replay attack prevention: reject requests older than 5 minutes
  const now = Date.now()
  const tsMs = timestamp
  if (Math.abs(now - tsMs) > 5 * 60 * 1000) {
    return { valid: false, reason: 'Request timestamp expired (replay attack prevention)' }
  }

  const expected = signRequest(method, path, body, timestamp)
  try {
    const a = Buffer.from(signature, 'hex')
    const b = Buffer.from(expected, 'hex')
    if (a.length !== b.length) return { valid: false, reason: 'Signature length mismatch' }
    if (timingSafeEqual(a, b)) return { valid: true }
    return { valid: false, reason: 'Signature mismatch' }
  } catch {
    return { valid: false, reason: 'Invalid signature format' }
  }
}

/**
 * Generate a short-lived JWT-like session token (simplified).
 * In production, use a full JWT library. This is a signed base64 payload.
 */
export function generateSessionToken(businessId: string, role: string, expiresInSeconds = 3600): string {
  const payload = {
    biz: businessId,
    role,
    iat: Date.now(),
    exp: Date.now() + expiresInSeconds * 1000,
  }
  const payloadStr = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = createHmac('sha256', HMAC_SECRET).update(payloadStr).digest('base64url')
  return `${payloadStr}.${sig}`
}

/**
 * Verify a session token. Returns the payload if valid, null otherwise.
 */
export function verifySessionToken(token: string): { biz: string; role: string; iat: number; exp: number } | null {
  try {
    const [payloadStr, sig] = token.split('.')
    if (!payloadStr || !sig) return null

    const expectedSig = createHmac('sha256', HMAC_SECRET).update(payloadStr).digest('base64url')
    const a = Buffer.from(sig, 'base64url')
    const b = Buffer.from(expectedSig, 'base64url')
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null

    const payload = JSON.parse(Buffer.from(payloadStr, 'base64url').toString())
    if (Date.now() > payload.exp) return null // expired
    return payload
  } catch {
    return null
  }
}

// ============================================================
// Threat 5: Input Sanitization (XSS Prevention)
// ============================================================

/**
 * Sanitize a string input to prevent XSS attacks.
 * - Strips <script> tags and event handlers
 * - Escapes HTML entities
 * - Removes null bytes
 */
export function sanitizeInput(input: string): string {
  if (typeof input !== 'string') return ''
  return input
    .replace(/\0/g, '')                    // null bytes
    .replace(/<script[^>]*>.*?<\/script>/gi, '')  // script tags
    .replace(/<iframe[^>]*>.*?<\/iframe>/gi, '')  // iframe tags
    .replace(/<object[^>]*>.*?<\/object>/gi, '')  // object tags
    .replace(/<embed[^>]*>/gi, '')                // embed tags
    .replace(/javascript:/gi, '')                 // javascript: URLs
    .replace(/on\w+\s*=/gi, '')                   // event handlers (onclick=, onload=, etc.)
    .replace(/<[^>]+>/g, (match) => {             // escape remaining tags
      // Allow basic formatting tags but escape everything else
      const allowed = /^<(\/?)(b|i|u|s|p|br|strong|em|ul|ol|li)\s*>$/i
      if (allowed.test(match)) return match
      return match.replace(/</g, '&lt;').replace(/>/g, '&gt;')
    })
    .trim()
}

/**
 * Deep-sanitize an object's string fields (recursively).
 * Use this on all request bodies before processing.
 */
export function sanitizeObject<T>(obj: T): T {
  if (typeof obj === 'string') return sanitizeInput(obj) as unknown as T
  if (Array.isArray(obj)) return obj.map(sanitizeObject) as unknown as T
  if (obj && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      // BIZ-ID verification: never allow businessId to be overridden via input
      if (key.toLowerCase() === 'businessid') continue
      result[key] = sanitizeObject(value)
    }
    return result as T
  }
  return obj
}

/**
 * Validate that a string contains only safe characters (alphanumeric + common punctuation).
 * Use for names, addresses, etc.
 */
export function isSafeString(input: string, maxLength = 500): boolean {
  if (typeof input !== 'string') return false
  if (input.length > maxLength) return false
  // Allow: letters, numbers, spaces, common punctuation, Bengali + Hindi unicode
  return /^[\p{L}\p{N}\s.,\-'"()&/:;@#+%!?\u0980-\u09FF\u0900-\u097F]*$/u.test(input)
}

// ============================================================
// Threat 1: Anti-Tamper & Root Detection (Client-side Checks)
// ============================================================

export interface TamperCheckResult {
  rooted: boolean
  debugger: boolean
  emulator: boolean
  tampered: boolean
  proxyDetected: boolean
  certPinningFailed: boolean
  riskScore: number  // 0-100, higher = more risky
}

export function runClientTamperChecks(): TamperCheckResult {
  if (typeof window === 'undefined') {
    return {
      rooted: false, debugger: false, emulator: false, tampered: false,
      proxyDetected: false, certPinningFailed: false, riskScore: 0,
    }
  }

  let riskScore = 0

  // Emulator detection
  const ua = navigator.userAgent
  const isEmulator = /Android SDK|Emulator|Simulator|qemu|Genymotion/i.test(ua)
  if (isEmulator) riskScore += 30

  // Debugger detection (dev tools open)
  const debuggerOpen = (() => {
    const threshold = 160
    const start = performance.now()
    debugger
    return performance.now() - start > threshold
  })()
  if (debuggerOpen) riskScore += 20

  // Proxy detection (via inconsistent timezone)
  const timezoneOffset = new Date().getTimezoneOffset()
  const browserTZ = Intl.DateTimeFormat().resolvedOptions().timeZone
  const proxySuspected = !browserTZ || (timezoneOffset === 0 && browserTZ !== 'UTC')
  if (proxySuspected) riskScore += 15

  // Tamper detection: check if source was modified
  const tampered = (() => {
    try {
      return console.log.toString().indexOf('native code') === -1
    } catch {
      return true
    }
  })()
  if (tampered) riskScore += 25

  // Root detection (simplified for web — in APK use RootBeer)
  const rooted = isEmulator

  return {
    rooted,
    debugger: debuggerOpen,
    emulator: isEmulator,
    tampered,
    proxyDetected: proxySuspected,
    certPinningFailed: false,
    riskScore: Math.min(100, riskScore),
  }
}

/**
 * Hash a function's source for tamper detection.
 * Compare against a known-good hash at build time.
 */
export function hashFunctionSource(fn: (...args: unknown[]) => unknown): string {
  return createHash('sha256').update(fn.toString()).digest('hex')
}

// ============================================================
// Re-exports from security-edge.ts (Edge-safe functions)
// These are shared between Edge middleware and Node.js routes.
// ============================================================
export {
  blockIP,
  isIPBlocked,
  getClientIP,
  recordFailedPINAttempt,
  isLockedOut,
  resetBruteForce,
  getLockoutMessage,
  verifyLocation,
  type LocationVerification,
  type LocationTrustResult,
} from '@/lib/security-edge'
