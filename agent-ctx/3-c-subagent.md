# Task 3-c — More Shops + Visited Shops Views

**Agent:** subagent (more-shops + visited-shops views)
**Task:** PRD Part 33 §3.2 & §2.2 — Build the "More Shops Near You" discovery page and "My Visited Shops" history deck (public, standalone customer-facing PWA views).

## Files written

1. **`/home/z/my-project/src/components/views/more-shops-view.tsx`** (~580 LOC)
   - GPS + area-name shop discovery
   - Animated radar pulse while detecting GPS
   - Skeleton cards while fetching
   - Sponsored gold-accented shop cards with "⭐ Featured" ribbon
   - Unserviceable Location panel: red AlertTriangle banner + amber AI Recommendation card + top-3 nearest shops with "Contact shop to confirm delivery." note
   - Shop cards: avatar (logo or first-letter gradient) + name + owner + MapPin address + distance/radius/product-count/category badges + "Visit Store" button → `/?store={slug}`
   - Footer: "Powered by BizLedger" + platform-aware "Add to Home Screen" hint

2. **`/home/z/my-project/src/components/views/visited-shops-deck.tsx`** (~400 LOC)
   - Exports `addVisitedShop({ slug, name, logoUrl? })` helper (localStorage key `bizledger-visited-shops`, dedup, max 20, SSR-safe)
   - Exports `VisitedShop` interface
   - `VisitedShopsDeck` component: reads history via `useSyncExternalStore` (subscribes to `storage` + custom in-tab event for same-window mutations) — no `setState` in effect, satisfies `react-hooks/set-state-in-effect` lint rule
   - 2-column grid of visited shop cards with timeAgo ("Visited 2 hours ago" / "Yesterday" / etc.), "Visit Again" button → `/?store={slug}`, Trash2 remove button
   - Empty state with "Discover Shops" CTA → `/?more-shops=1`
   - "Clear All History" ghost button

3. **`/home/z/my-project/src/app/api/nearby-shops/route.ts`** (minimal additive enhancement)
   - Added optional `?all=1` flag that bypasses the radius/area filter (still computes distance when lat+lng supplied)
   - Used by More Shops view to surface the top-3 nearest shops in the Unserviceable Location panel
   - Backward-compatible: no behavior change when flag is absent

## Lint
- `bun run lint` → **0 errors, 0 warnings**

## Dev server
- Compiles cleanly (verified `dev.log` — "✓ Compiled in Nms" entries, no errors)

## Note for next agent
`AppShell` (`src/components/layout/app-shell.tsx`) does NOT yet route `?more-shops=1` or `?visited=1` to these views, and `StoreCatalogView` does NOT yet call `addVisitedShop()` on store visit. Wiring these is out of scope for task 3-c but required for end-to-end PRD Part 33 flow. Recommended follow-ups:
1. In `app-shell.tsx` `useEffect`, detect `?more-shops=1` → render `<MoreShopsView />`, `?visited=1` → render `<VisitedShopsDeck />` instead of the app chrome (mirror the existing `?payment=TOKEN` pattern).
2. In `store-catalog-view.tsx`, import `addVisitedShop` and call it in the store-loaded `useEffect` with `{ slug, name: store.name, logoUrl: store.logoUrl }`.
