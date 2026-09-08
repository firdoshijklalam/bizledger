-- §NOTIFICATION-CHANNEL-PREFERENCES: Normalized per-channel preference table.
--
-- §ROOT-CAUSE: The old approach stored all channel preferences as a single
-- JSON string in AppSettings.notificationChannels. Updates required a
-- read-modify-write cycle (read JSON → parse → mutate one key → stringify →
-- write back). Two concurrent requests could both read the same old JSON
-- and overwrite each other's changes.
--
-- §FIX: Each channel is now a separate row in NotificationChannelPreference.
-- Updates to one channel use Prisma's upsert which is a single SQL statement
-- (INSERT ... ON CONFLICT UPDATE) — no read-modify-write, no race.
--
-- §DATA-MIGRATION: Old preferences stored in AppSettings.notificationChannels
-- (JSON string) are migrated into the new table. The old column is NOT dropped
-- (kept for backward compat during transition).
--
-- §POSTGRESQL-SAFE: This migration uses only standard PostgreSQL features.
-- No pgcrypto / gen_random_uuid() dependency. Row IDs are deterministic TEXT
-- values of the form 'mcp_<businessId>_<key>' (see §ID-GENERATION below).
--
-- §IDEMPOTENCY: The DDL statements (CREATE TABLE / CREATE INDEX / ALTER TABLE)
-- are NOT idempotent — re-running this migration against a database where the
-- table already exists will fail. Only the DATA-MIGRATION block (the DO block)
-- is safe to re-run: it uses ON CONFLICT DO NOTHING with deterministic ids, so
-- re-running it for the same data is a no-op. In production, Prisma's migrate
-- deploy tracks applied migrations in the _prisma_migrations table and never
-- re-runs an applied migration — so this is not a concern in normal operation.

-- CreateTable: NotificationChannelPreference
CREATE TABLE "NotificationChannelPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannelPreference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Unique constraint on (businessId, key)
CREATE UNIQUE INDEX "NotificationChannelPreference_businessId_key_key" ON "NotificationChannelPreference"("businessId", "key");

-- CreateIndex: Index on businessId for efficient lookups
CREATE INDEX "NotificationChannelPreference_businessId_idx" ON "NotificationChannelPreference"("businessId");

-- AddForeignKey: businessId → Business.id (cascade delete)
ALTER TABLE "NotificationChannelPreference" ADD CONSTRAINT "NotificationChannelPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §DATA-MIGRATION: Migrate existing preferences from AppSettings.notificationChannels
-- (JSON string column) into the new normalized table.
--
-- The JSON string looks like: {"sales": false, "lowStock": true, ...}
-- We use PostgreSQL's jsonb parsing to extract each key-value pair and
-- insert it as a separate row.
--
-- §ID-GENERATION: The id is a deterministic concatenation:
--   "mcp_" || businessId || "_" || key
-- This avoids the pgcrypto / gen_random_uuid() extension dependency. The
-- id is unique because (businessId, key) is unique (enforced by the unique
-- index below), and it is stable across re-runs (deterministic — re-running
-- the data migration for the same (businessId, key) targets the same id).
--
-- §MALFORMED-JSON-SAFETY: Each business's notificationChannels value is
-- processed independently. Two failure modes are handled PER-BUSINESS so
-- they never abort the migration for other businesses:
--   1. Malformed JSON syntax (e.g. '{"sales": true') — the TEXT::jsonb cast
--      raises an exception, caught by the inner BEGIN/EXCEPTION/END →
--      CONTINUE (skip this business, defaults will apply).
--   2. Valid JSON that is NOT a JSON object (e.g. '[]', 'null', '"scalar"') —
--      jsonb_each_text() raises "cannot call jsonb_each_text on a non-object".
--      A jsonb_typeof() = 'object' guard skips non-object values BEFORE
--      calling jsonb_each_text(), so no exception is raised.
-- An empty object '{}' passes the typeof check and yields 0 rows (no-op).
DO $$
DECLARE
    settings_record RECORD;
    channels_text TEXT;
    channels_jsonb jsonb;
    ch_key TEXT;
    ch_val TEXT;
BEGIN
    FOR settings_record IN
        SELECT "businessId", "notificationChannels"
        FROM "AppSettings"
        WHERE "notificationChannels" IS NOT NULL
          AND "notificationChannels" != ''
    LOOP
        channels_text := settings_record."notificationChannels";

        -- §PER-BUSINESS-EXCEPTION (syntax): Parse JSON for this business.
        -- If the text is not valid JSON syntax, skip this business — defaults
        -- will apply. This catches '{"sales": true' (missing closing brace)
        -- and similar syntax errors.
        BEGIN
            -- Cast TEXT → jsonb (validates JSON syntax)
            channels_jsonb := channels_text::jsonb;
        EXCEPTION WHEN OTHERS THEN
            -- Malformed JSON syntax — skip this business, continue with next
            CONTINUE;
        END;

        -- §OBJECT-TYPE-GUARD (semantic): jsonb_each_text() only accepts JSON
        -- objects. Valid-but-non-object JSON values ('[]', 'null', '"x"', '42')
        -- would raise "cannot call jsonb_each_text on a non-object" — which is
        -- NOT caught by the syntax-exception block above. Guard with
        -- jsonb_typeof() so non-object JSON is skipped silently (no channels
        -- to migrate). An empty object '{}' passes this guard and yields 0 rows.
        IF jsonb_typeof(channels_jsonb) = 'object' THEN
            -- §ITERATE-KEYS: Extract each known channel key from the JSON object.
            -- jsonb_each_text returns (key text, value text) pairs.
            FOR ch_key, ch_val IN
                SELECT * FROM jsonb_each_text(channels_jsonb)
            LOOP
                -- §VALIDATE: Only known keys with boolean values ('true'/'false'
                -- as text). Unknown keys and non-boolean values (numbers, nulls,
                -- arbitrary strings) are skipped.
                IF ch_key IN ('sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups')
                   AND ch_val IN ('true', 'false')
                THEN
                    -- §INSERT-OR-IGNORE: ON CONFLICT DO NOTHING preserves existing
                    -- rows. The id is deterministic ('mcp_<businessId>_<key>'), so a
                    -- re-run of the DATA-MIGRATION block (not the DDL — see header)
                    -- for the same (businessId, key) is a safe no-op.
                    INSERT INTO "NotificationChannelPreference" ("id", "businessId", "key", "enabled", "createdAt", "updatedAt")
                    VALUES (
                        'mcp_' || settings_record."businessId" || '_' || ch_key,
                        settings_record."businessId",
                        ch_key,
                        (ch_val = 'true'),
                        NOW(),
                        NOW()
                    )
                    ON CONFLICT ("businessId", "key") DO NOTHING;
                END IF;
            END LOOP;
        END IF;
    END LOOP;
END $$;
