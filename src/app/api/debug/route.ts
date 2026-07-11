import { NextResponse } from 'next/server'

export async function GET() {
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
