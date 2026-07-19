// BizLedger — Core domain types

export type ViewId =
  | 'dashboard'
  | 'khata'
  | 'inventory'
  | 'billing'
  | 'reports'
  | 'ai-tools'
  | 'settings'
  | 'notifications'
  | 'sale-pad'
  | 'sourcing'
  | 'history'

export type PartyType = 'customer' | 'supplier' | 'both'
export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'E'

export type TransactionType = 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'

export type InvoiceType = 'sales' | 'purchase' | 'retail' | 'challan'
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid' | 'void'
export type PaymentMode = 'cash' | 'upi' | 'credit' | 'cheque'
export type DiscountMode = 'flat' | 'percent'

export interface Business {
  id: string
  name: string
  ownerName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  state?: string | null
  gstin?: string | null
  pan?: string | null
  upiId?: string | null
  logoUrl?: string | null
  currency: string
  // PRD Part 33: Marketplace fields
  storeSlug?: string | null
  deliveryRadiusKm?: number
  latitude?: number | null
  longitude?: number | null
  serviceableAreas?: string | null
  subscriptionPlan?: string
  trialEndsAt?: string | null
  subscriptionEndsAt?: string | null
  isSponsored?: boolean
  sponsoredUntil?: string | null
  sponsoredArea?: string | null
}

export interface Party {
  id: string
  businessId: string
  name: string
  phone?: string | null
  type: PartyType
  balance: number
  qualityGrade: QualityGrade
  creditLimit?: number | null
  openingBalance: number
  address?: string | null
  gstin?: string | null
  notes?: string | null
  avgPaymentDays?: number | null
  avgDiscountPct: number
  gradeLastCalculated?: string | null
  gradeOverrideReason?: string | null
  // §3: phonetic search tags (JSON array string from transliteration)
  searchTags?: string | null
  createdAt: string
  updatedAt: string
}

export interface Product {
  id: string
  businessId: string
  name: string
  sku?: string | null
  category?: string | null
  unit: string
  purchasePrice: number
  salePrice: number
  mrp?: number | null
  wholesalePrice?: number | null
  gstRate: number
  stock: number
  lowStockThreshold: number
  supplierId?: string | null
  retailEnabled?: boolean
  retailUnit?: string | null
  conversionFactor?: number | null
  retailSalePrice?: number | null
  looseStock?: number
  subCategory?: string | null
  description?: string | null
  isPublished?: boolean
  categoryPath?: string | null
  // §3: phonetic search tags (JSON array string from transliteration)
  searchTags?: string | null
  createdAt: string
  updatedAt: string
}

export interface ProductImage {
  id: string
  productId: string
  url: string
  isPrimary: boolean
  order: number
  imageType?: string
  viewAngle?: string | null
  isProcessed?: boolean
  isHD?: boolean
  createdAt: string
}

export interface Transaction {
  id: string
  businessId: string
  partyId?: string | null
  type: TransactionType
  amount: number
  balanceAfter?: number | null
  description?: string | null
  category?: string | null
  invoiceId?: string | null
  createdAt: string
}

export interface InvoiceItem {
  id: string
  invoiceId: string
  productId?: string | null
  name: string
  quantity: number
  unitPrice: number
  discount: number
  gstRate: number
  total: number
}

export interface Invoice {
  id: string
  businessId: string
  partyId?: string | null
  invoiceNumber: string
  type: InvoiceType
  status: InvoiceStatus
  isGst: boolean
  subtotal: number
  discountValue: number
  discountMode: DiscountMode
  discountAmount: number
  gstAmount: number
  grandTotal: number
  amountPaid: number
  amountDue: number
  paymentMode?: string | null
  notes?: string | null
  paymentLandingToken?: string | null
  // §HISTORY: fulfillment + collection fields (synced with Prisma schema)
  deliveryStatus?: string | null
  collectedByName?: string | null
  collectedByRole?: string | null
  paidToName?: string | null
  paidToRole?: string | null
  createdAt: string
  updatedAt?: string
  items?: InvoiceItem[]
  party?: Party | null
}

export interface DashboardStats {
  totalReceivable: number
  totalPayable: number
  todaySales: number
  monthlyRevenue: number
  lowStockCount: number
  healthScore: number
  topDebtors: Array<{ id: string; name: string; balance: number; grade: QualityGrade }>
  recentTransactions: Transaction[]
  salesTrend: Array<{ date: string; fullDate?: string; revenue: number; expense: number; profit: number; collected?: number; creditGiven?: number }>
  gradeDistribution: Array<{ grade: QualityGrade; count: number }>
}

export interface AppSettingsData {
  notificationsEnabled: boolean
  autoBackupEnabled: boolean
  language: string
  dateFormat: string
  invoicePrefix: string
  pinEnabled: boolean
}

// PRD Part 13: B2B Sourcing types
export interface SupplierCatalogItem {
  id: string
  businessId: string
  supplierId: string
  productName: string
  category?: string | null
  basePrice: number
  transportFare: number
  coolieCharge: number
  unit: string
  minOrderQty: number
  notes?: string | null
  isActive: boolean
  matchedProductId?: string | null
  createdAt: string
  updatedAt: string
  supplierName?: string
  perUnitLandedCost?: number
}

export interface PurchaseOrderItem {
  id: string
  purchaseOrderId: string
  catalogItemId?: string | null
  productName: string
  category?: string | null
  quantity: number
  unitPrice: number
  transportFare: number
  coolieCharge: number
  totalCost: number
  matchedProductId?: string | null
}

export type PurchaseOrderStatus = 'sent' | 'dispatched' | 'received' | 'cancelled'

export interface PurchaseOrder {
  id: string
  businessId: string
  supplierId: string
  poNumber: string
  status: PurchaseOrderStatus
  totalAmount: number
  notes?: string | null
  dispatchedAt?: string | null
  receivedAt?: string | null
  createdAt: string
  updatedAt: string
  items?: PurchaseOrderItem[]
  supplier?: Party | null
}

export interface SourcingMatch {
  catalogItemId: string
  supplierId: string
  supplierName: string
  productName: string
  basePrice: number
  transportFare: number
  coolieCharge: number
  perUnitLandedCost: number
  totalLandedCost: number
  unit: string
  minOrderQty: number
  similarity: number
  isBestChoice?: boolean
}

export interface SourcingCompareResult {
  query: string
  quantity: number
  matches: SourcingMatch[]
}
