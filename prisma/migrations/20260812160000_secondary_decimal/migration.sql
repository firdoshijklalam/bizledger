-- AlterTable
ALTER TABLE "AppSettings" ALTER COLUMN "gateDiscountLimit" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "CustomerOrder" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "deliveryCharge" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "grandTotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "commissionAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "DefaulterRegistry" ALTER COLUMN "defaultAmount" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Party" ALTER COLUMN "maxCreditSuggestion" SET DATA TYPE DECIMAL(18,2);

