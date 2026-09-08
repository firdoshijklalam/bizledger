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
-- (JSON) are migrated into the new table. The old column is NOT dropped
-- (kept for backward compat — the invoice route reads it as a fallback
-- during the transition period).

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

-- §DATA-MIGRATION: Migrate existing preferences from AppSettings.notificationChannels JSON
-- into the new normalized table. This is a best-effort migration — if the JSON
-- is missing or malformed, defaults (all enabled) are used.
-- This uses a DO block with exception handling for safety.
DO $$
DECLARE
    settings_record RECORD;
    channels_json TEXT;
    ch RECORD;
BEGIN
    FOR settings_record IN SELECT "businessId", "notificationChannels" FROM "AppSettings" WHERE "notificationChannels" IS NOT NULL LOOP
        channels_json := settings_record."notificationChannels";
        BEGIN
            FOR ch IN SELECT * FROM json_each(channels_json) LOOP
                -- Only migrate known boolean values
                IF ch.key IN ('sales', 'lowStock', 'overduePayments', 'gradeChanges', 'backups')
                   AND typeof(ch.value) = 'integer' THEN
                    -- Insert or ignore (if already exists, keep existing)
                    INSERT INTO "NotificationChannelPreference" ("id", "businessId", "key", "enabled", "createdAt", "updatedAt")
                    VALUES (gen_random_uuid(), settings_record."businessId", ch.key, CAST(ch.value AS BOOLEAN), NOW(), NOW())
                    ON CONFLICT ("businessId", "key") DO NOTHING;
                END IF;
            END LOOP;
        EXCEPTION WHEN OTHERS THEN
            -- Malformed JSON — skip, defaults will apply
            NULL;
        END;
    END LOOP;
END $$;
