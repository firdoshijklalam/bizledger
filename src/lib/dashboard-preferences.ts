/**
 * §DASHBOARD-CUSTOMIZATION: Dashboard section preferences.
 *
 * Default config + defensive parser for the `dashboardSections` JSON field
 * stored in AppSettings. Mirrors the parseCardConfig pattern from
 * dashboard-card-management.tsx.
 *
 * §BACKWARD-COMPAT: Existing users without `dashboardSections` field get
 * safe defaults (all sections visible, default order, all tabs/actions visible).
 * No migration needed.
 */

// ─── Types ───────────────────────────────────────────────────────────────

export interface DashboardSection {
  id: 'summaryCards' | 'performanceChart' | 'customerQuality' | 'topInsights' | 'businessActivity' | 'quickActions'
  visible: boolean
  order: number
}

export interface DashboardSectionConfig {
  sections: DashboardSection[]
  customerQuality: {
    visibleGrades: string[]
  }
  topInsights: {
    visibleTabs: string[]
    defaultTab: string
  }
  businessActivity: {
    visibleTabs: string[]
    defaultTab: string
  }
  quickActions: {
    visibleActions: string[]
    order: string[]
  }
  defaults: {
    chartType: string
    timeRange: string
  }
}

// ─── Defaults ────────────────────────────────────────────────────────────

export const DEFAULT_DASHBOARD_SECTIONS: DashboardSection[] = [
  { id: 'summaryCards', visible: true, order: 0 },
  { id: 'performanceChart', visible: true, order: 1 },
  { id: 'customerQuality', visible: true, order: 2 },
  { id: 'topInsights', visible: true, order: 3 },
  { id: 'businessActivity', visible: true, order: 4 },
  { id: 'quickActions', visible: true, order: 5 },
]

export const DEFAULT_DASHBOARD_CONFIG: DashboardSectionConfig = {
  sections: DEFAULT_DASHBOARD_SECTIONS,
  customerQuality: {
    visibleGrades: ['A', 'B', 'C', 'D', 'E'],
  },
  topInsights: {
    visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
    defaultTab: 'debtors',
  },
  businessActivity: {
    visibleTabs: ['transactions', 'lowstock', 'orders'],
    defaultTab: 'transactions',
  },
  quickActions: {
    visibleActions: ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
    order: ['add-party', 'add-product', 'new-invoice', 'add-transaction'],
  },
  defaults: {
    chartType: 'revenue',
    timeRange: '7d',
  },
}

// ─── Parser (defensive, mirrors parseCardConfig) ────────────────────────

const VALID_SECTION_IDS = new Set([
  'summaryCards', 'performanceChart', 'customerQuality', 'topInsights', 'businessActivity', 'quickActions'
])
const VALID_GRADES = new Set(['A', 'B', 'C', 'D', 'E'])
const VALID_TOP_TABS = new Set(['debtors', 'buyers', 'payments', 'products', 'defaulters'])
const VALID_HUB_TABS = new Set(['transactions', 'lowstock', 'orders'])
const VALID_QUICK_ACTIONS = new Set(['add-party', 'add-product', 'new-invoice', 'add-transaction'])
const VALID_CHART_TYPES = new Set(['revenue', 'profit', 'profitLoss', 'cashflow', 'collections', 'categories'])
const VALID_RANGES = new Set(['1d', 'yesterday', '2d', '3d', '5d', '7d', '1m', '3m', '6m', '1y', 'custom'])

function filterStringArray(arr: any, validSet: Set<string>): string[] {
  if (!Array.isArray(arr)) return null as any // null = field missing/invalid; [] = intentionally empty
  return arr.filter((s: any) => typeof s === 'string' && validSet.has(s))
}

/**
 * Helper: if `arr` is null (field missing/invalid), return `defaults`.
 * If `arr` is an array (including empty []), return it as-is.
 * This distinguishes "field not provided" from "user explicitly emptied it".
 */
function resolveArray(arr: string[] | null, defaults: string[]): string[] {
  return arr === null ? [...defaults] : arr
}

/**
 * Parse a raw dashboardSections value (JSON string or object) into a valid
 * DashboardSectionConfig. Falls back to defaults on any error.
 *
 * §BACKWARD-COMPAT: If raw is null/undefined/empty, returns DEFAULT_DASHBOARD_CONFIG.
 * Missing fields are filled from defaults. Unknown IDs are filtered.
 */
