/**
 * PRD Part 34 — Threat Matrix: Edge-safe security utilities
 *
 * These functions are safe to use in Next.js Edge middleware (no Node.js 'crypto' module).
 * HMAC/JWT functions that require 'crypto' live in src/lib/security.ts (Node runtime only).
 */

// ============================================================
// Threat 2: IP Blocking (tamper detection → auto-block)
// ============================================================

interface BlockedIP {
  ip: string
  reason: string
  blockedAt: number
  expiresAt: number | null // null = permanent
}

// In-memory IP block list (in production, use Redis or a DB table)
const blockedIPs = new Map<string, BlockedIP>()

/**
 * Block an IP address for tampering / API manipulation.
 */
export function blockIP(ip: string, reason: string, durationMs: number | null = null): void {
  blockedIPs.set(ip, {
    ip,
    reason,
    blockedAt: Date.now(),
    expiresAt: durationMs ? Date.now() + durationMs : null,
  })
}

/**
 * Check if an IP is currently blocked.
 */
export function isIPBlocked(ip: string): { blocked: boolean; reason?: string; expiresAt?: number | null } {
  const entry = blockedIPs.get(ip)
  if (!entry) return { blocked: false }

  // Check if block has expired
  if (entry.expiresAt && Date.now() > entry.expiresAt) {
    blockedIPs.delete(ip)
    return { blocked: false }
  }

  return { blocked: true, reason: entry.reason, expiresAt: entry.expiresAt }
}

/**
 * Get client IP from request headers (handles proxies).
 */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim()
  const realIP = req.headers.get('x-real-ip')
  if (realIP) return realIP
  return 'unknown'
}

// ============================================================
// Threat 4: Exponential Backoff Brute-Force PIN Protection
// ============================================================

interface BruteForceState {
  failedAttempts: number
  lockedUntil: number | null
  lockoutLevel: number  // 0=no lock, 1=2min, 2=5min, 3=1hr, 4=24hr, 5=permanent
  lastFailedAt: number
}

// In-memory per-IP brute-force tracking (in production, use Redis)
const bruteForceStates = new Map<string, BruteForceState>()

/**
 * Exponential backoff lockout durations.
 * Level 0: no lock (2 fails → 2 min lockdown, per PRD Part 32)
 * Level 1: 2 minutes
 * Level 2: 5 minutes
 * Level 3: 1 hour
 * Level 4: 24 hours
 * Level 5: permanent (requires owner Telegram OTP to unlock)
 */
const LOCKOUT_DURATIONS = [
  0,                          // Level 0: no lock
  2 * 60 * 1000,             // Level 1: 2 minutes
  5 * 60 * 1000,             // Level 2: 5 minutes
  60 * 60 * 1000,            // Level 3: 1 hour
  24 * 60 * 60 * 1000,       // Level 4: 24 hours
  0,                          // Level 5: permanent (expiresAt = null)
]

/**
 * Record a failed PIN attempt and return the new lockout state.
 */
export function recordFailedPINAttempt(identifier: string): {
  locked: boolean
  lockedUntil: number | null
  lockoutLevel: number
  remainingMs: number
  telegramAlertRequired: boolean
} {
  const state = bruteForceStates.get(identifier) || {
    failedAttempts: 0,
    lockedUntil: null,
    lockoutLevel: 0,
    lastFailedAt: 0,
  }

  state.failedAttempts++
  state.lastFailedAt = Date.now()

  // After every 2 fails, escalate to the next lockout level
  if (state.failedAttempts >= 2) {
    state.lockoutLevel = Math.min(state.lockoutLevel + 1, 5)
    const duration = LOCKOUT_DURATIONS[state.lockoutLevel]
    state.lockedUntil = duration === 0 && state.lockoutLevel === 5 ? null : Date.now() + duration
    state.failedAttempts = 0 // reset counter after escalation

    bruteForceStates.set(identifier, state)
    return {
      locked: true,
      lockedUntil: state.lockedUntil,
      lockoutLevel: state.lockoutLevel,
      remainingMs: duration,
      telegramAlertRequired: state.lockoutLevel >= 1, // always alert on lockout
    }
  }

  bruteForceStates.set(identifier, state)
  return {
    locked: false,
    lockedUntil: null,
    lockoutLevel: state.lockoutLevel,
    remainingMs: 0,
    telegramAlertRequired: false,
  }
}

/**
 * Check if an identifier is currently locked out.
 */
