-- §STEP8A-CUSTOMER-FOLLOWUP: Add FollowUp + FollowUpEvent + FollowUpSequence.
--
-- §ADDITIVE: Only CREATE TABLE + CREATE INDEX + ADD FOREIGN KEY. No destructive ops.
--
-- §ARCHITECTURE: mirrors the Complaint model (status + priority + assignment +
-- append-only FollowUpEvent audit trail + business-scoped sequence for
-- race-safe numbering). See prisma/schema.prisma for full design docs.

-- CreateTable: FollowUpSequence
CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: one sequence per business
CREATE UNIQUE INDEX "FollowUpSequence_businessId_key" ON "FollowUpSequence"("businessId");

-- CreateTable: FollowUp
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "followUpNumber" TEXT NOT NULL,
    "partyId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "outcome" TEXT,
    "relatedInvoiceId" TEXT,
    "relatedComplaintId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: business-scoped uniqueness for followUpNumber
CREATE UNIQUE INDEX "FollowUp_businessId_followUpNumber_key" ON "FollowUp"("businessId", "followUpNumber");

-- CreateIndex: planned query patterns
CREATE INDEX "FollowUp_businessId_status_idx" ON "FollowUp"("businessId", "status");
CREATE INDEX "FollowUp_businessId_partyId_idx" ON "FollowUp"("businessId", "partyId");
CREATE INDEX "FollowUp_businessId_assignedToId_idx" ON "FollowUp"("businessId", "assignedToId");
CREATE INDEX "FollowUp_businessId_priority_idx" ON "FollowUp"("businessId", "priority");
CREATE INDEX "FollowUp_businessId_dueAt_idx" ON "FollowUp"("businessId", "dueAt");
CREATE INDEX "FollowUp_businessId_type_idx" ON "FollowUp"("businessId", "type");
CREATE INDEX "FollowUp_businessId_createdAt_idx" ON "FollowUp"("businessId", "createdAt");

-- CreateTable: FollowUpEvent
CREATE TABLE "FollowUpEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: event history queries
CREATE INDEX "FollowUpEvent_followUpId_createdAt_idx" ON "FollowUpEvent"("followUpId", "createdAt");
CREATE INDEX "FollowUpEvent_businessId_createdAt_idx" ON "FollowUpEvent"("businessId", "createdAt");

-- AddForeignKey: FollowUpSequence → Business
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FollowUp → Business (Cascade)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FollowUp → Party (SetNull — preserve history when party deleted)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUp.assignedToId → User (SetNull — 3 named relations)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUp.createdById → User (SetNull)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUp.completedById → User (SetNull)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_completedById_fkey"
  FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUp.relatedInvoiceId → Invoice (SetNull)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedInvoiceId_fkey"
  FOREIGN KEY ("relatedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUp.relatedComplaintId → Complaint (SetNull)
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedComplaintId_fkey"
  FOREIGN KEY ("relatedComplaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: FollowUpEvent → FollowUp (Cascade — history tied to follow-up lifetime)
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_followUpId_fkey"
  FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: FollowUpEvent → Business (Cascade)
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
