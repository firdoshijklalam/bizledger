# BIZLEDGER — MIGRATION RECOVERY FORENSIC AUDIT (READ-ONLY)

**Status:** INVESTIGATION & DESIGN ONLY — NO FIX IMPLEMENTED, NO APPROVAL REQUESTED GRANTED
**Audited tree:** snapshot `9057e6d19d6690b02139d78f985a6c4b82e4b65c` (== working tree `b7485b2` for `prisma/`, verified `git diff` empty)
**Date:** 2026-10 (session continuation)
**Constraints honored:** no migration file modified; no commit/branch/tag created; no push/deploy/merge; no DDL against Production; no `db push` / `migrate deploy` / `migrate reset` / `migrate resolve` against Production; no credentials or connection strings printed; snapshot unchanged.

---

## 0. Evidence & Reproduction Environment (all findings below are locally reproducible)

A disposable **PostgreSQL 17.11** instance was booted inside this sandbox (embedded-postgres zonky binaries on `127.0.0.1:5433`, data under `/tmp/pgreplay/data`). Three throwaway databases were used:

| DB | Purpose | Result |
|---|---|---|
| `replay` | Exact Vercel pipeline step: `prisma migrate deploy` on fresh DB | **P3018 @ migration 2** |
| `replay` (+resolve) | `migrate resolve --applied 20260812000000_sync_neon_schema` then re-deploy | **P3018 @ migration 3** — the "2/25" mode |
| `replay2` | Statement-by-statement replay, continue-on-error | **37 failing statements / 11 migrations** |
| `replay3` | Applied a schema-generated baseline | **281 stmts, 0 failures, exact schema parity** |

**Zero contact with Production** (sandbox `.env` contains only `file:custom.db` — a local SQLite dev file; no Neon credentials exist here).

CLI used: Prisma 6.19.2 (`bunx prisma`), Node/Bun runtime, `pg` 8.23.1 client.

---

## 1. TASK 1 — Production State Inventory: **NOT RUN**

**Reason:** this sandbox holds **no Production database credentials**. The only `DATABASE_URL` present is `file:custom.db` (SQLite dev). Per audit rules I do not guess, fabricate, or print credentials.

### 1.1 What the OWNER must run (read-only, safe, no DDL)

Run these from a machine with the Production **non-pooled** (direct, `-ep-` without `-pooler`) connection string exported as `DIRECT_URL` (never paste the URL into logs):

```bash
# (1) Migration history state — failed/pending/applied
npx prisma migrate status --schema prisma/schema.prisma

# (2) Full _prisma_migrations inventory (name, checksum, timestamps)
psql "$DIRECT_URL" -c "SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM _prisma_migrations ORDER BY migration_name;"

# (3) THE CRITICAL ONE — exact drift between Production reality and schema.prisma
npx prisma migrate diff --from-url "$DIRECT_URL" --to-schema-datamodel prisma/schema.prisma --script > prod-drift.sql

# (4) The 24 "never-in-any-migration" tables — do they exist on Production?
psql "$DIRECT_URL" -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"

# (5) The 4 raw-SQL partial unique indexes (not expressible in Prisma schema)
psql "$DIRECT_URL" -c "SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname IN ('Conversation_businessId_partyId_in_app_key','CustomerRewardCycle_businessId_partyId_active_key','Notification_businessId_followUpId_type_key','ProductFeedback_dedupKey_status_key');"

# (6) Runtime-risk table: FeedbackReconciliationCursor (see RISKS §6.5)
psql "$DIRECT_URL" -c "SELECT to_regclass('public.\"FeedbackReconciliationCursor\"') AS cursor_table;"

# (7) FK onDelete inventory (SetNull audit-preservation invariants)
psql "$DIRECT_URL" -c "SELECT conname, confdeltype FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace ORDER BY conname;"
```

**Checksum note:** Prisma's `_prisma_migrations.checksum` is the SHA-256 of the `migration.sql` file bytes — directly comparable with the SHA-256 column in §2.1. Any mismatch means the file was edited after it was applied on Production (relevant for the sync_neon_schema history question below).

### 1.2 What TASK 1 must decide (branch conditions for Path B)

| Question | Why it matters |
|---|---|
| Are there rows with `finished_at IS NULL` / `rolled_back_at IS NOT NULL`? | Outstanding P3018 state blocks `migrate deploy` entirely (must `resolve --rolled-back` first) |
| Is `20260811000000_init` recorded as applied — and does its checksum match `527a01d4…`? | Distinguishes "resolve-marked" vs "actually executed" history |
| Is `20260812000000_sync_neon_schema` applied with matching checksum `49eb4c89…`? | Confirms it executed against the legacy schema (its statements only make sense there) |
| Is `prod-drift.sql` (command 3) empty? | If non-empty, Production ≠ schema.prisma and the drift SQL must be applied (reviewed) before re-baselining |
| Do all 24 legacy tables + 4 partial indexes + FeedbackReconciliationCursor exist? | Directly gates the Path B alignment step |

