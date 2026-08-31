-- §P16-STEP3.7: Add deliveryCharge to Invoice model.
-- Additive migration — only ADD COLUMN, nullable, default 0.
-- Existing invoices get deliveryCharge = 0 (no effect on historical data).
-- grandTotal = taxable + gstAmount + deliveryCharge (for new invoices only).
-- Old invoices remain unchanged (deliveryCharge defaults to 0).

ALTER TABLE "Invoice" ADD COLUMN "deliveryCharge" DECIMAL(18,2) NOT NULL DEFAULT 0;
