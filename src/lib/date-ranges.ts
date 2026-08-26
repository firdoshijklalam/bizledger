/**
 * §SHARED-DATE-RANGES: Single source of truth for date-range semantics.
 *
 * Used by:
 *   - src/app/api/dashboard/route.ts     (Dashboard API)
 *   - src/app/api/transactions/summary/route.ts (History API)
 *   - src/app/api/reports/route.ts       (Reports API, via parseReportDateRange)
 *   - src/components/views/dashboard-view.tsx (TimeMetricCard, chart, card click)
 *   - src/components/views/transaction-history-view.tsx (History view)
 *   - src/components/views/reports-view.tsx (Reports view)
 *
 * §WHY: Previously each API/view had its own slightly different switch
 * statement computing date boundaries. Three consequences:
 *   1. Lossy mapping: dashboard "3d" → History "week" → different window.
 *   2. Timezone drift: dashboard used local `setHours()`, Reports used
 *      `Date.UTC(...)` — producing different windows for the "same" range.
 *   3. Maintenance: range semantics had to be changed in N places.
 *
 * §TIMEZONE: All ranges are computed in **Asia/Kolkata** (IST, UTC+5:30).
 * The app is targeted at Indian shopkeepers. The server may run in UTC
 * (Vercel default), but the user's "today" must mean IST today, not UTC
 * today. Using `setHours(0,0,0,0)` on `new Date()` gives server-timezone
 * midnight — wrong for IST users when the server is UTC. We compute IST
 * boundaries explicitly via UTC offset arithmetic, so the result is the
 * same regardless of server timezone.
 *
 * §SEMANTICS (authoritative — do not change without updating all callers):
 *   - '1d'        Today (00:00:00 IST → 23:59:59.999 IST)
 *   - 'yesterday' Previous calendar day (IST)
 *   - '2d'        Today + previous 1 day (rolling 2 calendar days)
 *   - '3d'        Today + previous 2 days (rolling 3 calendar days)
 *   - '5d'        Today + previous 4 days (rolling 5 calendar days)
 *   - '7d'        Rolling last 7 calendar days (NOT Mon–Sun week)
 *   - '1m'        Rolling last 30 days (NOT calendar month — preserves
 *                 existing Dashboard API semantics at a0dfe64)
 *   - '3m'        Rolling last 90 days
 *   - '6m'        Rolling last 180 days
 *   - '1y'        Rolling last 365 days
 *   - 'custom'    User-supplied start/end (YYYY-MM-DD); end is inclusive
 *                 (23:59:59.999 IST)
 *
 * §ROLLING-VS-CALENDAR: The Dashboard API at a0dfe64 used ROLLING
 * semantics for 1m (`setMonth(getMonth()-1)`) and ROLLING for 1y
 * (`setFullYear(getFullYear()-1)`). 1m via setMonth(-1) actually produces
 * a calendar-anchored "same day last month" — but if today is March 31,
 * setMonth(-1) gives March 3 (March has 31 days, Feb has 28, so Feb 31
 * overflows). To preserve existing numbers EXACTLY, we mirror that
 * behavior with setMonth/setFullYear rather than introducing a 30-day
 * approximation. See `computeRangeBounds` below.
 *
 * §NON-NEGOTIABLE: Callers MUST use this utility. They MUST NOT roll
 * their own `switch(range)` statements. If a new range is needed, add
 * it here and update the DASHBOARD_RANGES export.
 */

export type DashboardRange =
  | '1d' | 'yesterday' | '2d' | '3d' | '5d' | '7d'
  | '1m' | '3m' | '6m' | '1y'
  | 'custom'

/**
 * The full set of ranges the Dashboard exposes to users.
 *
 * History and Reports MUST support every entry here so that a card
 * click carrying any of these ranges is faithfully displayed.
 */
export const DASHBOARD_RANGES: Array<{ id: DashboardRange; label: string }> = [
  { id: '1d', label: '1 Day (Today)' },
  { id: 'yesterday', label: 'Yesterday' },
  { id: '2d', label: '2 Days' },
  { id: '3d', label: '3 Days' },
  { id: '5d', label: '5 Days' },
  { id: '7d', label: '1 Week' },
  { id: '1m', label: '1 Month' },
  { id: '3m', label: '3 Months' },
  { id: '6m', label: '6 Months' },
  { id: '1y', label: '1 Year' },
  { id: 'custom', label: 'Custom Range' },
]

