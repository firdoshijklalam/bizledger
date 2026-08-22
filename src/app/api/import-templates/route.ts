import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/session'
import { generateTemplate, getTemplateFilename, type ImportEntityType } from '@/lib/external-import'

// GET /api/import-templates?type=customers|suppliers|products|opening-balances
//
// §SECURITY: Authenticated users can download templates (no role restriction —
// templates contain no business data, just column headers + a sample row).
//
// Returns a CSV file with UTF-8 BOM (for Bengali text in Excel) containing:
// - Header row with required (*) and optional columns
// - One sample row
export async function GET(req: NextRequest) {
  const user = await requireRole(['OWNER', 'ADMIN', 'STAFF'])
  if (user instanceof NextResponse) return user

  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') as ImportEntityType

  if (!type || !['customers', 'suppliers', 'products', 'opening-balances'].includes(type)) {
    return NextResponse.json({ error: 'Invalid template type. Must be: customers, suppliers, products, or opening-balances' }, { status: 400 })
  }

  const csv = generateTemplate(type)
  const filename = getTemplateFilename(type)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