export function isLockedOut(identifier: string): {
  locked: boolean
  lockedUntil: number | null
  remainingMs: number
  lockoutLevel: number
} {
  const state = bruteForceStates.get(identifier)
  if (!state || !state.lockedUntil) {
    // Check permanent lock
    if (state && state.lockoutLevel === 5) {
      return { locked: true, lockedUntil: null, remainingMs: 0, lockoutLevel: 5 }
    }
    return { locked: false, lockedUntil: null, remainingMs: 0, lockoutLevel: 0 }
  }

  const now = Date.now()
  if (now < state.lockedUntil) {
    return {
      locked: true,
      lockedUntil: state.lockedUntil,
      remainingMs: state.lockedUntil - now,
      lockoutLevel: state.lockoutLevel,
    }
  }

  // Lockout expired — reset
  state.lockedUntil = null
  state.failedAttempts = 0
  bruteForceStates.set(identifier, state)
  return { locked: false, lockedUntil: null, remainingMs: 0, lockoutLevel: state.lockoutLevel }
}

/**
 * Reset brute-force state on successful auth.
 */
export function resetBruteForce(identifier: string): void {
  bruteForceStates.delete(identifier)
}

/**
 * Get a human-readable lockout duration message.
 */
export function getLockoutMessage(lockoutLevel: number, remainingMs: number): string {
  const messages = [
    '',
    '2 minutes',
    '5 minutes',
    '1 hour',
    '24 hours',
    'permanently (contact owner)',
  ]
  if (lockoutLevel === 5) return `Account locked ${messages[5]}`
  const mins = Math.ceil(remainingMs / 60000)
  if (mins >= 60) return `Locked for ${Math.ceil(mins / 60)} hour(s)`
  return `Locked for ${mins} minute(s)`
}

// ============================================================
// Threat 3: GPS Spoofing Prevention (Triangulation)
// ============================================================

export interface LocationVerification {
  gpsLat: number
  gpsLng: number
  gpsAccuracy: number     // meters, from navigator.geolocation
  cellTowerLat?: number   // from mobile API (if available)
  cellTowerLng?: number
  ipLat?: number          // from IP geolocation API
  ipLng?: number
}

export interface LocationTrustResult {
  trusted: boolean
  trustScore: number      // 0-100
  reason: string
  triangulatedLat: number
  triangulatedLng: number
  spoofingDetected: boolean
}

/**
 * Cross-verify GPS location with cell tower and IP geolocation.
 * If all 3 sources agree within a tolerance, the location is trusted.
 * If GPS differs significantly from cell/IP, it's likely spoofed.
 */
export function verifyLocation(loc: LocationVerification): LocationTrustResult {
  const sources: Array<{ lat: number; lng: number; name: string; weight: number }> = []

  // GPS (lowest trust — can be spoofed by fake GPS apps)
  sources.push({ lat: loc.gpsLat, lng: loc.gpsLng, name: 'GPS', weight: 0.4 })

  // Cell tower (higher trust — harder to spoof)
  if (loc.cellTowerLat != null && loc.cellTowerLng != null) {
    sources.push({ lat: loc.cellTowerLat, lng: loc.cellTowerLng, name: 'Cell', weight: 0.35 })
  }

  // IP geolocation (highest trust — can't be easily spoofed without VPN/proxy)
  if (loc.ipLat != null && loc.ipLng != null) {
    sources.push({ lat: loc.ipLat, lng: loc.ipLng, name: 'IP', weight: 0.25 })
  }

  // If only GPS is available, trust is low
  if (sources.length === 1) {
    return {
      trusted: false,
      trustScore: 30,
      reason: 'Only GPS available — cell tower and IP geolocation required for triangulation',
      triangulatedLat: loc.gpsLat,
      triangulatedLng: loc.gpsLng,
      spoofingDetected: false,
    }
  }

  // Calculate weighted average (triangulated position)
  const totalWeight = sources.reduce((s, src) => s + src.weight, 0)
  const triLat = sources.reduce((s, src) => s + src.lat * src.weight, 0) / totalWeight
  const triLng = sources.reduce((s, src) => s + src.lng * src.weight, 0) / totalWeight

  // Check if GPS is an outlier (differs from triangulated position by > 2km)
  const gpsDistance = haversineKm(loc.gpsLat, loc.gpsLng, triLat, triLng)
  const spoofingDetected = gpsDistance > 2.0 // GPS is >2km away from triangulated position

  // GPS accuracy check — if accuracy is suspiciously perfect (< 5m), it might be spoofed
  const suspiciousAccuracy = loc.gpsAccuracy < 5 && loc.gpsAccuracy > 0

  let trustScore = 100
  if (spoofingDetected) trustScore -= 60
  if (suspiciousAccuracy) trustScore -= 20
  if (sources.length === 2) trustScore -= 15 // only 2 sources

  trustScore = Math.max(0, Math.min(100, trustScore))

  return {
    trusted: trustScore >= 60,
    trustScore,
    reason: spoofingDetected
      ? `GPS spoofing detected: GPS is ${gpsDistance.toFixed(2)}km away from triangulated position`
      : suspiciousAccuracy
      ? 'GPS accuracy suspiciously perfect — possible spoofing'
      : `Location verified via ${sources.length}-source triangulation (score: ${trustScore}%)`,
    triangulatedLat: triLat,
    triangulatedLng: triLng,
    spoofingDetected,
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
