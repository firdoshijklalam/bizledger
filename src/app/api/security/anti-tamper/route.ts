import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { blockIP, getClientIP, type TamperCheckResult } from '@/lib/security'
import { apiError } from '@/lib/api-error'

/**
 * PRD Part 34 — Threat 1: Anti-Tamper & Root Detection
 *
 * POST /api/security/anti-tamper
 * Receives client-side tamper detection results.
 * If tampering is detected (rooted, debugger, emulator, modified code),
 * the server blocks the IP and locks the account.
 *
 * Body: TamperCheckResult (from runClientTamperChecks)
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as TamperCheckResult
    const business = await getCurrentBusiness()
    const clientIP = getClientIP(req)

    // Log the tamper check result
    console.warn(`[ANTI-TAMPER] IP=${clientIP} risk=${body.riskScore} rooted=${body.rooted} debugger=${body.debugger} emulator=${body.emulator} tampered=${body.tampered} proxy=${body.proxyDetected}`)

    // Determine action based on risk score
    let action: 'allow' | 'warn' | 'block' = 'allow'
    let message = 'Device verified clean'

    if (body.riskScore >= 70 || body.tampered) {
      // High risk — block IP and lock account
      action = 'block'
      message = 'Tampering detected. Access blocked. Account locked.'
      blockIP(clientIP, `Anti-tamper: risk=${body.riskScore}, tampered=${body.tampered}`, 24 * 60 * 60 * 1000) // 24hr block

      // Lock the business account (set gateLockdownUntil far in the future)
      if (business) {
        await db.appSettings.updateMany({
          where: { businessId: business.id },
          data: {
            gateLockdownUntil: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24hr lock
          },
        })
      }
    } else if (body.riskScore >= 40 || body.rooted || body.emulator) {
      // Medium risk — warn but allow
      action = 'warn'
      message = `Security warning: device appears to be ${body.emulator ? 'an emulator' : 'rooted'}. Some features may be restricted.`
    }

    // Create a biometric gate log entry for the tamper check
    if (business && action !== 'allow') {
      await db.biometricGateLog.create({
        data: {
          businessId: business.id,
          gateType: 'danger_zone', // reuse for tamper
          method: 'biometric',
          result: action === 'block' ? 'locked' : 'failed',
          staffName: 'System',
          ipAddress: clientIP,
          metadata: JSON.stringify({
            riskScore: body.riskScore,
            rooted: body.rooted,
            debugger: body.debugger,
            emulator: body.emulator,
            tampered: body.tampered,
            proxyDetected: body.proxyDetected,
          }),
        },
      })
    }

    return NextResponse.json({
      ok: true,
      action,
      message,
      riskScore: body.riskScore,
      blocked: action === 'block',
    })
  } catch (e) {
    return apiError(e, "Request failed")
  }
}
