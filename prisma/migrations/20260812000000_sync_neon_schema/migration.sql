-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "metadata" TEXT;

-- AlterTable
ALTER TABLE "CustomPrice" ALTER COLUMN "customPrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "customMrp" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "customSalePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "customWholesalePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "customRetailMrp" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "customRetailSalePrice" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Invoice" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "discountValue" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "discountAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "gstAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "grandTotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "amountPaid" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "amountDue" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "InvoiceItem" ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "discount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "gstRate" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "OrderSplit" ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Party" ALTER COLUMN "balance" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "creditLimit" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "openingBalance" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Product" ALTER COLUMN "purchasePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "salePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "mrp" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "wholesalePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "retailSalePrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "retailMrp" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "Transaction" ALTER COLUMN "amount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "balanceAfter" SET DATA TYPE DECIMAL(18,2);

-- CreateTable
CREATE TABLE "InvoiceSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'OWNER',
    "businessId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "balanceAfter" DOUBLE PRECISION NOT NULL,
    "referenceId" TEXT,
    "referenceType" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceSequence_businessId_key" ON "InvoiceSequence"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_businessId_idx" ON "User"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_productId_idx" ON "StockMovement"("businessId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_createdAt_idx" ON "StockMovement"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_entityType_createdAt_idx" ON "AuditLog"("businessId", "entityType", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_businessId_invoiceNumber_key" ON "Invoice"("businessId", "invoiceNumber");

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

