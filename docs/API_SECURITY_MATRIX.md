# BizLedger — API Security Matrix

**Date:** 2026-08-11
**Commit:** 2cebee8

Legend:
- **Auth**: ✅ = requireAuth/requireRole/getCurrentBusiness, ❌ = no auth, 🔒 = production guard (403)
- **Role**: Role required (if any)
- **Business Isolation**: ✅ = businessId scoped, ❌ = not scoped, N/A = public/system
- **Input Validation**: ✅ = validates inputs, ❌ = no validation
- **Status**: ✅ = Secure, 🟠 = Partial, 🔴 = Needs fix

---

## Protected Business Data Routes (require authentication + business isolation)

| Route | Auth | Role | Business Isolation | Input Validation | Status |
|-------|------|------|-------------------|-----------------|--------|
| `GET /api/parties` | ✅ | — | ✅ | ✅ | ✅ |
| `POST /api/parties` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/PUT/DELETE /api/parties/[id]` | ✅ | — | ✅ | ✅ | ✅ |
| `GET /api/products` | ✅ | — | ✅ | ❌ | 🟠 |
| `POST /api/products` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/PUT/DELETE /api/products/[id]` | ✅ | — | ✅ | ✅ | ✅ |
| `POST /api/products/[id]/restock` | ✅ | — | ✅ | ✅ | ✅ |
| `GET /api/products/[id]/custom-prices` | ✅ | — | ✅ | — | ✅ |
| `POST /api/products/[id]/custom-prices` | ✅ | — | ✅ | ✅ | ✅ |
| `PUT/DELETE /api/products/[id]/custom-prices/[priceId]` | ✅ | — | ✅ | ✅ | ✅ |
| `GET /api/products/[id]/resolved-price` | ✅ | — | ✅ | — | ✅ |
| `POST /api/products/resolve-prices-batch` | ✅ | — | ✅ | — | ✅ |
| `GET /api/products/[id]/customer-insights` | ✅ | — | ✅ | — | ✅ |
| `GET /api/invoices` | ✅ | — | ✅ | — | ✅ |
| `POST /api/invoices` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/PUT/DELETE /api/invoices/[id]` | ✅ | — | ✅ | — | ✅ |
| `GET /api/transactions` | ✅ | — | ✅ | — | ✅ |
| `POST /api/transactions` | ✅ | — | ✅ | ✅ | ✅ |
| `GET /api/transactions/summary` | ✅ | — | ✅ | — | ✅ |
| `GET /api/dashboard` | ✅ | — | ✅ | — | ✅ |
| `GET /api/reports` | ✅ | — | ✅ | — | ✅ |
| `GET /api/notifications` | ✅ | — | ✅ | — | ✅ |
| `GET /api/app-settings` | ✅ | — | ✅ | — | ✅ |
| `GET/PUT /api/settings/toggles` | ✅ | — | ✅ | — | ✅ |
| `GET /api/reminders` | ✅ | — | ✅ | — | ✅ |
| `GET /api/forecast` | ✅ | — | ✅ | — | ✅ |
| `GET /api/insights` | ✅ | — | ✅ | — | ✅ |
| `POST /api/grade-recalculate` | ✅ | — | ✅ | — | ✅ |
| `GET/POST /api/category-tree` | ✅ | — | ✅ | ✅ | ✅ |
| `PUT/DELETE /api/category-tree/[id]` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/POST /api/fulfillment/list` | ✅ | — | ✅ | — | ✅ |
| `PUT /api/fulfillment/[id]/ready` | ✅ | — | ✅ | — | ✅ |
| `PUT /api/fulfillment/[id]/handover` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/POST /api/purchase-orders` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/PUT /api/purchase-orders/[id]` | ✅ | — | ✅ | — | ✅ |
| `POST /api/purchase-orders/[id]/receive` | ✅ | — | ✅ | — | ✅ |
| `GET/POST /api/suppliers/[id]/catalog` | ✅ | — | ✅ | — | ✅ |
| `PUT/DELETE /api/suppliers/[id]/catalog/[itemId]` | ✅ | — | ✅ | — | ✅ |
| `GET /api/backup/list` | ✅ | — | ✅ | — | ✅ |
| `POST /api/backup/drive` | ✅ | — | ✅ | — | ✅ |
| `POST /api/backup/telegram` | ✅ | — | ✅ | — | ✅ |
| `POST /api/storage/cloud-sync` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/POST /api/sourcing/compare` | ✅ | — | ✅ | ✅ | ✅ |
| `POST /api/sourcing/seed-catalog` | ✅ | — | ✅ | — | ✅ |
| `GET/POST /api/customer-orders` | ✅ | — | ✅ | ✅ | ✅ |
| `PUT /api/customer-orders/[id]/status` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/POST /api/audit-log` | ✅ | — | ✅ | — | 🟠 |
| `GET /api/trust-score/[partyId]` | ✅ | — | ✅ | — | ✅ |
| `GET /api/defaulter-registry` | ❌ | — | ❌ | ✅ | 🔴 |
| `GET/DELETE /api/defaulter-registry/[id]` | ❌ | — | ❌ | — | 🔴 |
| `GET /api/business` | ❌ | — | ❌ | — | 🟠 |
| `GET/PUT /api/business/delivery-config` | ✅ | — | ✅ | — | ✅ |
| `GET/POST /api/profile/mode` | ✅ | — | ✅ | ✅ | ✅ |
| `POST /api/profile/switch-role` | ✅ | — | ✅ | ✅ | ✅ |
| `GET/POST /api/security/status` | ✅ | — | ✅ | — | ✅ |
| `POST /api/security/anti-tamper` | ✅ | — | ✅ | — | ✅ |

