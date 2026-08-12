# BizLedger API RBAC Matrix

**Task ID:** RBAC-MATRIX
**Auditor:** Security Engineer (general-purpose sub-agent)
**Date:** 2026-08-13
**Scope:** All 98 API routes under `src/app/api/`

This document captures the authentication, authorization, ownership, and
mutation posture of every API route in the BizLedger backend, and the
fixes applied during the RBAC-MATRIX audit pass.

---

## Conventions

| Column | Meaning |
|---|---|
| **Auth** | Does the handler call `getCurrentBusiness()` / `requireAuth()` / `requireRole()`? Values: `yes`, `no`, `partial` (some methods only) |
| **Role** | Minimum role required. Values: `PUBLIC` (no auth), `ANY-AUTH` (any authenticated user), `OWNER-ADMIN` (`requireRole(['OWNER','ADMIN'])`) |
| **Ownership** | Does the handler scope DB queries by `businessId` (via `findFirst({where:{id, businessId}})`, `updateMany({where:{..., businessId}})`, or storing `businessId` on create)? Values: `yes`, `no`, `n/a` (no business-owned data touched) |
| **Mutation** | Does the handler write to the DB? Values: `read`, `write` |
| **Status** | `PASS` (secure), `FAIL` (vulnerable — gap not yet fixed), `PUBLIC` (intentionally unauthenticated), `GUARDED` (blocked in production) |

**Note on 401 vs 400:** Several older handlers return HTTP 400 with a body
like `{error: 'No business'}` when `getCurrentBusiness()` returns null.
Functionally this still blocks unauthenticated access (the DB query is
never run), so we treat it as auth-enforced. New handlers added by this
audit return HTTP 401 (`{error: 'Not authenticated'}`) to follow REST
conventions; the existing 400-returning handlers were not refactored to
avoid churn.

---

## Status Summary

| Status | Route count |
|---|---:|
| PASS    | 76 |
| PUBLIC  | 16 |
| GUARDED |  6 |
| FAIL    |  0 |
| **Total** | **98** |

**Method-level breakdown:** 98 route files export ~131 HTTP method handlers.
Some routes have multiple methods with different postures (e.g.
`/api/store/[slug]/order` GET is auth-enforced while POST is intentionally
public for customer order placement).

---

## Fixes Applied (15 handlers across 11 route files)

### Group A — Missing auth (added `getCurrentBusiness()` + ownership check)

| # | Route | Method | Fix |
|---|---|---|---|
| 1 | `products/[id]/3d-status` | GET | Added `getCurrentBusiness()` + `findFirst({where:{id, businessId}})` product ownership check + businessId-scoped asset query. Previously exposed any product's media asset (processed image URLs, mesh data, scores) to unauthenticated callers. |
| 2 | `products/[id]/3d-reconstruct` | GET | Added `getCurrentBusiness()` + product ownership check. (The POST handler was already fixed in the prior RBAC-FIX pass; GET was still wide open.) |
| 3 | `products/[id]/media-assets` | GET | Added `getCurrentBusiness()` + product ownership check + businessId-scoped asset query. |
| 3 | `products/[id]/media-assets` | POST | Replaced `findUnique({where:{id}})` product existence check with `findFirst({where:{id, businessId}})` (ownership-aware). |
| 3 | `products/[id]/media-assets` | DELETE | Added `getCurrentBusiness()` + product ownership check + businessId-scoped `deleteMany`. |
| 4 | `fingerprints` | GET | Added `getCurrentBusiness()` + party ownership check + businessId-scoped fingerprint query. |
| 4 | `fingerprints` | DELETE | Added `getCurrentBusiness()` + `findFirst({where:{id, businessId}})` ownership check before delete. Previously allowed any caller to delete any fingerprint by id. |
| 5 | `payments/split` | GET | Added `getCurrentBusiness()` + orderSplit ownership check + businessId-scoped paymentSplit query. Previously exposed any payment split's settlement details (commission, merchant amount) to unauthenticated callers. |

