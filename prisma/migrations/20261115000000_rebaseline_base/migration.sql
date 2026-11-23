-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "state" TEXT,
    "gstin" TEXT,
    "pan" TEXT,
    "upiId" TEXT,
    "logoUrl" TEXT,
    "coverUrl" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "storeSlug" TEXT,
    "deliveryRadiusKm" INTEGER NOT NULL DEFAULT 5,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "serviceableAreas" TEXT,
    "subscriptionPlan" TEXT NOT NULL DEFAULT 'trial',
    "trialEndsAt" TIMESTAMP(3),
    "subscriptionEndsAt" TIMESTAMP(3),
    "isSponsored" BOOLEAN NOT NULL DEFAULT false,
    "sponsoredUntil" TIMESTAMP(3),
    "sponsoredArea" TEXT,

    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

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
CREATE TABLE "CustomPrice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "productId" TEXT,
    "catalogItemId" TEXT,
    "buyerId" TEXT,
    "buyerGroupName" TEXT,
    "customPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "customSalePrice" DECIMAL(18,2),
    "customMrp" DECIMAL(18,2),
    "customWholesalePrice" DECIMAL(18,2),
    "customRetailSalePrice" DECIMAL(18,2),
    "customRetailMrp" DECIMAL(18,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'system',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "invoiceId" TEXT,
    "followUpId" TEXT,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationChannelPreference" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationChannelPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "type" TEXT NOT NULL DEFAULT 'customer',
    "balance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "qualityGrade" TEXT NOT NULL DEFAULT 'B',
    "creditLimit" DECIMAL(18,2),
    "openingBalance" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "address" TEXT,
    "gstin" TEXT,
    "notes" TEXT,
    "avgPaymentDays" DOUBLE PRECISION,
    "avgDiscountPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "gradeLastCalculated" TIMESTAMP(3),
    "gradeOverrideReason" TEXT,
    "creditTrustScore" DOUBLE PRECISION NOT NULL DEFAULT 3,
    "maxCreditSuggestion" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "trustScoreUpdatedAt" TIMESTAMP(3),
    "trustScoreReason" TEXT,
    "searchTags" TEXT,
    "buyerGroup" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "category" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "purchasePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "salePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "mrp" DECIMAL(18,2),
    "wholesalePrice" DECIMAL(18,2),
    "gstRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "stock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lowStockThreshold" DOUBLE PRECISION NOT NULL DEFAULT 5,
    "supplierId" TEXT,
    "retailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "retailUnit" TEXT,
    "conversionFactor" DOUBLE PRECISION,
    "retailSalePrice" DECIMAL(18,2),
    "retailMrp" DECIMAL(18,2),
    "looseStock" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "subCategory" TEXT,
    "description" TEXT,
    "isPublished" BOOLEAN NOT NULL DEFAULT true,
    "categoryPath" TEXT,
    "searchTags" TEXT,
    "feedbackDelayHours" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Category" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "level" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductImage" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "imageType" TEXT NOT NULL DEFAULT 'raw',
    "viewAngle" TEXT,
    "isProcessed" BOOLEAN NOT NULL DEFAULT false,
    "isHD" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMediaAsset" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "inputType" TEXT NOT NULL DEFAULT 'image',
    "inputUrl" TEXT,
    "inputCount" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "meshData" TEXT,
    "processedImageUrl" TEXT,
    "spinVideoUrl" TEXT,
    "frontViewUrl" TEXT,
    "backViewUrl" TEXT,
    "leftViewUrl" TEXT,
    "rightViewUrl" TEXT,
    "qualityScore" DOUBLE PRECISION,
    "symmetryScore" DOUBLE PRECISION,
    "volumeMatch" DOUBLE PRECISION,
    "matchScore" DOUBLE PRECISION,
    "rejectionReason" TEXT,
    "ironingApplied" BOOLEAN NOT NULL DEFAULT false,
    "textRestored" BOOLEAN NOT NULL DEFAULT false,
    "bgRemoved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductMediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT,
    "type" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balanceAfter" DECIMAL(18,2),
    "description" TEXT,
    "category" TEXT,
    "invoiceId" TEXT,
    "transactionSubtype" TEXT,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT,
    "invoiceNumber" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'sales',
    "status" TEXT NOT NULL DEFAULT 'unpaid',
    "isGst" BOOLEAN NOT NULL DEFAULT false,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountValue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "discountMode" TEXT NOT NULL DEFAULT 'flat',
    "discountAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountPaid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "amountDue" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT,
    "notes" TEXT,
    "paymentLandingToken" TEXT,
    "collectedByName" TEXT,
    "collectedByRole" TEXT,
    "paidToName" TEXT,
    "paidToRole" TEXT,
    "deliveryStatus" TEXT DEFAULT 'handed',
    "saleOperationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceItem" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DECIMAL(18,2) NOT NULL,
    "discount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "gstRate" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "fulfilledQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "purchasePriceSnapshot" DECIMAL(18,2),

    CONSTRAINT "InvoiceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PartyNote" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'general',
    "content" TEXT NOT NULL,
    "author" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PartyNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSettings" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "autoBackupEnabled" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'en',
    "dateFormat" TEXT NOT NULL DEFAULT 'DD/MM/YYYY',
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "pinEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pinHash" TEXT,
    "lastBackupAt" TIMESTAMP(3),
    "userRole" TEXT NOT NULL DEFAULT 'owner',
    "telegramEnabled" BOOLEAN NOT NULL DEFAULT false,
    "driveEnabled" BOOLEAN NOT NULL DEFAULT false,
    "biometricEnabled" BOOLEAN NOT NULL DEFAULT false,
    "gateOwnerSwitch" BOOLEAN NOT NULL DEFAULT true,
    "gateHighValueDiscount" BOOLEAN NOT NULL DEFAULT true,
    "gateDiscountLimit" DECIMAL(18,2) NOT NULL DEFAULT 5000,
    "gateDataExport" BOOLEAN NOT NULL DEFAULT true,
    "gateInventoryPrice" BOOLEAN NOT NULL DEFAULT true,
    "gateDangerZone" BOOLEAN NOT NULL DEFAULT true,
    "externalScannerEnabled" BOOLEAN NOT NULL DEFAULT false,
    "defaulterRegistryEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gateLockdownUntil" TIMESTAMP(3),
    "onlineSalesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "offlineOnlyMode" BOOLEAN NOT NULL DEFAULT false,
    "cloudSyncMode" BOOLEAN NOT NULL DEFAULT false,
    "telegramFileIdMode" BOOLEAN NOT NULL DEFAULT false,
    "appMode" TEXT NOT NULL DEFAULT 'merchant',
    "cardPreferences" TEXT,
    "dashboardCards" TEXT,
    "dashboardSections" TEXT,
    "notificationChannels" TEXT,
    "rewardThreshold" DECIMAL(18,2) NOT NULL DEFAULT 400,
    "feedbackDelayHours" INTEGER NOT NULL DEFAULT 48,
    "messageTemplates" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FingerprintRecord" (
    "id" TEXT NOT NULL,
    "fingerprintHash" TEXT NOT NULL,
    "partyId" TEXT,
    "businessId" TEXT NOT NULL,
    "hand" TEXT NOT NULL DEFAULT 'right',
    "finger" TEXT NOT NULL DEFAULT 'thumb',
    "role" TEXT NOT NULL DEFAULT 'primary',
    "linkedName" TEXT,
    "relation" TEXT,
    "scannerType" TEXT NOT NULL DEFAULT 'native',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FingerprintRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'success',
    "fileUrl" TEXT,
    "fileSize" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackupLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportHistory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "userId" TEXT,
    "importType" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "importedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'PREVIEW',
    "errorReportJson" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefaulterRegistry" (
    "id" TEXT NOT NULL,
    "fingerprintHash" TEXT,
    "partyName" TEXT NOT NULL,
    "partyPhone" TEXT,
    "defaultAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "merchantName" TEXT NOT NULL,
    "merchantArea" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DefaulterRegistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiometricGateLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "gateType" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "staffName" TEXT,
    "ipAddress" TEXT,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BiometricGateLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "customerName" TEXT NOT NULL,
    "customerPhone" TEXT,
    "customerAddress" TEXT,
    "customerLat" DOUBLE PRECISION,
    "customerLng" DOUBLE PRECISION,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "deliveryCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "grandTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "paymentMode" TEXT NOT NULL DEFAULT 'cod',
    "syncedTransactionId" TEXT,
    "syncedInvoiceId" TEXT,
    "notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'catalog',
    "referrerBusinessId" TEXT,
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionLog" (
    "id" TEXT NOT NULL,
    "recipientBusinessId" TEXT NOT NULL,
    "payerBusinessId" TEXT NOT NULL,
    "customerOrderId" TEXT,
    "orderAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupplierCatalogItem" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "productName" TEXT NOT NULL,
    "category" TEXT,
    "basePrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transportFare" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "coolieCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'pcs',
    "minOrderQty" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "matchedProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupplierCatalogItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "poNumber" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sent',
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "dispatchedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderItem" (
    "id" TEXT NOT NULL,
    "purchaseOrderId" TEXT NOT NULL,
    "catalogItemId" TEXT,
    "productName" TEXT NOT NULL,
    "category" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "transportFare" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "coolieCharge" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalCost" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "matchedProductId" TEXT,

    CONSTRAINT "PurchaseOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Staff" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "role" TEXT NOT NULL DEFAULT 'sales',
    "staffId" TEXT NOT NULL,
    "qrToken" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "permBilling" BOOLEAN NOT NULL DEFAULT true,
    "permInventory" BOOLEAN NOT NULL DEFAULT false,
    "permKhata" BOOLEAN NOT NULL DEFAULT false,
    "permReports" BOOLEAN NOT NULL DEFAULT false,
    "permSourcing" BOOLEAN NOT NULL DEFAULT false,
    "permSettings" BOOLEAN NOT NULL DEFAULT false,
    "permExport" BOOLEAN NOT NULL DEFAULT false,
    "permDelete" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Staff_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "staffId" TEXT,
    "staffName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "description" TEXT NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessLink" (
    "id" TEXT NOT NULL,
    "staffPhone" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'sales',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FavoriteShop" (
    "id" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "storeSlug" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FavoriteShop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderSplit" (
    "id" TEXT NOT NULL,
    "parentOrderId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "items" TEXT NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "merchantAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "deliveryOtp" TEXT,
    "otpVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentSplit" (
    "id" TEXT NOT NULL,
    "orderSplitId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "commissionPct" DOUBLE PRECISION NOT NULL DEFAULT 2,
    "commissionAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "merchantAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "settlementStatus" TEXT NOT NULL DEFAULT 'pending',
    "settledAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentSplit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" TEXT NOT NULL,
    "orderSplitId" TEXT NOT NULL,
    "customerPhone" TEXT,
    "reason" TEXT NOT NULL,
    "refundAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "refundStatus" TEXT NOT NULL DEFAULT 'pending',
    "refundedAt" TIMESTAMP(3),
    "stockRestored" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerTrustScore" (
    "id" TEXT NOT NULL,
    "customerPhone" TEXT NOT NULL,
    "trustScore" DOUBLE PRECISION NOT NULL DEFAULT 5.0,
    "totalOrders" INTEGER NOT NULL DEFAULT 0,
    "totalReturns" INTEGER NOT NULL DEFAULT 0,
    "consecutiveReturns" INTEGER NOT NULL DEFAULT 0,
    "codLocked" BOOLEAN NOT NULL DEFAULT false,
    "lastReturnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerTrustScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'customer',
    "merchantId" TEXT,
    "customerName" TEXT,
    "merchantName" TEXT,
    "pinHash" TEXT,
    "pinEnabled" BOOLEAN NOT NULL DEFAULT false,
    "biometricEnabled" BOOLEAN NOT NULL DEFAULT false,
    "isSeller" BOOLEAN NOT NULL DEFAULT false,
    "sellerSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBehaviour" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "rating" TEXT NOT NULL,
    "tags" TEXT,
    "notes" TEXT,
    "ratedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerBehaviour_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerBehaviourHistory" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "behaviourId" TEXT,
    "rating" TEXT NOT NULL,
    "tags" TEXT,
    "notes" TEXT,
    "ratedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerBehaviourHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplaintSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "complaintNumber" TEXT NOT NULL,
    "partyId" TEXT,
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedTo" TEXT,
    "relatedInvoiceId" TEXT,
    "relatedProductId" TEXT,
    "productFeedbackId" TEXT,
    "resolution" TEXT,
    "internalNotes" TEXT,
    "attachments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
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

-- CreateTable
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

-- CreateTable
CREATE TABLE "CustomerRewardCycle" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "cycleNumber" INTEGER NOT NULL DEFAULT 1,
    "threshold" DECIMAL(18,2) NOT NULL,
    "accumulatedProfit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "unlockedAt" TIMESTAMP(3),
    "rewardGivenAt" TIMESTAMP(3),
    "rewardDescription" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerRewardCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerRewardEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "cycleId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sourceInvoiceId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerRewardEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardAccrualOutbox" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "processingStartedAt" TIMESTAMP(3),
    "claimToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RewardAccrualOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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

-- CreateTable
CREATE TABLE "RewardReconciliationCursor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lastCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInvoiceId" TEXT NOT NULL DEFAULT '',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RewardReconciliationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedbackReconciliationCursor" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "lastCreatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastInvoiceId" TEXT NOT NULL DEFAULT '',
    "scannedCount" INTEGER NOT NULL DEFAULT 0,
    "cycleCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedbackReconciliationCursor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "followUpNumber" TEXT NOT NULL,
    "partyId" TEXT,
    "type" TEXT NOT NULL DEFAULT 'manual',
    "sourceType" TEXT NOT NULL DEFAULT 'MANUAL',
    "sourceId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
    "assignedToId" TEXT,
    "createdById" TEXT,
    "dueAt" TIMESTAMP(3),
    "snoozedUntil" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "outcome" TEXT,
    "relatedInvoiceId" TEXT,
    "relatedComplaintId" TEXT,
    "relatedProductId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEvent" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "fromValue" TEXT,
    "toValue" TEXT,
    "note" TEXT,
    "actor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpSequence" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUpSequence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
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
    "dedupKey" TEXT,
    "requestedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Business_storeSlug_key" ON "Business"("storeSlug");

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
CREATE INDEX "CustomPrice_businessId_idx" ON "CustomPrice"("businessId");

-- CreateIndex
CREATE INDEX "CustomPrice_productId_idx" ON "CustomPrice"("productId");

-- CreateIndex
CREATE INDEX "CustomPrice_catalogItemId_idx" ON "CustomPrice"("catalogItemId");

-- CreateIndex
CREATE INDEX "CustomPrice_buyerId_idx" ON "CustomPrice"("buyerId");

-- CreateIndex
CREATE INDEX "CustomPrice_buyerGroupName_idx" ON "CustomPrice"("buyerGroupName");

-- CreateIndex
CREATE INDEX "Notification_businessId_idx" ON "Notification"("businessId");

-- CreateIndex
CREATE INDEX "Notification_isRead_idx" ON "Notification"("isRead");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_businessId_invoiceId_key" ON "Notification"("businessId", "invoiceId");

-- CreateIndex
CREATE INDEX "NotificationChannelPreference_businessId_idx" ON "NotificationChannelPreference"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationChannelPreference_businessId_key_key" ON "NotificationChannelPreference"("businessId", "key");

-- CreateIndex
CREATE INDEX "Party_businessId_idx" ON "Party"("businessId");

-- CreateIndex
CREATE INDEX "Product_businessId_idx" ON "Product"("businessId");

-- CreateIndex
CREATE INDEX "Product_supplierId_idx" ON "Product"("supplierId");

-- CreateIndex
CREATE INDEX "Category_businessId_idx" ON "Category"("businessId");

-- CreateIndex
CREATE INDEX "Category_parentId_idx" ON "Category"("parentId");

-- CreateIndex
CREATE INDEX "ProductImage_productId_idx" ON "ProductImage"("productId");

-- CreateIndex
CREATE INDEX "ProductMediaAsset_productId_idx" ON "ProductMediaAsset"("productId");

-- CreateIndex
CREATE INDEX "ProductMediaAsset_businessId_idx" ON "ProductMediaAsset"("businessId");

-- CreateIndex
CREATE INDEX "ProductMediaAsset_status_idx" ON "ProductMediaAsset"("status");

-- CreateIndex
CREATE INDEX "Transaction_businessId_idx" ON "Transaction"("businessId");

-- CreateIndex
CREATE INDEX "Transaction_partyId_idx" ON "Transaction"("partyId");

-- CreateIndex
CREATE INDEX "Transaction_businessId_createdAt_idx" ON "Transaction"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_paymentLandingToken_key" ON "Invoice"("paymentLandingToken");

-- CreateIndex
CREATE INDEX "Invoice_businessId_idx" ON "Invoice"("businessId");

-- CreateIndex
CREATE INDEX "Invoice_partyId_idx" ON "Invoice"("partyId");

-- CreateIndex
CREATE INDEX "Invoice_businessId_createdAt_idx" ON "Invoice"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_businessId_invoiceNumber_key" ON "Invoice"("businessId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_businessId_saleOperationId_key" ON "Invoice"("businessId", "saleOperationId");

-- CreateIndex
CREATE INDEX "InvoiceItem_invoiceId_idx" ON "InvoiceItem"("invoiceId");

-- CreateIndex
CREATE INDEX "PartyNote_partyId_idx" ON "PartyNote"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "AppSettings_businessId_key" ON "AppSettings"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FingerprintRecord_fingerprintHash_key" ON "FingerprintRecord"("fingerprintHash");

-- CreateIndex
CREATE INDEX "FingerprintRecord_partyId_idx" ON "FingerprintRecord"("partyId");

-- CreateIndex
CREATE INDEX "FingerprintRecord_businessId_idx" ON "FingerprintRecord"("businessId");

-- CreateIndex
CREATE INDEX "FingerprintRecord_role_idx" ON "FingerprintRecord"("role");

-- CreateIndex
CREATE INDEX "BackupLog_businessId_idx" ON "BackupLog"("businessId");

-- CreateIndex
CREATE INDEX "ImportHistory_businessId_idx" ON "ImportHistory"("businessId");

-- CreateIndex
CREATE INDEX "ImportHistory_createdAt_idx" ON "ImportHistory"("createdAt");

-- CreateIndex
CREATE INDEX "DefaulterRegistry_fingerprintHash_idx" ON "DefaulterRegistry"("fingerprintHash");

-- CreateIndex
CREATE INDEX "DefaulterRegistry_status_idx" ON "DefaulterRegistry"("status");

-- CreateIndex
CREATE INDEX "DefaulterRegistry_partyPhone_idx" ON "DefaulterRegistry"("partyPhone");

-- CreateIndex
CREATE INDEX "BiometricGateLog_businessId_idx" ON "BiometricGateLog"("businessId");

-- CreateIndex
CREATE INDEX "BiometricGateLog_gateType_idx" ON "BiometricGateLog"("gateType");

-- CreateIndex
CREATE INDEX "BiometricGateLog_result_idx" ON "BiometricGateLog"("result");

-- CreateIndex
CREATE INDEX "CustomerOrder_businessId_idx" ON "CustomerOrder"("businessId");

-- CreateIndex
CREATE INDEX "CustomerOrder_status_idx" ON "CustomerOrder"("status");

-- CreateIndex
CREATE INDEX "CommissionLog_recipientBusinessId_idx" ON "CommissionLog"("recipientBusinessId");

-- CreateIndex
CREATE INDEX "CommissionLog_payerBusinessId_idx" ON "CommissionLog"("payerBusinessId");

-- CreateIndex
CREATE INDEX "SupplierCatalogItem_businessId_idx" ON "SupplierCatalogItem"("businessId");

-- CreateIndex
CREATE INDEX "SupplierCatalogItem_supplierId_idx" ON "SupplierCatalogItem"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_businessId_idx" ON "PurchaseOrder"("businessId");

-- CreateIndex
CREATE INDEX "PurchaseOrder_supplierId_idx" ON "PurchaseOrder"("supplierId");

-- CreateIndex
CREATE INDEX "PurchaseOrderItem_purchaseOrderId_idx" ON "PurchaseOrderItem"("purchaseOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_staffId_key" ON "Staff"("staffId");

-- CreateIndex
CREATE UNIQUE INDEX "Staff_qrToken_key" ON "Staff"("qrToken");

-- CreateIndex
CREATE INDEX "Staff_businessId_idx" ON "Staff"("businessId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_productId_idx" ON "StockMovement"("businessId", "productId");

-- CreateIndex
CREATE INDEX "StockMovement_businessId_createdAt_idx" ON "StockMovement"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_idx" ON "AuditLog"("businessId");

-- CreateIndex
CREATE INDEX "AuditLog_staffId_idx" ON "AuditLog"("staffId");

-- CreateIndex
CREATE INDEX "AuditLog_businessId_entityType_createdAt_idx" ON "AuditLog"("businessId", "entityType", "createdAt");

-- CreateIndex
CREATE INDEX "BusinessLink_staffPhone_idx" ON "BusinessLink"("staffPhone");

-- CreateIndex
CREATE INDEX "FavoriteShop_customerPhone_idx" ON "FavoriteShop"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "FavoriteShop_customerPhone_businessId_key" ON "FavoriteShop"("customerPhone", "businessId");

-- CreateIndex
CREATE INDEX "OrderSplit_parentOrderId_idx" ON "OrderSplit"("parentOrderId");

-- CreateIndex
CREATE INDEX "OrderSplit_businessId_idx" ON "OrderSplit"("businessId");

-- CreateIndex
CREATE INDEX "OrderSplit_status_idx" ON "OrderSplit"("status");

-- CreateIndex
CREATE INDEX "PaymentSplit_orderSplitId_idx" ON "PaymentSplit"("orderSplitId");

-- CreateIndex
CREATE INDEX "PaymentSplit_businessId_idx" ON "PaymentSplit"("businessId");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderSplitId_idx" ON "ReturnRequest"("orderSplitId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerTrustScore_customerPhone_key" ON "CustomerTrustScore"("customerPhone");

-- CreateIndex
CREATE INDEX "CustomerTrustScore_customerPhone_idx" ON "CustomerTrustScore"("customerPhone");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfile_phone_key" ON "UserProfile"("phone");

-- CreateIndex
CREATE INDEX "UserProfile_phone_idx" ON "UserProfile"("phone");

-- CreateIndex
CREATE INDEX "CustomerBehaviour_businessId_idx" ON "CustomerBehaviour"("businessId");

-- CreateIndex
CREATE INDEX "CustomerBehaviour_partyId_idx" ON "CustomerBehaviour"("partyId");

-- CreateIndex
CREATE INDEX "CustomerBehaviour_businessId_partyId_idx" ON "CustomerBehaviour"("businessId", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerBehaviour_businessId_partyId_key" ON "CustomerBehaviour"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "CustomerBehaviourHistory_businessId_partyId_createdAt_idx" ON "CustomerBehaviourHistory"("businessId", "partyId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerBehaviourHistory_behaviourId_createdAt_idx" ON "CustomerBehaviourHistory"("behaviourId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerBehaviourHistory_partyId_createdAt_idx" ON "CustomerBehaviourHistory"("partyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintSequence_businessId_key" ON "ComplaintSequence"("businessId");

-- CreateIndex
CREATE INDEX "Complaint_businessId_status_idx" ON "Complaint"("businessId", "status");

-- CreateIndex
CREATE INDEX "Complaint_businessId_partyId_idx" ON "Complaint"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "Complaint_businessId_assignedTo_idx" ON "Complaint"("businessId", "assignedTo");

-- CreateIndex
CREATE INDEX "Complaint_businessId_priority_idx" ON "Complaint"("businessId", "priority");

-- CreateIndex
CREATE INDEX "Complaint_businessId_createdAt_idx" ON "Complaint"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Complaint_businessId_complaintNumber_key" ON "Complaint"("businessId", "complaintNumber");

-- CreateIndex
CREATE INDEX "ComplaintEvent_complaintId_createdAt_idx" ON "ComplaintEvent"("complaintId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplaintEvent_businessId_createdAt_idx" ON "ComplaintEvent"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerChannelIdentity_businessId_partyId_idx" ON "CustomerChannelIdentity"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "CustomerChannelIdentity_businessId_channel_idx" ON "CustomerChannelIdentity"("businessId", "channel");

-- CreateIndex
CREATE INDEX "CustomerChannelIdentity_businessId_phoneNumber_idx" ON "CustomerChannelIdentity"("businessId", "phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerChannelIdentity_businessId_channel_externalUserId_key" ON "CustomerChannelIdentity"("businessId", "channel", "externalUserId");

-- CreateIndex
CREATE INDEX "Conversation_businessId_partyId_idx" ON "Conversation"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "Conversation_businessId_lastMessageAt_idx" ON "Conversation"("businessId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_businessId_channel_idx" ON "Conversation"("businessId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_businessId_channel_externalId_key" ON "Conversation"("businessId", "channel", "externalId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_partyId_createdAt_idx" ON "Message"("businessId", "partyId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_businessId_isRead_idx" ON "Message"("businessId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "Message_businessId_externalMessageId_key" ON "Message"("businessId", "externalMessageId");

-- CreateIndex
CREATE INDEX "CustomerRewardCycle_businessId_partyId_status_idx" ON "CustomerRewardCycle"("businessId", "partyId", "status");

-- CreateIndex
CREATE INDEX "CustomerRewardCycle_businessId_status_idx" ON "CustomerRewardCycle"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRewardCycle_businessId_partyId_cycleNumber_key" ON "CustomerRewardCycle"("businessId", "partyId", "cycleNumber");

-- CreateIndex
CREATE INDEX "CustomerRewardEvent_cycleId_createdAt_idx" ON "CustomerRewardEvent"("cycleId", "createdAt");

-- CreateIndex
CREATE INDEX "CustomerRewardEvent_businessId_partyId_createdAt_idx" ON "CustomerRewardEvent"("businessId", "partyId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerRewardEvent_businessId_sourceInvoiceId_key" ON "CustomerRewardEvent"("businessId", "sourceInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "RewardAccrualOutbox_invoiceId_key" ON "RewardAccrualOutbox"("invoiceId");

-- CreateIndex
CREATE INDEX "RewardAccrualOutbox_status_lastAttemptAt_idx" ON "RewardAccrualOutbox"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "RewardAccrualOutbox_businessId_status_idx" ON "RewardAccrualOutbox"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackOutbox_invoiceId_key" ON "FeedbackOutbox"("invoiceId");

-- CreateIndex
CREATE INDEX "FeedbackOutbox_status_lastAttemptAt_idx" ON "FeedbackOutbox"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "FeedbackOutbox_businessId_status_idx" ON "FeedbackOutbox"("businessId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RewardReconciliationCursor_businessId_key" ON "RewardReconciliationCursor"("businessId");

-- CreateIndex
CREATE INDEX "RewardReconciliationCursor_businessId_idx" ON "RewardReconciliationCursor"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "FeedbackReconciliationCursor_businessId_key" ON "FeedbackReconciliationCursor"("businessId");

-- CreateIndex
CREATE INDEX "FeedbackReconciliationCursor_businessId_idx" ON "FeedbackReconciliationCursor"("businessId");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_status_idx" ON "FollowUp"("businessId", "status");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_partyId_idx" ON "FollowUp"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_assignedToId_idx" ON "FollowUp"("businessId", "assignedToId");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_priority_idx" ON "FollowUp"("businessId", "priority");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_dueAt_idx" ON "FollowUp"("businessId", "dueAt");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_type_idx" ON "FollowUp"("businessId", "type");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_createdAt_idx" ON "FollowUp"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "FollowUp_businessId_relatedProductId_idx" ON "FollowUp"("businessId", "relatedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_businessId_followUpNumber_key" ON "FollowUp"("businessId", "followUpNumber");

-- CreateIndex
CREATE INDEX "FollowUpEvent_followUpId_createdAt_idx" ON "FollowUpEvent"("followUpId", "createdAt");

-- CreateIndex
CREATE INDEX "FollowUpEvent_businessId_createdAt_idx" ON "FollowUpEvent"("businessId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpSequence_businessId_key" ON "FollowUpSequence"("businessId");

-- CreateIndex
CREATE INDEX "ProductFeedback_businessId_partyId_idx" ON "ProductFeedback"("businessId", "partyId");

-- CreateIndex
CREATE INDEX "ProductFeedback_businessId_productId_idx" ON "ProductFeedback"("businessId", "productId");

-- CreateIndex
CREATE INDEX "ProductFeedback_businessId_invoiceId_idx" ON "ProductFeedback"("businessId", "invoiceId");

-- CreateIndex
CREATE INDEX "ProductFeedback_businessId_status_idx" ON "ProductFeedback"("businessId", "status");

-- CreateIndex
CREATE INDEX "ProductFeedback_businessId_createdAt_idx" ON "ProductFeedback"("businessId", "createdAt");

-- AddForeignKey
ALTER TABLE "InvoiceSequence" ADD CONSTRAINT "InvoiceSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPrice" ADD CONSTRAINT "CustomPrice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPrice" ADD CONSTRAINT "CustomPrice_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomPrice" ADD CONSTRAINT "CustomPrice_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationChannelPreference" ADD CONSTRAINT "NotificationChannelPreference_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Party" ADD CONSTRAINT "Party_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductImage" ADD CONSTRAINT "ProductImage_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMediaAsset" ADD CONSTRAINT "ProductMediaAsset_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMediaAsset" ADD CONSTRAINT "ProductMediaAsset_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceItem" ADD CONSTRAINT "InvoiceItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PartyNote" ADD CONSTRAINT "PartyNote_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppSettings" ADD CONSTRAINT "AppSettings_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FingerprintRecord" ADD CONSTRAINT "FingerprintRecord_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FingerprintRecord" ADD CONSTRAINT "FingerprintRecord_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiometricGateLog" ADD CONSTRAINT "BiometricGateLog_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerOrder" ADD CONSTRAINT "CustomerOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLog" ADD CONSTRAINT "CommissionLog_recipientBusinessId_fkey" FOREIGN KEY ("recipientBusinessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionLog" ADD CONSTRAINT "CommissionLog_payerBusinessId_fkey" FOREIGN KEY ("payerBusinessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupplierCatalogItem" ADD CONSTRAINT "SupplierCatalogItem_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_purchaseOrderId_fkey" FOREIGN KEY ("purchaseOrderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderItem" ADD CONSTRAINT "PurchaseOrderItem_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "SupplierCatalogItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBehaviour" ADD CONSTRAINT "CustomerBehaviour_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBehaviour" ADD CONSTRAINT "CustomerBehaviour_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_behaviourId_fkey" FOREIGN KEY ("behaviourId") REFERENCES "CustomerBehaviour"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerBehaviourHistory" ADD CONSTRAINT "CustomerBehaviourHistory_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintSequence" ADD CONSTRAINT "ComplaintSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_productFeedbackId_fkey" FOREIGN KEY ("productFeedbackId") REFERENCES "ProductFeedback"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintEvent" ADD CONSTRAINT "ComplaintEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChannelIdentity" ADD CONSTRAINT "CustomerChannelIdentity_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerChannelIdentity" ADD CONSTRAINT "CustomerChannelIdentity_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRewardCycle" ADD CONSTRAINT "CustomerRewardCycle_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRewardCycle" ADD CONSTRAINT "CustomerRewardCycle_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_cycleId_fkey" FOREIGN KEY ("cycleId") REFERENCES "CustomerRewardCycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerRewardEvent" ADD CONSTRAINT "CustomerRewardEvent_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardAccrualOutbox" ADD CONSTRAINT "RewardAccrualOutbox_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackOutbox" ADD CONSTRAINT "FeedbackOutbox_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackOutbox" ADD CONSTRAINT "FeedbackOutbox_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardReconciliationCursor" ADD CONSTRAINT "RewardReconciliationCursor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedbackReconciliationCursor" ADD CONSTRAINT "FeedbackReconciliationCursor_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedInvoiceId_fkey" FOREIGN KEY ("relatedInvoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedComplaintId_fkey" FOREIGN KEY ("relatedComplaintId") REFERENCES "Complaint"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpSequence" ADD CONSTRAINT "FollowUpSequence_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductFeedback" ADD CONSTRAINT "ProductFeedback_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- §PARTIAL-INDEXES: 4 raw-SQL partial unique indexes not expressible in Prisma schema (dedup invariants; from migrations 20260912/20260913/20260917/20260919, IF NOT EXISTS omitted for fresh-DB semantics)
CREATE UNIQUE INDEX "Conversation_businessId_partyId_in_app_key"
  ON "Conversation"("businessId", "partyId")
  WHERE "channel" = 'in_app';

CREATE UNIQUE INDEX "CustomerRewardCycle_businessId_partyId_active_key"
  ON "CustomerRewardCycle"("businessId", "partyId")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "Notification_businessId_followUpId_type_key"
  ON "Notification"("businessId", "followUpId", "type")
  WHERE "followUpId" IS NOT NULL;

CREATE UNIQUE INDEX "ProductFeedback_dedupKey_status_key"
  ON "ProductFeedback"("dedupKey")
  WHERE "status" = 'pending' OR "status" = 'scheduled';
