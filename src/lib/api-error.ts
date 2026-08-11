import { NextResponse } from 'next/server'

/**
 * §API-ERROR: Sanitized error response helper.
 *
 * In production: returns a generic error message (hides DB internals, stack traces,
 * connection strings, etc. that could be exploited).
 * In development: returns the full error for debugging.
 *
 * Always logs the real error server-side for debugging.
 *
 * Usage:
 *   } catch (e) {
 *     return apiError(e, 'Failed to create invoice')
 *   }
 */
export function apiError(e: unknown, fallbackMessage = 'An error occurred', status = 500) {
  // Always log the real error server-side
  console.error(`[API Error] ${fallbackMessage}:`, e)

  if (process.env.NODE_ENV === 'production') {
    // §SECURITY: In production, never expose internal error details.
    // DB errors can leak: table names, column names, connection strings,
    // SQL queries, constraint names — all useful to attackers.
    return NextResponse.json({ error: fallbackMessage }, { status })
  }

  // In development, return the full error for debugging
  const message = e instanceof Error ? e.message : String(e)
  return NextResponse.json({ error: message }, { status })
}