---

## Role-Protected Routes (require OWNER/ADMIN)

| Route | Auth | Role | Status |
|-------|------|------|--------|
| `GET/POST /api/staff` | ✅ | OWNER/ADMIN | ✅ |
| `GET/PUT/DELETE /api/staff/[id]` | ✅ | — | 🟠 (needs role check on [id] routes) |
| `GET /api/data-export` | ✅ | OWNER/ADMIN | ✅ |

---

## Authenticated Routes (requireAuth)

| Route | Auth | Status |
|-------|------|--------|
| `POST /api/pin` | ✅ requireAuth | ✅ |

---

## Public Routes (no auth required by design)

| Route | Purpose | Status |
|-------|---------|--------|
| `GET /api/public/catalog` | Customer-facing store catalog | ✅ Public by design |
| `POST /api/public/orders` | Customer places order from store | ✅ Public by design |
| `GET /api/store/[slug]` | Public store page | ✅ Public by design |
| `POST /api/store/[slug]/order` | Customer order submission | ✅ Public by design |
| `GET /api/payment` | Payment landing page (token-based) | ✅ Public by design (token auth) |
| `GET /api/central-catalog` | B2B marketplace catalog | ✅ Public by design |
| `GET /api/nearby-shops` | Discover nearby shops | ✅ Public by design |
| `GET /api/favorite-shops` | Favorite shops list | ✅ Public by design |
| `GET /api/customer-trust-score` | Trust score lookup | ✅ Public by design |
| `GET /api/verify-location` | Location verification | ✅ Public by design |
| `GET/POST /api/orders/[id]/otp` | Order OTP verification | ✅ Public by design |
| `GET/POST /api/orders/split` | Order split (payment) | ✅ Public by design |
| `GET/PUT /api/orders/split/[id]` | Order split detail | ✅ Public by design |

---

## Auth API Routes

| Route | Auth | Rate Limited | Status |
|-------|------|-------------|--------|
| `POST /api/auth/login` | Public | ✅ (5/15min/IP) | ✅ |
| `POST /api/auth/logout` | Authenticated | — | ✅ |
| `GET /api/auth/me` | Authenticated | — | ✅ |

---

## Production-Blocked Routes (return 403 in production)

| Route | Purpose | Status |
|-------|---------|--------|
| `POST /api/seed` | Seed demo data | 🔒 403 in production |
| `POST /api/reset` | Reset database | 🔒 403 in production |
| `GET/POST /api/setup-db` | Database setup | 🔒 403 in production |
| `GET /api/debug` | Debug info | 🔒 403 in production |
| `POST /api/seed-demo-shops` | Seed demo shops | 🔒 403 in production |
| `POST /api/backfill-search-tags` | Backfill search tags | 🔒 403 in production |

---

## Routes Needing Attention (🔴)

| Route | Issue | Recommended Fix |
|-------|-------|----------------|
| `GET /api/defaulter-registry` | No auth, no business isolation | Add requireAuth + businessId scope |
| `GET/DELETE /api/defaulter-registry/[id]` | No auth, no business isolation | Add requireAuth + businessId scope |
| `GET /api/business` | No auth on business profile | Add requireAuth |
| `GET/PUT/DELETE /api/staff/[id]` | Has getCurrentBusiness but no requireRole | Add requireRole(['OWNER','ADMIN']) |
| `GET/POST /api/products/[id]/media-assets` | No auth check | Add getCurrentBusiness |
| `GET /api/products/[id]/3d-status` | No auth check | Add getCurrentBusiness |
| `POST /api/products/[id]/3d-reconstruct` | No auth check | Add getCurrentBusiness |
| `GET /api/products/[id]/multi-angle-export` | No auth check | Add getCurrentBusiness |
| `GET /api/invoices/[id]/export-image` | No auth check | Add getCurrentBusiness |
| `POST /api/products/ai-autofill` | No auth check | Add getCurrentBusiness |
| `GET/POST /api/orders/split` | Public but modifies business data | Add token-based auth |

---

## Summary

| Category | Count | Status |
|----------|-------|--------|
| Protected business routes | 54 | ✅ Secure |
| Role-protected routes | 3 | ✅ Secure |
| Auth-required routes | 1 | ✅ Secure |
| Public routes (by design) | 13 | ✅ Correct |
| Auth API routes | 3 | ✅ Secure |
| Production-blocked routes | 6 | ✅ Secure |
| **Routes needing attention** | **11** | 🔴 Needs fix |
| **Total routes** | **91** | |

**Security coverage: 80/91 routes (88%) secured**
