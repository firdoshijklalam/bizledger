# BizLedger — Production Release Baseline

**Baseline Date:** 2026-08-19
**Production SHA:** `a3539d0`
**Status:** RELEASE READY

---

## 1. Production SHA

`a3539d040e55be78e0da6f989a8e592b891ecf72`

Commit message: `fix: correct Retry-After calculation + remove debug-rl endpoint`

## 2. Deployment Status

| Field | Value |
|---|---|
| Platform | Vercel |
| URL | https://bizledger-liart.vercel.app |
| Status | SUCCESS — "Deployment has completed" |
| Framework | Next.js 16 (App Router, Turbopack) |
| Build command | `prisma generate --schema prisma/schema.prisma && npx prisma migrate deploy --schema prisma/schema.prisma && next build` |
| Install command | `npm install` |

## 3. Test Results

| Check | Result |
|---|---|
| Unit tests (invoice calculation) | 31/31 PASS |
| Unit tests (server-authoritative invoice) | 21/21 PASS |
| Unit tests (reports accounting) | 20/20 PASS |
| Unit tests (concurrent payments) | 8/8 PASS |
| Unit tests (POS cart calculations) | 26/26 PASS |
| Unit tests (financial numeric safety) | 64/64 PASS |
| Integration tests (cross-tenant) | 20/20 PASS |
| Integration tests (security ownership) | 13/13 PASS |
| Integration tests (RBAC authorization) | 41/41 PASS |
| **Total** | **244/244 PASS** |
| ESLint | PASS (exit 0) |
| TypeScript (`tsc --noEmit`) | PASS (0 errors) |
| Next.js build | PASS (exit 0) |

## 4. Security Audit Status

| Area | Status |
|---|---|
| Authentication | PASS — Session-based, scrypt password hashing, httpOnly cookies |
| RBAC | PASS — 98 routes audited, 0 FAIL (docs/API_RBAC_MATRIX.md) |
| Multi-tenant isolation | PASS — All tenant queries use findFirst+businessId |
| IDOR | PASS — No findUnique without businessId on tenant-owned data |
| Seed/reset/setup-db | PASS — All return 403 in production |
| Debug endpoints | PASS — /api/debug is production-guarded (403); debug-rl/debug-env removed |
| Secrets in code | PASS — None found |
| .env in git | PASS — Not tracked |
| Security headers | PASS — X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy |
| Rate limiting | ACTIVE — See section 7 |

## 5. Financial Safety Status

| Area | Status |
|---|---|
| Prisma Decimal serialization | PASS — 30 API routes use serializeDecimals() (57 wraps) |
| Frontend numeric coercion | PASS — toNumber() utility used in all reduce() calls |
| formatCurrency() safety | PASS — Uses toNumber() internally, never used in arithmetic |
| Auto-discount precedence | PASS — (mrp - price) × qty, NOT mrp - price × qty |
| GST calculation | PASS — Applied on taxable (subtotal - discount), not subtotal |
| Server-authoritative invoices | PASS — All totals recalculated server-side, client values not trusted |
| Atomic void | PASS — $transaction wraps stock+balance+transaction+status |
| Atomic return | PASS — $transaction with idempotency check (409 on duplicate) |
| Concurrent payment safety | PASS — Atomic increment/decrement (not read-then-write) |
| Decimal migration | PASS — All financial fields are Decimal(18,2), no Float financial fields |

### Critical Financial Regression Tests

**CASE A:** ₹55 + ₹55, GST 5%
- Expected: subtotal=110, GST=5.50, grandTotal=115.50
- Status: PASS

**CASE B:** ₹1,250 + ₹1,280
- Expected: subtotal=2,530
- Status: PASS

**CASE C:** MRP ₹60, Sale ₹55, Qty 2
- Expected: auto-discount = (60-55)×2 = ₹10
- Status: PASS

## 6. Multi-Tenant Isolation Status

Every tenant-owned query enforces `businessId`:
- Products: `findFirst({where:{id, businessId}})`
- Parties: `findFirst({where:{id, businessId}})`
- Invoices: `findFirst({where:{id, businessId}})`
- Transactions: `findFirst({where:{id, businessId}})`
- Staff: `requireRole(['OWNER','ADMIN'])`
- All mutations: `updateMany({where:{id, businessId}})` or findFirst+businessId verification