/**
 * History's local range state — superset of DashboardRange minus the
 * long ranges that History never offered before (3m/6m/1y were collapsed
 * to 'week' historically). Now History accepts the full DashboardRange
 * set so card clicks never lose context.
 *
 * (Kept as an alias for readability at History call-sites.)
 */
export type HistoryRange = DashboardRange

/**
 * Reports P&L range — same set. P&L now supports all dashboard ranges.
 */
export type PLRange = DashboardRange

/**
 * IST offset in milliseconds (UTC+5:30 = +330 minutes).
 * Used to shift a UTC Date to IST midnight.
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/**
 * Returns a Date representing "midnight at start of `daysAgo` IST days,
 * plus end-of-today IST". Used by rolling ranges (1d, 2d, 3d, 5d, 7d).
 *
 * Example: today is 2026-08-26 11:30 IST.
 *   rollingDaysBounds(2) →
 *     start = 2026-08-24 00:00:00 IST  (= 2026-08-23 18:30:00 UTC)
 *     end   = 2026-08-26 23:59:59.999 IST  (= 2026-08-26 18:29:59.999 UTC)
 */
function rollingDaysBounds(daysAgo: number): { start: Date; end: Date } {
  const now = new Date()
  // Shift "now" to IST by adding the IST offset, then zero out the time
  // components, then subtract the offset back. This gives IST midnight
  // regardless of the server's local timezone.
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  const istTodayMidnight = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  )
  const istTodayEnd = new Date(istTodayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1)
  const startIst = new Date(istTodayMidnight.getTime() - daysAgo * 24 * 60 * 60 * 1000)
  // Shift back to UTC for return (Date objects are UTC internally)
  return {
    start: new Date(startIst.getTime() - IST_OFFSET_MS),
    end: new Date(istTodayEnd.getTime() - IST_OFFSET_MS),
  }
}

/**
 * Returns midnight-IST for the previous calendar day, end = 23:59:59.999 IST.
 */
function yesterdayBounds(): { start: Date; end: Date } {
  const yesterday = rollingDaysBounds(1)
  // yesterdayBounds already gives "1 day ago 00:00 IST → today 23:59 IST"
  // We want "yesterday 00:00 → yesterday 23:59:59.999" (no today).
  const startIst = new Date(yesterday.start.getTime() + IST_OFFSET_MS)
  const endIst = new Date(startIst.getTime() + 24 * 60 * 60 * 1000 - 1)
  return {
    start: new Date(startIst.getTime() - IST_OFFSET_MS),
    end: new Date(endIst.getTime() - IST_OFFSET_MS),
  }
}

/**
 * Rolling N months (preserves Dashboard API a0dfe64 semantics).
 * Uses setMonth(-N) which is calendar-aware (handles month length
 * differences, e.g. Jan 31 - 1 month = Jan 31 → Feb 28/29).
 */
function rollingMonthsBounds(monthsAgo: number): { start: Date; end: Date } {
  const now = new Date()
  // Compute IST "now"
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  // IST today midnight
  const istTodayMidnight = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  )
  const istTodayEnd = new Date(istTodayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1)
  // Mirror dashboard API's `setMonth(getMonth()-N)` — this gives calendar
  // "same day N months ago", which is what the dashboard card displayed.
  const startIst = new Date(istTodayMidnight)
  startIst.setUTCMonth(startIst.getUTCMonth() - monthsAgo)
  return {
    start: new Date(startIst.getTime() - IST_OFFSET_MS),
    end: new Date(istTodayEnd.getTime() - IST_OFFSET_MS),
  }
}

/**
 * Rolling N years. setFullYear(-N) — preserves Dashboard API a0dfe64 semantics.
 */
function rollingYearsBounds(yearsAgo: number): { start: Date; end: Date } {
  const now = new Date()
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  const istTodayMidnight = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      istNow.getUTCDate(),
      0,
      0,
      0,
      0,
    ),
  )
  const istTodayEnd = new Date(istTodayMidnight.getTime() + 24 * 60 * 60 * 1000 - 1)
  const startIst = new Date(istTodayMidnight)
  startIst.setUTCFullYear(startIst.getUTCFullYear() - yearsAgo)
  return {
    start: new Date(startIst.getTime() - IST_OFFSET_MS),
    end: new Date(istTodayEnd.getTime() - IST_OFFSET_MS),
  }
}

