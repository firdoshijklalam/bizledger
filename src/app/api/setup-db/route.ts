import { NextResponse } from 'next/server'
import { PrismaClient } from '@prisma/client'

export async function GET() {
  try {
    let dbUrl = process.env.DATABASE_URL || ''
    if (dbUrl.includes('channel_binding')) {
      dbUrl = dbUrl.replace(/&?channel_binding=require/, '')
    }
    
    const db = new PrismaClient({
      datasources: { db: { url: dbUrl } }
    })
    
    await db.$connect()
    const result = await db.$queryRaw`SELECT 1 as test`
    await db.$disconnect()
    
    return NextResponse.json({ 
      ok: true, 
      hasUrl: dbUrl.length > 0,
      isPg: dbUrl.startsWith('postgresql://') || dbUrl.startsWith('postgres://'),
      message: 'Database connected! Call /api/seed to add data.'
    })
  } catch (e: any) {
    return NextResponse.json({ 
      ok: false, 
      error: e.message,
      hasUrl: !!process.env.DATABASE_URL,
      urlStart: (process.env.DATABASE_URL || '').substring(0, 30)
    })
  }
}
