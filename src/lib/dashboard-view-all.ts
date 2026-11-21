/**
 * §STEP-4B: Dashboard "View All" deep-linking — routing/context abstraction.
 *
 * Every Dashboard "View All" action MUST preserve the SEMANTIC MEANING of the
 * insight the user clicked. A "related page" is NOT sufficient — the destination
 * must receive the correct tab, filter, sort, and date-range context so the
 * complete corresponding dataset is shown.
 *
 * This module is the single source of truth for the destination/context used by
 * each Dashboard insight. It exists so:
 *   - Each insight's destination is obvious from one place (the resolver).
 *   - Tests can verify routing logic without mounting React components.
 *   - dashboard-view.tsx stays declarative — it calls `applyViewAllDestination`
 *     with the resolved destination, not an ad-hoc if/else chain.
 *
 * Design constraints (per STEP-4B spec):
 *   - Reuse existing authoritative API/data sources. NO duplicated datasets.
 *   - NO accounting calculation changes. View-All navigation is READ-ONLY.
 *   - NO fake second copy of receivables / payments / sales / units sold.
 *
 * The flow:
 *   1. dashboard-view.tsx calls `resolveViewAllDestination(insightId, ctx)`
 *      → returns a typed `ViewAllDestination` object.
 *   2. dashboard-view.tsx calls `applyViewAllDestination(store, dest)` which
 *      sets the right Zustand context fields + setActiveView().
 *   3. The destination view's `useEffect` consumes the context fields on mount
 *      and clears them (one-shot pattern, same as `reportsTab`).
 */

import type { ViewId } from '@/lib/types'
import type { RangeContext } from '@/lib/date-ranges'
import type {
  OutstandingTab,
  OutstandingGradeFilter,
  PartySortBy,
  PartySegment,
  HistoryViewMode,
  InventorySortBy,
  OnlineOrdersInitialTab,
} from '@/store/app-store'

// ============================================================================
// §DESTINATION-TYPES: Typed ViewAllDestination discriminated union.
// Each variant captures the FULL context needed by the destination view.
// ============================================================================

export type ViewAllDestination =
  // §TOP-DEBTORS: Reports → Outstanding → Receivables (sorted by amount desc).
  // Outstanding.receivables is already sorted by party.balance desc in the
  // Reports API (parties are fetched with balance, then filtered > 0). The
  // destination view shows the COMPLETE receivables list — not just top 5.
  // Outstanding balances are NOT date-filtered (they're current state), so
  // no range context is needed.
  | { kind: 'top-debtors' }
  // §TOP-BUYERS: Reports → Party Ledger → customers segment + sort by
  // purchaseVolume. The Reports API returns `purchaseVolume` per partyLedger
  // entry (computed from sales/retail non-void invoices in the requested range).
  // Supplier-only parties are excluded by setting segment='customers'.
  // `range` preserves the dashboard's selected date window so the buyer
  // ranking matches what the user saw on the dashboard.
  | { kind: 'top-buyers'; range: RangeContext | null }
  // §TOP-PAYMENTS: History → viewMode='payments' + range context. Shows
  // type='credit' transactions only (payment/credit transactions, NOT invoices).
  // Range context preserves the dashboard's selected date window.
  | { kind: 'top-payments'; range: RangeContext | null }
  // §TOP-PRODUCTS: Inventory → sortBy='unitsSold'. Inventory fetches
  // /api/dashboard?range=<range>&includeAllProductStats=true and joins the
  // un-sliced allProductStats array into the product list, then sorts by units
  // sold. `range` preserves the dashboard's selected date window.
  | { kind: 'top-products'; range: RangeContext | null }
  // §TOP-REVENUE-PRODUCTS: Inventory → sortBy='revenue'. Same data source as
  // top-products but sorted by revenue. (Previously routed to Khata — bug.)
  | { kind: 'top-revenue-products'; range: RangeContext | null }
  // §DEFAULTERS: Reports → Outstanding → Receivables filtered to Grade D+E.
  // The Dashboard "Defaulters" insight is specifically D+E (not just D).
  // OutstandingGradeFilter='D+E' is a generic, reusable filter — not a
  // hardcoded special case for this button.
  | { kind: 'defaulters' }
  // §TRANSACTIONS (Business Activity): History → viewMode='transactions' +
  // range context. Shows ALL credit+debit transactions (NOT invoices) with
  // Total In / Total Out summary matching the dashboard.
  | { kind: 'transactions'; range: RangeContext | null }
  // §LOW-STOCK: Inventory → filter='low-stock' (existing behavior, no change).
  // Declared here for completeness + test coverage.
  | { kind: 'low-stock' }
  // §ONLINE-ORDERS: Online Orders → initialTab='all'. Shows a new "All"
  // pseudo-tab displaying orders across all statuses (matching the Dashboard's
  // all-status list). Does NOT break the default 'pending' tab when the page
  // is opened directly elsewhere.
  | { kind: 'online-orders' }

