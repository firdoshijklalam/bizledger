-- §STEP7-REWARD-ACCRUAL-OUTBOX: Durable work record for reward accrual.
--
-- §ADDITIVE: Only CREATE TABLE + CREATE INDEX. No destructive ops.
--
-- §PURPOSE: closes the fire-and-forget gap. When an eligible sale invoice
-- commits, a matching outbox row is created IN THE SAME db.$transaction.
-- This guarantees: if the invoice committed, there is a durable record of
-- the reward-accrual work that must eventually be done.
--
-- §INVARIANT: invoiceId is @unique — exactly one outbox row per invoice.
--   This makes reconciliation idempotent (creating a duplicate for an
--   invoice that already has a row hits P2002 → no-op).
--
-- §STATUSES: PENDING | PROCESSING | COMPLETED | FAILED | PERMANENTLY_FAILED
--   (stored as TEXT; application enforces the enum)

-- CreateTable: RewardAccrualOutbox
CREATE TABLE "RewardAccrualOutbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RewardAccrualOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 1:1 invariant — exactly one outbox row per invoice
CREATE UNIQUE INDEX "RewardAccrualOutbox_invoiceId_key" ON "RewardAccrualOutbox"("invoiceId");

-- CreateIndex: cron drain query — find PENDING/FAILED rows by backoff
CREATE INDEX "RewardAccrualOutbox_status_lastAttemptAt_idx" ON "RewardAccrualOutbox"("status", "lastAttemptAt");

-- CreateIndex: tenant-scoped queries
CREATE INDEX "RewardAccrualOutbox_businessId_status_idx" ON "RewardAccrualOutbox"("businessId", "status");

-- AddForeignKey: business cascade (matches CustomerRewardCycle/CustomerRewardEvent pattern)
ALTER TABLE "RewardAccrualOutbox" ADD CONSTRAINT "RewardAccrualOutbox_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
