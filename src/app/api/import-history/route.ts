import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth/session'

// GET /api/import-history
// Returns the last 50 import history entries for the authenticated business.
// §SECURITY: Authenticated users can view history (no role restriction —
// viewing import history is safe; only performing imports requires OWNER).
export async function GET() {
  const user = await requireRole(['OWNER', 'ADMIN', 'STAFF'])
  if (user instanceof NextResponse) return user

  const history = await db.importHistory.findMany({
    where: { businessId: user.businessId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: {
      id: true,
      importType: true,
      sourceFileName: true,
      sourceFormat: true,
      rowCount: true,
      importedCount: true,
      skippedCount: true,
      failedCount: true,
      status: true,
      createdAt: true,
      completedAt: true,
    },
  })

  return NextResponse.json({ items: history, total: history.length })
}