export function parseDashboardSectionConfig(raw: any): DashboardSectionConfig {
  if (!raw) return DEFAULT_DASHBOARD_CONFIG

  let parsed: any
  try {
    parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch {
    return DEFAULT_DASHBOARD_CONFIG
  }

  if (typeof parsed !== 'object' || parsed === null) return DEFAULT_DASHBOARD_CONFIG

  // §SECTIONS: Parse + validate + add missing as visible (preserve user's visibility)
  let sections: DashboardSection[] = []
  if (Array.isArray(parsed.sections)) {
    for (const item of parsed.sections) {
      if (typeof item !== 'object' || item === null) continue
      if (typeof item.id !== 'string' || !VALID_SECTION_IDS.has(item.id)) continue
      if (typeof item.visible !== 'boolean') continue
      if (typeof item.order !== 'number') continue
      sections.push({
        id: item.id as DashboardSection['id'],
        visible: item.visible,
        order: Math.max(0, Math.min(10, Math.round(item.order))),
      })
    }
  }
  // Add missing sections from defaults
  for (const def of DEFAULT_DASHBOARD_SECTIONS) {
    if (!sections.find(s => s.id === def.id)) {
      sections.push({ ...def })
    }
  }
  sections.sort((a, b) => a.order - b.order)

  // §CUSTOMER-QUALITY
  // §STEP-1B: Distinguish "field missing" (→ defaults) from "empty array" (→ keep []).
  const cq = parsed.customerQuality && typeof parsed.customerQuality === 'object' ? parsed.customerQuality : {}
  const visibleGrades = filterStringArray(cq.visibleGrades, VALID_GRADES)
  const customerQuality = {
    visibleGrades: resolveArray(visibleGrades, DEFAULT_DASHBOARD_CONFIG.customerQuality.visibleGrades),
  }

  // §TOP-INSIGHTS
  const ti = parsed.topInsights && typeof parsed.topInsights === 'object' ? parsed.topInsights : {}
  const topTabs = filterStringArray(ti.visibleTabs, VALID_TOP_TABS)
  const topInsights = {
    visibleTabs: resolveArray(topTabs, DEFAULT_DASHBOARD_CONFIG.topInsights.visibleTabs),
    defaultTab: typeof ti.defaultTab === 'string' && VALID_TOP_TABS.has(ti.defaultTab) ? ti.defaultTab : 'debtors',
  }

  // §BUSINESS-ACTIVITY
  const ba = parsed.businessActivity && typeof parsed.businessActivity === 'object' ? parsed.businessActivity : {}
  const hubTabs = filterStringArray(ba.visibleTabs, VALID_HUB_TABS)
  const businessActivity = {
    visibleTabs: resolveArray(hubTabs, DEFAULT_DASHBOARD_CONFIG.businessActivity.visibleTabs),
    defaultTab: typeof ba.defaultTab === 'string' && VALID_HUB_TABS.has(ba.defaultTab) ? ba.defaultTab : 'transactions',
  }

  // §QUICK-ACTIONS
  const qa = parsed.quickActions && typeof parsed.quickActions === 'object' ? parsed.quickActions : {}
  const qaVisible = filterStringArray(qa.visibleActions, VALID_QUICK_ACTIONS)
  const qaOrder = filterStringArray(qa.order, VALID_QUICK_ACTIONS)
  const quickActions = {
    visibleActions: resolveArray(qaVisible, DEFAULT_DASHBOARD_CONFIG.quickActions.visibleActions),
    order: resolveArray(qaOrder, DEFAULT_DASHBOARD_CONFIG.quickActions.order),
  }

  // §DEFAULTS
  const df = parsed.defaults && typeof parsed.defaults === 'object' ? parsed.defaults : {}
  const defaults = {
    chartType: typeof df.chartType === 'string' && VALID_CHART_TYPES.has(df.chartType) ? df.chartType : 'revenue',
    timeRange: typeof df.timeRange === 'string' && VALID_RANGES.has(df.timeRange) ? df.timeRange : '7d',
  }

  return { sections, customerQuality, topInsights, businessActivity, quickActions, defaults }
}

/**
 * Get the visibility of a specific dashboard section by ID.
 * Returns true if the section is visible (or not found in config — defaults to visible).
 */
export function isSectionVisible(config: DashboardSectionConfig, sectionId: string): boolean {
  const section = config.sections.find(s => s.id === sectionId)
  return section ? section.visible : true
}

/**
 * Get the ordered list of visible sections.
 */
export function getVisibleSections(config: DashboardSectionConfig): DashboardSection[] {
  return config.sections
    .filter(s => s.visible)
    .sort((a, b) => a.order - b.order)
}

/**
 * §STEP-1B: Get the ordered list of visible Quick Action IDs.
 *
 * Uses `visibleActions` to determine which actions are shown.
 * Uses `order` to determine the display order among those enabled actions.
 * Enabled actions missing from the order list are appended safely
 * after the explicitly ordered actions.
 * Unknown/invalid action IDs never appear (filtered by the parser).
 *
 * @returns string[] of action IDs in the order they should render
 */
export function getOrderedQuickActions(config: DashboardSectionConfig): string[] {
  const { visibleActions, order } = config.quickActions
  if (visibleActions.length === 0) return []

  const result: string[] = []
  // First: actions in the saved order that are also visible
  for (const actionId of order) {
    if (visibleActions.includes(actionId) && !result.includes(actionId)) {
      result.push(actionId)
    }
  }
  // Then: visible actions not in the order list (appended safely)
  for (const actionId of visibleActions) {
    if (!result.includes(actionId)) {
      result.push(actionId)
    }
  }
  return result
}
