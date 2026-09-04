import { NextRequest, NextResponse } from 'next/server'
import { db, getCurrentBusiness } from '@/lib/db'
import { apiError } from '@/lib/api-error'
import { requireRole } from '@/lib/auth/session'
import { serializeDecimals } from '@/lib/decimal-serializer'

// §ATOMIC-CARD-SAVE: POST /api/card-customization
//
// Saves ALL card customization fields (logo, cover, preferences) in ONE
// Prisma $transaction. If any part fails, everything rolls back — no
// partial-save state.
//
// §RBAC: Only OWNER/ADMIN can modify card customization.
// §TENANT-ISOLATION: businessId derived from session, never from client.
//
// Body:
//   {
//     logoUrl?: string | null,      // base64 data URL or null to remove
//     coverUrl?: string | null,     // base64 data URL, CSS gradient, or null
//     cardPreferences?: string      // JSON string: {showOwner,showAddress,showPhone,showGstin,greetingText,coverBlur,coverOverlay}
//   }
//
// All fields are optional — only provided fields are updated.
// cardPreferences is validated server-side via validateCardPreferences.

export const maxDuration = 15

// §VALIDATE-CARD-PREFERENCES: Defensive parse + allow-list.
// Mirrors the validation in app-settings route for consistency.
function validateCardPreferences(input: unknown): string | null {
  let prefs: Record<string, unknown> = {}
  if (typeof input === 'string') {
    try {
      prefs = JSON.parse(input)
    } catch {
      return null
    }
  } else if (typeof input === 'object' && input !== null) {
    prefs = input as Record<string, unknown>
  } else {
    return null
  }

  const clean: Record<string, unknown> = {}
  const BOOL_KEYS = ['showOwner', 'showAddress', 'showPhone', 'showGstin'] as const
  for (const key of BOOL_KEYS) {
    if (key in prefs && typeof prefs[key] === 'boolean') {
      clean[key] = prefs[key]
    }
  }
  if ('greetingText' in prefs && typeof prefs.greetingText === 'string') {
    clean.greetingText = prefs.greetingText.trim().slice(0, 30)
  }
  if ('coverBlur' in prefs && typeof prefs.coverBlur === 'number' && !isNaN(prefs.coverBlur)) {
    clean.coverBlur = Math.max(0, Math.min(20, Math.round(prefs.coverBlur)))
  }
  if ('coverOverlay' in prefs && typeof prefs.coverOverlay === 'number' && !isNaN(prefs.coverOverlay)) {
    clean.coverOverlay = Math.max(0, Math.min(0.9, Math.round(prefs.coverOverlay * 100) / 100))
  }
  return Object.keys(clean).length > 0 ? JSON.stringify(clean) : null
}

export async function POST(req: NextRequest) {
  try {
    // §RBAC: Only OWNER/ADMIN can modify card customization
    const user = await requireRole(['OWNER', 'ADMIN'])
    if (user instanceof NextResponse) return user

    const business = await getCurrentBusiness()
    if (!business) {
      return NextResponse.json({ error: 'No business' }, { status: 400 })
    }

    const body = await req.json()

    // §INPUT-VALIDATION: Validate logoUrl and coverUrl before transaction.
    // Accept: null (remove), data:image/* (uploaded image),
    // linear-gradient(...) (suggested CSS cover), or undefined (no change).
    // Reject: arbitrary strings, oversized payloads.
    const MAX_IMAGE_SIZE = 500 * 1024 // 500KB base64 string limit
    function validateImageUrl(val: unknown, fieldName: string): void {
      if (val === null) return
      if (typeof val !== 'string') {
        throw new Error(`Invalid ${fieldName}: must be string or null`)
      }
      if (val.length > MAX_IMAGE_SIZE) {
        throw new Error(`${fieldName} too large (max 500KB)`)
      }
      // Accept data: URLs (uploaded images) and linear-gradient (CSS presets)
      if (!val.startsWith('data:image/') && !val.startsWith('linear-gradient(')) {
        throw new Error(`Invalid ${fieldName} format`)
      }
    }

    if (body.logoUrl !== undefined) {
      validateImageUrl(body.logoUrl, 'logoUrl')
    }
    if (body.coverUrl !== undefined) {
      validateImageUrl(body.coverUrl, 'coverUrl')
    }

    // §ATOMIC-TRANSACTION: Update Business + AppSettings inside ONE Prisma
    // $transaction. If any part fails, everything rolls back.
    const result = await db.$transaction(async (tx) => {
      // 1. Update Business fields (logoUrl, coverUrl) if provided
      const businessData: Record<string, unknown> = {}
      if (body.logoUrl !== undefined) {
        // null = remove, string = set new value
        businessData.logoUrl = body.logoUrl
      }
      if (body.coverUrl !== undefined) {
        businessData.coverUrl = body.coverUrl
      }

      let updatedBusiness: any = null
      if (Object.keys(businessData).length > 0) {
        updatedBusiness = await tx.business.update({
          where: { id: business.id },
          data: businessData,
        })
      }

      // 2. Update AppSettings.cardPreferences if provided
      let updatedSettings: any = null
      if (body.cardPreferences !== undefined || body.dashboardCards !== undefined || body.dashboardSections !== undefined) {
        const updateData: Record<string, unknown> = {}
        if (body.cardPreferences !== undefined) {
          updateData.cardPreferences = validateCardPreferences(body.cardPreferences)
        }
        if (body.dashboardCards !== undefined) {
          updateData.dashboardCards = validateDashboardCards(body.dashboardCards)
        }
        if (body.dashboardSections !== undefined) {
          updateData.dashboardSections = validateDashboardSections(body.dashboardSections)
        }
        updatedSettings = await tx.appSettings.upsert({
          where: { businessId: business.id },
          update: updateData,
          create: {
            businessId: business.id,
            ...updateData,
          },
        })
      }

      return { business: updatedBusiness, settings: updatedSettings }
    })

    // §RESPONSE: Return both updated entities (serialized for Decimal fields)
    return NextResponse.json({
      ok: true,
      business: result.business ? serializeDecimals(result.business) : null,
      settings: result.settings ? serializeDecimals(result.settings) : null,
    })
  } catch (e) {
    return apiError(e, 'Card customization save failed')
  }
}

