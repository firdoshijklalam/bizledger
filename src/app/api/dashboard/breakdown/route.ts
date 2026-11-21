import { NextRequest, NextResponse } from 'next/server'
import { getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { getBreakdown, BreakdownValidationError, VALID_RANGES } from '@/lib/dashboard-breakdown-service'
import type { DashboardRange } from '@/lib/date-ranges'

/**
 * §P16-STEP3.8.1-DASHBOARD-DRILLDOWN: GET /api/dashboard/breakdown
 *
 * Self-contained drill-down endpoint for the Profit & Loss chart.
 * Given a dashboard range + bucketIndex, returns the server-derived
 * bucket boundaries + every underlying record (invoices, invoice items
 * with products, expense transactions) that produced the P&L totals for
 * that bucket.
 *
 * §ROUTE-IS-THIN-WRAPPER: The core logic lives in
 * `src/lib/dashboard-breakdown-service.ts` (extracted to enable REAL DB
 * testing without requiring a running Next.js dev server or cookie context).
 * This handler only:
 *   1. Gets the authenticated business (from session cookie)
 *   2. Validates + parses query params
 *   3. Calls `getBreakdown(businessId, params)`
 *   4. Maps `BreakdownValidationError` → 400, other errors → 500
 *
 * §CORRECTION-2 (Minimize API surface): This endpoint is SELF-CONTAINED.
 * It does NOT depend on extensions to /api/invoices or /api/transactions
 * GET handlers.
 *
 * §CORRECTION-4 (Server-derived): The client sends ONLY:
 *   - range (validated against DASHBOARD_RANGES whitelist)
 *   - startDate / endDate (required only when range='custom')
 *   - bucketIndex (integer, validated < server-computed bucketCount)
 *
 * §ACCOUNTING-FREEZE: READ-ONLY. No writes, no formula changes.
 */
export const maxDuration = 20

export async function GET(req: NextRequest) {
  try {
    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const { searchParams } = new URL(req.url)
    const rangeParam = searchParams.get('range') as DashboardRange | null
    const startDate = searchParams.get('startDate')
    const endDate = searchParams.get('endDate')
    const bucketIndexRaw = searchParams.get('bucketIndex')

    // ─── §VALIDATE-BUCKET-INDEX-PRESENCE ──────────────────────────────
    if (bucketIndexRaw == null) {
      return NextResponse.json({ error: 'Invalid bucketIndex' }, { status: 400 })
    }
    const bucketIndex = Number(bucketIndexRaw)

    // ─── §CALL-SERVICE ────────────────────────────────────────────────
    // The service performs ALL validation (range whitelist, custom dates,
    // bucketIndex integer/range) and throws BreakdownValidationError for
    // 400-level errors.
    const result = await getBreakdown(business.id, {
      range: rangeParam as DashboardRange,
      startDate,
      endDate,
      bucketIndex,
    })

    return NextResponse.json(result)
  } catch (e: any) {
    // §P16-STEP3.8.1: BreakdownValidationError → HTTP 400 (client error).
    if (e instanceof BreakdownValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    // §NEVER-EXPOSE-PRISMA: 500 responses use the generic apiError helper
    // which hides DB internals, stack traces, SQL, etc. in production.
    return apiError(e, 'Failed to load breakdown')
  }
}

// §RE-EXPORT: Expose VALID_RANGES for tests that need to verify the whitelist.
export { VALID_RANGES }
