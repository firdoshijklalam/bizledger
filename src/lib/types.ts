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

export type PartyType = 'customer' | 'supplier' | 'both'
export type QualityGrade = 'A' | 'B' | 'C' | 'D' | 'E'

export type TransactionType = 'credit' | 'debit' | 'sale' | 'purchase' | 'expense'

export type InvoiceType = 'sales' | 'purchase' | 'retail' | 'challan'
export type InvoiceStatus = 'unpaid' | 'partial' | 'paid'
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
  createdAt: string
  updatedAt: string
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
  createdAt: string
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
  salesTrend: Array<{ date: string; revenue: number; expense: number; profit: number }>
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
