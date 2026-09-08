-- §CUSTOMER-BEHAVIOUR: Add CustomerBehaviour + CustomerBehaviourHistory tables.
--
-- §CONTEXT: These models were added to prisma/schema.prisma in a prior commit
-- but no production migration existed — deploying HEAD without this migration
-- would cause runtime "relation CustomerBehaviour does not exist" errors.
-- This migration creates both tables from scratch.
--
-- §SETNULL-INVARIANT: CustomerBehaviourHistory.behaviourId is NULLABLE +
-- ON DELETE SET NULL (NOT CASCADE). This preserves the APPEND-ONLY AUDIT
-- invariant: if the current CustomerBehaviour row is deleted (future "reset
-- behaviour" feature, or party cascade), the historical snapshot rows MUST
-- survive — they are the audit trail. Deleting the current row sets
-- history.behaviourId = NULL, but the snapshot data (rating, tags, notes,
-- ratedBy, partyId, businessId) is fully retained.
-- This follows the existing codebase convention: Transaction.party?
-- @relation(... onDelete: SetNull) and Transaction.invoice? @relation(...
-- onDelete: SetNull) both use SetNull for child rows that must survive
-- parent deletion.
--
-- §PARTY-DELETE: CustomerBehaviourHistory.party uses ON DELETE CASCADE —
-- deleting a Party DOES cascade-delete their behaviour history. This is a
-- KNOWN consequence of the current minimal design. If the product later
-- requires history to survive party deletion too (like AuditLog does),
-- partyId should become nullable + SetNull in a follow-up migration.
--
-- §ADDITIVE-ONLY: This migration only CREATEs tables + indexes + FKs. No
-- existing table is altered. No data is migrated. No destructive operations.

-- CreateTable: CustomerBehaviour (current behaviour, one row per party per business)
CREATE TABLE "CustomerBehaviour" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "tags" TEXT,
    "notes" TEXT,
    "ratedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerBehaviour_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CustomerBehaviourHistory (append-only audit trail)
CREATE TABLE "CustomerBehaviourHistory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "behaviourId" TEXT,
    "rating" TEXT NOT NULL,
    "tags" TEXT,
    "notes" TEXT,
    "ratedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBehaviourHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: CustomerBehaviour lookups
CREATE INDEX "CustomerBehaviour_businessId_idx" ON "CustomerBehaviour"("businessId");

CREATE INDEX "CustomerBehaviour_partyId_idx" ON "CustomerBehaviour"("partyId");

CREATE INDEX "CustomerBehaviour_businessId_partyId_idx" ON "CustomerBehaviour"("businessId", "partyId");

-- CreateIndex: Unique constraint — one current behaviour per party per business
CREATE UNIQUE INDEX "CustomerBehaviour_businessId_partyId_key" ON "CustomerBehaviour"("businessId", "partyId");

-- CreateIndex: CustomerBehaviourHistory lookups
CREATE INDEX "CustomerBehaviourHistory_businessId_partyId_createdAt_idx" ON "CustomerBehaviourHistory"("businessId", "partyId", "createdAt");

CREATE INDEX "CustomerBehaviourHistory_behaviourId_createdAt_idx" ON "CustomerBehaviourHistory"("behaviourId", "createdAt");

CREATE INDEX "CustomerBehaviourHistory_partyId_createdAt_idx" ON "CustomerBehaviourHistory"("partyId", "createdAt");

-- AddForeignKey: CustomerBehaviour → Business (cascade delete)
ALTER TABLE "CustomerBehaviour" ADD CONSTRAINT "CustomerBehaviour_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CustomerBehaviour → Party (cascade delete)
ALTER TABLE "CustomerBehaviour" ADD CONSTRAINT "CustomerBehaviour_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CustomerBehaviourHistory → CustomerBehaviour (SET NULL — preserves audit trail)
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_behaviourId_fkey" FOREIGN KEY ("behaviourId") REFERENCES "CustomerBehaviour"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: CustomerBehaviourHistory → Business (cascade delete)
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: CustomerBehaviourHistory → Party (cascade delete — see §PARTY-DELETE note above)
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
