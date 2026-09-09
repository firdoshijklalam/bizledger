-- §CONVERSATION-UNIQUENESS-FIX: Replace the overly-restrictive universal
-- unique constraint (businessId, partyId, channel) with a partial unique
-- index that only applies to in_app conversations.
--
-- §PROBLEM: The old constraint prevented a customer from having multiple
-- conversations on the same external channel (e.g., two WhatsApp threads),
-- even with different externalId values. This is incorrect — external
-- providers allow multiple threads per customer.
--
-- §FIX:
--   1. DROP the old unique index "Conversation_businessId_partyId_channel_key"
--   2. CREATE a partial unique index that only enforces uniqueness for
--      in_app conversations: one conversation per (businessId, partyId)
--      WHERE channel = 'in_app'.
--   3. KEEP the existing external thread uniqueness:
--      "Conversation_businessId_channel_externalId_key" (unchanged).
--
-- §POSTGRESQL-PARTIAL-INDEX: PostgreSQL supports WHERE clauses on indexes.
-- Prisma's @@unique cannot express this, so the index is created via raw SQL.
-- The application-level dedup in POST /api/conversations also handles this.
--
-- §ADDITIVE: This migration only drops + creates indexes. No table recreation,
-- no data migration, no destructive operations.

-- Drop the overly-restrictive unique index
DROP INDEX IF EXISTS "Conversation_businessId_partyId_channel_key";

-- Create the partial unique index for in_app conversations only
CREATE UNIQUE INDEX "Conversation_businessId_partyId_in_app_key"
  ON "Conversation"("businessId", "partyId")
  WHERE "channel" = 'in_app';
