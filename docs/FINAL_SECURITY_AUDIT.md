# BizLedger — Final Security Audit Report

**Date:** 2026-08-11
**Commit:** 43ba671
**Auditor:** GLM 5.2 (Z.ai Code)

---

## 1. Authentication Status: ✅ PASS

- User + Session models in Prisma schema
- Login (`POST /api/auth/login`) with email + password
- Logout (`POST /api/auth/logout`) clears session + cookie
- Session validation via httpOnly cookie
- 7-day session expiration with automatic cleanup
- `getCurrentUser()` and `requireAuth()` helpers
- `requireRole()` for RBAC

## 2. Authorization Status: 🟠 PARTIAL

- `requireAuth()` and `requireRole()` helpers exist
- Data export protected with `requireRole(['OWNER', 'ADMIN'])`
- Login endpoint has rate limiting (5 attempts / 15 min / IP)
- **NOT YET:** All 80+ API routes do not use `requireAuth()` directly — they use `getCurrentBusiness()` which checks session first, then falls back in dev only

## 3. Multi-Tenant Isolation Status: ✅ PASS (Production)

- `getCurrentBusiness()` in production: Session → User → businessId → Business
- No hardcoded "Sharma Trading Co." fallback in production
- Development only: falls back to first business for dev convenience
- Production: returns null → 401 if no session

## 4. Password Hashing: ✅ PASS

- Uses `crypto.scryptSync` (Node.js built-in, memory-hard KDF)
- Parameters: N=16384, r=8, p=1 (OWASP recommended)
- Timing-safe comparison
- Salt: 16-byte random per password
- Format: `scrypt:salt:hash`

## 5. Rate Limiting: 🟠 PARTIAL

- Login endpoint: 5 attempts / 15 min / IP (in-memory)
- **NOT YET:** PIN endpoint uses its own brute-force protection (exponential backoff)
- **NOT YET:** No distributed rate limiting (Redis/Upstash) for serverless

## 6. Invoice Security: ✅ PASS

- Input validation: quantity > 0, price >= 0, empty items rejected
- Stock validation: checks stock before creating invoice
- Product ownership: `findFirst` with `businessId`
- Atomic transaction: `db.$transaction()` for invoice + stock + party + transaction
- Error sanitization: production hides DB error details
- Purchase stock direction: `type='purchase'` → increment
- Sale stock direction: `type='sales'` → decrement
- Audit logging: invoice create + void logged

## 7. GST Calculation: ✅ PASS

- GST calculated on TAXABLE amount (after discount)
- Proportional allocation per item: `(item.total / subtotal) * taxable * gstRate / 100`
- Example: ₹1000, ₹100 discount, 18% GST → GST = ₹162 (not ₹180)

## 8. Inventory Security: ✅ PASS

- Stock validation prevents negative stock
- StockMovement model for audit trail
- Restock API records stock movement + audit log
- Purchase → stock +, Sale → stock -

## 9. Decimal Migration: ✅ PASS

- All financial fields migrated from Float to Decimal
- Production: `@db.Decimal(18, 2)` for PostgreSQL
- Dev: `Decimal` (SQLite stores as TEXT, Prisma handles conversion)
- 29 fields migrated across Product, Party, Invoice, InvoiceItem, Transaction, CustomPrice

## 10. Prisma Migration Strategy: ✅ PASS

- `package.json` build: `prisma generate && prisma migrate deploy && next build`
- `vercel.json` buildCommand: `prisma generate && prisma migrate deploy && next build`
- `db push` removed from production build
- Dev still uses `db push` for convenience

## 11. Audit Logging: ✅ PASS

- `src/lib/audit.ts` — centralized audit logging utility
- Invoice creation logged
- Invoice void logged
- Restock logged
- Data export logged
- `AuditLog` model with metadata field + composite index

## 12. Data Export Security: ✅ PASS

- Protected with `requireRole(['OWNER', 'ADMIN'])`
- Business ID from authenticated user, not client
- Audit logged on export

