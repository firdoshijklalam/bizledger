-- §COMPLAINTS: Add Complaint + ComplaintEvent + ComplaintSequence tables.
--
-- §CONTEXT: Implements the Complaint Management Foundation. Complaints are
-- independent entities (not copied message text) with their own lifecycle
-- (status, priority, assignment, resolution, event history).
--
-- §COMPLAINT-NUMBERING: ComplaintSequence provides a per-business atomic counter
-- (mirrors InvoiceSequence). upsert + { increment: 1 } inside a $transaction
-- guarantees unique sequential CMP-0001, CMP-0002 numbers even under concurrent
-- creation.
--
-- §SOURCE-REFERENCE: sourceType + sourceId are APPLICATION-LEVEL references
-- (no polymorphic DB FK). sourceId is a free-form String validated at the API
-- layer. This allows future MESSAGE/CALL/FEEDBACK sources without schema changes.
--
-- §SETNULL-INVARIANTS:
--   - Complaint.partyId: nullable + ON DELETE SET NULL (anonymous complaints +
--     party deletion preserves complaint history)
--   - Complaint.relatedInvoiceId: nullable + ON DELETE SET NULL (invoice deletion
--     preserves complaint)
--   - Complaint.relatedProductId: nullable + ON DELETE SET NULL (product deletion
--     preserves complaint)
--
-- §CASCADE: ComplaintEvent.complaintId is NOT nullable + ON DELETE CASCADE —
-- event history is tightly coupled to the complaint lifetime. The DELETE API
-- uses soft-archive (status=CLOSED) rather than hard-delete to preserve history.
--
-- §ADDITIVE-ONLY: This migration only CREATEs tables + indexes + FKs. No
-- existing table is altered. No data is migrated. No destructive operations.

-- CreateTable: ComplaintSequence (per-business atomic counter)
CREATE TABLE "ComplaintSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Complaint (independent complaint entity)
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "complaintNumber" TEXT NOT NULL,
    "partyId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedTo" TEXT,
    "relatedInvoiceId" TEXT,
    "relatedProductId" TEXT,
    "resolution" TEXT,
    "internalNotes" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ComplaintEvent (append-only audit trail)
CREATE TABLE "ComplaintEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: ComplaintSequence (one row per business)
CREATE UNIQUE INDEX "ComplaintSequence_businessId_key" ON "ComplaintSequence"("businessId");

-- CreateIndex: Complaint lookups + business-scoped uniqueness
CREATE INDEX "Complaint_businessId_status_idx" ON "Complaint"("businessId", "status");
CREATE INDEX "Complaint_businessId_partyId_idx" ON "Complaint"("businessId", "partyId");
CREATE INDEX "Complaint_businessId_assignedTo_idx" ON "Complaint"("businessId", "assignedTo");
CREATE INDEX "Complaint_businessId_priority_idx" ON "Complaint"("businessId", "priority");
CREATE INDEX "Complaint_businessId_createdAt_idx" ON "Complaint"("businessId", "createdAt");

-- CreateIndex: Unique constraint — business-scoped complaint number (CMP-0001 per business)
CREATE UNIQUE INDEX "Complaint_businessId_complaintNumber_key" ON "Complaint"("businessId", "complaintNumber");

-- CreateIndex: ComplaintEvent lookups
CREATE INDEX "ComplaintEvent_complaintId_createdAt_idx" ON "ComplaintEvent"("complaintId", "createdAt");
CREATE INDEX "ComplaintEvent_businessId_createdAt_idx" ON "ComplaintEvent"("businessId", "createdAt");

-- AddForeignKey: ComplaintSequence → Business (cascade delete)
ALTER TABLE "ComplaintSequence" ADD CONSTRAINT "ComplaintSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Complaint → Business (cascade delete)
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: Complaint → Party (SET NULL — preserves complaint on party deletion)
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Complaint → Invoice (SET NULL — preserves complaint on invoice deletion)
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: Complaint → Product (SET NULL — preserves complaint on product deletion)
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ComplaintEvent → Complaint (CASCADE — event history tied to complaint lifetime)
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ComplaintEvent → Business (cascade delete)
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