Cross-tenant tests: 20/20 PASS

## 7. Rate Limiting Configuration

| Endpoint | Limit | Window | Identifier |
|---|---|---|---|
| Login | 5 | 15 minutes | IP |
| PIN | 5 | 15 minutes | IP |
| OCR | 5 | 1 minute | User ID |
| Image compression | 10 | 1 minute | User ID |
| Image remove-bg | 10 | 1 minute | User ID |
| Public orders | 10 | 1 hour | IP |

**Implementation:** `src/lib/rate-limit.ts` using `@upstash/ratelimit` + `@upstash/redis`
**Fail-open behavior:** If Redis connection fails, requests are allowed through (prevents lockout)
**429 response:** Includes `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining` headers
**Retry-After calculation:** `Math.max(1, Math.ceil((rateResult.reset - Date.now()) / 1000))`

**Required Vercel Environment Variables:**
- `UPSTASH_REDIS_REST_URL` — Upstash Redis REST endpoint URL
- `UPSTASH_REDIS_REST_TOKEN` — Upstash Redis REST API token

## 8. Database / Migration Status

| Field | Value |
|---|---|
| Database | Neon PostgreSQL (production) / SQLite (dev) |
| ORM | Prisma 6 |
| Connection | Neon pooled endpoint (-pooler in hostname) |
| Migration state | "Database schema is up to date!" |
| Applied migrations | 4 (init, sync_neon_schema, secondary_decimal, remaining_decimal) |

**All financial fields are Decimal(18,2):**
- Product: purchasePrice, salePrice, mrp, wholesalePrice, retailSalePrice, retailMrp
- Party: balance, creditLimit, openingBalance, maxCreditSuggestion
- Invoice: subtotal, discountValue, discountAmount, gstAmount, grandTotal, amountPaid, amountDue
- InvoiceItem: unitPrice, discount, gstRate, total
- Transaction: amount, balanceAfter
- CustomPrice: customPrice, customMrp, customSalePrice, customWholesalePrice, customRetailMrp, customRetailSalePrice
- CustomerOrder: subtotal, deliveryCharge, grandTotal, commissionAmount
- OrderSplit: commissionAmount, merchantAmount
- PaymentSplit: totalAmount, commissionAmount, merchantAmount
- PurchaseOrder: totalAmount
- PurchaseOrderItem: unitPrice, transportFare, coolieCharge, totalCost
- ReturnRequest: refundAmount
- DefaulterRegistry: defaultAmount
- AppSettings: gateDiscountLimit

**Remaining Float fields (non-financial, correct):**
- gstRate (percentage), stock, looseStock (quantity), conversionFactor, quantity, fulfilledQty, commissionPct (percentage), trustScore (0-5 stars), latitude/longitude

## 9. Important Architecture Decisions

1. **Server-authoritative invoice calculation** — All invoice totals (subtotal, discount, GST, grandTotal, amountPaid, amountDue) are recalculated server-side from quantity × unitPrice. Client-provided totals are never trusted.

2. **Atomic operations** — Invoice creation, void, and return all use Prisma `$transaction` to ensure atomicity. If any step fails, all changes roll back.

3. **Concurrent payment safety** — Party balance updates use Prisma's atomic `increment`/`decrement` operators (SQL-level atomic), not read-then-write.

4. **InvoiceSequence** — Per-business atomic invoice numbering using `upsert+increment` inside the invoice creation transaction. Prevents duplicate invoice numbers under concurrent load.

5. **serializeDecimals()** — Custom utility (`src/lib/decimal-serializer.ts`) recursively converts Prisma Decimal objects to JS numbers before JSON serialization. Checks `isDecimalLike()` before generic object recursion.

6. **toNumber() utility** — Frontend numeric safety utility (`src/lib/numeric.ts`) converts any value (string, Decimal, null, NaN) to a safe number. Used in all financial reduce() calculations.

7. **formatCurrency()** — Display-only function that uses `toNumber()` internally. Never used in arithmetic.

8. **Marketplace feature flag** — `NEXT_PUBLIC_ENABLE_MARKETPLACE=false` (default disabled). Marketplace pages hidden until customer auth + payment webhook are production-ready.

