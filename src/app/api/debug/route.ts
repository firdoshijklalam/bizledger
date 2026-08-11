import { NextResponse } from 'next/server'

// §SECURITY: Debug endpoint — blocked in production to prevent info leakage.
export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'This endpoint is disabled in production' }, { status: 403 })
  }
  const dbUrl = process.env.DATABASE_URL || '(not set)'
  const masked = dbUrl.replace(/:[^:@]+@/, ':****@')
  return NextResponse.json({
    hasUrl: !!process.env.DATABASE_URL,
    urlStart: dbUrl.substring(0, 15),
    urlLength: dbUrl.length,
    maskedUrl: masked.substring(0, 80),
    nodeEnv: process.env.NODE_ENV,
    isPostgres: dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://'),
  })
}
