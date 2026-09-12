-- §REWARD-CYCLES: Add CustomerRewardCycle + CustomerRewardEvent tables.
-- Also adds rewardThreshold column to AppSettings.
--
-- §ADDITIVE: Only CREATE TABLE + ADD COLUMN + CREATE INDEX. No destructive ops.

-- Add rewardThreshold to AppSettings (default ₹400)
ALTER TABLE "AppSettings" ADD COLUMN IF NOT EXISTS "rewardThreshold" DECIMAL(18,2) NOT NULL DEFAULT 400;

-- CreateTable: CustomerRewardCycle
CREATE TABLE "CustomerRewardCycle" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "threshold" DECIMAL(18,2) NOT NULL DEFAULT 400,
    "accumulatedProfit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "rewardGivenAt" TIMESTAMP(3),
    "rewardDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerRewardCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerRewardEvent
CREATE TABLE "CustomerRewardEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sourceInvoiceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerRewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: Cycle uniqueness + lookups
CREATE UNIQUE INDEX "CustomerRewardCycle_businessId_partyId_cycleNumber_key" ON "CustomerRewardCycle"("businessId", "partyId", "cycleNumber");
CREATE INDEX "CustomerRewardCycle_businessId_partyId_status_idx" ON "CustomerRewardCycle"("businessId", "partyId", "status");
CREATE INDEX "CustomerRewardCycle_businessId_status_idx" ON "CustomerRewardCycle"("businessId", "status");

-- CreateIndex: Event idempotency + lookups
CREATE UNIQUE INDEX "CustomerRewardEvent_businessId_sourceInvoiceId_key" ON "CustomerRewardEvent"("businessId", "sourceInvoiceId");
CREATE INDEX "CustomerRewardEvent_cycleId_createdAt_idx" ON "CustomerRewardEvent"("cycleId", "createdAt");
CREATE INDEX "CustomerRewardEvent_businessId_partyId_createdAt_idx" ON "CustomerRewardEvent"("businessId", "partyId", "createdAt");

-- AddForeignKey
ALTER TABLE "CustomerRewardCycle" ADD CONSTRAINT "CustomerRewardCycle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRewardCycle" ADD CONSTRAINT "CustomerRewardCycle_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CustomerRewardCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- §PARTIAL-UNIQUE: Only one ACTIVE cycle per (businessId, partyId).
-- Prisma cannot express WHERE clauses on @@unique, so this is raw SQL.
CREATE UNIQUE INDEX "CustomerRewardCycle_businessId_partyId_active_key"
  ON "CustomerRewardCycle"("businessId", "partyId")
  WHERE "status" = 'ACTIVE';