// ============================================================================
// §INSIGHT-IDS: Identifiers for Dashboard insights that have View-All buttons.
// These mirror the tab IDs used in dashboard-view.tsx (topTab / hubTab).
// ============================================================================

export type TopInsightId =
  | 'debtors'
  | 'buyers'
  | 'payments'
  | 'products'
  | 'defaulters'
  | 'top-revenue-products'

export type HubInsightId = 'transactions' | 'lowstock' | 'orders'

// ============================================================================
// §RESOLVER: Pure function — given an insight ID + optional range context,
// returns the typed ViewAllDestination. This is the single source of truth
// for "where does each insight's View-All go?"
// ============================================================================

/**
 * Resolve a Top Insights tab ID to its View-All destination.
 *
 * @param insightId  One of: debtors, buyers, payments, products, defaulters, top-revenue-products
 * @param range      Optional RangeContext (used by top-payments). Other insights
 *                   have inherent semantics that don't depend on range.
 */
export function resolveTopInsightViewAll(
  insightId: TopInsightId,
  range?: RangeContext | null,
): ViewAllDestination {
  switch (insightId) {
    case 'debtors':
      return { kind: 'top-debtors' }
    case 'buyers':
      return { kind: 'top-buyers', range: range ?? null }
    case 'payments':
      return { kind: 'top-payments', range: range ?? null }
    case 'products':
      return { kind: 'top-products', range: range ?? null }
    case 'defaulters':
      return { kind: 'defaulters' }
    case 'top-revenue-products':
      return { kind: 'top-revenue-products', range: range ?? null }
  }
}

/**
 * Resolve a Multi-Tab Hub (Business Activity) tab ID to its View-All destination.
 *
 * @param insightId  One of: transactions, lowstock, orders
 * @param range      Optional RangeContext (used by transactions to preserve
 *                  the dashboard's selected date window including custom range).
 */
export function resolveHubViewAll(
  insightId: HubInsightId,
  range?: RangeContext | null,
): ViewAllDestination {
  switch (insightId) {
    case 'transactions':
      return { kind: 'transactions', range: range ?? null }
    case 'lowstock':
      return { kind: 'low-stock' }
    case 'orders':
      return { kind: 'online-orders' }
  }
}

// ============================================================================
// §APPLIER: Imperative helper that sets the right Zustand context fields +
// setActiveView. Called by dashboard-view.tsx View-All handlers.
//
// The store type is intentionally minimal (structural typing) so this helper
// can be unit-tested with a mock store without importing the full Zustand
// store. The real app-store satisfies this interface.
// ============================================================================

export interface ViewAllStoreActions {
  setActiveView: (v: ViewId) => void
  setReportsTab: (t: string | null) => void
  setReportsOutstandingTab: (t: OutstandingTab | null) => void
  setReportsOutstandingGradeFilter: (g: OutstandingGradeFilter | null) => void
  setReportsPartySortBy: (s: PartySortBy | null) => void
  setReportsPartySegment: (s: PartySegment | null) => void
  setReportsRangeContext: (ctx: RangeContext | null) => void
  setHistoryViewMode: (m: HistoryViewMode | null) => void
  setHistoryRangeContext: (ctx: RangeContext | null) => void
  setInventoryFilter: (f: 'all' | 'low-stock') => void
  setInventorySortBy: (s: InventorySortBy | null) => void
  setInventoryStatsRange: (ctx: RangeContext | null) => void
  setOnlineOrdersInitialTab: (t: OnlineOrdersInitialTab | null) => void
}

