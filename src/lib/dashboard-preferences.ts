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

export type CustomerQualityChartShape = 'bar' | 'donut' | 'horizontal'
export type CustomerQualitySortOrder = 'grade' | 'count-desc'

export interface DashboardSectionConfig {
  sections: DashboardSection[]
  customerQuality: {
    visibleGrades: string[]
    // §STEP-2C: Advanced Customer Quality settings
    chartShape: CustomerQualityChartShape
    showCount: boolean
    showPercentage: boolean
    showDescription: boolean
    tapBehavior: 'modal' | 'filter'
    sortOrder: CustomerQualitySortOrder
  }
  topInsights: {
    visibleTabs: string[]
    order: string[]
    defaultTab: string
  }
  businessActivity: {
    visibleTabs: string[]
    order: string[]
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
    // §STEP-2C: Advanced defaults — preserve existing visual/behavior as defaults
    chartShape: 'bar',
    showCount: true,
    showPercentage: true,
    showDescription: true,
    tapBehavior: 'modal', // existing behavior: tap opens grade-filtered customer modal
    sortOrder: 'grade',   // existing order: A → E
  },
  topInsights: {
    visibleTabs: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
    order: ['debtors', 'buyers', 'payments', 'products', 'defaulters'],
    defaultTab: 'debtors',
  },
  businessActivity: {
    visibleTabs: ['transactions', 'lowstock', 'orders'],
    order: ['transactions', 'lowstock', 'orders'],
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
const VALID_CQ_CHART_SHAPES = new Set<CustomerQualityChartShape>(['bar', 'donut', 'horizontal'])
const VALID_CQ_SORT_ORDERS = new Set<CustomerQualitySortOrder>(['grade', 'count-desc'])
const VALID_CQ_TAP_BEHAVIORS = new Set(['modal', 'filter'])
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
  // §STEP-2C: Added chartShape, showCount, showPercentage, showDescription, tapBehavior, sortOrder.
  const cq = parsed.customerQuality && typeof parsed.customerQuality === 'object' ? parsed.customerQuality : {}
  const visibleGrades = filterStringArray(cq.visibleGrades, VALID_GRADES)
  // §STEP-2C: Each advanced field is validated independently. Invalid/missing → default.
  // Explicit false values are preserved (typeof === 'boolean' check accepts false).
  const customerQuality = {
    visibleGrades: resolveArray(visibleGrades, DEFAULT_DASHBOARD_CONFIG.customerQuality.visibleGrades),
    chartShape: typeof cq.chartShape === 'string' && VALID_CQ_CHART_SHAPES.has(cq.chartShape as CustomerQualityChartShape)
      ? cq.chartShape as CustomerQualityChartShape
      : DEFAULT_DASHBOARD_CONFIG.customerQuality.chartShape,
    showCount: typeof cq.showCount === 'boolean' ? cq.showCount : DEFAULT_DASHBOARD_CONFIG.customerQuality.showCount,
    showPercentage: typeof cq.showPercentage === 'boolean' ? cq.showPercentage : DEFAULT_DASHBOARD_CONFIG.customerQuality.showPercentage,
    showDescription: typeof cq.showDescription === 'boolean' ? cq.showDescription : DEFAULT_DASHBOARD_CONFIG.customerQuality.showDescription,
    tapBehavior: typeof cq.tapBehavior === 'string' && VALID_CQ_TAP_BEHAVIORS.has(cq.tapBehavior)
      ? cq.tapBehavior as 'modal' | 'filter'
      : DEFAULT_DASHBOARD_CONFIG.customerQuality.tapBehavior,
    sortOrder: typeof cq.sortOrder === 'string' && VALID_CQ_SORT_ORDERS.has(cq.sortOrder as CustomerQualitySortOrder)
      ? cq.sortOrder as CustomerQualitySortOrder
      : DEFAULT_DASHBOARD_CONFIG.customerQuality.sortOrder,
  }

  // §TOP-INSIGHTS
  // §STEP-1D: Added order field for tab reordering
  const ti = parsed.topInsights && typeof parsed.topInsights === 'object' ? parsed.topInsights : {}
  const topTabs = filterStringArray(ti.visibleTabs, VALID_TOP_TABS)
  const topOrder = filterStringArray(ti.order, VALID_TOP_TABS)
  const topInsights = {
    visibleTabs: resolveArray(topTabs, DEFAULT_DASHBOARD_CONFIG.topInsights.visibleTabs),
    order: resolveArray(topOrder, DEFAULT_DASHBOARD_CONFIG.topInsights.order),
    defaultTab: typeof ti.defaultTab === 'string' && VALID_TOP_TABS.has(ti.defaultTab) ? ti.defaultTab : 'debtors',
  }

  // §BUSINESS-ACTIVITY
  // §STEP-1D: Added order field for tab reordering
  const ba = parsed.businessActivity && typeof parsed.businessActivity === 'object' ? parsed.businessActivity : {}
  const hubTabs = filterStringArray(ba.visibleTabs, VALID_HUB_TABS)
  const hubOrder = filterStringArray(ba.order, VALID_HUB_TABS)
  const businessActivity = {
    visibleTabs: resolveArray(hubTabs, DEFAULT_DASHBOARD_CONFIG.businessActivity.visibleTabs),
    order: resolveArray(hubOrder, DEFAULT_DASHBOARD_CONFIG.businessActivity.order),
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
 * §STEP-1D: Refactored to use the shared getOrderedVisibleIds helper.
 * See implementation at the bottom of the file.
 */

/**
 * §STEP-1C-FIX: Move an item within the full order array, skipping over
 * disabled (invisible) items so the visible order actually changes.
 *
 * Algorithm:
 * 1. Build the visible-ordered list (enabled items in saved order).
 * 2. Find the item's position in the visible list.
 * 3. Swap it with the adjacent VISIBLE item (up or down).
 * 4. Reconstruct the full order array, preserving disabled items in place.
 *
 * @param order - The full saved order array (includes disabled items)
 * @param visibleActions - Which action IDs are currently enabled
 * @param id - The action ID to move
 * @param direction - 'up' or 'down'
 * @returns New order array, or null if no move occurred
 */
export function moveItemInOrder(
  order: string[],
  visibleActions: string[],
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  // §STEP-1D-CORRECTION: Normalize the full order FIRST.
  // This ensures every valid ID from BOTH `order` and `visibleActions` is
  // preserved. Disabled IDs already in `order` stay in place. Visible IDs
  // missing from `order` are appended deterministically.
  const normalizedOrder: string[] = []
  // 1. Keep all IDs from the original order (both visible and disabled)
  for (const actionId of order) {
    if (!normalizedOrder.includes(actionId)) {
      normalizedOrder.push(actionId)
    }
  }
  // 2. Append visible IDs not already in the order
  for (const actionId of visibleActions) {
    if (!normalizedOrder.includes(actionId)) {
      normalizedOrder.push(actionId)
    }
  }

  // Build visible-ordered list from the NORMALIZED order
  const visibleOrdered: string[] = []
  for (const actionId of normalizedOrder) {
    if (visibleActions.includes(actionId) && !visibleOrdered.includes(actionId)) {
      visibleOrdered.push(actionId)
    }
  }

  // Find position in visible list
  const visibleIdx = visibleOrdered.indexOf(id)
  if (visibleIdx < 0) return null

  // Determine swap target in visible list
  const swapVisibleIdx = direction === 'up' ? visibleIdx - 1 : visibleIdx + 1
  if (swapVisibleIdx < 0 || swapVisibleIdx >= visibleOrdered.length) return null

  const swapId = visibleOrdered[swapVisibleIdx]

  // Reconstruct full order: walk the NORMALIZED order, swap `id` and `swapId`.
  // All other items (including disabled ones) stay in their original positions.
  const newOrder: string[] = []
  for (const actionId of normalizedOrder) {
    if (actionId === id) {
      newOrder.push(swapId)
    } else if (actionId === swapId) {
      newOrder.push(id)
    } else {
      newOrder.push(actionId)
    }
  }

  // §STEP-1D-CORRECTION: No need to append id/swapId — they're already in
  // normalizedOrder (id is visible → was added in step 2 if missing;
  // swapId is visible → same).

  return newOrder
}

/**
 * §STEP-1D: Generic helper — get ordered visible IDs from any order+visible pair.
 * Used by getOrderedTopInsightsTabs, getOrderedBusinessActivityTabs, and getOrderedQuickActions.
 */
function getOrderedVisibleIds(order: string[], visibleIds: string[]): string[] {
  if (visibleIds.length === 0) return []
  const result: string[] = []
  for (const id of order) {
    if (visibleIds.includes(id) && !result.includes(id)) {
      result.push(id)
    }
  }
  for (const id of visibleIds) {
    if (!result.includes(id)) {
      result.push(id)
    }
  }
  return result
}

/**
 * §STEP-1D: Get the ordered list of visible Top Insights tab IDs.
 */
export function getOrderedTopInsightsTabs(config: DashboardSectionConfig): string[] {
  return getOrderedVisibleIds(config.topInsights.order, config.topInsights.visibleTabs)
}

/**
 * §STEP-1D: Get the ordered list of visible Business Activity tab IDs.
 */
export function getOrderedBusinessActivityTabs(config: DashboardSectionConfig): string[] {
  return getOrderedVisibleIds(config.businessActivity.order, config.businessActivity.visibleTabs)
}

/**
 * §STEP-1D: Refactored to use the shared getOrderedVisibleIds helper.
 */
export function getOrderedQuickActions(config: DashboardSectionConfig): string[] {
  return getOrderedVisibleIds(config.quickActions.order, config.quickActions.visibleActions)
}

/**
 * §STEP-1D-FINAL: Resolve the effective default tab for a section.
 *
 * If savedDefaultTab is visible (in the ordered visible list), use it.
 * Otherwise, use the first tab from the ordered visible list.
 * If no tabs are visible, return null (safe empty state).
 *
 * @param orderedVisible - Result of getOrderedTopInsightsTabs or getOrderedBusinessActivityTabs
 * @param savedDefaultTab - The persisted defaultTab value
 * @returns The effective tab ID, or null if no tabs are visible
 */
export function resolveDefaultTab(
  orderedVisible: string[],
  savedDefaultTab: string,
): string | null {
  if (orderedVisible.length === 0) return null
  if (orderedVisible.includes(savedDefaultTab)) return savedDefaultTab
  return orderedVisible[0]
}

/**
 * §STEP-2C: Pure helper — sort grade distribution data per the user's sortOrder preference.
 *
 * Input: gradeData = [{ grade: 'A', count: 5 }, { grade: 'B', count: 10 }, ...]
 *        config = the parsed DashboardSectionConfig (reads config.customerQuality.sortOrder)
 *
 * Behavior:
 *   'grade'      → A, B, C, D, E (natural grade order — the existing default)
 *   'count-desc' → highest count first, ties broken by grade order (A before B)
 *
 * This is a PURE function (no side effects) so it can be unit-tested directly
 * without React/DOM. The dashboard-view calls this to derive the sorted
 * visible grade data before rendering.
 *
 * §NOTE: This does NOT filter by visibleGrades — the caller is responsible for
 * filtering. This only sorts.
 */
export function getSortedGradeData(
  gradeData: Array<{ grade: string; count: number }>,
  config: DashboardSectionConfig,
): Array<{ grade: string; count: number }> {
  const sortOrder = config.customerQuality.sortOrder
  const arr = [...gradeData] // shallow copy — never mutate caller's array
  if (sortOrder === 'count-desc') {
    // Highest count first; ties broken by natural grade order (A < B < C < D < E)
    const gradeOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4 }
    arr.sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return (gradeOrder[a.grade] ?? 99) - (gradeOrder[b.grade] ?? 99)
    })
  } else {
    // 'grade' — natural A → E order. Unknown grades sort last alphabetically.
    arr.sort((a, b) => a.grade.localeCompare(b.grade))
  }
  return arr
}