9. **PWA** — Installable: manifest.json + icon-192.png + icon-512.png + apple-touch-icon.png + functional service worker (network-first HTML, cache-first static assets, never caches API responses).

10. **Rate limiting** — Distributed via Upstash Redis (serverless-safe). Fail-open on Redis error. 6 endpoints protected.

## 10. Production Environment Variables

| Variable | Purpose | Set in Vercel |
|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL pooled connection string | ✅ |
| `NEXTAUTH_SECRET` | PIN/biometric hashing secret | ✅ |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint | ✅ |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST API token | ✅ |
| `NEXT_PUBLIC_ENABLE_MARKETPLACE` | Feature flag (default: false) | Optional |

**Note:** Never commit `.env` to git. Use `.env.example` as a template.

## 11. Rollback Procedure

To roll back to a previous production deployment:

1. Go to https://vercel.com/dashboard → BizLedger project → Deployments
2. Find the target deployment (e.g., `a3539d0`)
3. Click the "..." menu → "Promote to Production"
4. Confirm the promotion

**Alternatively via CLI:**
```bash
vercel promote <deployment-url> --prod
```

**Database rollback:** Not recommended. Prisma migrations are forward-only. If a migration issue occurs, create a new migration to reverse the change. Never run `prisma migrate reset` in production.

## 12. Reproducing Critical Financial Regression Tests

```bash
# Run all tests
bun run test

# Run specific test suites
npx tsx tests/unit/invoice-calculation.test.ts        # 31 tests
npx tsx tests/unit/server-authoritative-invoice.test.ts # 21 tests
npx tsx tests/unit/reports-accounting.test.ts         # 20 tests
npx tsx tests/unit/concurrent-payments.test.ts         # 8 tests
npx tsx tests/unit/pos-cart-calculations.test.ts       # 26 tests
npx tsx tests/unit/financial-numeric-safety.test.ts   # 64 tests
npx tsx tests/integration/cross-tenant.test.ts        # 20 tests
npx tsx tests/integration/security-ownership.test.ts  # 13 tests
npx tsx tests/integration/rbac-authorization.test.ts   # 41 tests
```

### Key Test Cases

**CASE A (₹55+₹55, GST 5%):** `tests/unit/pos-cart-calculations.test.ts` Test 1
**CASE B (₹1250+₹1280):** `tests/unit/pos-cart-calculations.test.ts` Test 2
**Auto-discount precedence:** `tests/unit/pos-cart-calculations.test.ts` Test 8
**String concat bug repro:** `tests/unit/pos-cart-calculations.test.ts` Test 9
**Concurrent payment safety:** `tests/unit/concurrent-payments.test.ts` Tests 1-7
**Voided invoice exclusion:** `tests/unit/reports-accounting.test.ts` Tests 1-2
**COGS calculation:** `tests/unit/reports-accounting.test.ts` Test 3

## 13. Verifying Rate Limiting After Future Deployments

```bash
# Test login rate limiting (should get 429 on 6th+ attempt)
for i in 1 2 3 4 5 6 7; do
  curl -s -X POST https://bizledger-liart.vercel.app/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"rl-verify@test.com","password":"wrong"}' \
    -o /dev/null -w "Attempt $i: HTTP %{http_code}\n" \
    -D /tmp/rl-$i.txt
  grep -i "retry-after\|x-ratelimit" /tmp/rl-$i.txt 2>/dev/null
done

# Expected:
# Attempts 1-5: HTTP 401 (allowed)
# Attempt 6+: HTTP 429 (rate limited)
# Retry-After: <seconds> (present on 429)
# X-RateLimit-Limit: 5
# X-RateLimit-Remaining: 0
```

---

## Final Git State Confirmation

- Branch: `main`
- HEAD: `a3539d040e55be78e0da6f989a8e592b891ecf72`
- origin/main: `a3539d040e55be78e0da6f989a8e592b891ecf72` (in sync)
- Working tree: CLEAN
- .env: NOT tracked
- .pid files: NOT tracked
- Debug endpoints: NONE (except production-guarded /api/debug)
- Runtime artifacts: NONE

---

