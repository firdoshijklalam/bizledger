-- §P16-STEP3.8: Add saleOperationId to Invoice for idempotency.
-- Additive migration — only ADD COLUMN (nullable) + CREATE UNIQUE INDEX.
-- Existing invoices get saleOperationId = NULL (no idempotency tracking for old invoices).
-- New SalePad submissions will send a UUID that prevents duplicate creation.
-- The unique index is on (businessId, saleOperationId) to scope by tenant.
-- NULL values are NOT enforced as unique by PostgreSQL (NULL != NULL), so
-- old invoices with NULL saleOperationId do NOT conflict with each other.

ALTER TABLE "Invoice" ADD COLUMN "saleOperationId" TEXT;

-- Unique index on (businessId, saleOperationId) — allows multiple NULLs
-- (PostgreSQL treats NULLs as distinct for unique indexes, so old invoices
-- with NULL saleOperationId don't conflict).
CREATE UNIQUE INDEX "Invoice_businessId_saleOperationId_key"
ON "Invoice" ("businessId", "saleOperationId")
WHERE "saleOperationId" IS NOT NULL;
