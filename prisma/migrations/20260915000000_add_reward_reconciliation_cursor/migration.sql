-- §STEP7A-REWARD-RECONCILIATION-CURSOR: Durable progress marker for
-- incremental historical reconciliation.
--
-- §ADDITIVE: Only CREATE TABLE + CREATE INDEX. No destructive ops.
--
-- §PURPOSE: enables a full historical walk of eligible invoices. Each cron
-- run processes the next bounded batch starting from (lastCreatedAt, lastInvoiceId),
-- advancing forward through ALL eligible invoice history. When the cursor
-- reaches the newest invoice, the next run wraps back to the oldest (cyclic).
--
-- §INVARIANT: businessId is @unique — exactly one cursor per business.

-- CreateTable: RewardReconciliationCursor
CREATE TABLE "RewardReconciliationCursor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lastCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInvoiceId" TEXT NOT NULL DEFAULT '',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RewardReconciliationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one cursor per business
CREATE UNIQUE INDEX "RewardReconciliationCursor_businessId_key" ON "RewardReconciliationCursor"("businessId");

-- CreateIndex: lookup by businessId
CREATE INDEX "RewardReconciliationCursor_businessId_idx" ON "RewardReconciliationCursor"("businessId");

-- AddForeignKey: business cascade (matches other reward models)
ALTER TABLE "RewardReconciliationCursor" ADD CONSTRAINT "RewardReconciliationCursor_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