**This baseline is frozen. All future feature development must preserve:**
1. Financial numeric safety (serializeDecimals + toNumber)
2. Multi-tenant isolation (findFirst+businessId)
3. Authentication + RBAC on all routes
4. Rate limiting on sensitive endpoints
5. Server-authoritative invoice calculations
6. Atomic transaction patterns

---

# BizLedger — Production Release Baseline v2 (Backup/Restore Finalized)

**Baseline Date:** 2026-08-23
**Production SHA:** `1cf7c96`
**Status:** RELEASE READY — Backup/Restore system fully verified
**Supersedes:** v1 (`a3539d0`, 2026-08-19) for backup/restore, import, and search baseline

---

## v2.1. Production SHA

`1cf7c96ad57a584eb82e2e8f13d3bf74b0f1d65e`

Commit message: `fix(restore): handle repeat imports with _imp ID collision detection`

## v2.2. Deployment Status

| Field | Value |
|---|---|
| Platform | Vercel |
| URL | https://bizledger-liart.vercel.app |
| Local HEAD | `1cf7c96ad57a584eb82e2e8f13d3bf74b0f1d65e` |
| origin/main | `1cf7c96ad57a584eb82e2e8f13d3bf74b0f1d65e` (in sync) |
| Working tree | CLEAN |
| Framework | Next.js 16 (App Router, Turbopack) |
| Build command | `prisma generate --schema prisma/schema.prisma && npx prisma migrate deploy --schema prisma/schema.prisma && next build` |
| Install command | `npm install` |
| Vercel deployment-object state via Vercel API | **NOT VERIFIED** — no `VERCEL_TOKEN` in environment. See §v2.10. |

## v2.3. Test Results

| Check | Result |
|---|---|
| Unit tests (invoice calculation) | 31/31 PASS |
| Unit tests (server-authoritative invoice) | 21/21 PASS |
| Unit tests (reports accounting) | 20/20 PASS |
| Unit tests (reports export) | 58/58 PASS |
| Unit tests (reports performance) | 52/52 PASS |
| Unit tests (backup import) | 89/89 PASS |
| Unit tests (external import) | 121/121 PASS |
| Unit tests (xlsx import) | 75/75 PASS |
| Unit tests (xlsx multisheet) | 42/42 PASS |
| Unit tests (duplicate resolution) | 30/30 PASS |
| Unit tests (concurrent payments) | 8/8 PASS |
| Unit tests (POS cart calculations) | 26/26 PASS |
| Unit tests (financial numeric safety) | 64/64 PASS |
| Unit tests (search engine) | 44/44 PASS |
| Unit tests (search engine v2) | 72/72 PASS |
| Integration tests (cross-tenant) | 20/20 PASS |
| Integration tests (security ownership) | 13/13 PASS |
| Integration tests (RBAC authorization) | 41/41 PASS |
| **Total** | **827/827 PASS** |
| ESLint | PASS (exit 0) |
| TypeScript (`tsc --noEmit`) | PASS (0 errors) |
| Next.js build | PASS (exit 0) |

## v2.4. Backup/Restore Verification

| Area | Status | Evidence |
|---|---|---|
| `/api/data-import` uses `db.$transaction` | PASS | `route.ts:255` |
| DB exceptions propagate out of transaction callback | PASS | No `try/catch` inside transaction block (lines 255–702) |
| No test/force/debug rollback flag in source | PASS | Grep for 13 markers (e.g. `__forceRollback`, `SIMULATED_DB_FAILURE`) → 0 matches |
| No conditional production/test rollback branch | PASS | Single atomic code path |
| Row-level validation errors skipped, not rolled back | PASS | `/api/external-import/route.ts:237–246` (`continue` on `status === 'ERROR'`) |
| DB-level exception → full transaction rollback | PASS | Errors propagate to outer catch (`route.ts:145`) → HTTP 500 "rolled back" |
| ImportHistory marked `ROLLED_BACK` on DB failure | PASS | `/api/external-import/route.ts:202–208` |
| Cross-tenant ID remapping via `_imp` suffix + `idMap` | PASS | `route.ts:294–303`, `hasId()` / `resolveId()` helpers |
| Repeat-import collision detection (`_imp` of `_imp`) | PASS | Commit `1cf7c96` |
| Secrets stripped via allow-list (passwordHash, qrToken, paymentLandingToken, etc.) | PASS | `src/lib/backup-format.ts` |
| Tenant isolation: `businessId` rewritten from session, never trusted from file | PASS | All create/upsert blocks |

