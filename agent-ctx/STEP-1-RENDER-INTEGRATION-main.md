# STEP-1-RENDER-INTEGRATION — Dashboard Section Render Integration

**Task ID:** STEP-1-RENDER-INTEGRATION
**Agent:** main (Z.ai Code)
**Status:** Complete
**File modified:** `src/components/views/dashboard-view.tsx` (only)
**Files verified unchanged:** all search-freeze files, all frozen accounting files, dashboard API routes, breakdown service, dashboard-preferences.ts, dashboard-customization-sheet.tsx

---

## What was implemented

The dashboard's render layer was wired up to consume the `dashSectionConfig` state that was already loaded from `/api/app-settings` and saved via `saveDashboardSections()`. All seven broken integration points from the STEP-0 audit are now functional:

### 1. Section visibility (6 sections gated via `isSectionVisible()`)

Each of the six dashboard sections is now wrapped in a conditional that respects the user's per-section visibility setting:

| Section ID | Gate location | Notes |
|---|---|---|
| `summaryCards` | line ~1114 | Wraps metric cards grid + "Manage Dashboard Cards" button. The `DashboardCardManagementSheet` itself is left OUTSIDE the wrap so the "Manage Summary Cards →" link in the Customize Dashboard sheet can still open it when summaryCards is hidden. |
| `performanceChart` | line ~1175 | Wraps the entire chart Card (incl. custom date range panel + chart canvas + categories list). |
| `customerQuality` | line ~1429 | Wraps the Card AND the floating grade modal. Modal can only be triggered by a bar tap, so hiding the section implicitly prevents opening the modal. |
| `topInsights` | line ~1502 | Wraps the full restructured Card (header + filtered tabs + View All + tab content + empty state). |
| `businessActivity` | line ~1669 | Same pattern as topInsights. |
| `quickActions` | line ~1816 | Wraps the Card (header + filtered actions + empty state). |

**Section ORDERING is intentionally deferred.** The audit's safer-approach path was chosen: visibility wrappers + a comment that reordering requires a larger refactor. The rationale is documented in a `§ORDERING-NOTE` block at line ~615 — the six section Cards are deeply interleaved with floating modals/sheets (grade modal, drilldown sheet, 4 SectionSettingsSheets) that can't be cleanly hoisted into a render-order map without restructuring each section into its own component.

### 2. ⚙️ Settings gear icons on 4 section headers

Each gear button calls `setShowSectionSettings(sectionId)` to open the corresponding `SectionSettingsSheet`. All use the `Settings` icon from `lucide-react` (already imported), with `w-8 h-8` size, `min-h-[36px]` for touch-friendliness, `aria-label` for accessibility, and `hover:bg-muted` for hover feedback.

| Section | Header change |
|---|---|
| Customer Quality Distribution | Existing `<h3>` moved into a `flex items-center justify-between mb-1` row with gear button. |
| Top Insights | NEW header row added (was previously headerless — Card started directly with the tab row). |
| Business Activity | NEW header row added (was previously headerless). |
| Quick Actions | Existing `<h3>` moved into a `flex items-center justify-between mb-3` row with gear button. |

### 3. Top Insights tab filtering

- Inline `[...].map(...)` swapped for `visibleTopTabs.map(...)` where `visibleTopTabs` is a top-of-component `const` derived from `dashSectionConfig.topInsights.visibleTabs`.
- `useEffect` at line ~445 watches `dashSectionConfig.topInsights.visibleTabs` + `topTab` state; if the active `topTab` falls out of the visible set, it falls back to `visibleTabs[0]`. Prevents orphaned tab content rendering.

### 4. Business Activity tab filtering

- Mirror of Top Insights: `visibleHubTabs` const + `useEffect` fallback for `hubTab`.

### 5. Quick Actions filtering

- Inline actions array (4 items) extracted to a top-of-component `ALL_QUICK_ACTIONS` const, then `visibleQuickActions = ALL_QUICK_ACTIONS.filter(...)` derives the filtered list.
- Used directly in `visibleQuickActions.map(...)` for the grid.

### 6. View All buttons moved BELOW tab rows

**Top Insights** (was `flex items-center justify-between mb-3` containing tabs + View All in same row):
- Now: tabs in their own `flex items-center gap-1 overflow-x-auto no-scrollbar mb-2` div, then View All in a separate `mb-3` div BELOW.

**Business Activity** (was `flex items-center gap-1 mb-3 ...` containing tabs + a `<div className="ml-auto shrink-0">` wrapper around View All in same row):
- Now: same pattern as Top Insights — tabs in their own row, View All in a separate div below.

### 7. Empty states for zero enabled items

When the user disables every tab/action in a section's settings sheet, the Card now shows a friendly empty state instead of an empty grid:

> "No tabs enabled. Open settings to configure." [⚙️]

The empty state includes a ⚙️ button that opens the section's `SectionSettingsSheet`, so the user can re-enable items directly from the empty state. This applies to Top Insights, Business Activity, and Quick Actions.

The empty state is rendered inside a `bg-muted/40 p-3 rounded-xl` container with `flex items-center justify-between` layout. When the empty state is shown, the tab content blocks (`{topTab === 'debtors' && (...)}` etc.) are skipped because they're inside the `<>...</>` fragment that only renders in the non-empty branch of the ternary.

---

## Implementation details