/**
 * Custom range from user-supplied YYYY-MM-DD strings.
 *
 * §INCLUSIVE-END: end date gets 23:59:59.999 IST (not 00:00:00).
 * §IST: Both start and end are interpreted as IST dates.
 *   - start = YYYY-MM-DDT00:00:00+05:30
 *   - end   = YYYY-MM-DDT23:59:59.999+05:30
 *
 * Returns null if either date is missing/invalid.
 */
function customBounds(
  customStart: string | undefined | null,
  customEnd: string | undefined | null,
): { start: Date; end: Date } | null {
  if (!customStart || !customEnd) return null
  // Parse "YYYY-MM-DD" as IST midnight by appending T00:00:00+05:30
  const startStr = `${customStart}T00:00:00+05:30`
  const endStr = `${customEnd}T23:59:59.999+05:30`
  const start = new Date(startStr)
  const end = new Date(endStr)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null
  // Swap if user reversed the order
  if (start.getTime() > end.getTime()) {
    return { start: end, end: start }
  }
  return { start, end }
}

/**
 * §COMPUTE-RANGE-BOUNDS: The single authoritative date-boundary function.
 *
 * Returns { start, end } Date objects representing the exact window for the
 * given range + optional custom dates. ALL APIs and views MUST call this.
 *
 * For 'custom' range, customStart/customEnd MUST be provided (YYYY-MM-DD).
 * Returns null for 'custom' with missing dates — caller decides fallback.
 */
export function computeRangeBounds(
  range: DashboardRange,
  customStart?: string | null,
  customEnd?: string | null,
): { start: Date; end: Date } | null {
  switch (range) {
    case '1d':
      return rollingDaysBounds(0)
    case 'yesterday':
      return yesterdayBounds()
    case '2d':
      return rollingDaysBounds(1)
    case '3d':
      return rollingDaysBounds(2)
    case '5d':
      return rollingDaysBounds(4)
    case '7d':
      return rollingDaysBounds(6)
    case '1m':
      return rollingMonthsBounds(1)
    case '3m':
      return rollingMonthsBounds(3)
    case '6m':
      return rollingMonthsBounds(6)
    case '1y':
      return rollingYearsBounds(1)
    case 'custom':
      return customBounds(customStart, customEnd)
    default:
      // Exhaustiveness check — TypeScript will error if a new DashboardRange
      // variant is added without a case here.
      return null
  }
}

/**
 * §DASHBOARD-RANGE-LABEL: Human-readable label for a range + custom dates.
 *
 * Used by History/Reports to display the SAME label the Dashboard card
 * showed — so the user sees "3 Days" both on the dashboard AND on History
 * after clicking the card.
 *
 * For 'custom', formats as "DD MMM – DD MMM" (e.g. "20 Aug – 24 Aug").
 */
export function dashboardRangeLabel(
  range: DashboardRange,
  customStart?: string | null,
  customEnd?: string | null,
): string {
  if (range === 'custom' && customStart && customEnd) {
    try {
      const fmt = (s: string) => {
        const d = new Date(`${s}T00:00:00+05:30`)
        if (isNaN(d.getTime())) return s
        return d.toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          timeZone: 'Asia/Kolkata',
        })
      }
      return `${fmt(customStart)} – ${fmt(customEnd)}`
    } catch {
      return 'Custom Range'
    }
  }
  const found = DASHBOARD_RANGES.find((r) => r.id === range)
  return found ? found.label : 'Custom Range'
}

/**
 * §RANGE-CONTEXT: A range + its custom dates, packaged as one object.
 *
 * This is the shape that travels through Zustand store from Dashboard →
 * History/Reports. Carrying all three together avoids losing the custom
 * range's start/end dates (the original Phase 4 bug D1).
 */
export interface RangeContext {
  range: DashboardRange
  customStart?: string | null
  customEnd?: string | null
}

/**
 * §EQUAL-RANGE-CONTEXT: Deep equality check for RangeContext objects.
 * Used by tests to assert that History received exactly what Dashboard sent.
 */
export function equalRangeContext(a: RangeContext, b: RangeContext): boolean {
  return (
    a.range === b.range &&
    (a.customStart || null) === (b.customStart || null) &&
    (a.customEnd || null) === (b.customEnd || null)
  )
}