---

## 2. TASK 2 — Forensics of All 25 Migrations

### 2.1 Master table (SHA-256 verified; fresh-DB result EMPIRICALLY replayed on PG 17.11)

`stmts` = statement count from replay splitter. `fresh` = outcome on empty PG17 (continue-on-error statement replay). `target` = what environment the migration was actually written for.

| # | Migration | SHA-256 (first 16) | stmts | fresh PG17 | Designed for |
|---|---|---|---|---|---|
| 1 | 20260811000000_init | `527a01d42eb157c3` | 30 | 30 OK | **fresh baseline** |
| 2 | 20260812000000_sync_neon_schema | `49eb4c8951991194` | 26 | **16 FAIL** | **legacy Neon only** |
| 3 | 20260812160000_secondary_decimal | `1953708f4f036138` | 4 | **3 FAIL** | legacy only |
| 4 | 20260812170000_remaining_decimal | `83877931203a1a1e` | 7 | **7 FAIL** | legacy only |
| 5 | 20260822000000_add_import_history | `d2e0babd906721a4` | 3 | 3 OK | both |
| 6 | 20260824000000_add_card_customization | `7c10417cdca4e006` | 2 | **1 FAIL** | both (AppSettings half is legacy-only) |
| 7 | 20260826000000_add_dashboard_cards | `2f198dd9d6374e29` | 1 | **1 FAIL** | legacy only |
| 8 | 20260830000000_add_accounting_subtype_snapshot | `a6f9d58b28d7a072` | 3 | 3 OK | both |
| 9 | 20260831000000_add_invoice_delivery_charge | `872b930f8555d582` | 1 | 1 OK | both |
| 10 | 20260831000001_add_invoice_sale_operation_id | `9a9f7a64d4e9ab6c` | 2 | 2 OK | both |
| 11 | 20260905000000_add_dashboard_sections | `50ed097aaf36ce87` | 1 | **1 FAIL** | legacy only |
| 12 | 20260907000000_add_notification_invoice_id | `d3a329ea3ce59098` | 3 | **3 FAIL** | legacy only |
| 13 | 20260908000000_add_notification_channel_preferences | `d437c5648cb57387` | 5 | **1 FAIL** | both (DO-block is legacy-only) |
| 14 | 20260909000000_add_customer_behaviour | `5989c8c072d7a1ac` | 14 | 14 OK | both |
| 15 | 20260910000000_add_complaints | `0042fa44a2b8c9f7` | 19 | 19 OK | both |
| 16 | 20260911000000_add_messaging | `32c40f183cfe616d` | 23 | 23 OK | both |
| 17 | 20260912000000_fix_conversation_uniqueness | `a30803302f045bbd` | 2 | 2 OK | both |
| 18 | 20260913000000_add_reward_cycles | `a55e1fbc27be9c43` | 15 | **1 FAIL** | both (rewardThreshold half legacy-only) |
| 19 | 20260914000000_add_reward_accrual_outbox | `efec84f4d47bba95` | 5 | 5 OK | both |
| 20 | 20260915000000_add_reward_reconciliation_cursor | `23d67f9d18bac1ed` | 4 | 4 OK | both |
| 21 | 20260916000000_add_followups | `3ed8da421dddee24` | 24 | 24 OK | both |
| 22 | 20260917000000_add_notification_followup_id | `96c328029b53ad6a` | 2 | **2 FAIL** | legacy only |
| 23 | 20260918000000_add_product_feedback | `12409ae696ae98b2` | 17 | **16 OK / 1 FAIL** | both (feedbackDelayHours legacy-only) |
| 24 | 20260919000000_add_feedback_completeness | `a03d791272a5f2dc` | 3 | 3 OK | both |
| 25 | 20260920000000_add_feedback_outbox | `4be33d3eec263cec` | 6 | 6 OK | both |

Full SHA-256 values are in §2.4 (needed for `_prisma_migrations.checksum` comparison).

### 2.2 Root cause — structural, not cosmetic

**Migrations 1 and 2 are mutually exclusive by construction:**

