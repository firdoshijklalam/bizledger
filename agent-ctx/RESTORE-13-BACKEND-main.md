# Task RESTORE-13-BACKEND — PRD Part 13 Backend Recreation

**Task ID:** RESTORE-13-BACKEND
**Agent:** main
**Date:** 2026-06-28
**Status:** ✅ COMPLETE

## Summary

Recreated the accidentally-deleted PRD Part 13 backend (Sourcing & Purchase Orders) for the BizLedger project. All API endpoints, Prisma models, library code, and TypeScript types have been restored.

## Files Created/Modified

### Modified
1. `prisma/schema.prisma` — Added 3 new models (`SupplierCatalogItem`, `PurchaseOrder`, `PurchaseOrderItem`) and back-relation `purchaseOrders PurchaseOrder[]` on `Party`.
2. `src/lib/types.ts` — Added `'sourcing'` to `ViewId` union; added 5 new interfaces (`SupplierCatalogItem`, `PurchaseOrderItem`, `PurchaseOrder`, `SourcingMatch`, `SourcingCompareResult`).

### Created
3. `src/lib/landed-cost.ts` — Landed cost calculator (`calcLandedCost`), best-supplier selector (`findBestSupplier`), product similarity matcher (`productSimilarity` — hybrid Jaccard + Levenshtein), `SIMILARITY_THRESHOLD = 0.6`.
4. `src/app/api/suppliers/[id]/catalog/route.ts` — GET (list active items w/ supplierName + perUnitLandedCost), POST (create item).
5. `src/app/api/suppliers/[id]/catalog/[itemId]/route.ts` — PUT (update), DELETE (delete).
6. `src/app/api/sourcing/compare/route.ts` — GET (?productId OR ?name&category, optional &quantity) — hybrid matcher + sort by cost + best-choice flag.
7. `src/app/api/sourcing/seed-catalog/route.ts` — POST (seed 3 demo catalog items per supplier, ±5% price variation, skip duplicates).
8. `src/app/api/purchase-orders/route.ts` — GET (list w/ items+supplier), POST (create PO-YYYY-NNNN, compute totalAmount, status=sent).
9. `src/app/api/purchase-orders/[id]/route.ts` — GET (single PO), PUT (update status, set dispatchedAt when status=dispatched).
10. `src/app/api/purchase-orders/[id]/receive/route.ts` — POST (Smart Restock & Auto-Product Creation — restock if matchedProductId set, else auto-create Product).

## Verification

All endpoints were smoke-tested end-to-end via curl:
- Seed → created 9 catalog items across 3 suppliers
- Compare → returns matches sorted by landed cost with best-choice flag
- PO create → poNumber=PO-2026-0001, totalAmount correct
- PO receive → restocked existing product (stock 20→35), auto-created new product
- Catalog PUT/DELETE → both work
- Lint clean, no console errors

Test data was cleaned up after verification (3 test POs + 1 auto-created product removed; catalog re-seeded).

## Patterns Followed

- `NextRequest` / `NextResponse` from `next/server`
- `import { db } from '@/lib/db'`
- `business.findFirst()` for businessId lookup
- `params: Promise<{ id: string }>` for dynamic routes (Next.js 16 async params)
- Try/catch with `{ error: String(e) }` and status 500 on failure
- `{ ok: true }` for DELETE responses

## Notes for Downstream Agents

- The new ViewId `'sourcing'` is added but NO frontend view exists yet — a downstream agent should create `src/components/views/sourcing-view.tsx` (or similar) and wire it into the AppShell's `renderView()` switch.
- The catalog was re-seeded to original 9 items after test cleanup. To get a fully clean state, the user can call `/api/reset` to wipe and re-seed all demo data.
- `PurchaseOrder.status` TypeScript union: `'draft' | 'sent' | 'accepted' | 'dispatched' | 'received' | 'cancelled'`. The Prisma schema uses `String` (SQLite limitation) — the union is enforced at the TypeScript layer in `src/lib/types.ts`.
- PO numbering: `PO-YYYY-NNNN` where NNNN = `count(businessId) + 1`. There's a theoretical race condition if two POs are created in the same millisecond; production deployment should add a unique constraint or transaction.