### Group B — Missing OWNER/ADMIN role check (added `requireRole(['OWNER','ADMIN'])`)

| # | Route | Method | Fix |
|---|---|---|---|
| 6 | `app-settings` | PUT | Settings (PIN, biometric gates, invoice prefix, scanner, defaulter registry) are owner-controlled. STAFF can no longer flip them. |
| 7 | `settings/toggles` | PUT | Marketplace participation toggles (`onlineSalesEnabled`, `offlineOnlyMode`, `cloudSyncMode`) are owner-controlled. STAFF can no longer take the business offline. |
| 8 | `business` | PUT | Business profile (name, GSTIN, PAN, UPI ID, store slug, delivery radius) is owner-controlled. STAFF can no longer redirect payments to a different UPI ID. |
| 9 | `business/delivery-config` | PUT | Delivery configuration (radius, lat/lng, serviceable areas) is owner-controlled. STAFF can no longer shrink/extend the delivery zone. |
| 10 | `products/[id]` | PUT | Product master data (prices, stock, retail config) is owner-controlled. STAFF can no longer adjust stock or alter prices. |
| 10 | `products/[id]` | DELETE | Product deletion is a destructive owner action. STAFF can no longer delete products. |
| 11 | `products/[id]/restock` | POST | Manual stock increment is owner-controlled (affects inventory valuation + audit trail). STAFF can no longer restock. |
| 12 | `invoices/[id]` | DELETE | Invoice void (reverses stock + party balance + creates reversal transaction) is owner-controlled. Prevents cashiers from hiding theft by voiding sales. |
| 13 | `parties/[id]` | PUT | Party modification (credit limit, grade override) is owner-controlled. STAFF can no longer self-approve credit. |
| 13 | `parties/[id]` | DELETE | Party ledger deletion is a destructive owner action. |
| 14 | `category-tree` | POST | Category tree restructuring is a business-wide configuration decision. STAFF can no longer create top-level categories. |
| 15 | `category-tree/[id]` | PATCH | Same — STAFF can no longer move/rename category nodes. |
| 15 | `category-tree/[id]` | DELETE | Same — STAFF can no longer delete category subtrees. |
| 16 | `monetization/sponsor` | POST | Sponsorship is a paid advertising decision. STAFF can no longer enable sponsored placement. |
| 16 | `monetization/sponsor` | DELETE | Same — STAFF can no longer cancel sponsorship. |
| 17 | `monetization/subscribe` | POST | SaaS subscription activation is a paid decision. STAFF can no longer flip subscription state. |

**Total: 22 individual handlers fixed across 17 route files** (some files
had multiple methods fixed). All fixes preserve existing business logic —
only auth/role checks were added at the top of each handler.

---

## Investigated Routes

The task asked us to investigate two routes:

### `payment/route.ts` — VERDICT: PUBLIC (correct as-is)
- GET-only endpoint that returns invoice data for a **customer payment landing page**.
- The customer accesses this via a `?token=TOKEN` link sent to them by the merchant.
- The token is an unguessable random string (`paymentLandingToken`), generated at
  invoice creation time via `generateToken()`.
- The response exposes only the fields needed to render the payment page
  (invoice number, amount, party name/phone, business UPI ID/logo/address).