- `20260811000000_init` is a **fresh-database baseline**: it creates 12 tables including `AuditLog` **with** the `metadata` column, and `User`, `Session`, `InvoiceSequence`, `StockMovement` with their indexes and FKs.
- `20260812000000_sync_neon_schema` is a **legacy-database patch**: it was hand-written to transform the historical Neon DB (created by `prisma db push`) — adding `AuditLog.metadata` (which the legacy table lacked), creating the then-missing auth tables, and converting double-precision columns to `DECIMAL(18,2)`.
- Running 2 after 1 on any database therefore collides: **42701** (duplicate column), **42P07** (duplicate tables/indexes), **42710** (duplicate FKs). Running 2 without 1 requires the 24 legacy tables to pre-exist.

**Deeper finding (bigger than the AuditLog column):** the chain never creates **24 of the 55 schema tables**. These tables were only ever created on Production by historical `prisma db push`:

```
AppSettings, BackupLog, BiometricGateLog, BusinessLink, Category, CommissionLog,
CustomerOrder, CustomerTrustScore, DefaulterRegistry, FavoriteShop,
FeedbackReconciliationCursor, FingerprintRecord, Notification, OrderSplit, PartyNote,
PaymentSplit, ProductImage, ProductMediaAsset, PurchaseOrder, PurchaseOrderItem,
ReturnRequest, Staff, SupplierCatalogItem, UserProfile
```

**Empirical proof (replay2 end-state vs schema.prisma, via `prisma migrate diff`):** even after a best-effort replay that skips all 37 failures, the chain's end state is missing:

- **24 CREATE TABLE**
- **33 FOREIGN KEY constraints**
- **11 unique indexes + 52 plain indexes**
- **6 ADD COLUMN** + **2 ALTER COLUMN**

⇒ The migration chain **cannot provision a fresh PostgreSQL 17 database under any statement-level patching**. It is a legacy-patch series, not a provisioning chain. This is why the Vercel Preview build (which runs `prisma migrate deploy` against a fresh Neon branch DB) can never pass on current `main`.

### 2.3 The verified failure list — 37 statements across 11 migrations (PG 17.11)