### Const declarations (lines ~622-673)

```ts
const ALL_TOP_TABS = [
  { id: 'debtors', label: 'Top Debtors' },
  { id: 'buyers', label: 'Top Buyers' },
  { id: 'payments', label: 'Top Payments' },
  { id: 'products', label: 'Top Products' },
  { id: 'defaulters', label: 'Defaulters' },
] as const
const visibleTopTabs = ALL_TOP_TABS.filter(tab =>
  dashSectionConfig.topInsights.visibleTabs.includes(tab.id)
)
// (mirror for ALL_HUB_TABS / visibleHubTabs + ALL_QUICK_ACTIONS / visibleQuickActions)
```

These are derived on every render. They're 3–5 element arrays, so memoization would add overhead without measurable benefit. `ALL_QUICK_ACTIONS` uses `t(...)` for i18n labels — `t` is destructured from `useI18n()` at line 130 and is stable across renders.

### useEffect fallbacks (lines ~445-457)

```ts
useEffect(() => {
  const visible = dashSectionConfig.topInsights.visibleTabs
  if (visible.length > 0 && !visible.includes(topTab)) {
    setTopTab(visible[0] as typeof topTab)
  }
}, [dashSectionConfig.topInsights.visibleTabs, topTab])

useEffect(() => {
  const visible = dashSectionConfig.businessActivity.visibleTabs
  if (visible.length > 0 && !visible.includes(hubTab)) {
    setHubTab(visible[0] as typeof hubTab)
  }
}, [dashSectionConfig.businessActivity.visibleTabs, hubTab])
```

**Hook-ordering note:** These `useEffect`s are placed BEFORE the early returns (loading / error / empty states at lines ~496-524) so React's rules-of-hooks sees them called in the same order on every render — even when the dashboard short-circuits. ESLint's `react-hooks/rules-of-hooks` confirmed satisfied.

---

## Verification

| Check | Status |
|---|---|
| `npx tsc --noEmit` | ✅ passes (no output) |
| `bun run lint` (eslint .) | ✅ passes (no output) |
| `npx next build` | ✅ "Compiled successfully in 27.0s", "Generating static pages using 1 worker (77/77)" |
| `npx tsx tests/unit/dashboard-cards.test.ts` | ✅ 68 passed, 0 failed |
| `npx tsx tests/unit/card-customization.test.ts` | ✅ 109 passed, 0 failed |
| `npx tsx tests/unit/phase5-date-context.test.ts` | ✅ 124 passed, 0 failed |
| Search-freeze files unchanged | ✅ `git status` shows ONLY `src/components/views/dashboard-view.tsx` modified (the `db/` folder is auto-generated runtime DB, not source) |
| Frozen accounting files unchanged | ✅ Same — only `dashboard-view.tsx` |
| Dashboard API unchanged | ✅ No files under `src/app/api/dashboard/` touched |
| Breakdown service unchanged | ✅ `src/lib/dashboard-breakdown-service.ts` not modified |
| `dashboard-preferences.ts` unchanged | ✅ Not modified |
| `dashboard-customization-sheet.tsx` unchanged | ✅ Not modified |

### Diff stat
```
 src/components/views/dashboard-view.tsx | 395 +++++++++++++++++++++++---------
 1 file changed, 285 insertions(+), 110 deletions(-)
```

---

## Critical rules respected

- ✅ No accounting calculations / invoice logic / SalePad / P&L / drill-downs modified
- ✅ No search-freeze files modified
- ✅ Dashboard API (`/api/dashboard`) not changed
- ✅ No new API endpoints created
- ✅ Breakdown service (`src/lib/dashboard-breakdown-service.ts`) not modified
- ✅ All existing functionality preserved when sections are visible (default config = all sections visible, all tabs/actions visible — identical to pre-STEP-1 behavior)
- ✅ `Settings` icon from `lucide-react` used (already imported at line 12)
- ✅ All touch targets ≥36px (gear buttons are `min-h-[36px]` + `w-8 h-8`; Quick Action buttons unchanged at `min-h-[72px]`)

---

## What's deferred (not in this step's scope)

1. **Section ORDERING** — the audit's safer path was chosen. Visibility wrappers + a `§ORDERING-NOTE` comment explain the deferral. Implementing ordering requires extracting each section's JSX into a separate component so they can be rendered via `getVisibleSections(dashSectionConfig).map(s => <Section key={s.id} config={...} />)`. That refactor touches ~600 lines of JSX and is best done as its own step.

2. **Customer Quality grade filtering** — the `dashSectionConfig.customerQuality.visibleGrades` array is already exposed and the `SectionSettingsSheet` for customerQuality toggles it (lines ~1905-1920). But the bar chart at line ~1446 still renders all grades regardless of `visibleGrades`. Filtering the chart's `data.gradeDistribution` and the grade buttons would be a separate render-integration sub-step. (Not in STEP-1 scope per the task description, which lists only Top Insights / Business Activity / Quick Actions for tab filtering.)

3. **Memoization** — `visibleTopTabs`, `visibleHubTabs`, `visibleQuickActions` are recomputed on every render. Not memoized because they're tiny (3–5 element arrays). If profiling shows this is a hot path, wrap in `useMemo` with the relevant `dashSectionConfig.*` arrays as deps.

---

**End of STEP-1-RENDER-INTEGRATION work record.**
