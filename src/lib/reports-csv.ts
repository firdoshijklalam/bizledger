/**
 * §REPORTS-CSV: Pure helpers for CSV generation + date-range parsing.
 *
 * §EXTRACTED-FROM-UI: These functions were previously inline in
 * `reports-view.tsx` (exportExcel) and `data-export/route.ts` (CSV escape).
 * They are extracted here for:
 *   1. Testability — pure functions can be unit-tested without a browser/DB.
 *   2. Reuse — both the UI (client-side Excel export) and the API
 *      (server-side CSV download) use the same escape + BOM logic.
 *   3. Consistency — both code paths produce identical, Excel-compatible CSV.
 *
 * §BUGS-FIXED:
 *   - BUG 1: Export Excel produced EMPTY CSV for GST Report, Stock Ageing,
 *     and Customer Quality tabs (only P&L, Party Ledger, Outstanding were
 *     handled). Now all 6 report types produce non-empty CSV.
 *   - BUG 2: CSV lacked UTF-8 BOM. Bengali text (e.g., আব্দুল্লাহ) was present
 *     but Excel mis-rendered it without the BOM. Now CSV always starts with
 *     the UTF-8 BOM (0xEF 0xBB 0xBF).
 *   - BUG 3: CSV did not escape commas, double quotes, or newlines in values.
 *     A party name like "Sharma, Das & Sons" broke the CSV structure. Now
 *     values are properly escaped per RFC 4180.
 *   - BUG 4: /api/reports accepted no date-range query parameters. The P&L
 *     and GST date filter buttons in the UI were cosmetic. Now the API
 *     accepts ?start=YYYY-MM-DD&end=YYYY-MM-DD and filters accordingly.
 */

// ─── CSV escape (RFC 4180) ─────────────────────────────────────────────────

/**
 * Escape a single CSV field per RFC 4180.
 *
 * Rules:
 *   - If the value contains a comma, double quote, newline, or carriage return,
 *     wrap it in double quotes and escape any inner double quotes by doubling.
 *   - Otherwise, return the value as-is.
 *   - null/undefined become empty string.
 *   - Numbers are stringified.
 *
 * Examples:
 *   escapeCsvField('Firdosh Alam')       → 'Firdosh Alam'
 *   escapeCsvField('Sharma, Das & Sons') → '"Sharma, Das & Sons"'
 *   escapeCsvField('He said "hi"')        → '"He said ""hi"""'
 *   escapeCsvField('line1\nline2')        → '"line1\nline2"'
 *   escapeCsvField(1000)                  → '1000'
 *   escapeCsvField('আব্দুল্লাহ')           → 'আব্দুল্লাহ' (no escape needed)
 *   escapeCsvField(null)                  → ''
 */
export function escapeCsvField(value: any): string {
  if (value === null || value === undefined) return ''
  const str = typeof value === 'string' ? value : String(value)
  // §RFC4180: Wrap in quotes if the field contains comma, quote, newline, or CR.
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"'
  }
  return str
}

/**
 * Build a complete CSV string from a 2D array of rows + cells.
 *
 * §BOM: Prepends the UTF-8 BOM (0xFEFF) so Excel correctly decodes Bengali
 * and other non-ASCII characters.
 *
 * §LINE-TERMINATOR: Uses \r\n per RFC 4180 (Excel-friendly).
 */
export function buildCsv(rows: any[][]): string {
  const body = rows.map((row) => row.map(escapeCsvField).join(',')).join('\r\n')
  return '\uFEFF' + body
}

// ─── Report-specific CSV builders ───────────────────────────────────────────

export type ReportType = 'pl' | 'gst' | 'party' | 'outstanding' | 'stock' | 'grade'

interface ReportDataShape {
  business?: { name?: string; currency?: string }
  profitLoss: {
    revenue: number; netRevenue: number; discount: number; cogs: number
    grossProfit: number; indirectExpenses: number; expense: number
    netProfit: number; gst: number
  }
  gst: {
    totalGst: number
    breakdown: Array<{ rate: number; taxable: number; gst: number }>
  }
  partyLedger: Array<{ id: string; name: string; type: string; grade: string; balance: number; phone?: string | null }>
  outstanding: {
    totalReceivable: number; totalPayable: number
    receivables: Array<{ name: string; amount: number; grade: string; phone?: string | null }>
    payables: Array<{ name: string; amount: number; phone?: string | null }>
  }
  stockAgeing: Array<{ name: string; stock: number; value: number; threshold: number; status: string }>
  gradeDistribution: Array<{ grade: string; count: number; balance: number }>
  invoiceCount: number
}