## v2.5. Cleanup Verification

Searched entire repository for the following 13 test/backdoor markers — **ZERO references** in production source, tests, scripts, or API routes:

```
__testForceRollback   testForceRollback     TEST_ROLLBACK
create-qa-b           test-rollback         rollback-e2e
rollback-direct       SIMULATED_DB_FAILURE  debug-rl
debug-env             qa-create-tenant       __forceRollback
forceRollback
```

| Cleanup Item | Status |
|---|---|
| Test-only rollback code removed | PASS |
| No temporary API routes | PASS (7 hypothetical test endpoints all return HTTP 404 in production) |
| No test scripts in `package.json` | PASS |
| No test-only env vars | PASS |
| No test-only query/body flags | PASS |
| No `console.debug` in import routes | PASS |
| No synthetic QA records in production DB | PASS (cleaned after browser smoke test) |
| No leaked credentials/secrets in source | PASS |
| `/api/debug` production-guarded | PASS (returns HTTP 403 with `{"error":"This endpoint is disabled in production"}`) |

## v2.6. Search Freeze (Baseline `b9eb828`)

All 7 frozen search files have **identical blob hashes** between baseline `b9eb828` and current HEAD `1cf7c96`. Byte-for-byte identical content — zero content line changes.

| File | b9eb828 blob | HEAD (1cf7c96) blob | Match |
|---|---|---|---|
| `src/lib/search-engine.ts` | `818e042bfd18...` | `818e042bfd18...` | IDENTICAL |
| `src/lib/search-rank.ts` | `f231ff10ab0c...` | `f231ff10ab0c...` | IDENTICAL |
| `src/lib/highlight.tsx` | `95d8c24bb499...` | `95d8c24bb499...` | IDENTICAL |
| `src/lib/transliteration.ts` | `e0e7744dfb46...` | `e0e7744dfb46...` | IDENTICAL |
| `src/components/layout/search-overlay.tsx` | `dcc55300b24a...` | `dcc55300b24a...` | IDENTICAL |
| `tests/unit/search-engine.test.ts` | `235b4d913a2a...` | `235b4d913a2a...` | IDENTICAL |
| `tests/unit/search-engine-v2.test.ts` | `6df17d8b0252...` | `6df17d8b0252...` | IDENTICAL |

Verification command (content-only, ignores mode-only changes):
```bash
git diff b9eb828 -- \
  src/lib/search-engine.ts \
  src/lib/search-rank.ts \
  src/lib/highlight.tsx \
  src/lib/transliteration.ts \
  src/components/layout/search-overlay.tsx \
  tests/unit/search-engine.test.ts \
  tests/unit/search-engine-v2.test.ts
# Expected: EMPTY content diff
```

## v2.7. Production Smoke Test

| Endpoint | Expected | Observed |
|---|---|---|
| `GET https://bizledger-liart.vercel.app/` | HTTP 200 | HTTP 200 (13,195 bytes, 626ms) |
| `GET https://bizledger-liart.vercel.app/login` | HTTP 200 | HTTP 200 |
| `GET https://bizledger-liart.vercel.app/api/debug` | HTTP 403 (production-guarded) | HTTP 403 `{"error":"This endpoint is disabled in production"}` |
| `GET /api/test-rollback` | HTTP 404 | HTTP 404 |
| `GET /api/rollback-e2e` | HTTP 404 | HTTP 404 |
| `GET /api/qa-create-tenant` | HTTP 404 | HTTP 404 |
| `GET /api/create-qa-b` | HTTP 404 | HTTP 404 |
| `GET /api/debug-env` | HTTP 404 | HTTP 404 |
| `GET /api/debug-rl` | HTTP 404 | HTTP 404 |
| `GET /api/test-force-rollback` | HTTP 404 | HTTP 404 |

