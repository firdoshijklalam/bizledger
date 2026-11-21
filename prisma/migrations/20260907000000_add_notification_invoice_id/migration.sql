-- §NOTIFICATION-DEDUP: Add invoiceId column + unique constraint to Notification.
--
-- §ROOT-CAUSE: Sale notifications were deduplicated using a heuristic (timestamp
-- proximity + party name matching). This could suppress legitimate second sales
-- from the same customer within 2 seconds, or fail to dedup retries that arrived
-- after 2 seconds.
--
-- §FIX: Add invoiceId column to Notification. Sale notifications store the
-- invoice ID that triggered them. A unique constraint on (businessId, invoiceId)
-- ensures at most ONE sale notification per invoice — even under concurrent
-- racing requests. Non-sale notifications have invoiceId=NULL (the unique
-- constraint allows multiple NULLs).
--
-- Also adds notificationChannels column to AppSettings (from previous commit
-- that was pushed to schema.prisma but never migrated).

-- AlterTable: Add invoiceId to Notification
ALTER TABLE "Notification" ADD COLUMN "invoiceId" TEXT;

-- CreateIndex: Unique constraint on (businessId, invoiceId)
-- NULL values are allowed (non-sale notifications have no invoiceId).
-- PostgreSQL treats NULL as distinct, so multiple NULLs are allowed.
CREATE UNIQUE INDEX "Notification_businessId_invoiceId_key" ON "Notification"("businessId", "invoiceId");

-- AlterTable: Add notificationChannels to AppSettings
ALTER TABLE "AppSettings" ADD COLUMN "notificationChannels" TEXT;
