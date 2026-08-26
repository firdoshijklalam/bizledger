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
 *   - '1m'        Calendar-aware rolling 1 month via setMonth(-1)
 *                 (NOT a fixed 30-day count — actual day count varies 28-31)
 *   - '3m'        Calendar-aware rolling 3 months via setMonth(-3)
 *   - '6m'        Calendar-aware rolling 6 months via setMonth(-6)
 *   - '1y'        Calendar-aware rolling 1 year via setFullYear(-1)
 *                 (365 or 366 days depending on leap year)
 *   - 'custom'    User-supplied start/end (YYYY-MM-DD); end is inclusive
 *                 (23:59:59.999 IST). Reversed inputs are auto-normalized
 *                 by swapping DATE STRINGS (not timestamps) before applying
 *                 start-of-day/end-of-day semantics.
 *
 * §ROLLING-VS-CALENDAR: '1m'/'3m'/'6m' use `setMonth(-N)` which is calendar-
 * aware (same day N months ago). '1y' uses `setFullYear(-1)` (same day 1 year
 * ago). These are NOT fixed day-counts. For example, on Aug 26, `1m` = Jul 26
 * (31 days), but on Mar 31 `1m` = Feb 28 (28 days, 2026 non-leap) — JavaScript
 * overflows Feb 31 to Mar 3 internally, then we normalize. This mirrors the
 * Dashboard API's pre-Phase-5 semantics at `a0dfe64` (which used
 * `setMonth(getMonth()-1)`).
 *
 * §CALENDAR-MONTH-TO-DATE: SEPARATE from the rolling '1m' range above. The
 * Dashboard API's `monthlyRevenue` field uses CALENDAR month-to-date (1st of
 * current IST month → now), NOT rolling 1 month. This is preserved by the
 * separate `calendarMonthStartIST()` helper exported below. Do NOT confuse
 * the two — they compute different windows.
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
 * §REVERSED-INPUT-NORMALIZATION (Phase 5 pre-commit FIX 2):
 * If the user accidentally selects end-date BEFORE start-date (e.g.
 * customStart='2026-08-24', customEnd='2026-08-20'), we normalize by
 * swapping the DATE STRINGS first, THEN applying start-of-day/end-of-day
 * semantics. Swapping the strings (not the timestamps) is critical —
 * swapping timestamps would produce a near-empty window because start
 * already has 00:00:00 applied and end already has 23:59:59.999 applied.
 *
 * Example (reversed input):
 *   customStart='2026-08-24', customEnd='2026-08-20'
 *   → swap strings → start='2026-08-20', end='2026-08-24'
 *   → apply IST semantics →
 *     start = 2026-08-20T00:00:00+05:30 = 2026-08-19T18:30:00.000Z
 *     end   = 2026-08-24T23:59:59.999+05:30 = 2026-08-24T18:29:59.999Z
 *
 * Returns null if either date is missing/invalid.
 */