// §VALIDATE-DASHBOARD-CARDS: Defensive parse + allow-list for dashboard card config.
// Accepts JSON string or array. Only known card IDs with boolean visible + number order.
// Returns a JSON string safe for Prisma storage, or null if empty/invalid.
function validateDashboardCards(input: unknown): string | null {
  let cards: unknown[]
  if (typeof input === 'string') {
    try {
      cards = JSON.parse(input)
    } catch {
      return null
    }
  } else if (Array.isArray(input)) {
    cards = input
  } else {
    return null
  }

  // §KNOWN-CARD-IDs: Allow-list of valid dashboard card IDs
  // §FIX: Added 'netProfitLoss' + 'grossProfit' (Phase 4 cards were missing —
  // their config was silently dropped on save).
  const KNOWN_IDS = new Set([
    'totalReceivable', 'totalPayable', 'businessHealth', 'lowStock',
    'totalSales', 'netProfitLoss', 'totalCollection', 'totalRevenue',
    'totalExpense', 'totalCustomers', 'totalProducts', 'totalInvoices',
    'stockValue', 'todaySales', 'monthlyRevenue', 'grossProfit',
  ])

  const clean: Array<{ id: string; visible: boolean; order: number }> = []
  for (const item of cards) {
    if (typeof item !== 'object' || item === null) continue
    const obj = item as Record<string, unknown>
    if (typeof obj.id !== 'string' || !KNOWN_IDS.has(obj.id)) continue
    if (typeof obj.visible !== 'boolean') continue
    if (typeof obj.order !== 'number' || !Number.isFinite(obj.order)) continue
    clean.push({ id: obj.id, visible: obj.visible, order: Math.max(0, Math.min(100, Math.round(obj.order))) })
  }

  return clean.length > 0 ? JSON.stringify(clean) : null
}

