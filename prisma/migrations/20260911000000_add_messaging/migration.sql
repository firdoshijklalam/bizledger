-- §MESSAGING: Add CustomerChannelIdentity + Conversation + Message tables.
-- Implements the unified messaging foundation: Customer → Conversation → Message.
--
-- §UNIQUENESS-STRATEGY:
--   - CustomerChannelIdentity: unique on (businessId, channel, externalUserId)
--   - Conversation: TWO unique constraints:
--     1. (businessId, channel, externalId) — external thread dedup
--     2. (businessId, partyId, channel) — in_app dedup (where externalId is NULL)
--   - Message: unique on (businessId, externalMessageId) — webhook replay idempotency
--
-- §POSTGRESQL-NULL-SEMANTICS: PostgreSQL treats NULL values as distinct in
-- unique indexes. The two-conversation-unique design handles this correctly:
-- external threads use externalId (NOT NULL), in_app uses partyId+channel (externalId is NULL).
--
-- §ADDITIVE-ONLY: No existing table altered. No destructive operations.

CREATE TABLE "CustomerChannelIdentity" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "externalUsername" TEXT,
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "metadata" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerChannelIdentity_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "senderType" TEXT NOT NULL,
    "senderId" TEXT,
    "body" TEXT,
    "attachments" TEXT,
    "externalMessageId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CustomerChannelIdentity_businessId_partyId_idx" ON "CustomerChannelIdentity"("businessId", "partyId");
CREATE INDEX "CustomerChannelIdentity_businessId_channel_idx" ON "CustomerChannelIdentity"("businessId", "channel");
CREATE INDEX "CustomerChannelIdentity_businessId_phoneNumber_idx" ON "CustomerChannelIdentity"("businessId", "phoneNumber");
CREATE UNIQUE INDEX "CustomerChannelIdentity_businessId_channel_externalUserId_key" ON "CustomerChannelIdentity"("businessId", "channel", "externalUserId");
CREATE INDEX "Conversation_businessId_partyId_idx" ON "Conversation"("businessId", "partyId");
CREATE INDEX "Conversation_businessId_lastMessageAt_idx" ON "Conversation"("businessId", "lastMessageAt");
CREATE INDEX "Conversation_businessId_channel_idx" ON "Conversation"("businessId", "channel");
CREATE UNIQUE INDEX "Conversation_businessId_channel_externalId_key" ON "Conversation"("businessId", "channel", "externalId");
CREATE UNIQUE INDEX "Conversation_businessId_partyId_channel_key" ON "Conversation"("businessId", "partyId", "channel");
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");
CREATE INDEX "Message_businessId_partyId_createdAt_idx" ON "Message"("businessId", "partyId", "createdAt");
CREATE INDEX "Message_businessId_isRead_idx" ON "Message"("businessId", "isRead");
CREATE UNIQUE INDEX "Message_businessId_externalMessageId_key" ON "Message"("businessId", "externalMessageId");
ALTER TABLE "CustomerChannelIdentity" ADD CONSTRAINT "CustomerChannelIdentity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerChannelIdentity" ADD CONSTRAINT "CustomerChannelIdentity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;