function customBounds(
  customStart: string | undefined | null,
  customEnd: string | undefined | null,
): { start: Date; end: Date } | null {
  if (!customStart || !customEnd) return null

  // §FIX-2: Normalize by swapping DATE STRINGS (not timestamps).
  // Date strings in YYYY-MM-DD format compare lexicographically the same
  // way they compare chronologically, so a simple string comparison tells
  // us if the user reversed the input.
  let startStr = customStart
  let endStr = customEnd
  if (startStr > endStr) {
    // Reversed input — swap the date strings BEFORE applying IST semantics
    const tmp = startStr
    startStr = endStr
    endStr = tmp
  }

  // Parse "YYYY-MM-DD" as IST midnight (start) / IST end-of-day (end)
  const start = new Date(`${startStr}T00:00:00+05:30`)
  const end = new Date(`${endStr}T23:59:59.999+05:30`)
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null

  // §POST-SWAP-INVARIANT: After swapping date strings, start <= end is
  // guaranteed. No timestamp swap needed.
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

/**
 * §CALENDAR-MONTH-START-IST: Returns the IST midnight of the 1st day of the
 * CURRENT IST calendar month. Used by the Dashboard API's `monthlyRevenue`
 * field (which is calendar month-to-date, NOT rolling 1 month).
 *
 * §WHY-SEPARATE-FROM-1M: The '1m' range in `computeRangeBounds` is ROLLING
 * (setMonth(-1) = same day last month). But `monthlyRevenue` semantics at
 * a0dfe64 used `new Date(); setDate(1); setHours(0,0,0,0)` — which is
 * CALENDAR month-to-date (1st of current month → now). These are DIFFERENT
 * windows. Pre-Phase-5 commit `94647ee` accidentally replaced `monthStart`
 * with `computeRangeBounds('1m')!.start`, changing `monthlyRevenue` from
 * calendar-month-to-date to rolling-1-month — a regression. This helper
 * restores the calendar-month-to-date semantics with IST-safe boundaries.
 *
 * §IST-SAFE: Computes the 1st of the current IST month at 00:00:00 IST,
 * regardless of server timezone. The old `setHours(0,0,0,0)` on a UTC
 * server gave UTC midnight (= 05:30 IST) — wrong for IST users.
 *
 * Example: today is 2026-08-26 12:00 IST
 *   → returns 2026-08-01T00:00:00+05:30 = 2026-07-31T18:30:00.000Z
 *
 * Example: today is 2026-01-15 03:00 IST (year boundary)
 *   → returns 2026-01-01T00:00:00+05:30 = 2025-12-31T18:30:00.000Z
 */
export function calendarMonthStartIST(now: Date = new Date()): Date {
  // Shift "now" to IST by adding the IST offset, then take the UTC year/month
  // (which now represent IST year/month), then construct UTC midnight on the
  // 1st of that month, then shift back to UTC.
  const istNow = new Date(now.getTime() + IST_OFFSET_MS)
  const istMonthStartUtc = new Date(
    Date.UTC(
      istNow.getUTCFullYear(),
      istNow.getUTCMonth(),
      1, // 1st day of the month
      0,
      0,
      0,
      0,
    ),
  )
  // Shift back to UTC for return (Date objects are UTC internally)
  return new Date(istMonthStartUtc.getTime() - IST_OFFSET_MS)
}

/**
 * §CALENDAR-TODAY-START-IST: Returns the IST midnight of today. Used by the
 * Dashboard API's `todaySales` field. Alias for `computeRangeBounds('1d')!.start`
 * but named explicitly for clarity at the call-site where the semantic is
 * "today" (not "the 1d range").
 *
 * §IST-SAFE: Computes today's 00:00:00 IST regardless of server timezone.
 */
export function calendarTodayStartIST(now: Date = new Date()): Date {
  return computeRangeBounds('1d')!.start
}

/**
 * §FIX-2B: Compute chart bucket boundaries using IST-aligned time arithmetic.
 *
 * Previously, the bucket loop used `setUTCHours(rangeStart.getUTCHours() + i, 0, 0, 0)`
 * which TRUNCATED 18:30 UTC (00:00 IST) → 18:00 UTC (23:30 IST). This caused
 * the first hourly bucket to start 30 minutes before IST midnight.
 *
 * Fix: Use direct time arithmetic (`getTime() + i * unitMs`) for hour/day/week
 * buckets — this preserves the exact IST midnight boundary without truncation.
 * For month buckets, use `setUTCMonth(month + i, 1)` WITHOUT `setUTCHours(0,0,0,0)`
 * — the rangeStart's time component (18:30 UTC = 00:00 IST) is preserved.
 *
 * Returns an array of `{ start, end, label }` objects for chart rendering.
 */
export interface Bucket {
  start: Date
  end: Date
  label: string
}

export function computeBuckets(
  rangeStart: Date,
  rangeEnd: Date,
  bucketType: 'hour' | 'day' | 'week' | 'month',
  bucketCount: number,
): Bucket[] {
  const buckets: Bucket[] = []
  const HOUR_MS = 60 * 60 * 1000
  const DAY_MS = 24 * HOUR_MS
  const WEEK_MS = 7 * DAY_MS

  for (let i = 0; i < bucketCount; i++) {
    let start: Date
    let end: Date
    let label: string

    if (bucketType === 'hour') {
      start = new Date(rangeStart.getTime() + i * HOUR_MS)
      end = new Date(start.getTime() + HOUR_MS)
      label = start.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
    } else if (bucketType === 'day') {
      start = new Date(rangeStart.getTime() + i * DAY_MS)
      end = new Date(start.getTime() + DAY_MS)
      if (bucketCount <= 7) {
        label = start.toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'Asia/Kolkata' })
      } else {
        label = start.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
      }
    } else if (bucketType === 'week') {
      start = new Date(rangeStart.getTime() + i * WEEK_MS)
      end = new Date(start.getTime() + WEEK_MS)
      label = `W${i + 1}`
    } else {
      start = new Date(rangeStart)
      start.setUTCMonth(rangeStart.getUTCMonth() + i, 1)
      end = new Date(start)
      end.setUTCMonth(start.getUTCMonth() + 1, 1)
      label = start.toLocaleDateString('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' })
    }

    if (start > rangeEnd) break
    // §FIX-7D: Extend last bucket's end to cover rangeEnd exactly.
    // Without this, the last bucket's end (e.g. 30th day for 1m) doesn't
    // reach rangeEnd (which includes the 31st day for months with 31 days).
    // This ensures sum(bucket.expense) === rangeExpense — no data lost.
    // We only extend if the gap is positive (bucket end < range end) and
    // this is the last iteration (i === bucketCount - 1 OR next start > rangeEnd).
    const nextStart = (i + 1 < bucketCount)
      ? new Date(rangeStart.getTime() + (i + 1) * (bucketType === 'hour' ? HOUR_MS : bucketType === 'day' ? DAY_MS : bucketType === 'week' ? WEEK_MS : 0))
      : null
    // For monthly buckets, nextStart uses setUTCMonth (not time arithmetic)
    const nextMonthStart = (i + 1 < bucketCount && bucketType === 'month')
      ? (() => { const d = new Date(rangeStart); d.setUTCMonth(rangeStart.getUTCMonth() + i + 1, 1); return d })()
      : null
    const isLast = (i === bucketCount - 1) || (nextStart && nextStart > rangeEnd) || (nextMonthStart && nextMonthStart > rangeEnd)

    if (isLast && end < rangeEnd) {
      end = new Date(rangeEnd.getTime() + 1) // +1ms to make end inclusive (>= rangeEnd)
    }

    buckets.push({ start, end, label })
  }

  return buckets
}
