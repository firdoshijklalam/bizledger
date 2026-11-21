import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth/session'

// GET /api/import-history/[id]
// Returns full details of a specific import, including the error report.
// §SECURITY: Authenticated users can view (no role restriction).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireRole(['OWNER', 'ADMIN', 'STAFF'])
  if (user instanceof NextResponse) return user

  const { id } = await params

  const record = await db.importHistory.findFirst({
    where: { id, businessId: user.businessId },
  })

  if (!record) {
    return NextResponse.json({ error: 'Import record not found' }, { status: 404 })
  }

  // Parse the error report JSON
  let errors: any[] = []
  if (record.errorReportJson) {
    try {
      errors = JSON.parse(record.errorReportJson)
    } catch {
      errors = []
    }
  }

  return NextResponse.json({
    id: record.id,
    importType: record.importType,
    sourceFileName: record.sourceFileName,
    sourceFormat: record.sourceFormat,
    rowCount: record.rowCount,
    importedCount: record.importedCount,
    skippedCount: record.skippedCount,
    failedCount: record.failedCount,
    status: record.status,
    createdAt: record.createdAt,
    completedAt: record.completedAt,
    errors,
  })
}