/**
 * Build a CSV for a specific report type. Used by the UI's "Export Excel"
 * button to produce a client-side CSV download for the currently active
 * report tab.
 *
 * §COVERAGE: All 6 report types are handled. Previously only P&L, Party
 * Ledger, and Outstanding were implemented — GST, Stock Ageing, and Customer
 * Quality produced empty CSVs.
 */
export function buildReportCsv(type: ReportType, data: ReportDataShape): string {
  const currency = data.business?.currency || 'INR'
  switch (type) {
    case 'pl': {
      const pl = data.profitLoss
      return buildCsv([
        ['Metric', `Amount (${currency})`],
        ['Total Sales (Gross)', pl.revenue],
        ['Less: Discounts Given', pl.discount],
        ['Net Revenue', pl.netRevenue],
        ['Less: Purchase Cost (COGS)', pl.cogs],
        ['Gross Profit', pl.grossProfit],
        ['Less: Indirect Expenses', pl.indirectExpenses],
        ['Net Profit', pl.netProfit],
        ['GST Collected (liability)', pl.gst],
      ])
    }
    case 'gst': {
      const rows: any[][] = [
        ['Rate (%)', 'Taxable Amount', `GST Amount (${currency})`],
      ]
      for (const b of data.gst.breakdown) {
        rows.push([`${b.rate}%`, b.taxable, b.gst])
      }
      rows.push([])
      rows.push(['Total GST Collected', '', data.gst.totalGst])
      return buildCsv(rows)
    }
    case 'party': {
      const rows: any[][] = [['Name', 'Type', 'Grade', `Balance (${currency})`, 'Phone']]
      for (const p of data.partyLedger) {
        rows.push([p.name, p.type, p.grade, p.balance, p.phone || ''])
      }
      return buildCsv(rows)
    }
    case 'outstanding': {
      const rows: any[][] = [['Name', `Amount (${currency})`, 'Type', 'Grade', 'Phone']]
      for (const r of data.outstanding.receivables) {
        rows.push([r.name, r.amount, 'Receivable', r.grade, r.phone || ''])
      }
      for (const p of data.outstanding.payables) {
        rows.push([p.name, p.amount, 'Payable', '', p.phone || ''])
      }
      rows.push([])
      rows.push(['Total Receivable', data.outstanding.totalReceivable, '', '', ''])
      rows.push(['Total Payable', data.outstanding.totalPayable, '', '', ''])
      return buildCsv(rows)
    }
    case 'stock': {
      const rows: any[][] = [['Product', 'Stock', `Value (${currency})`, 'Threshold', 'Status']]
      for (const s of data.stockAgeing) {
        rows.push([s.name, s.stock, s.value, s.threshold, s.status])
      }
      return buildCsv(rows)
    }
    case 'grade': {
      const rows: any[][] = [['Grade', 'Count', `Total Balance (${currency})`]]
      for (const g of data.gradeDistribution) {
        rows.push([`Grade ${g.grade}`, g.count, g.balance])
      }
      return buildCsv(rows)
    }
    default:
      // Exhaustive check — if a new report type is added without a case,
      // TypeScript will error here (because `type` is a union and the default
      // is unreachable). At runtime, return an empty (BOM-prefixed) CSV.
      return buildCsv([['(no data)']])
  }
}

// ─── Date-range parsing for /api/reports ────────────────────────────────────

export interface DateRange {
  start: Date
  end: Date
}

/**
 * Parse date-range query parameters from a URLSearchParams.
 *
 * Accepted formats:
 *   - ?start=YYYY-MM-DD&end=YYYY-MM-DD       (date only — end is inclusive of the whole day)
 *   - ?start=2026-08-01T10:00:00Z&end=...    (ISO datetime — preserved as-is)
 *
 * §INCLUSIVE-END: When only a date (YYYY-MM-DD) is given for `end`, the end
 * is set to the END of that day (23:59:59.999Z) so that invoices created on
 * the end date are included in the filter.
 *
 * §NULL-RETURN: Returns null if:
 *   - Both params are missing
 *   - Both params are empty strings
 *   - Either param is not a valid date
 *
 * When null is returned, the API defaults to "all time" (no date filter),
 * preserving backward compatibility.
 */