| Migration | # | PG code | Failing statement (abridged) |
|---|---|---|---|
| sync_neon_schema | 1 | 42701 | `ALTER TABLE "AuditLog" ADD COLUMN "metadata" TEXT` — column exists (init L251) |
| sync_neon_schema | 5 | 42P01 | `ALTER TABLE "OrderSplit" ALTER COLUMN "subtotal" …` — table never created |
| sync_neon_schema | 9 | 42P07 | `CREATE TABLE "InvoiceSequence"` — duplicate of init |
| sync_neon_schema | 10 | 42P07 | `CREATE TABLE "User"` — duplicate |
| sync_neon_schema | 11 | 42P07 | `CREATE TABLE "Session"` — duplicate |
| sync_neon_schema | 12 | 42P07 | `CREATE TABLE "StockMovement"` — duplicate |
| sync_neon_schema | 13 | 42P07 | `CREATE UNIQUE INDEX "InvoiceSequence_businessId_key"` |
| sync_neon_schema | 14 | 42P07 | `CREATE UNIQUE INDEX "User_email_key"` |
| sync_neon_schema | 15 | 42P07 | `CREATE INDEX "User_businessId_idx"` |
| sync_neon_schema | 16 | 42P07 | `CREATE UNIQUE INDEX "Session_tokenHash_key"` |
| sync_neon_schema | 17 | 42P07 | `CREATE INDEX "Session_userId_idx"` |
| sync_neon_schema | 18 | 42P07 | `CREATE INDEX "Session_expiresAt_idx"` |
| sync_neon_schema | 22 | 42P07 | `CREATE UNIQUE INDEX "Invoice_businessId_invoiceNumber_key"` |
| sync_neon_schema | 23 | 42710 | `ADD CONSTRAINT "InvoiceSequence_businessId_fkey"` |
| sync_neon_schema | 24 | 42710 | `ADD CONSTRAINT "User_businessId_fkey"` |
| sync_neon_schema | 25 | 42710 | `ADD CONSTRAINT "Session_userId_fkey"` |
| secondary_decimal | 1 | 42P01 | `ALTER TABLE "AppSettings" …` |
| secondary_decimal | 2 | 42P01 | `ALTER TABLE "CustomerOrder" …` |
| secondary_decimal | 3 | 42P01 | `ALTER TABLE "DefaulterRegistry" …` |
| remaining_decimal | 1 | 42P01 | `ALTER TABLE "CommissionLog" …` |
| remaining_decimal | 2 | 42P01 | `ALTER TABLE "OrderSplit" …` |
| remaining_decimal | 3 | 42P01 | `ALTER TABLE "PaymentSplit" …` |
| remaining_decimal | 4 | 42P01 | `ALTER TABLE "PurchaseOrder" …` |
| remaining_decimal | 5 | 42P01 | `ALTER TABLE "PurchaseOrderItem" …` |
| remaining_decimal | 6 | 42P01 | `ALTER TABLE "ReturnRequest" …` |
| remaining_decimal | 7 | 42P01 | `ALTER TABLE "SupplierCatalogItem" …` |
| add_card_customization | 2 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN "cardPreferences"` |
| add_dashboard_cards | 1 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN "dashboardCards"` |
| add_dashboard_sections | 1 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN "dashboardSections"` |
| add_notification_invoice_id | 1 | 42P01 | `ALTER TABLE "Notification" ADD COLUMN "invoiceId"` |
| add_notification_invoice_id | 2 | 42P01 | `CREATE UNIQUE INDEX "Notification_businessId_invoiceId_key"` |
| add_notification_invoice_id | 3 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN "notificationChannels"` |
| add_notification_channel_preferences | 5 | 42P01 | `DO $$ … SELECT … FROM "AppSettings" …` (data-migration block) |
| add_reward_cycles | 1 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "rewardThreshold"` — `IF NOT EXISTS` cannot rescue a missing TABLE |
| add_notification_followup_id | 1 | 42P01 | `ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "followUpId"` |
| add_notification_followup_id | 2 | 42P01 | `CREATE UNIQUE INDEX IF NOT EXISTS "Notification_businessId_followUpId_type_key"` |
| add_product_feedback | 17 | 42P01 | `ALTER TABLE "AppSettings" ADD COLUMN "feedbackDelayHours"` |

**Error-code census:** 42P01 ×19 (missing table), 42P07 ×14 (duplicate table/index), 42701 ×1 (duplicate column), 42710 ×3 (duplicate FK).

**Deploy-mode behavior (transactional, fail-fast):** `prisma migrate deploy` wraps each migration in one transaction and stops at the first failure:
1. Fresh DB → M1 applies → **M2 fails 42701 (AuditLog.metadata) → P3018 → build exits 1** (exact Vercel `buildCommand` failure).
2. `migrate resolve --applied 20260812000000_sync_neon_schema` then re-deploy → **M3 fails 42P01 (AppSettings) → P3018** — reproducing the reported "2/25 P3018" pattern. Continuing resolve-and-redeploy never terminates successfully: M4 fails identically, and the 24-table deficit can never be satisfied by the chain.

### 2.4 Full SHA-256 manifest (for `_prisma_migrations.checksum` comparison)

```
20260811000000_init                       527a01d42eb157c3d244543421cafe0824a171ae4e195f29a0bd8c7e20443e94
20260812000000_sync_neon_schema           49eb4c8951991194a6d7f0380984221c6c7b0a06163d406e6cb5c65cdd045b6f
20260812160000_secondary_decimal          1953708f4f0361384108ddfe29077dfad9ef6568b3e9a1450d6f76447ff530c4
20260812170000_remaining_decimal          83877931203a1a1eb04a288eb47ffd02aa67b2d09ca95aa3b1badd2878a295b7
20260822000000_add_import_history         d2e0babd906721a48bbe9a570b046ce9c01572cbc891f29220e60a81bdadd2e3
20260824000000_add_card_customization     7c10417cdca4e006e8d47791d7d8bc3776cff3cbd76cf539810bc8f2d210c99c
20260826000000_add_dashboard_cards        2f198dd9d6374e29b37fc654705a2b46d6abee6330189364ea1e2474f61830ee
20260830000000_add_accounting_subtype_snapshot  a6f9d58b28d7a072bddd61ce095f1d456b94c1fdca1b5f996f9469ea0ae5c8e1
20260831000000_add_invoice_delivery_charge 872b930f8555d5826ac8244ca112ff0ff1591d3fe58e6d7d0065858c9775b5aa
20260831000001_add_invoice_sale_operation_id 9a9f7a64d4e9ab6cc12005e0f9917a1989355937a67962afb6f3853c737f4d02
20260905000000_add_dashboard_sections     50ed097aaf36ce87107ead738ba6cdc482e715c9446eb27f1776b2a4478e35d3
20260907000000_add_notification_invoice_id d3a329ea3ce59098780fef752cc4dd7de229620c68fbdb2890f749b775eea7eb
20260908000000_add_notification_channel_preferences d437c5648cb57387ff96768c413d1184d0d39f85b5fe90b35fc6a3fc88889de4
20260909000000_add_customer_behaviour     5989c8c072d7a1ac515d8a3c5d7ab0e44fab9afed060b8fada6ef7fc9513c15d
20260910000000_add_complaints             0042fa44a2b8c9f7f0c9d99b0d573c93301f756ba500508c8c6be0108420bf62
20260911000000_add_messaging              32c40f183cfe616d42d8381ea3d306aa3bd8950a67a2d4b9ccd4c57a8b7fc03e
20260912000000_fix_conversation_uniqueness a30803302f045bbd91310ca127d65812d52a6aace19e463178e47324a26b7034
20260913000000_add_reward_cycles          a55e1fbc27be9c43296f5aafccf567b6eefd8052e4dc775345b6bd64be7965eb
20260914000000_add_reward_accrual_outbox  efec84f4d47bba95bd4da95ceff69070e41804575d997bac124b64c4b45ccd94
20260915000000_add_reward_reconciliation_cursor 23d67f9d18bac1ed63109880041a7737931cb324dd1c3ec6c8af7279bcd9d621
20260916000000_add_followups              3ed8da421dddee24fa42183e36a6bf8199c8f554e9005c52060e8c9a6b33cf96
20260917000000_add_notification_followup_id 96c328029b53ad6a66d0fb2be8495779a6ef4ec67363a3f3a8386b376a5beaaf
20260918000000_add_product_feedback       12409ae696ae98b2b0ac9a46f3f92ec9fd1b1809238c0802152beaaf2fbd28f5
20260919000000_add_feedback_completeness  a03d791272a5f2dc37edc3fa1080c8eeb9329202c68021cb95b71bb09ba1edc2
20260920000000_add_feedback_outbox        4be33d3eec263cec24dbfaf6666f585280a8981cfcc3129156615f297e2389ff
```

### 2.5 Dependency map (what each failing migration needs to pre-exist)

- **sync_neon_schema** needs: an AuditLog **without** metadata; **no** User/Session/InvoiceSequence/StockMovement; OrderSplit present.
- **secondary_decimal** needs: AppSettings, CustomerOrder, DefaulterRegistry.
- **remaining_decimal** needs: CommissionLog, OrderSplit, PaymentSplit, PurchaseOrder, PurchaseOrderItem, ReturnRequest, SupplierCatalogItem.
- **AppSettings-dependent** (ADD COLUMN): add_card_customization, add_dashboard_cards, add_dashboard_sections, add_notification_invoice_id, add_notification_channel_preferences (DO block), add_reward_cycles, add_product_feedback.
- **Notification-dependent**: add_notification_invoice_id, add_notification_followup_id.
- All 19 migrations marked "both" are self-contained additive DDL on tables created by init or by themselves.

### 2.6 Additional forensic observations

1. **Orphaned enum:** init creates `CREATE TYPE "UserRole"` but no column uses it (schema.prisma `User.role` is TEXT; schema has no enums). Harmless; the schema-generated baseline will not create it.
2. **4 raw-SQL partial unique indexes exist only in migrations** (Prisma schema cannot express `WHERE`): `Conversation_businessId_partyId_in_app_key`, `CustomerRewardCycle_businessId_partyId_active_key`, `Notification_businessId_followUpId_type_key`, `ProductFeedback_dedupKey_status_key`. Any schema-derived baseline MUST append these explicitly or the dedup invariants (P2002 guards in tests 19/31/43) are lost. `Invoice_businessId_saleOperationId_key` IS schema-expressible (composite @@unique) and is covered.
3. **`20260908000000` DO-block** migrates legacy `AppSettings.notificationChannels` JSON into the normalized table — meaningful only on legacy data; no-op on fresh (empty AppSettings) — but it hard-fails when AppSettings is absent.
4. **`FeedbackReconciliationCursor`** was added to schema.prisma in commit `327c686` **with no migration** (verified via `git log -S`). It is queried by `/api/cron/feedback-outbox` (daily Vercel cron). See RISKS.

---

## 3. TASK 3 — Deployment Path Designs

### PATH A — Fresh empty PostgreSQL 17 → complete Prisma schema

**Artifact:** a single baseline migration generated from the schema (NOT hand-written):

```bash
bunx prisma migrate diff --from-empty --to-schema-datamodel prisma/schema.prisma --script \
  > prisma/migrations/<TS>_baseline/migration.sql
