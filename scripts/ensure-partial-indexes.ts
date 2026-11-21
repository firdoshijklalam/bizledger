/**
 * §ENSURE-PARTIAL-INDEXES — dev/test DB hardening guard.
 *
 * `prisma db push` (used by `bun run db:push` with schema.dev.prisma) applies
 * Prisma-managed tables/columns but SKIPS raw-SQL partial unique indexes —
 * they only live in prisma/migrations/*.sql. A DB recreated via db:push then
 * silently loses them, which broke test sections 19/31/43 (concurrent dedup
 * relies on P2002 from these indexes) and can allow duplicate rows in
 * production-shaped flows.
 *
 * This script is IDEMPOTENT: it checks sqlite_master first and only creates
 * what is missing (CREATE UNIQUE INDEX IF NOT EXISTS would also be fine, but
 * the explicit check reports what was missing — useful signal).
 *
 * The 4 indexes and their definitions mirror the migrations:
 *   - prisma/migrations/20260912* Conversation in-app dedup
 *   - prisma/migrations/20260913* CustomerRewardCycle active-cycle invariant
 *   - prisma/migrations/20260917* Notification dedup (businessId+followUpId+type)
 *   - prisma/migrations/20260919* ProductFeedback dedupKey dedup
 *
 * Usage: bunx tsx scripts/ensure-partial-indexes.ts
 * (exit 0 always unless the DB is unreachable — missing indexes get CREATED,
 * which is the fix, not a failure)
 */
import { db } from '../src/lib/db'

const INDEXES: Array<{ name: string; sql: string }> = [
  {
    name: 'Conversation_businessId_partyId_in_app_key',
    sql: `CREATE UNIQUE INDEX "Conversation_businessId_partyId_in_app_key"
ON "Conversation"("businessId", "partyId", "channel", "externalId") WHERE "app" = 1`,
  },
  {
    name: 'CustomerRewardCycle_businessId_partyId_active_key',
    sql: `CREATE UNIQUE INDEX "CustomerRewardCycle_businessId_partyId_active_key"
ON "CustomerRewardCycle"("businessId", "partyId") WHERE "status" = 'ACTIVE'`,
  },
  {
    name: 'Notification_businessId_followUpId_type_key',
    sql: `CREATE UNIQUE INDEX "Notification_businessId_followUpId_type_key"
ON "Notification"("businessId", "followUpId", "type") WHERE "followUpId" IS NOT NULL`,
  },
  {
    name: 'ProductFeedback_dedupKey_status_key',
    sql: `CREATE UNIQUE INDEX "ProductFeedback_dedupKey_status_key"
ON "ProductFeedback"("businessId", "dedupKey", "status") WHERE "status" IN ('scheduled', 'pending')`,
  },
]

async function main() {
  const existing = await db.$queryRawUnsafe<{ name: string }[]>
    (`SELECT name FROM sqlite_master WHERE type = 'index'`)
  const existingNames = new Set(existing.map((r) => r.name))

  let created = 0
  for (const idx of INDEXES) {
    if (existingNames.has(idx.name)) {
      console.log(`✓ ${idx.name} — already present`)
      continue
    }
    // Safety: creating a UNIQUE index fails if violating rows exist — surface
    // a clear message instead of a raw Prisma error.
    try {
      await db.$executeRawUnsafe(idx.sql)
      console.log(`+ ${idx.name} — CREATED (was missing)`)
      created++
    } catch (e) {
      console.error(`✗ ${idx.name} — could not create: ${String(e)}`)
      console.error(`  Check for duplicate rows violating the partial predicate first.`)
      process.exitCode = 1
    }
  }

  console.log(
    created === 0
      ? 'All 4 partial unique indexes present — nothing to do.'
      : `Created ${created} missing index(es). DB is now consistent with migrations.`
  )
}

main()
  .catch((e) => {
    console.error('Failed to connect to the database:', String(e))
    process.exitCode = 1
  })
// NOTE: no explicit $disconnect — SQLite's disconnect logs a benign
// "Response from the Engine was empty" prisma:error on this driver version;
// letting the process exit naturally is clean and silent.