// §DASHBOARD-CUSTOMIZATION: Validate dashboardSections JSON payload.
// Accepts a JSON string or object. Returns a sanitized JSON string or null.
// Uses the same defensive parsing pattern as validateDashboardCards.
function validateDashboardSections(input: unknown): string | null {
  if (input == null) return null
  let parsed: any
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input) } catch { return null }
  } else if (typeof input === 'object') {
    parsed = input
  } else {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null

  // §VALIDATE-SECTIONS: array of {id, visible, order}
  const VALID_SECTION_IDS = new Set([
    'summaryCards', 'performanceChart', 'customerQuality', 'topInsights', 'businessActivity', 'quickActions'
  ])
  const sections: Array<{ id: string; visible: boolean; order: number }> = []
  if (Array.isArray(parsed.sections)) {
    for (const item of parsed.sections) {
      if (typeof item !== 'object' || item === null) continue
      if (typeof item.id !== 'string' || !VALID_SECTION_IDS.has(item.id)) continue
      if (typeof item.visible !== 'boolean') continue
      if (typeof item.order !== 'number') continue
      sections.push({ id: item.id, visible: item.visible, order: Math.max(0, Math.min(10, Math.round(item.order))) })
    }
  }

  // §VALIDATE-STRING-ARRAY: helper for string[] fields
  // Returns [] for non-arrays (field missing/invalid → treated as empty, parser defaults handle fallback)
  const validateStringArray = (arr: any, validSet: Set<string>): string[] => {
    if (!Array.isArray(arr)) return []
    return arr.filter((s: any) => typeof s === 'string' && validSet.has(s))
  }

  // §STEP-1D-CORRECTION: Validate `order` fields — null-safe.
  // If the field is missing/invalid (not an array), return null so the parser
  // falls back to defaults. If it's an explicit empty array [], preserve it.
  const validateOrderArray = (arr: any, validSet: Set<string>): string[] | null => {
    if (arr === null || arr === undefined) return null // missing → parser uses defaults
    if (!Array.isArray(arr)) return null // invalid type → parser uses defaults
    return arr.filter((s: any) => typeof s === 'string' && validSet.has(s))
  }

  const GRADES = new Set(['A', 'B', 'C', 'D', 'E'])
  const TOP_TABS = new Set(['debtors', 'buyers', 'payments', 'products', 'defaulters'])
  const HUB_TABS = new Set(['transactions', 'lowstock', 'orders'])
  const QUICK_ACTIONS = new Set(['add-party', 'add-product', 'new-invoice', 'add-transaction'])

  const result: Record<string, unknown> = { sections }

  // customerQuality
  // §STEP-2C: Added chartShape, showCount, showPercentage, showDescription, tapEnabled, sortOrder.
  // §STEP-2C-REVIEW: Replaced tapBehavior ('modal'|'filter') with tapEnabled (boolean).
  //   Migration: old tapBehavior='modal'/'filter' → tapEnabled=true (filter/nav behavior REMOVED).
  //   Invalid/missing → tapEnabled=true (default).
  // Mirrors the parser in dashboard-preferences.ts.
  if (parsed.customerQuality && typeof parsed.customerQuality === 'object') {
    const cq = parsed.customerQuality
    const CQ_SHAPES = new Set(['bar', 'donut', 'horizontal'])
    const CQ_SORTS = new Set(['grade', 'count-desc'])
    // §STEP-2C-REVIEW: Resolve tapEnabled with backwards-compatible migration.
    let tapEnabled: boolean
    if (typeof cq.tapEnabled === 'boolean') {
      tapEnabled = cq.tapEnabled
    } else if (typeof cq.tapBehavior === 'string') {
      // §MIGRATE: old tapBehavior → tapEnabled=true (filter/nav behavior NOT retained)
      tapEnabled = true
    } else {
      tapEnabled = true
    }
    result.customerQuality = {
      visibleGrades: validateStringArray(cq.visibleGrades, GRADES),
      chartShape: typeof cq.chartShape === 'string' && CQ_SHAPES.has(cq.chartShape) ? cq.chartShape : 'bar',
      // §EXPLICIT-FALSE: typeof === 'boolean' accepts false (not just truthy)
      showCount: typeof cq.showCount === 'boolean' ? cq.showCount : true,
      showPercentage: typeof cq.showPercentage === 'boolean' ? cq.showPercentage : true,
      showDescription: typeof cq.showDescription === 'boolean' ? cq.showDescription : true,
      tapEnabled,
      sortOrder: typeof cq.sortOrder === 'string' && CQ_SORTS.has(cq.sortOrder) ? cq.sortOrder : 'grade',
    }
  }

  // topInsights
  if (parsed.topInsights && typeof parsed.topInsights === 'object') {
    result.topInsights = {
      visibleTabs: validateStringArray(parsed.topInsights.visibleTabs, TOP_TABS),
      // §STEP-1D-CORRECTION: Use validateOrderArray for order fields (null-safe)
      order: validateOrderArray(parsed.topInsights.order, TOP_TABS),
      defaultTab: typeof parsed.topInsights.defaultTab === 'string' && TOP_TABS.has(parsed.topInsights.defaultTab) ? parsed.topInsights.defaultTab : 'debtors',
    }
  }

  // businessActivity
  if (parsed.businessActivity && typeof parsed.businessActivity === 'object') {
    result.businessActivity = {
      visibleTabs: validateStringArray(parsed.businessActivity.visibleTabs, HUB_TABS),
      // §STEP-1D-CORRECTION: Use validateOrderArray for order fields (null-safe)
      order: validateOrderArray(parsed.businessActivity.order, HUB_TABS),
      defaultTab: typeof parsed.businessActivity.defaultTab === 'string' && HUB_TABS.has(parsed.businessActivity.defaultTab) ? parsed.businessActivity.defaultTab : 'transactions',
    }
  }

  // quickActions
  if (parsed.quickActions && typeof parsed.quickActions === 'object') {
    result.quickActions = {
      visibleActions: validateStringArray(parsed.quickActions.visibleActions, QUICK_ACTIONS),
      // §STEP-1D-CORRECTION: Use validateOrderArray for order fields (null-safe)
      order: validateOrderArray(parsed.quickActions.order, QUICK_ACTIONS),
    }
  }

  // defaults
  if (parsed.defaults && typeof parsed.defaults === 'object') {
    const CHART_TYPES = new Set(['revenue', 'profit', 'profitLoss', 'cashflow', 'collections', 'categories'])
    const RANGES = new Set(['1d', 'yesterday', '2d', '3d', '5d', '7d', '1m', '3m', '6m', '1y', 'custom'])
    result.defaults = {
      chartType: typeof parsed.defaults.chartType === 'string' && CHART_TYPES.has(parsed.defaults.chartType) ? parsed.defaults.chartType : 'revenue',
      timeRange: typeof parsed.defaults.timeRange === 'string' && RANGES.has(parsed.defaults.timeRange) ? parsed.defaults.timeRange : '7d',
    }
  }

  return JSON.stringify(result)
}
