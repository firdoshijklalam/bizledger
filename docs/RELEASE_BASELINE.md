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