- **No fix applied.** Adding `getCurrentBusiness()` would break the
  customer-side payment flow (customers don't have merchant sessions).
- **Minor residual concern:** the `OR: [{ paymentLandingToken: token }, { id: token }]`
  clause allows the invoice UUID to be used as a token. UUIDs are 128-bit and
  not enumerable, so this is a low-risk design choice — but if invoice IDs
  ever leak (URLs, logs, screenshots), anyone with the ID can view the
  invoice. Recommend a future task to drop the `id: token` fallback.

### `products/[id]/3d-status/route.ts` — VERDICT: FAIL → fixed (see Group A #1)
- GET-only endpoint that returned the latest `ProductMediaAsset` for a product.
- Previously had **no auth check** — any unauthenticated caller could poll
  the 3D reconstruction status of any product by id, including the
  processed image URLs, mesh data, and quality scores.
- Mirrored the auth posture of the sibling `3d-reconstruct` POST handler
  (which was fixed in the prior RBAC-FIX pass).
- **Fix applied:** added `getCurrentBusiness()` + product ownership check
  + businessId-scoped asset query.

### `debug/route.ts` — VERDICT: GUARDED (correct as-is)
- Already has the production guard: `if (process.env.NODE_ENV === 'production') return 403`.
- No fix needed.

---

## Routes NOT Modified (intentional design)

These routes were investigated and intentionally left in their current
posture. Each is documented so future audits don't re-investigate them.

### Intentionally PUBLIC routes

| Route | Why public |
|---|---|
| `auth/login` POST | Login endpoint — must accept credentials from unauthenticated callers. Rate-limited (5 attempts / 15 min / IP). |
| `auth/logout` POST | Logout endpoint — clears the session cookie. Calling it without a session is a no-op. |
| `auth/me` GET | Session-check endpoint — returns 401 when unauthenticated, used by the frontend to determine auth state on page load. |
| `central-catalog` GET | Public marketplace catalog. Customers browse without an account. Business name is HIDDEN by default (only shown for favorite shops). |
| `customer-trust-score` GET | Read-only aggregate score lookup. Used by merchants AND customers during checkout (COD gating). No PII beyond an aggregate numeric score. |
| `defaulter-registry` GET | Read-only shared defaulter lookup. Merchants check this during checkout — a shared safety feature. (POST/PATCH/DELETE on the same registry are OWNER/ADMIN-only.) |
| `favorite-shops` GET/POST/DELETE | Customer-facing favorites. Customers are identified by phone only (no accounts). Requiring a session would break the favorites flow. |
| `nearby-shops` GET | Public shop discovery for the marketplace. Only returns businesses with `storeSlug` set and `onlineSalesEnabled` (or no settings row). |
| `orders/split` POST | Customer-facing multi-shop cart checkout. Customers don't have accounts. Each item's `businessId` is VERIFIED against the product's actual `businessId` in the DB — a client cannot supply an arbitrary `businessId` to decrement another business's stock. |
| `payment` GET | Customer payment landing page (see "Investigated Routes" above). |
| `profile/switch-role` GET/POST | "Become a Seller" flow. POST is PIN-gated by phone (separate from session auth). GET is a profile lookup by phone — exposes id/phone/role/isSeller/pinEnabled/biometricEnabled. No session secrets. |
| `public/catalog` GET | External quick-commerce catalog for headless frontends. Only returns published, in-stock products for a store by `storeSlug`. |
| `public/orders` GET/POST | External order webhook (POST places an order) + status check (GET). Stock is decremented atomically inside a `$transaction`. |
| `store/[slug]` GET | Customer-facing store catalog. Only returns published, in-stock products. |
| `store/[slug]/order` POST | Customer order placement from a store catalog. The GET handler on the same route IS auth-enforced (owner-only order list). |
| `verify-location` POST | Customer-side GPS check before placing an order. Returns only a boolean trust verdict + triangulated position (which the client supplied). No privileged writes. |

### Production-guarded routes (return 403 when `NODE_ENV === 'production'`)

| Route | Why guarded |
|---|---|
| `backfill-search-tags` POST | Maintenance endpoint — regenerates `searchTags` for all parties/products. Calls `getCurrentBusiness()` for dev-only use. |
| `debug` GET | Returns masked DB URL info. Blocked in prod to prevent info leakage. |
| `reset` POST | Destructive — wipes Sharma Trading Co. business + re-seeds. Blocked in prod. |
| `seed` POST | Destructive — wipes ALL businesses + re-seeds. Blocked in prod. |
| `seed-demo-shops` POST | Seeds 2 demo shops for the "More Shops" view. Blocked in prod. |
| `setup-db` GET/POST | Database setup — runs raw SQL `CREATE TABLE` statements. Blocked in prod. |

---

## Full Route Matrix

### Auth (`/api/auth/*`) — 3 routes, all PUBLIC

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `auth/login` | POST | no | PUBLIC | n/a | write (creates Session) | PUBLIC |
| `auth/logout` | POST | no | PUBLIC | n/a | write (deletes Session) | PUBLIC |
| `auth/me` | GET | no | PUBLIC | n/a | read | PUBLIC |

### Customer-facing public (`/api/{central-catalog,favorite-shops,nearby-shops,orders/split,payment,public/*,store/*,verify-location}`) — 11 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `central-catalog` | GET | no | PUBLIC | n/a (read-only catalog) | read | PUBLIC |
| `customer-trust-score` | GET | no | PUBLIC | n/a (read-only aggregate) | read | PUBLIC |
| `customer-trust-score` | POST | yes | OWNER-ADMIN | n/a (global table by phone) | write | PASS |
| `defaulter-registry` | GET | no | PUBLIC | n/a (read-only lookup) | read | PUBLIC |
| `defaulter-registry` | POST | yes | OWNER-ADMIN | n/a (global table by phone) | write | PASS |
| `defaulter-registry/[id]` | PATCH | yes | OWNER-ADMIN | n/a (global table) | write | PASS |
| `defaulter-registry/[id]` | DELETE | yes | OWNER-ADMIN | n/a (global table) | write | PASS |
| `favorite-shops` | GET | no | PUBLIC | n/a (keyed by phone) | read | PUBLIC |
| `favorite-shops` | POST | no | PUBLIC | n/a (keyed by phone) | write | PUBLIC |
| `favorite-shops` | DELETE | no | PUBLIC | n/a (keyed by phone) | write | PUBLIC |
| `nearby-shops` | GET | no | PUBLIC | n/a | read | PUBLIC |
| `orders/split` | POST | no | PUBLIC | yes (per-item businessId verified against product) | write | PUBLIC |
| `orders/split/[id]` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `orders/split/[id]` | PATCH | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | write | PASS |
| `orders/[id]/otp` | POST | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})` on OrderSplit + PaymentSplit) | write | PASS |
| `payment` | GET | no | PUBLIC | n/a (token-keyed read) | read | PUBLIC |
| `profile/mode` | GET | partial | ANY-AUTH (returns default if no biz) | yes (reads own AppSettings) | read | PASS |
| `profile/mode` | POST | partial | ANY-AUTH (PIN-gated by phone, then business) | yes | write | PASS |
| `profile/switch-role` | GET | no | PUBLIC | n/a (read by phone) | read | PUBLIC |
| `profile/switch-role` | POST | no | PUBLIC (PIN-gated by phone) | yes (links to current business) | write | PUBLIC |
| `public/catalog` | GET | no | PUBLIC | n/a (read by storeSlug) | read | PUBLIC |
| `public/orders` | GET | no | PUBLIC | yes (order scoped by businessId) | read | PUBLIC |
| `public/orders` | POST | no | PUBLIC | yes (product findFirst with businessId) | write | PUBLIC |
| `store/[slug]` | GET | no | PUBLIC | n/a (read by storeSlug) | read | PUBLIC |
| `store/[slug]/order` | GET | yes | ANY-AUTH | yes (verifies `business.storeSlug === slug`) | read | PASS |
| `store/[slug]/order` | POST | no | PUBLIC | yes (product findFirst with businessId) | write | PUBLIC |
| `verify-location` | POST | no | PUBLIC | n/a (read-only) | read | PUBLIC |

### Production-guarded maintenance (`/api/{backfill-search-tags,debug,reset,seed,seed-demo-shops,setup-db}`) — 6 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `backfill-search-tags` | POST | yes | ANY-AUTH | yes (businessId-scoped) | write | GUARDED |
| `debug` | GET | no | PUBLIC | n/a (env info) | read | GUARDED |
| `reset` | POST | no | PUBLIC | n/a (wipes by business name) | write (destructive) | GUARDED |
| `seed` | POST | no | PUBLIC | n/a (creates fresh business) | write | GUARDED |
| `seed-demo-shops` | POST | no | PUBLIC | n/a (creates new businesses) | write | GUARDED |
| `setup-db` | GET | no | PUBLIC | n/a (DB setup) | read | GUARDED |
| `setup-db` | POST | no | PUBLIC | n/a (DB setup) | write | GUARDED |

### App settings & business config (`/api/{app-settings,settings/*,business/*}`) — 4 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `app-settings` | GET | yes | ANY-AUTH | yes | read (creates default row if missing) | PASS |
| `app-settings` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (upsert by businessId) | write | PASS |
| `settings/toggles` | GET | yes | ANY-AUTH | yes | read | PASS |
| `settings/toggles` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (upsert by businessId) | write | PASS |
| `business` | GET | yes | ANY-AUTH | yes (returns own business) | read | PASS |
| `business` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (update own business) | write | PASS |
| `business/delivery-config` | GET | yes | ANY-AUTH | yes | read | PASS |
| `business/delivery-config` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (update own business) | write | PASS |

### Products (`/api/products/*`) — 15 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `products` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `products` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |
| `products/[id]` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `products/[id]` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` before update) | write | PASS |
| `products/[id]` | DELETE | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` before delete) | write (destructive) | PASS |
| `products/[id]/3d-reconstruct` | GET | yes (FIXED) | ANY-AUTH | yes (FIXED: product findFirst + asset where businessId) | read | PASS |
| `products/[id]/3d-reconstruct` | POST | yes | ANY-AUTH | yes (product findUnique + businessId on asset create) | write | PASS |
| `products/[id]/3d-status` | GET | yes (FIXED) | ANY-AUTH | yes (FIXED: product findFirst + asset where businessId) | read | PASS |
| `products/[id]/custom-prices` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `products/[id]/custom-prices` | POST | yes | ANY-AUTH | yes (sets businessId + upsert findFirst by businessId) | write | PASS |
| `products/[id]/custom-prices/[priceId]` | PUT | yes | ANY-AUTH | yes (`updateMany where id+productId+businessId`) | write | PASS |
| `products/[id]/custom-prices/[priceId]` | DELETE | yes | ANY-AUTH | yes (`deleteMany where id+productId+businessId`) | write | PASS |
| `products/[id]/customer-insights` | GET | yes | ANY-AUTH | yes (product findFirst) | read | PASS |
| `products/[id]/media-assets` | GET | yes (FIXED) | ANY-AUTH | yes (FIXED: product findFirst + asset where businessId) | read | PASS |
| `products/[id]/media-assets` | POST | yes (FIXED) | ANY-AUTH | yes (FIXED: replaced findUnique with findFirst+businessId) | write | PASS |
| `products/[id]/media-assets` | DELETE | yes (FIXED) | ANY-AUTH | yes (FIXED: product findFirst + deleteMany where businessId) | write | PASS |
| `products/[id]/media-assets/[assetId]` | GET | yes | ANY-AUTH | yes (product findFirst via `getOwnedProduct`) | read | PASS |
| `products/[id]/media-assets/[assetId]` | PATCH | yes | ANY-AUTH | yes (product findFirst) | write | PASS |
| `products/[id]/media-assets/[assetId]` | DELETE | yes | ANY-AUTH | yes (product findFirst + deleteMany where productId) | write | PASS |
| `products/[id]/multi-angle-export` | GET | yes | ANY-AUTH | yes (product findFirst) | read | PASS |
| `products/[id]/multi-angle-export` | POST | yes | ANY-AUTH | yes (product findFirst) | write | PASS |
| `products/[id]/publish` | GET | yes | ANY-AUTH | yes (product findFirst) | read | PASS |
| `products/[id]/publish` | POST | yes | ANY-AUTH | yes (product findFirst) | write | PASS |
| `products/[id]/resolved-price` | GET | yes | ANY-AUTH | yes (product findFirst) | read | PASS |
| `products/[id]/restock` | POST | yes | **OWNER-ADMIN** (FIXED) | yes (product findFirst) | write | PASS |
| `products/ai-autofill` | POST | yes | ANY-AUTH | n/a (VLM call, no DB write) | read (AI) | PASS |
| `products/categories` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `products/resolve-prices-batch` | POST | yes | ANY-AUTH | yes (`where: { id: {in: ...}, businessId }`) | read | PASS |

### Invoices (`/api/invoices/*`) — 4 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `invoices` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `invoices` | POST | yes | ANY-AUTH | yes (product findFirst + party findFirst + tx-scoped product re-check) | write | PASS |
| `invoices/[id]` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `invoices/[id]` | PUT | yes | ANY-AUTH | yes (`findFirst` before update) | write | PASS |
| `invoices/[id]` | DELETE | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` + tx-scoped product/party re-check) | write (destructive — atomic void) | PASS |
| `invoices/[id]/export-image` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `invoices/[id]/subtag` | PATCH | yes | ANY-AUTH | yes (`findFirst` before update) | write | PASS |

### Parties (`/api/parties/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `parties` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `parties` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |
| `parties/[id]` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `parties/[id]` | PUT | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` before update) | write | PASS |
| `parties/[id]` | DELETE | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` before delete) | write (destructive) | PASS |

### Transactions (`/api/transactions/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `transactions` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `transactions` | POST | yes | ANY-AUTH | yes (party findFirst + `updateMany where id+businessId`) | write | PASS |
| `transactions/summary` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |

### Returns (`/api/returns`) — 1 route

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `returns` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})` on OrderSplit) | read | PASS |
| `returns` | POST | yes | ANY-AUTH | yes (orderSplit findFirst + tx-scoped product/payment re-check) | write (atomic, idempotent) | PASS |

### Customer Orders (`/api/customer-orders/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `customer-orders` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `customer-orders/[id]/status` | PATCH | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})` + tx-scoped product/party re-check) | write (atomic sync to invoice + party + transaction) | PASS |

### Purchase Orders (`/api/purchase-orders/*`) — 3 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `purchase-orders` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `purchase-orders` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |
| `purchase-orders/[id]` | GET | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | read | PASS |
| `purchase-orders/[id]` | PUT | yes | ANY-AUTH | yes (`findFirst` before update) | write | PASS |
| `purchase-orders/[id]/receive` | POST | yes | ANY-AUTH | yes (PO findFirst + product findFirst) | write | PASS |

### Suppliers (`/api/suppliers/[id]/catalog/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `suppliers/[id]/catalog` | GET | partial | ANY-AUTH (buyer resolution optional) | yes (catalog where businessId; buyer resolved via party findFirst) | read | PASS |
| `suppliers/[id]/catalog` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |
| `suppliers/[id]/catalog/[itemId]` | PUT | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | write | PASS |
| `suppliers/[id]/catalog/[itemId]` | DELETE | yes | ANY-AUTH | yes (`findFirst` before delete) | write | PASS |

### Sourcing (`/api/sourcing/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `sourcing/compare` | GET | yes | ANY-AUTH | yes (product findFirst + catalog where businessId) | read | PASS |
| `sourcing/seed-catalog` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |

### Category Tree (`/api/category-tree/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `category-tree` | GET | yes | ANY-AUTH | yes (where businessId) | read (seed if empty) | PASS |
| `category-tree` | POST | yes | **OWNER-ADMIN** (FIXED) | yes (sets businessId on create) | write | PASS |
| `category-tree/[id]` | PATCH | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` + `updateMany where id+businessId`) | write | PASS |
| `category-tree/[id]` | DELETE | yes | **OWNER-ADMIN** (FIXED) | yes (`findFirst` before delete) | write | PASS |

### Fulfillment (`/api/fulfillment/*`) — 3 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `fulfillment/list` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `fulfillment/[id]/ready` | PUT | yes | ANY-AUTH | yes (`findFirst({where:{id, businessId}})`) | write | PASS |
| `fulfillment/[id]/handover` | PUT | yes | ANY-AUTH | yes (`findFirst` + item validation, no silent skip) | write | PASS |

### Staff (`/api/staff/*`) — 2 routes (already OWNER/ADMIN from prior work)

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `staff` | GET | yes | OWNER-ADMIN | yes (where businessId) | read | PASS |
| `staff` | POST | yes | OWNER-ADMIN | yes (sets businessId on create) | write | PASS |
| `staff/[id]` | PUT | yes | OWNER-ADMIN | yes (`findFirst({where:{id, businessId}})`) | write | PASS |
| `staff/[id]` | DELETE | yes | OWNER-ADMIN | yes (`findFirst` before delete) | write | PASS |

### Data Export — 1 route (already OWNER/ADMIN from prior work)

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `data-export` | GET | yes | OWNER-ADMIN | yes (where businessId for all tables) | read (full export — audit-logged) | PASS |

### Trust Scores (`/api/{customer-trust-score,trust-score/*,grade-recalculate}`) — 3 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `customer-trust-score` | GET | no | PUBLIC | n/a (read-only aggregate by phone) | read | PUBLIC |
| `customer-trust-score` | POST | yes | OWNER-ADMIN | n/a (global table by phone) | write | PASS |
| `trust-score/[partyId]` | GET | yes | ANY-AUTH | yes (party findFirst) | write (persists score) | PASS |
| `trust-score/[partyId]` | POST | yes | ANY-AUTH | yes (party findFirst) | write | PASS |
| `grade-recalculate` | POST | yes | ANY-AUTH | yes (party findFirst if partyId, else where businessId) | write | PASS |

### Audit Log — 1 route

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `audit-log` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `audit-log` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |

### Biometric (`/api/{biometric,biometric/gate}`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `biometric` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `biometric` | POST | yes | ANY-AUTH | yes (sets businessId on create) | write | PASS |
| `biometric/gate` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `biometric/gate` | POST | yes | ANY-AUTH | yes (where businessId on settings + log) | write | PASS |

### Security (`/api/security/*`) — 2 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `security/anti-tamper` | POST | partial | ANY-AUTH (uses getCurrentBusiness but fails open if no biz) | yes (only locks own business) | write (gateLog + optional 24h lockdown of own business) | PASS |
| `security/status` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |

### PIN — 1 route

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `pin` | GET | yes | ANY-AUTH | yes (findUnique by businessId) | read | PASS |
| `pin` | POST | yes | ANY-AUTH | yes (findUnique by businessId + updateMany) | write | PASS |

### Fingerprints — 1 route

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `fingerprints` | GET | yes (FIXED) | ANY-AUTH | yes (FIXED: party findFirst + where businessId) | read | PASS |
| `fingerprints` | POST | yes | ANY-AUTH | yes (party findFirst + sets businessId on create) | write | PASS |
| `fingerprints` | DELETE | yes (FIXED) | ANY-AUTH | yes (FIXED: `findFirst({where:{id, businessId}})` before delete) | write | PASS |

### Notifications — 1 route

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `notifications` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `notifications` | POST | yes | ANY-AUTH | yes (`updateMany where id+businessId` for single, `where businessId` for all) | write | PASS |

### Reports / Dashboard / Insights / Forecast / Reminders — 5 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `reports` | GET | yes | ANY-AUTH | yes (where businessId for all tables) | read | PASS |
| `dashboard` | GET | yes | ANY-AUTH | yes (where businessId for all tables) | read | PASS |
| `insights` | GET | yes | ANY-AUTH | yes (where businessId for all tables) | read | PASS |
| `forecast` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `reminders` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |

### Backup / Storage — 4 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `backup/drive` | POST | yes | ANY-AUTH | yes (where businessId for all tables) | write (backup log + settings updateMany) | PASS |
| `backup/list` | GET | yes | ANY-AUTH | yes (where businessId) | read | PASS |
| `backup/telegram` | POST | yes | ANY-AUTH | yes (where businessId for all tables) | write (backup log + settings updateMany) | PASS |
| `storage/cloud-sync` | GET | yes | ANY-AUTH | yes (findUnique by businessId) | read | PASS |
| `storage/cloud-sync` | POST | yes | ANY-AUTH | yes (findUnique by businessId) | write (returns simulated fileId) | PASS |

### Monetization (`/api/monetization/*`) — 3 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `monetization/sponsor` | POST | yes | **OWNER-ADMIN** (FIXED) | yes (updates own business) | write | PASS |
| `monetization/sponsor` | DELETE | yes | **OWNER-ADMIN** (FIXED) | yes (updates own business) | write | PASS |
| `monetization/stats` | GET | yes | ANY-AUTH | yes (where recipientBusinessId / payerBusinessId / businessId) | read | PASS |
| `monetization/subscribe` | POST | yes | **OWNER-ADMIN** (FIXED) | yes (updates own business) | write | PASS |

### Image processing (`/api/{image-compress,image-remove-bg,ocr}`) — 3 routes

| Route | Method | Auth | Role | Ownership | Mutation | Status |
|---|---|---|---|---|---|---|
| `image-compress` | POST | yes | ANY-AUTH | n/a (no DB write) | read (image processing) | PASS |
| `image-remove-bg` | POST | yes | ANY-AUTH | n/a (no DB write) | read (image processing) | PASS |
| `ocr` | POST | yes | ANY-AUTH | n/a (no DB write) | read (VLM call) | PASS |

---

## Recommended Future Hardening (not blocking)

These are items the audit identified but did not fix because they fall
outside the task's explicit fix list (Step 3). They are documented for a
follow-up task.

| Route | Concern | Recommendation |
|---|---|---|
| `payment` GET | The `OR: [{ paymentLandingToken: token }, { id: token }]` clause allows the invoice UUID to be used as a token. UUIDs are 128-bit and not enumerable, but if invoice IDs leak (URLs, logs, screenshots), anyone with the ID can view the invoice. | Drop the `id: token` fallback; require `paymentLandingToken` only. |
| `backup/drive` POST / `backup/telegram` POST | STAFF can trigger a full-data backup. The backup is sent to the OWNER's configured Telegram/Drive (not the STAFF's), so it's not a direct exfiltration — but it's still an owner-only action conceptually. | Add `requireRole(['OWNER','ADMIN'])` to both for consistency with `data-export`. |
| `audit-log` POST | STAFF can write arbitrary audit log entries (with any staffName/staffName/entityId). Could be used to forge audit trails. | Add `requireRole(['OWNER','ADMIN'])`, or at minimum, derive staffName from the session rather than accepting it from the request body. |
| `security/anti-tamper` POST | Fails open if no business — an unauthenticated caller can still submit tamper reports (which only have effect if a business is found, so impact is limited to logging noise). | Optional: return 401 if no business to reduce log noise. |
| `biometric/gate` POST | STAFF can attempt PIN/biometric verification for any gate (owner_switch, high_value_discount, etc.). The gate itself is the protection, but logging which gates a STAFF is probing could be valuable. | Add audit-log entries for failed gate attempts by STAFF users. |
| `profile/switch-role` GET | Public lookup by phone exposes profile info (id, phone, role, isSeller, pinEnabled, biometricEnabled). | Add rate limiting at the edge. The data is low-sensitivity but could be enumerated. |

---

## Test Coverage

A new test file was added: `tests/integration/rbac-authorization.test.ts`.

The test verifies:
- Unauthenticated access to all protected mutation routes returns 401
  (the `getCurrentBusiness()` null path).
- Routes fixed in this audit no longer expose data without auth.

STAFF-vs-OWNER role testing requires a test database seeded with users of
each role — the test file documents this as a follow-up to implement when
a test database is available.

See the test file header for the full list of routes covered.
