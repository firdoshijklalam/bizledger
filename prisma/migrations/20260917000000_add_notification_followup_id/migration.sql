-- §STEP8FB-NOTIFICATION-FOLLOWUP-ID: Add followUpId to Notification + partial
-- unique index for follow-up reminder dedup.
--
-- §ADDITIVE: Only ALTER TABLE ADD COLUMN + CREATE UNIQUE INDEX. No destructive ops.
--
-- §DEDUP-INVARIANT: UNIQUE(businessId, followUpId, type) WHERE followUpId IS NOT NULL.
-- This allows a follow-up to have BOTH a 'followup_due_soon' AND a
-- 'followup_overdue' notification (different type values), while preventing
-- duplicates of the SAME type. NULL followUpId rows are excluded (non-follow-up
-- notifications like sale, custom-price, system are unaffected).

-- Add followUpId column (nullable — NULL for non-follow-up notifications)
ALTER TABLE "Notification" ADD COLUMN IF NOT EXISTS "followUpId" TEXT;

-- Partial unique index: one notification per (businessId, followUpId, type)
-- WHERE followUpId IS NOT NULL.
-- Same raw-SQL pattern as CustomerRewardCycle_businessId_partyId_active_key
-- (Prisma cannot express WHERE clauses on @@unique).
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_businessId_followUpId_type_key"
  ON "Notification"("businessId", "followUpId", "type")
  WHERE "followUpId" IS NOT NULL;
