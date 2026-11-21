-- §FEEDBACK-OUTBOX: Durable work record for post-purchase product feedback
-- request creation. Mirrors the RewardAccrualOutbox pattern (Step 7 reliability
-- layer) — closes the fire-and-forget gap on the feedback side.
--
-- §ADDITIVE: Only CREATE TABLE + CREATE INDEX + ADD FOREIGN KEY. No destructive ops.
--
-- §PURPOSE: when an eligible sale invoice commits, a matching outbox row is
-- created IN THE SAME db.$transaction as the invoice. This guarantees: if the
-- invoice committed, there is a durable record of the feedback work that must
-- eventually be done. A fire-and-forget post-commit call processes it
-- immediately; a cron recovers any missed rows.
--
-- §INVARIANT: invoiceId is @unique — exactly one outbox row per invoice.
--   This makes reconciliation idempotent (creating a duplicate for an
--   invoice that already has a row hits P2002 → no-op).
--
-- §PARTY: partyId is the customer who will be asked for feedback (copied from
--   the invoice at creation time). null for walk-in sales — but the eligibility
--   gate already requires partyId, so the row is only created when partyId is
--   non-null at the invoice-service gate.
--
-- §PRODUCTIDS: JSON-stringified array of unique productIds (deterministic,
--   first-appearance order). null/empty when no product-backed items exist
--   (a single generic feedback record is created).
--
-- §STATUSES: PENDING | PROCESSING | COMPLETED | FAILED | PERMANENTLY_FAILED
--   (stored as TEXT; application enforces the enum)

-- CreateTable: FeedbackOutbox
CREATE TABLE "FeedbackOutbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "partyId" TEXT,
    "productIds" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FeedbackOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: 1:1 invariant — exactly one outbox row per invoice
CREATE UNIQUE INDEX "FeedbackOutbox_invoiceId_key" ON "FeedbackOutbox"("invoiceId");

-- CreateIndex: cron drain query — find PENDING/FAILED rows by backoff
CREATE INDEX "FeedbackOutbox_status_lastAttemptAt_idx" ON "FeedbackOutbox"("status", "lastAttemptAt");

-- CreateIndex: tenant-scoped queries
CREATE INDEX "FeedbackOutbox_businessId_status_idx" ON "FeedbackOutbox"("businessId", "status");

-- AddForeignKey: business cascade (matches RewardAccrualOutbox pattern)
ALTER TABLE "FeedbackOutbox" ADD CONSTRAINT "FeedbackOutbox_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: invoice cascade — keeps the outbox + invoice lifecycle in sync
-- (deleting an invoice also deletes its outbox row, mirroring the 1:1 invariant)
ALTER TABLE "FeedbackOutbox" ADD CONSTRAINT "FeedbackOutbox_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