export function parseReportDateRange(params: URLSearchParams): DateRange | null {
  const startStr = params.get('start')
  const endStr = params.get('end')

  // Both missing → no filter
  if (!startStr && !endStr) return null
  // Empty strings → no filter
  if ((!startStr || startStr.trim() === '') && (!endStr || endStr.trim() === '')) return null

  const start = startStr ? new Date(startStr) : new Date(0)
  const end = endStr ? new Date(endStr) : new Date()

  // §INVALID-DATE: If either date is invalid (NaN), return null — the API
  // should default to all-time rather than crash.
  if (isNaN(start.getTime()) || isNaN(end.getTime())) return null

  // §INCLUSIVE-END: If the end string is a date-only (YYYY-MM-DD, length 10),
  // set the end to the END of that day (23:59:59.999Z).
  if (endStr && /^\d{4}-\d{2}-\d{2}$/.test(endStr.trim())) {
    end.setUTCHours(23, 59, 59, 999)
  }

  // §SWAP: If start > end, swap them (avoid empty result).
  if (start.getTime() > end.getTime()) {
    return { start: end, end: start }
  }

  return { start, end }
}

/**
 * Filter invoices by a date range. Returns only non-voided invoices whose
 * `createdAt` falls within [start, end] (inclusive on both ends).
 *
 * §NULL-RANGE: If `range` is null, returns all non-voided invoices
 * (backward compatibility with the unfiltered /api/reports response).
 */
export function filterInvoicesByRange<T extends { status: string; createdAt: Date | string }>(
  invoices: T[],
  range: DateRange | null
): T[] {
  // §VOID-EXCLUSION: Voided invoices are ALWAYS excluded, even when no date
  // range is specified. This matches the /api/reports route's behavior.
  let filtered = invoices.filter((i) => i.status !== 'void')
  if (!range) return filtered
  const startMs = range.start.getTime()
  const endMs = range.end.getTime()
  filtered = filtered.filter((i) => {
    const t = i.createdAt instanceof Date ? i.createdAt.getTime() : new Date(i.createdAt).getTime()
    return t >= startMs && t <= endMs
  })
  return filtered
}

// ─── Date-range presets (used by UI) ───────────────────────────────────────

/**
 * Compute start/end ISO date strings for the P&L range selector.
 *
 * Used by reports-view.tsx to build the /api/reports?start=...&end=... URL.
 *
 * §TIMEZONE-AGNOSTIC: Uses UTC date strings (YYYY-MM-DD) so that the API
 * (which parses them as UTC midnight) applies consistent filtering regardless
 * of the user's timezone. This avoids off-by-one-day bugs where a user in
 * IST selects "Today" but the API interprets it as the previous day in UTC.
 *
 * Returns `{ start: '', end: '' }` for the 'custom' range — the actual
 * dates come from the user-supplied plCustomStart/plCustomEnd inputs.
 */
export function computeRangeDates(
  range: 'today' | 'week' | 'month' | '3months' | 'custom',
  customStart: string,
  customEnd: string
): { start: string; end: string } {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  switch (range) {
    case 'today':
      return { start: today.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    case 'week': {
      // §WEEK: Last 7 days including today
      const start = new Date(today)
      start.setUTCDate(start.getUTCDate() - 6)
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    }
    case 'month': {
      // §MONTH: Current calendar month (1st to today)
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    }
    case '3months': {
      // §3MONTHS: Last 90 days
      const start = new Date(today)
      start.setUTCDate(start.getUTCDate() - 89)
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    }
    case 'custom':
      // §CUSTOM: User-supplied dates (YYYY-MM-DD from <input type="date">)
      return { start: customStart || '', end: customEnd || '' }
  }
}

/**
 * Compute start/end ISO date strings for the GST range selector.
 *
 * §GST-PRESETS:
 *   - 'month'      → current calendar month
 *   - 'last_month' → previous calendar month (full)
 *   - 'quarter'    → current quarter (3 months)
 *   - 'custom'     → user-supplied dates
 */
export function computeGstRangeDates(
  range: 'month' | 'last_month' | 'quarter' | 'custom',
  customStart: string,
  customEnd: string
): { start: string; end: string } {
  const now = new Date()
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))

  switch (range) {
    case 'month': {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    }
    case 'last_month': {
      // §LAST-MONTH: Full previous calendar month
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)) // last day of previous month
      return { start: start.toISOString().split('T')[0], end: end.toISOString().split('T')[0] }
    }
    case 'quarter': {
      // §QUARTER: Current calendar quarter (Q1=Jan-Mar, Q2=Apr-Jun, etc.)
      const quarterStartMonth = Math.floor(now.getUTCMonth() / 3) * 3
      const start = new Date(Date.UTC(now.getUTCFullYear(), quarterStartMonth, 1))
      return { start: start.toISOString().split('T')[0], end: today.toISOString().split('T')[0] }
    }
    case 'custom':
      return { start: customStart || '', end: customEnd || '' }
  }
}
