-- §FEEDBACK-COMPLETENESS: wire product feedback into the full CRM flow.
--
-- §ADDITIVE: only ALTER TABLE ADD COLUMN + CREATE UNIQUE INDEX. No destructive
-- ops. No drops, no renames, no type changes.
--
-- §CHANGES:
--   1. Product.feedbackDelayHours (Int?) — optional per-product override for
--      the global AppSettings.feedbackDelayHours. null → use the global
--      default. When set (1–168), this product's feedback requests use the
--      per-product delay instead. Resolved server-side at creation time by
--      src/lib/product-feedback.ts:resolveEffectiveFeedbackDelay.
--   2. ProductFeedback.dedupKey (String?) — deterministic key for race-safe
--      duplicate prevention. Computed from
--      [businessId, partyId, invoiceId ?? '', productId ?? ''].join('|').
--   3. Partial UNIQUE INDEX on ProductFeedback(dedupKey) WHERE status is
--      pending OR scheduled — the active statuses. Submitted/skipped/expired
--      records do NOT block a new request (the customer can be re-asked).
--      The index treats NULL invoiceId/productId as '' (via the dedupKey
--      computation), so the unique constraint covers ALL tuples uniformly.
--      This is the authoritative guard — the application-level findFirst in
--      the POST handler is just an early-exit UX optimization.

ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "feedbackDelayHours" INTEGER;
ALTER TABLE "ProductFeedback" ADD COLUMN IF NOT EXISTS "dedupKey" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ProductFeedback_dedupKey_status_key"
  ON "ProductFeedback"("dedupKey")
  WHERE "status" = 'pending' OR "status" = 'scheduled';