/**
 * Apply a ViewAllDestination: set the destination view's context fields and
 * switch to that view. Each branch makes the destination's behavior OBVIOUS:
 *
 *   top-debtors           → Reports + tab=outstanding + outstandingTab=receivables
 *   top-buyers            → Reports + tab=party + segment=customers + sortBy=purchaseVolume
 *   top-payments          → History + viewMode=payments + range context
 *   top-products          → Inventory + sortBy=unitsSold
 *   top-revenue-products  → Inventory + sortBy=revenue
 *   defaulters            → Reports + tab=outstanding + outstandingTab=receivables + grade=D+E
 *   transactions          → History + viewMode=transactions + range context
 *   low-stock             → Inventory + filter=low-stock
 *   online-orders         → Online Orders + initialTab=all
 *
 * NOTE: Context fields are ONE-SHOT — destination views clear them after
 * applying on mount. This prevents stale context from affecting later visits.
 */
export function applyViewAllDestination(
  store: ViewAllStoreActions,
  dest: ViewAllDestination,
): void {
  switch (dest.kind) {
    case 'top-debtors': {
      store.setReportsTab('outstanding')
      store.setReportsOutstandingTab('receivables')
      store.setReportsOutstandingGradeFilter('all')
      store.setActiveView('reports')
      break
    }
    case 'top-buyers': {
      // §TOP-BUYERS: Set Reports range context so purchaseVolume is computed
      // for the SAME window as the dashboard's Top Buyers insight.
      store.setReportsTab('party')
      store.setReportsPartySegment('customers')
      store.setReportsPartySortBy('purchaseVolume')
      store.setReportsRangeContext(dest.range ?? null)
      store.setActiveView('reports')
      break
    }
    case 'top-payments': {
      store.setHistoryViewMode('payments')
      store.setHistoryRangeContext(dest.range ?? null)
      store.setActiveView('history')
      break
    }
    case 'top-products': {
      store.setInventoryFilter('all')
      store.setInventorySortBy('unitsSold')
      store.setInventoryStatsRange(dest.range ?? null)
      store.setActiveView('inventory')
      break
    }
    case 'top-revenue-products': {
      store.setInventoryFilter('all')
      store.setInventorySortBy('revenue')
      store.setInventoryStatsRange(dest.range ?? null)
      store.setActiveView('inventory')
      break
    }
    case 'defaulters': {
      // §DEFAULTERS: Grade D+E (not just D). Generic filter — works for any
      // grade combination. 'D+E' is interpreted by the Reports view as
      // "show parties whose grade is D OR E".
      store.setReportsTab('outstanding')
      store.setReportsOutstandingTab('receivables')
      store.setReportsOutstandingGradeFilter('D+E')
      store.setActiveView('reports')
      break
    }
    case 'transactions': {
      store.setHistoryViewMode('transactions')
      store.setHistoryRangeContext(dest.range ?? null)
      store.setActiveView('history')
      break
    }
    case 'low-stock': {
      store.setInventoryFilter('low-stock')
      store.setInventorySortBy('default')
      store.setActiveView('inventory')
      break
    }
    case 'online-orders': {
      store.setOnlineOrdersInitialTab('all')
      store.setActiveView('online-orders')
      break
    }
  }
}

// ============================================================================
// §DESTINATION-METADATA: Read-only metadata for documentation + tests.
// Returns the human-readable destination string for a ViewAllDestination.
// Used by tests to assert "this insight goes to this destination".
// ============================================================================

export function describeViewAllDestination(dest: ViewAllDestination): string {
  switch (dest.kind) {
    case 'top-debtors':
      return 'Reports → Outstanding → Receivables (all, sorted by amount desc)'
    case 'top-buyers':
      return 'Reports → Party Ledger → customers + sort by purchaseVolume'
    case 'top-payments':
      return `History → viewMode=payments${dest.range ? ` + range=${dest.range.range}` : ''}`
    case 'top-products':
      return 'Inventory → sortBy=unitsSold'
    case 'top-revenue-products':
      return 'Inventory → sortBy=revenue'
    case 'defaulters':
      return 'Reports → Outstanding → Receivables + grade=D+E'
    case 'transactions':
      return `History → viewMode=transactions${dest.range ? ` + range=${dest.range.range}` : ''}`
    case 'low-stock':
      return 'Inventory → filter=low-stock'
    case 'online-orders':
      return 'Online Orders → initialTab=all'
  }
}
