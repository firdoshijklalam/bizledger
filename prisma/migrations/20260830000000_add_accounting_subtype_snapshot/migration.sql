-- §P16-STEP2: Additive schema migration for accounting subtype + historical COGS snapshot.
--
-- Adds 3 nullable columns to support:
--   1. Transaction.transactionSubtype — authoritative accounting discriminator
--      (resolves `debit`/`credit` semantic overload). NULL for legacy/ambiguous rows.
--   2. Transaction.source — provenance (manual/invoice/ocr/online_order/system/import/restore/salepad).
--      Distinct from subtype; records WHO wrote the row, not WHAT it means financially.
--   3. InvoiceItem.purchasePriceSnapshot — historical cost at moment of sale. NULL for
--      legacy InvoiceItems (Reports falls back to current Product.purchasePrice).
--
-- All columns are nullable — no NOT NULL constraint, no default, no data deletion.
-- Existing rows remain valid: new columns default to NULL.
-- Backward compatible: old code that doesn't set these fields continues to work.

-- Transaction: authoritative accounting subtype (resolves debit/credit overload)
ALTER TABLE "Transaction" ADD COLUMN "transactionSubtype" TEXT;

-- Transaction: provenance — which code path created this row
ALTER TABLE "Transaction" ADD COLUMN "source" TEXT;

-- InvoiceItem: historical cost snapshot for accurate COGS at sale time
ALTER TABLE "InvoiceItem" ADD COLUMN "purchasePriceSnapshot" DECIMAL(18,2);