Browser-based local verification (agent-browser, `http://localhost:3000`):
- Page renders correctly (title: "BizLedger — Digital Khata for Modern Business").
- Login golden path works (`owner@bizledger.app` / `admin123` → redirected to `/`).
- Dashboard renders real data: "Sharma Trading Co.", Total Receivable ₹8,000, Total Sales ₹9,142, charts, parties, transactions, bottom navigation.
- No console errors, no page errors, no hydration mismatches.
- Seeded test data cleaned after verification (all counts back to 0).

## v2.8. Final Git State

- Branch: `main`
- HEAD: `1cf7c96ad57a584eb82e2e8f13d3bf74b0f1d65e`
- origin/main: `1cf7c96ad57a584eb82e2e8f13d3bf74b0f1d65e` (in sync)
- Working tree: CLEAN
- .env: NOT tracked
- Debug endpoints: NONE except production-guarded `/api/debug` (pre-existing, Aug 11)
- Runtime artifacts: NONE
- Temp test files: NONE (all `scripts/_*.ts` removed after verification)

## v2.9. Release Freeze Policy

**From this point onward (`1cf7c96`), the following are FROZEN and must NOT be modified unless a real production regression is demonstrated and reproduced first:**

1. **Frozen search module** (7 files listed in §v2.6) — byte-for-byte identical to `b9eb828`.
2. **No rollback/debug/test backdoors** may be re-introduced under any circumstance.
3. **Financial/accounting logic** (invoice calculation, decimal serialization, COGS, voided invoice exclusion) — see §13 of v1 baseline.
4. **Import/restore behavior** (`/api/data-import`, `/api/external-import`, ID mapping, `_imp` suffix, `hasId()`/`resolveId()`, ImportHistory status flow) — must not change unless a real production regression is demonstrated.
5. **Multi-tenant isolation** — all tenant queries use `findFirst + businessId`.
6. **Authentication + RBAC** on all routes.
7. **Atomic transaction patterns** (`db.$transaction` for import/restore/payment).

**Bug-fix workflow from this point onward:**
1. **Reproduce first** — Any reported bug must first be reproduced in production (via browser against `https://bizledger-liart.vercel.app`) or in the local dev environment against real data.
2. **Confirm root cause** — Identify the exact failing line/logic before touching code.
3. **Minimal fix** — Change only the lines required to fix the regression. Do not refactor unrelated modules.
4. **Regression test** — Add a unit/integration test that fails before the fix and passes after.
5. **Re-run full suite** — `bun run test && bun run lint && npx tsc --noEmit && npx next build` must all exit 0.
6. **New branch/commit after `1cf7c96`** — Do not commit directly to `main` without review.

## v2.10. NOT VERIFIED (genuinely untestable in this environment)

| Item | Reason | Mitigation |
|---|---|---|
| Explicit Vercel deployment-object `state: "READY"` via Vercel REST API | No `VERCEL_TOKEN` available in this sandbox. | (a) Local HEAD `1cf7c96` == origin/main `1cf7c96` → code is pushed → GitHub↔Vercel auto-deploy triggered. (b) Production URL `https://bizledger-liart.vercel.app` responds HTTP 200 with correct content. (c) The `/api/debug` production guard fires correctly (`NODE_ENV === 'production'` → HTTP 403), proving the deployed instance is running in production mode. To get the explicit Vercel deployment SHA + state, run `vercel ls` or check the Vercel dashboard with an authenticated token. |

---

## v2.11. VERIFIED vs NOT VERIFIED Summary

### A. VERIFIED
- Real DB rollback after successful insert (Prisma `$transaction`, no internal error swallowing).
- Row-level validation behavior (ERROR rows skipped without rollback; DB errors propagate).
- Cleanup of rollback test mechanism (13 markers → 0 references).
- Regression suite (827/827 assertions PASS).
- Lint (exit 0).
- Typecheck (exit 0).
- Production build (exit 0).
- Search freeze (7 files byte-for-byte identical to `b9eb828`).
- Production deployment (HTTP 200 on home + login; `/api/debug` → 403; all 7 test endpoints → 404).
- Browser smoke test (login golden path + dashboard rendering).
- Git clean (HEAD == origin/main, working tree clean).

### B. NOT VERIFIED
- Explicit Vercel deployment-object READY/SUCCESS state via Vercel REST API (no `VERCEL_TOKEN` in environment). Production HTTP behavior has been verified successfully as mitigation.
