-- §PRODUCT-FEEDBACK: Add first-class Product Feedback system.
--
-- §ADDITIVE: only CREATE TABLE + ALTER TABLE ADD COLUMN + ADD FOREIGN KEY +
-- CREATE INDEX. No destructive ops. No drops, no renames, no type changes.
--
-- §ARCHITECTURE: a ProductFeedback record represents a SCHEDULED request for a
-- customer to leave feedback (rating + comment) after a purchase. It links to
-- a Party (required at app layer) + optional Product/Invoice + a system-created
-- FollowUp reminder (FollowUp.type='product_feedback', sourceType='SYSTEM_CREATED',
-- sourceId=<productFeedback.id>). Complaint.productFeedbackId is the reverse
-- link for escalations (POST /api/feedback/[id]/complaint).
--
-- §TENANT-ISOLATION: businessId comes from the authenticated session, never
-- from the client body. All indexes are business-scoped.
--
-- §CHICKEN-AND-EGG: ProductFeedback.followUpId ↔ FollowUp.sourceId. The API
-- resolves this by creating ProductFeedback first (followUpId=null), creating
-- the FollowUp (sourceId=productFeedback.id), then updating ProductFeedback
-- .followUpId inside the SAME $transaction.

-- CreateTable: ProductFeedback
CREATE TABLE "ProductFeedback" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT,
    "invoiceId" TEXT,
    "productId" TEXT,
    "followUpId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "rating" INTEGER,
    "comment" TEXT,
    "metadata" TEXT,
    "requestedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: planned query patterns (all business-scoped for tenant isolation)
CREATE INDEX "ProductFeedback_businessId_partyId_idx" ON "ProductFeedback"("businessId", "partyId");
CREATE INDEX "ProductFeedback_businessId_productId_idx" ON "ProductFeedback"("businessId", "productId");
CREATE INDEX "ProductFeedback_businessId_invoiceId_idx" ON "ProductFeedback"("businessId", "invoiceId");
CREATE INDEX "ProductFeedback_businessId_status_idx" ON "ProductFeedback"("businessId", "status");
CREATE INDEX "ProductFeedback_businessId_createdAt_idx" ON "ProductFeedback"("businessId", "createdAt");

-- AddForeignKey: ProductFeedback → Business (Cascade — owned by business)
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_businessId_fkey"
  FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: ProductFeedback → Party (SetNull — preserve feedback history)
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_partyId_fkey"
  FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProductFeedback → Invoice (SetNull)
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProductFeedback → Product (SetNull)
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey: ProductFeedback → FollowUp (SetNull — preserve feedback if reminder deleted)
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_followUpId_fkey"
  FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- §ALTER FollowUp: add relatedProductId (FK to Product, named relation
-- "FollowUpProduct" to disambiguate from Complaint.relatedProduct).
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "FollowUp" ADD COLUMN "relatedProductId" TEXT;

ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedProductId_fkey"
  FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex: business-scoped lookup by product (for cleanup on product delete)
CREATE INDEX "FollowUp_businessId_relatedProductId_idx" ON "FollowUp"("businessId", "relatedProductId");

-- ──────────────────────────────────────────────────────────────────────
-- §ALTER Complaint: add productFeedbackId (FK to ProductFeedback, SetNull —
-- the complaint stands on its own even if the feedback record is deleted).
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "Complaint" ADD COLUMN "productFeedbackId" TEXT;

ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_productFeedbackId_fkey"
  FOREIGN KEY ("productFeedbackId") REFERENCES "ProductFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ──────────────────────────────────────────────────────────────────────
-- §ALTER AppSettings: add feedbackDelayHours (Int @default(48)). Range 1-168
-- enforced at the API layer (src/app/api/app-settings/route.ts PUT).
-- ──────────────────────────────────────────────────────────────────────
ALTER TABLE "AppSettings" ADD COLUMN "feedbackDelayHours" INTEGER NOT NULL DEFAULT 48;
