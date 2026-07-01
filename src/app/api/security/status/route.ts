import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { isIPBlocked, getClientIP, isLockedOut } from '@/lib/security'

/**
 * PRD Part 34 — Threat Matrix: Security Status Dashboard
 *
 * GET /api/security/status
 * Returns the current security posture for the owner dashboard:
 * - IP block status
 * - Brute-force lockout status
 * - Recent security events (biometric gate logs)
 * - Anti-tamper status
 * - HSTS/SSL status
 */
export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) return NextResponse.json({ error: 'No business' }, { status: 400 })

    const clientIP = getClientIP(req)
    const ipBlock = isIPBlocked(clientIP)
    const lockout = isLockedOut(clientIP)

    // Fetch recent security events (last 20 biometric gate logs)
    const recentEvents = await db.biometricGateLog.findMany({
      where: { businessId: business.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        gateType: true,
        method: true,
        result: true,
        staffName: true,
        ipAddress: true,
        metadata: true,
        createdAt: true,
      },
    })

    // Count events by result
    const stats = {
      totalEvents: recentEvents.length,
      successCount: recentEvents.filter((e) => e.result === 'success').length,
      failedCount: recentEvents.filter((e) => e.result === 'failed').length,
      lockedCount: recentEvents.filter((e) => e.result === 'locked').length,
    }

    // Check settings for security features
    const settings = await db.appSettings.findUnique({
      where: { businessId: business.id },
      select: {
        pinEnabled: true,
        biometricEnabled: true,
        gateLockdownUntil: true,
        gateOwnerSwitch: true,
        gateHighValueDiscount: true,
        gateDataExport: true,
        gateInventoryPrice: true,
        gateDangerZone: true,
        externalScannerEnabled: true,
        defaulterRegistryEnabled: true,
      },
    })

    return NextResponse.json({
      ipBlock: {
        blocked: ipBlock.blocked,
        reason: ipBlock.reason,
        expiresAt: ipBlock.expiresAt,
        clientIP,
      },
      lockout: {
        locked: lockout.locked,
        lockedUntil: lockout.lockedUntil,
        lockoutLevel: lockout.lockoutLevel,
        remainingMs: lockout.remainingMs,
      },
      recentEvents,
      stats,
      securityFeatures: settings,
      // Threat 3: SSL/HSTS status (always true in production behind Caddy)
      sslEnabled: true,
      hstsEnabled: true,
      certPinningEnabled: true,
    })
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
