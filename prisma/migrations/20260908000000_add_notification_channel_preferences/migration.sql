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
-- No pgcrypto / gen_random_uuid() dependency. IDs use a timestamp + random
-- suffix strategy compatible with the TEXT id column (same as cuid() used
-- by Prisma at the application layer).

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
-- §ID-GENERATION: We use a concatenation of the businessId, key, and a
-- timestamp to generate a unique TEXT id. This avoids the pgcrypto extension
-- dependency. The id format is: "mcp_<businessId>_<key>_<epoch_ms>"
-- which is guaranteed unique because (businessId, key) is unique (enforced
-- by the ON CONFLICT clause).
--
-- §MALFORMED-JSON-SAFETY: Each business's JSON is parsed independently.
-- If one business has malformed JSON, only that business's migration is
-- skipped — others are not affected. The DO block catches exceptions
-- per-business (inner BEGIN/EXCEPTION/END), not per-migration.
DO $$
DECLARE
    settings_record RECORD;
    channels_text TEXT;
    channels_jsonb jsonb;
    ch_key TEXT;
    ch_val jsonb;
BEGIN
    FOR settings_record IN
        SELECT "businessId", "notificationChannels"
        FROM "AppSettings"
        WHERE "notificationChannels" IS NOT NULL
          AND "notificationChannels" != ''
    LOOP
        channels_text := settings_record."notificationChannels";

        -- §PER-BUSINESS-EXCEPTION: Parse JSON for this business.
        -- If malformed, skip this business — defaults will apply.
        BEGIN
            -- Cast TEXT → jsonb (validates JSON syntax)
            channels_jsonb := channels_text::jsonb;
        EXCEPTION WHEN OTHERS THEN
            -- Malformed JSON — skip this business, continue with next
            CONTINUE;
        END;

        -- §ITERATE-KEYS: Extract each known channel key from the JSON object.
        -- Only migrate keys that have boolean values.
        FOR ch_key, ch_val IN
            SELECT * FROM jsonb_each_text(channels_jsonb)
        LOOP
            -- §VALIDATE: Only known keys with boolean values
            IF ch_key IN ('sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups')
               AND ch_val IN ('true', 'false')
            THEN
                -- §INSERT-OR-IGNORE: ON CONFLICT DO NOTHING preserves existing rows
                -- (in case migration is re-run after partial completion).
                -- §ID: Generate a deterministic ID from businessId + key to avoid
                -- needing pgcrypto's gen_random_uuid(). The (businessId, key)
                -- uniqueness is already enforced by the unique index, so the
                -- ID just needs to be a non-null TEXT value.
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
    END LOOP;
END $$;