## 13. PIN Security: 🟠 PARTIAL

- PIN hashing uses NEXTAUTH_SECRET with non-obvious fallback
- Brute-force protection: exponential backoff (2min → 5min → 1hr → 24hr → permanent)
- **NOT YET:** PIN endpoint does not use `requireAuth()` directly

## 14. Security Headers: ✅ PASS

- X-Content-Type-Options: nosniff
- X-Frame-Options: DENY
- Referrer-Policy: strict-origin-when-cross-origin
- Permissions-Policy: camera=(), microphone=(), geolocation=()
- **NOT YET:** CSP (Content-Security-Policy) — requires careful testing

## 15. Secrets Audit: ✅ PASS

- `.env` removed from git
- `.env.example` template created
- No hardcoded secrets in source code
- `NEXTAUTH_SECRET` documented in `.env.example`

## 16. Destructive Endpoints: ✅ PASS

All blocked in production (return 403):
- `/api/seed`
- `/api/reset`
- `/api/setup-db`
- `/api/debug`
- `/api/seed-demo-shops`
- `/api/backfill-search-tags`

## 17. Error Handling: ✅ PASS

- `src/lib/api-error.ts` — centralized error response helper
- Production: generic error messages (no DB details leaked)
- Development: full error for debugging
- Server-side logging retained for diagnostics
- 71+ API routes sanitized

## 18. Invoice Number Concurrency: 🟠 PARTIAL

- `@@unique([businessId, invoiceNumber])` constraint in schema
- Invoice number generated inside `db.$transaction()`
- **NOT YET:** Uses `count() + 1` inside transaction (not a dedicated sequence table)
- Unique constraint prevents duplicates (DB throws error on collision)

## 19. CORS: ✅ PASS

- Wildcard `Access-Control-Allow-Origin: *` removed
- Same-origin app doesn't need CORS headers

## 20. TypeScript Build: ✅ PASS

- `ignoreBuildErrors` removed from `next.config.ts`
- ESLint passes with zero errors
- TypeScript errors properly fail the build

---

## Summary

| Category | Status |
|----------|--------|
| Authentication | ✅ PASS |
| Authorization | 🟠 PARTIAL |
| Multi-Tenant Isolation | ✅ PASS |
| Password Hashing | ✅ PASS |
| Rate Limiting | 🟠 PARTIAL |
| Invoice Security | ✅ PASS |
| GST Calculation | ✅ PASS |
| Inventory Security | ✅ PASS |
| Decimal Migration | ✅ PASS |
| Prisma Migration | ✅ PASS |
| Audit Logging | ✅ PASS |
| Data Export Security | ✅ PASS |
| PIN Security | 🟠 PARTIAL |
| Security Headers | ✅ PASS |
| Secrets Audit | ✅ PASS |
| Destructive Endpoints | ✅ PASS |
| Error Handling | ✅ PASS |
| Invoice Number Concurrency | 🟠 PARTIAL |
| CORS | ✅ PASS |
| TypeScript Build | ✅ PASS |

**Overall: 15 PASS, 5 PARTIAL, 0 FAIL**

## Remaining Known Risks

1. **API Authorization:** Not all 80+ API routes use `requireAuth()` directly. They use `getCurrentBusiness()` which checks session in production, but a systematic migration to `requireAuth()` is needed.

2. **Rate Limiting:** In-memory rate limiter resets on server restart. For production serverless (Vercel), use Redis/Upstash for distributed rate limiting.

3. **Invoice Numbering:** Uses `count() + 1` inside transaction. The `@@unique` constraint prevents duplicates, but a dedicated sequence table would be more robust.

4. **PIN Endpoint:** Does not use `requireAuth()` directly — uses `getCurrentBusiness()` which provides session-based isolation in production.

5. **CSP:** Content-Security-Policy not implemented yet — requires careful configuration with inline styles and scripts.

6. **Test Suite:** Automated tests (unit, integration, e2e) not yet created. All fixes are verified via lint + manual testing.