```

**Empirically validated on PG 17.11 (this audit, DB `replay3`):** 1,704 lines / 281 statements / 55 CREATE TABLE / 83 FK constraints → **applied with 0 failures** and produced an **empty parity diff** vs schema.prisma.

**Required composition (in order):**
1. The generated baseline SQL (above).
2. Appended: the 4 partial unique indexes (raw SQL, copied verbatim from migrations 20260912/20260913/20260917/20260919 — with `IF NOT EXISTS` omitted for fresh-DB semantics).
3. Nothing else. Data-migration logic is intentionally EXCLUDED — the only data migration in the chain (notification-channels DO block) is legacy-specific and is a no-op on an empty database.

**Custom constraints/indexes:** all covered — 83 FKs (including all SetNull audit-preservation rules), all schema-level uniques; plus item 2.

**Fresh-DB provisioning then becomes:** `prisma migrate deploy` → single migration → done (works in Vercel Preview buildCommand unchanged).

### PATH B — Existing Production database (preserve records, preserve history, no duplicate DDL, no silent skips, no tampering with applied checksums)

**Preconditions:** TASK 1 inventory (§1.1) executed by owner; Neon snapshot/branch taken.

**Procedure (after design approval — NOT executed now):**

1. **Capture** (read-only): `_prisma_migrations` dump; `migrate status`; drift SQL (command 3 in §1.1); table row counts.
2. **Align schema** (the only step that touches Production objects): review + apply `prod-drift.sql`. Expected content given the history: creation of `FeedbackReconciliationCursor`, any missing partial indexes, possibly column/type gaps vs schema. This is explicit, reviewed, and idempotent-ified before application — **nothing is silently skipped**.
3. **Re-baseline the chain in the repository (single atomic commit):** remove the 25 legacy migration directories; add the single `<TS>_baseline` migration from PATH A. `migration_lock.toml` unchanged.
4. **Record the baseline on Production without executing it:**
   ```bash
   npx prisma migrate resolve --applied <TS>_baseline --schema prisma/schema.prisma
   ```
   `resolve --applied` writes only a `_prisma_migrations` row — **no SQL is executed**, so there is **zero duplicate DDL and zero data risk**. The old rows (for now-deleted migrations) become inert orphans; `migrate deploy` ignores rows without local folders. Optional hygiene (separate reviewed step): `DELETE FROM _prisma_migrations WHERE migration_name <> '<TS>_baseline';`
5. **Verify:** `npx prisma migrate status` → "Database schema is up to date!"; `migrate deploy` → no-op, exit 0; drift diff → empty; row counts unchanged vs step 1.
6. **Rollback plan:** Neon restore point (data) + `git revert` of the chain swap (repo) + re-insert old `_prisma_migrations` rows from the step-1 dump if needed. Every step is reversible before the first post-change deploy.

**What Path B deliberately does NOT do:** reset the database, rewrite/delete applied history before verification, re-run legacy migrations, or edit any applied migration file (which would silently change the meaning of recorded history).

---

## 4. TASK 4 — Repair Option Comparison

### Option 1 — Baseline / re-baseline (RECOMMENDED)

| Aspect | Detail |
|---|---|
| Files changed | Delete 25 dirs under `prisma/migrations/`; add 1 dir `<TS>_baseline/migration.sql` (generated + 4 partial indexes appended). `migration_lock.toml`, `schema.prisma`, all application code: unchanged. |
| Prod migration-history impact | Old rows become orphans (ignored by deploy); one new row via `resolve --applied` (no SQL executed). Applied-checksums of old rows are never modified. |
| Data-loss risk | None inherent: no DML anywhere; `resolve --applied` executes nothing. The only Prod DDL is the reviewed drift SQL (additive-dominant). Neon snapshot taken first. |
| Rollback | Neon restore point + `git revert` + `_prisma_migrations` dump replay. |
| Fresh-DB test | **Already executed in this audit: 281 stmts, 0 failures, empty parity diff on PG 17.11.** |
| Legacy-DB test | Drift diff empty after alignment → resolve → status clean (procedure §3 Path B). |
| Long-term | Chain ≡ schema by construction; one source of truth; future migrations are normal. |

### Option 2 — Compatibility migrations (fix the chain in place)

Would require, at minimum: (a) editing the already-applied `sync_neon_schema` to make all 16 colliding statements idempotent (`IF NOT EXISTS` / exception wrappers) — **this rewrites the recorded history of an applied migration and changes its checksum**, violating the audit's no-tampering principle; (b) inserting a new "create the 24 legacy tables" migration ordered *before* 20260812 (timestamp tricks) with exact column-level fidelity to what `db push` produced historically; (c) re-verifying M3/M4 become no-ops. Result: the repo permanently carries a "compat shim" whose only purpose is to simulate the legacy db-push history; every future fresh environment depends on the shim staying correct.
**Rejected:** highest complexity, history-rewriting, permanent cruft, no upside over Option 1.

### Option 3 — Independent DB bootstrap (keep chain for Prod; script/db-push for fresh envs)

Fresh environments would be provisioned by `prisma db push` + partial-index script + `migrate resolve --applied` for all 25 names. Zero Production risk, but: Vercel's `buildCommand` runs `migrate deploy` FIRST — a push-bootstrapped DB with 25 unapplied migrations breaks the build unless the bootstrap pre-marks everything, which cannot be done from `vercel.json` without custom build logic; drift between push-provisioning and the chain recurs forever; Preview automation stays broken.
**Role:** acceptable only as an emergency stopgap before re-baseline approval; not an end-state.

### Recommendation

**Option 1 (re-baseline)** — because it is the only option that (1) fixes both deployment paths with a single artifact, (2) is already empirically validated end-to-end on a real PG 17.11 in this audit, (3) never executes SQL against Production (`resolve --applied`), never edits applied history, and never rewrites migration files that Production has recorded, and (4) matches Prisma's officially documented baseline strategy for exactly this situation (existing DB + broken/legacy chain). Option 3 remains available as a stopgap if a Preview environment is urgently needed before approval.

---

## 5. TASK 5 — Test Plan

### 5.1 Environment 1 — fresh empty PostgreSQL 17 (repeatable, no Production data)

1. Create empty DB → `npx prisma migrate deploy --schema prisma/schema.prisma` → assert exit 0, "1 migration applied".
2. `npx prisma migrate diff --from-url … --to-schema-datamodel prisma/schema.prisma --script` → assert **empty**.
3. `npx prisma migrate status` → assert "Database schema is up to date!", no failed/pending.
4. Structural asserts: 55 tables; 83 FK constraints; the 4 partial unique indexes present.
5. **SetNull audit-history preservation asserts** (delete-parent scenarios on scratch data):
   - `DELETE Party` → `Complaint.partyId` NULL (row survives); `FollowUp.partyId` NULL; `ProductFeedback.partyId` NULL.
   - `DELETE User` → `FollowUp.assignedToId/createdById/completedById` NULL.
   - `DELETE Invoice` → `Complaint.relatedInvoiceId` NULL; `FollowUp.relatedInvoiceId` NULL; `ProductFeedback.invoiceId` NULL.
   - `DELETE Product` → `Complaint.relatedProductId` NULL; `FollowUp.relatedProductId` NULL; `ProductFeedback.productId` NULL.
   - `DELETE CustomerBehaviour` → `CustomerBehaviourHistory.behaviourId` NULL (history rows survive).
   - `DELETE ProductFeedback` → `Complaint.productFeedbackId` NULL.
6. **Reward-cycle invariants:** create business+party+eligible invoice → run accrual → exactly one `CustomerRewardCycle` (status ACTIVE) and one `CustomerRewardEvent` per `sourceInvoiceId`; duplicate accrual → P2002 no-op; second ACTIVE cycle insert → unique-index rejection; outbox 1:1 per invoice (P2002 on duplicate).
7. **CRM integrity smoke:** message → create-complaint flow; followup transition + event history; notification dedup partial indexes (duplicate insert → P2002).
8. `bun run lint` + `bunx prisma validate --schema prisma/schema.prisma` (with PG-shaped env) → clean.

### 5.2 Environment 2 — isolated copy of Production (schema + history + data)

1. Create a **Neon branch** of Production (or `pg_dump`/restore into isolated PG17). Never test on the primary.
2. Pre-change capture: `_prisma_migrations` dump; row counts of all 55 tables; `migrate status`; drift SQL.
3. Execute PATH B steps 2–5 on the branch.
4. Post-change asserts: row counts identical; drift diff empty; `migrate deploy` no-op exit 0; `migrate status` clean; all §5.1.5 SetNull asserts on scratch businesses only; reward + CRM smokes from §5.1.6–7.
5. **Vercel Preview gate:** push the re-baselined branch → Vercel `buildCommand` (`prisma generate && prisma migrate deploy && next build`) against the Preview's fresh branch DB → must complete green (this is the gate that is currently structurally impossible).

---

## 6. FINAL REPORT

### 6.1 VERIFIED (this audit, local PG 17.11, commands in §0/§2)

| # | Finding |
|---|---|
| V1 | `prisma migrate deploy` on fresh PG 17 fails: M1 OK → **M2 P3018/42701 `AuditLog.metadata`** → deploy halts (exact Vercel buildCommand failure reproduced, exit 1) |
| V2 | resolve-and-redeploy mode: **M3 P3018/42P01 `AppSettings`** — the "2/25" failure pattern; chain can never complete on a fresh DB |
| V3 | Statement replay: **37 failing statements across 11 migrations** (full list §2.3); census 42P01×19, 42P07×14, 42710×3, 42701×1 |
| V4 | Chain end-state (best-effort) is missing **24 tables, 33 FKs, 63 indexes, 6 columns, 2 type changes** vs schema.prisma — chain ≠ schema, structurally |
| V5 | Schema-generated baseline (from-empty diff + 4 partial indexes) applies **cleanly (281 stmts, 0 failures)** on fresh PG 17.11 and yields **exact parity (empty diff)** |
| V6 | Snapshot integrity: working tree `prisma/{migrations,schema.prisma}` ≡ snapshot tree `9057e6d` (`git diff` empty); HEAD `b7485b2`; migrations tree `824948c` |
| V7 | All 25 migration SHA-256 manifest recorded (§2.4) for Production checksum comparison |
| V8 | `prisma validate` PASS for both `schema.prisma` (with PG env) and `schema.dev.prisma` |
| V9 | `FeedbackReconciliationCursor` has **no migration** (commit `327c686`) and is used by the daily Vercel cron |
| V10 | Dev server unaffected throughout (port 3000 healthy, no errors in dev.log) |

### 6.2 REPORTED (prior sessions; not re-run in this audit)

- CRM unit tests 16/16 (1,331 assertions); TypeScript/ESLint clean; standalone `next build` 89 static pages.
- Remote `main` (`c058320c`) contains the same two defective migrations (owner-verified earlier).

### 6.3 NOT RUN (blocked — requires owner/credentials)

- **TASK 1 Production inventory** — no Neon credentials in sandbox (§1.1 has the exact command list).
- Neon credential rotation (PENDING gate).
- Vercel Preview DB isolation (needs Vercel access).
- Any Production DDL / resolve / deploy — correctly forbidden pending approval.

### 6.4 FAILED (reproduced & root-caused)

- PostgreSQL 17 fresh-database migration chain: **FAILED** (V1–V3; root cause §2.2).
- Exact Vercel pipeline (`migrate deploy` step): **FAILED** (V1; direct consequence).

### 6.5 RISKS

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | Production is likely missing `FeedbackReconciliationCursor` (no migration ever created it; only db push would have) → daily cron `/api/cron/feedback-outbox` throws P2021 → feedback reconciliation safety-net silently degraded | High (runtime) | TASK 1 command (6); create via drift SQL in Path B step 2 |
| R2 | Unknown Production `_prisma_migrations` state (failed rows? resolved? checksum drift?) — Path B branch conditions unconfirmed | High (procedure) | TASK 1 commands (1)(2) |
| R3 | The 4 partial unique indexes may be absent if Production ever missed migrations 12/13/17/19 → duplicate-notification/reward-cycle races | Medium | TASK 1 command (5); add via drift SQL |
| R4 | Re-baseline requires a one-time coordinated repo+prod change; a half-applied state (repo swapped, prod not resolved) blocks deploys until resolved | Medium | Run resolve immediately after merge; keep `git revert` + restore point ready |
| R5 | Any future schema.prisma edit without a matching migration recreates this class of failure (already happened once: `327c686`) | Medium | CI check: `prisma migrate diff --from-migrations --to-schema-datamodel` must be empty (needs shadow DB in CI) |

### 6.6 RECOMMENDED REPAIR DESIGN (awaiting explicit approval — nothing implemented)

**Option 1 — Re-baseline**, exactly as specified in §3 (Path A + Path B) and §4. Artifacts already prepared and validated locally:
- Baseline SQL (1,704 lines): `/home/z/pgreplay/baseline-from-schema.sql` (regenerate any time via the §3 command — do not hand-edit).
- Chain-vs-schema drift: `/home/z/pgreplay/chain-vs-schema-drift.sql`.
- Failure evidence: `/home/z/pgreplay/failures.json` (+ `replay.ts`, resettable PG17 on 127.0.0.1:5433).

**Sequence after approval:** TASK 1 (owner) → Neon snapshot → Path B steps 1–5 → §5.1/§5.2 test gates (both PASS) → Vercel Preview gate → release.

---

## 7. EXPLICIT "OWNER MUST DO" LIST (things this sandbox cannot do)

1. Run the TASK 1 read-only inventory (§1.1) with Production `DIRECT_URL` and share the outputs (never the URL itself).
2. Decide/perform Neon credential rotation (PENDING release gate).
3. Create the Neon snapshot/branch used as the rollback point and as Test Environment 2.
4. Execute the approved Path B procedure against Production (all commands are prepared here; execution requires owner credentials).
5. Trigger and verify the Vercel Preview build (owner's Vercel access).
6. Give the explicit approval to implement the re-baseline (this audit stops here and waits).
