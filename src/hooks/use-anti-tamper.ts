'use client'

import { useEffect, useRef } from 'react'
import { runClientTamperChecks } from '@/lib/security'

/**
 * PRD Part 34 — Threat 1: Anti-Tamper & Root Detection
 *
 * Client-side hook that runs tamper detection checks on mount
 * and reports results to the server. If tampering is detected,
 * the server blocks the IP and locks the account.
 *
 * Runs checks:
 * - On app load (once)
 * - Every 5 minutes (periodic monitoring)
 * - On window focus (when user returns to the app)
 */
export function useAntiTamper() {
  const hasChecked = useRef(false)

  useEffect(() => {
    // Skip anti-tamper checks in development mode (avoids false positives from dev tools)
    if (process.env.NODE_ENV === 'development') return
    if (hasChecked.current) return
    hasChecked.current = true

    const runChecks = async () => {
      try {
        const result = runClientTamperChecks()

        // Only report if risk score is non-zero (don't spam the server)
        if (result.riskScore > 0) {
          await fetch('/api/security/anti-tamper', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(result),
          })
        }
      } catch {
        // Silent fail — don't disrupt UX if the check endpoint is unreachable
      }
    }

    // Run immediately on mount
    runChecks()

    // Run every 5 minutes (periodic monitoring)
    const interval = setInterval(runChecks, 5 * 60 * 1000)

    // Run on window focus (user returns to app)
    const onFocus = () => runChecks()
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
}

/**
 * PRD Part 34 — Threat 3: GPS Spoofing Prevention
 *
 * Client-side hook to get verified location with triangulation.
 * Falls back to GPS-only if cell tower / IP geo APIs are unavailable.
 */
export function useVerifiedLocation() {
  const getLocation = async (): Promise<{
    gpsLat: number
    gpsLng: number
    gpsAccuracy: number
    trusted: boolean
    trustScore: number
    spoofingDetected: boolean
    message: string
  } | null> => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return null

    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const gpsLat = position.coords.latitude
          const gpsLng = position.coords.longitude
          const gpsAccuracy = position.coords.accuracy

          // Try to get IP geolocation (free API)
          let ipLat: number | undefined
          let ipLng: number | undefined
          try {
            const ipRes = await fetch('https://ipapi.co/json/')
            const ipData = await ipRes.json()
            if (ipData.latitude && ipData.longitude) {
              ipLat = ipData.latitude
              ipLng = ipData.longitude
            }
          } catch {
            // IP geo may fail — continue with GPS only
          }

          // Verify location via server-side triangulation
          try {
            const verifyRes = await fetch('/api/verify-location', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                gpsLat,
                gpsLng,
                gpsAccuracy,
                ipLat,
                ipLng,
              }),
            })
            const verifyData = await verifyRes.json()
            resolve({
              gpsLat,
              gpsLng,
              gpsAccuracy,
              trusted: verifyData.trusted,
              trustScore: verifyData.trustScore,
              spoofingDetected: verifyData.spoofingDetected,
              message: verifyData.message || verifyData.reason,
            })
          } catch {
            // Fallback: GPS only (low trust)
            resolve({
              gpsLat,
              gpsLng,
              gpsAccuracy,
              trusted: false,
              trustScore: 30,
              spoofingDetected: false,
              message: 'Location verification unavailable (GPS only)',
            })
          }
        },
        (error) => {
          resolve(null)
        },
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
      )
    })
  }

  return { getLocation }
}
