import { db } from '@/lib/db'

/**
 * §AUDIT-LOG: Centralized audit logging utility.
 * Logs critical business actions (invoice create/delete, stock changes,
 * data export, staff changes, settings changes) to the AuditLog table.
 *
 * Usage:
 *   await logAudit({
 *     businessId: business.id,
 *     action: 'create_invoice',
 *     entityType: 'invoice',
 *     entityId: invoice.id,
 *     description: `Invoice ${invoice.invoiceNumber} created for ₹${grandTotal}`,
 *     metadata: JSON.stringify({ amount: grandTotal, partyId: invoice.partyId }),
 *   })
 */
export async function logAudit(params: {
  businessId: string
  staffId?: string | null
  staffName?: string
  action: string
  entityType: string
  entityId?: string | null
  description: string
  metadata?: string | null
}) {
  try {
    await db.auditLog.create({
      data: {
        businessId: params.businessId,
        staffId: params.staffId || null,
        staffName: params.staffName || 'system',
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId || null,
        description: params.description,
        metadata: params.metadata || null,
      },
    })
  } catch (e) {
    // §NON-FATAL: Audit logging should never break the main operation.
    // Just log the error and continue.
    console.error('[AuditLog] Failed to log:', params.action, e)
  }
}

/**
 * Pre-defined audit actions for consistency.
 */
export const AUDIT_ACTIONS = {
  // Invoice
  INVOICE_CREATE: 'create_invoice',
  INVOICE_UPDATE: 'modify_invoice',
  INVOICE_DELETE: 'delete_invoice',
  INVOICE_VOID: 'void_invoice',
  // Stock
  STOCK_ADJUST: 'stock_adjust',
  RESTOCK: 'restock',
  // Party
  PARTY_CREATE: 'create_party',
  PARTY_UPDATE: 'modify_party',
  PARTY_DELETE: 'delete_party',
  // Transaction
  KHATA_ENTRY: 'khata_entry',
  // Settings
  SETTINGS_CHANGE: 'settings_change',
  // Data
  DATA_EXPORT: 'data_export',
  // Staff
  STAFF_CREATE: 'staff_create',
  STAFF_UPDATE: 'staff_update',
  STAFF_DELETE: 'staff_delete',
} as const

/**
 * Pre-defined entity types for consistency.
 */
export const ENTITY_TYPES = {
  INVOICE: 'invoice',
  PARTY: 'party',
  PRODUCT: 'product',
  TRANSACTION: 'transaction',
  SETTINGS: 'settings',
  STAFF: 'staff',
  EXPORT: 'export',
} as const
